// netlify/functions/brouillon-cron.js
//
// SUPPORT — RÉDACTION des brouillons IA (découplée de la réception). Fonction planifiée (chaque minute).
// Trouve les conversations en file SANS brouillon et fait rédiger une réponse par Claude.
//
// POURQUOI séparé : la réception (courriel-entrant) ne fait que STOCKER -> aucun courriel n'est perdu
// si Anthropic est lent/en panne. Ce cron est AUTO-RÉPARANT : si Anthropic tombe, les courriels restent
// stockés sans brouillon et sont rédigés dès qu'Anthropic répond (au passage suivant). (Anthropic plante
// parfois plusieurs fois par mois -> cette résilience est volontaire.)
//
// Voix de marque (CLAUDE.md §1) : SOLUTION-FIRST, québécois, digne. Garde-fou légal (§2) : remboursement
// / allégation = confiance basse, jamais auto. Best-effort. Env : ANTHROPIC_API_KEY, AIRTABLE_TOKEN, AIRTABLE_BASE_ID.

const BASE_ID  = process.env.AIRTABLE_BASE_ID;
const AT_TOKEN = process.env.AIRTABLE_TOKEN;
const API      = `https://api.airtable.com/v0/${BASE_ID}`;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const CONVOS   = 'tbl3KBgXthCPromxF';
const PROJECTS = 'tblh7O8eoog7RyTMJ';
const SITE     = 'https://chansonmemoire.ca';
const MAX_PER_RUN = 5;
const MAX_TEXTE   = 90000;
const TIMEOUT_MS  = 20000;

const { piedAuto } = require('./_lib/pied-courriel');
// Génération du brouillon (prompt de marque + contexte projets + appel Anthropic) = source UNIQUE partagée
// avec le cockpit (action regen_draft, qui régénère avec un TON choisi). Voir _lib/brouillon.js.
const { construireContexts, genererBrouillon } = require('./_lib/brouillon');

// RÉSUMÉ d'un fil clôturé : 1-2 phrases pour avoir une ligne lisible par client sans dérouler tout l'échange.
// Best-effort (timeout) : '' si indisponible -> on réessaiera au passage suivant.
async function genererResume(f) {
  if (!ANTHROPIC_KEY) return '';
  const fil = (f.historique || f.message || '').slice(-MAX_TEXTE);
  if (!fil.trim()) return '';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 200,
        system: "Résume ce fil de support client en 1 à 2 phrases neutres et factuelles : ce que le client demandait et ce qui a été fait ou répondu. Français correct, sans tiret cadratin. Réponds UNIQUEMENT par le résumé, rien d'autre.",
        messages: [{ role: 'user', content: fil }] })
    });
    if (!res.ok) return '';
    const data = await res.json().catch(() => ({}));
    return ((data.content && data.content[0] && data.content[0].text) || '').trim();
  } catch (_) { return ''; }
  finally { clearTimeout(timer); }
}

exports.handler = async () => {
  if (!ANTHROPIC_KEY) return { statusCode: 200, body: JSON.stringify({ ok: false, reason: 'no_key' }) };
  const headers = { Authorization: `Bearer ${AT_TOKEN}` };
  let rediges = 0, echecs = 0;

  try {
    // Conversations en file SANS brouillon (capturées par courriel-entrant, ou re-mises à vide au regroupement).
    const formula = encodeURIComponent('AND({statut}="a_verifier", {brouillon_ia}="")');
    const r = await fetch(`${API}/${CONVOS}?filterByFormula=${formula}&maxRecords=${MAX_PER_RUN}`, { headers });
    const d = await r.json().catch(() => ({}));
    const recs = (d && d.records) || [];

    for (const rec of recs) {
      const f = rec.fields || {};
      const contexts = await construireContexts({ api: API, headers, projectsTable: PROJECTS, site: SITE, projectIds: Array.isArray(f.Projet) ? f.Projet : [] });
      const ia = await genererBrouillon({ key: ANTHROPIC_KEY, fields: f, contexts });
      if (!ia || !ia.brouillon) { echecs++; continue; }   // Anthropic indispo -> on réessaiera (auto-réparation)
      const conf = ['haute', 'moyenne', 'basse'].includes(ia.confiance) ? ia.confiance : 'basse';
      const cat  = ['question', 'modification', 'remboursement', 'remerciement', 'autre'].includes(ia.categorie) ? ia.categorie : 'autre';
      try {
        await fetch(`${API}/${CONVOS}/${rec.id}`, {
          method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { brouillon_ia: `${ia.brouillon.slice(0, MAX_TEXTE)}\n\n${piedAuto()}`, confiance_ia: conf, categorie_ia: cat } })
        });
        rediges++;
      } catch (_) { echecs++; }
    }

    // 2e passe : RÉSUMÉ des fils clôturés (statut=repondu) encore sans resume_ia -> 1 ligne lisible par client.
    let resumes = 0;
    try {
      const fR = encodeURIComponent('AND({statut}="repondu", {resume_ia}="")');
      const rR = await fetch(`${API}/${CONVOS}?filterByFormula=${fR}&maxRecords=${MAX_PER_RUN}`, { headers });
      const recsR = (((await rR.json().catch(() => ({}))).records) || []);
      for (const rec of recsR) {
        const resume = await genererResume(rec.fields || {});
        if (!resume) continue;
        try {
          await fetch(`${API}/${CONVOS}/${rec.id}`, {
            method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { resume_ia: resume.slice(0, MAX_TEXTE) } })
          });
          resumes++;
        } catch (_) {}
      }
    } catch (_) {}

    return { statusCode: 200, body: JSON.stringify({ ok: true, trouve: recs.length, rediges, echecs, resumes }) };
  } catch (err) {
    console.error('[brouillon-cron]', err && err.message);
    return { statusCode: 200, body: '{}' };
  }
};

// Observabilite : heartbeat Healthchecks (dead man's switch) + capture Sentry. Voir _lib/cron.js.
const { withCron } = require('./_lib/cron');
exports.handler = withCron('brouillon-cron', exports.handler);
