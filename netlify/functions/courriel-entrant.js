// netlify/functions/courriel-entrant.js
//
// SUPPORT ENTRANT — reçoit une réponse client (courriel) et la dépose dans la file « Conversations »
// d'Airtable avec un BROUILLON DE RÉPONSE rédigé par Claude. Maxime relit, ajuste, répond (Phase 1).
// Plus tard : auto-réponse des cas à haute confiance (Phase 2).
//
// CHEMIN : Route Mailgun (achat/info) -> petit webhook Make (décortique le multipart) -> POST ici en
// JSON PROPRE { secret, from, subject, body, message_id }. On évite ainsi de parser du multipart brut.
//
// SÉCURITÉ : gate par `secret` == MAKE_WEBHOOK_SECRET (sinon n'importe qui crée des lignes + dépense
// des crédits Anthropic). On ignore nos propres adresses + les auto-réponses (bounces, absences).
// Best-effort : on répond toujours 200 (sauf secret invalide) pour ne pas faire boucler Make.
//
// Voix de marque (CLAUDE.md §1) : SOLUTION-FIRST, jamais ouvrir sur le deuil ; sobre, digne, québécois.
// Garde-fou légal (§2) : un remboursement / une allégation ne se décide JAMAIS en auto -> confiance
// basse + escalade humaine. Le brouillon n'est qu'une SUGGESTION, jamais envoyé sans relecture.
//
// Env : MAKE_WEBHOOK_SECRET, ANTHROPIC_API_KEY, AIRTABLE_TOKEN, AIRTABLE_BASE_ID.

const BASE_ID  = process.env.AIRTABLE_BASE_ID;
const AT_TOKEN = process.env.AIRTABLE_TOKEN;
const API      = `https://api.airtable.com/v0/${BASE_ID}`;
const SECRET   = process.env.MAKE_WEBHOOK_SECRET;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const CLIENTS = 'tblQbF1OlE3uRxFra';
const PROJECTS = 'tblh7O8eoog7RyTMJ';
const CONVOS   = 'tbl3KBgXthCPromxF';
const CLIENT_PROJECTS_LINK = 'fldayFzM1PdALeWKL';   // champ lien Clients -> Projects (lu par returnFieldsByFieldId)

// Échappe une valeur pour un littéral filterByFormula (cf. lire-projet).
function formulaLiteral(v) {
  const s = String(v);
  if (!s.includes('"')) return `"${s}"`;
  if (!s.includes("'")) return `'${s}'`;
  return null;
}

// Adresses qui ne doivent JAMAIS créer de conversation (nos propres envois, no-reply, notifications).
function estAdresseInterne(addr) {
  const a = (addr || '').toLowerCase();
  return /@(achat|info|mg|mail)\.chansonmemoire\.ca$/.test(a)
      || /\bno-?reply@/.test(a)
      || /(mailer-daemon|postmaster)@/.test(a);
}
// Sujets d'auto-réponse à ignorer (absences, accusés, rapports de non-remise).
function estAutoReponse(subject) {
  return /^(re:\s*)?(out of office|absence|automatic reply|réponse automatique|delivery status|undeliverable|mail delivery|échec de remise)/i.test(subject || '');
}

// Extrait le premier objet JSON d'un texte (le modèle peut emballer dans de la prose).
function extraireJson(txt) {
  if (!txt) return null;
  const i = txt.indexOf('{'), j = txt.lastIndexOf('}');
  if (i === -1 || j === -1 || j < i) return null;
  try { return JSON.parse(txt.slice(i, j + 1)); } catch (_) { return null; }
}

const SYSTEM = `Tu es l'assistant du SERVICE CLIENT de Chanson Mémoire (chansons hommage et cadeau personnalisées, marché québécois francophone).

Ta tâche : à partir du courriel reçu d'un client et du contexte de son projet, rédiger un BROUILLON de réponse que l'équipe relira avant envoi.

VOIX DE MARQUE — IMPÉRATIF :
- Français QUÉBÉCOIS, naturel, chaleureux, sobre et digne. Vouvoiement.
- SOLUTION-FIRST : n'ouvre JAMAIS sur le deuil ou la douleur. Entre par ce qu'on offre / ce qu'on peut faire pour la personne.
- Pas larmoyant, pas de clichés. Concis et humain.
- Signe « L'équipe Chanson Mémoire ».

GARDE-FOUS — NE JAMAIS faire de façon autonome (mets alors confiance="basse") :
- Promettre, confirmer ou refuser un REMBOURSEMENT.
- Avancer un prix, une promotion, une garantie de résultat ou une allégation.
- Toute question juridique, plainte, ou litige.
Dans ces cas, rédige un accusé de réception empathique qui dit qu'un membre de l'équipe revient personnellement — sans rien promettre.

CONFIANCE :
- "haute" : question simple répondable avec le contexte (état de la commande, comment accéder à la chanson, délais), ton neutre/positif.
- "moyenne" : demande de modification claire, ou question partiellement couverte.
- "basse" : remboursement, plainte, sujet sensible/légal, ou contexte insuffisant.

CATÉGORIE : "question" | "modification" | "remboursement" | "remerciement" | "autre".

RÉPONDS UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"brouillon":"<la réponse complète, prête à relire>","confiance":"haute|moyenne|basse","categorie":"question|modification|remboursement|remerciement|autre"}`;

async function redigerBrouillon(from, subject, bodyMsg, contexte) {
  if (!ANTHROPIC_KEY) return null;
  const userPrompt =
    `COURRIEL REÇU\nDe : ${from}\nSujet : ${subject || '(aucun)'}\nMessage :\n${(bodyMsg || '').slice(0, 4000)}\n\n` +
    `CONTEXTE DU PROJET (peut être vide si client non retrouvé) :\n${JSON.stringify(contexte || {})}`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system: SYSTEM,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { console.error('[courriel-entrant] Anthropic', res.status); return null; }
    const txt = (data.content && data.content[0] && data.content[0].text) || '';
    return extraireJson(txt);
  } catch (e) { console.error('[courriel-entrant] Anthropic', e && e.message); return null; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '{}' };
  if (!SECRET) { console.error('[courriel-entrant] MAKE_WEBHOOK_SECRET manquant'); return { statusCode: 500, body: '{}' }; }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return { statusCode: 400, body: '{}' }; }
  if ((body.secret || '') !== SECRET) return { statusCode: 403, body: '{}' };

  const from    = (body.from || '').toString().trim();
  const subject = (body.subject || '').toString().trim();
  const message = (body.body || '').toString().trim();
  const msgId   = (body.message_id || '').toString().trim();

  // Filtres : pas d'expéditeur, nos propres adresses, ou auto-réponses -> on ignore proprement.
  if (!from) return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'no_sender' }) };
  if (estAdresseInterne(from)) return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'internal' }) };
  if (estAutoReponse(subject)) return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'auto_reply' }) };

  const headers = { Authorization: `Bearer ${AT_TOKEN}` };

  try {
    // 1. MATCH : Client par email (insensible à la casse) -> son projet le plus récent.
    let projectId = '';
    let contexte = {};
    const lit = formulaLiteral(from);
    if (lit !== null) {
      const fC = encodeURIComponent(`LOWER({email})=LOWER(${lit})`);
      const rC = await fetch(`${API}/${CLIENTS}?filterByFormula=${fC}&maxRecords=1&returnFieldsByFieldId=true`, { headers });
      const dC = await rC.json().catch(() => ({}));
      const client = dC.records && dC.records[0];
      if (client) {
        const projs = client.fields && client.fields[CLIENT_PROJECTS_LINK];
        if (Array.isArray(projs) && projs.length) projectId = projs[projs.length - 1];   // le plus récent
      }
    }

    // 2. Contexte projet pour le brouillon (best-effort).
    if (projectId) {
      try {
        const rP = await fetch(`${API}/${PROJECTS}/${projectId}`, { headers });
        if (rP.ok) {
          const p = (await rP.json()).fields || {};
          contexte = {
            prenom_personne: p.deceased_name || '',
            type: p.song_type || 'hommage',
            langue: p.language || 'fr-CA',
            statut_commande: p.commercial_status || 'preview_only',
            etape: p.approval_status || ''
          };
        }
      } catch (_) {}
    }

    // 3. Brouillon IA (best-effort : la conversation est créée même si l'IA échoue).
    const ia = await redigerBrouillon(from, subject, message, contexte) || {};
    const conf = ['haute', 'moyenne', 'basse'].includes(ia.confiance) ? ia.confiance : 'basse';
    const cat  = ['question', 'modification', 'remboursement', 'remerciement', 'autre'].includes(ia.categorie) ? ia.categorie : 'autre';

    // 4. Crée la ligne dans la file « à vérifier ».
    const fields = {
      expediteur: from,
      sujet: subject.slice(0, 250),
      message: message.slice(0, 95000),
      recu_le: new Date().toISOString(),
      brouillon_ia: (ia.brouillon || '').slice(0, 95000),
      confiance_ia: conf,
      categorie_ia: cat,
      statut: 'a_verifier',
      message_id: msgId.slice(0, 250)
    };
    if (projectId) fields.Projet = [projectId];

    const rCreate = await fetch(`${API}/${CONVOS}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields })
    });
    if (!rCreate.ok) { console.error('[courriel-entrant] create', rCreate.status, await rCreate.text().catch(() => '')); }

    return { statusCode: 200, body: JSON.stringify({ ok: true, matched: !!projectId, confiance: conf }) };
  } catch (err) {
    console.error('[courriel-entrant]', err && err.message);
    return { statusCode: 200, body: '{}' };   // best-effort
  }
};
