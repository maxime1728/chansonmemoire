// netlify/functions/aide-plafond.js
// Client qui a atteint le PLAFOND de versions (popup aperçu « on veut t'aider »). Capture DEUX choses :
//   1. son courriel (cap_help_email/cap_help_at sur le Projet) -> recontact ;
//   2. (optionnel mais PRIORITAIRE) le TEXTE de sa demande -> ligne Conversations DURABLE (cockpit), pour ne
//      JAMAIS perdre ce qu'il a écrit. Si une conversation existe déjà pour ce client (thread_key = courriel),
//      on GREFFE la demande dessus (pas de doublon, même fil) ; sinon on en crée une.
// « Rien perdre » : si un texte est fourni et que la capture Conversations échoue, on répond 5xx -> le client
//   voit « réessaie » (jamais un faux « reçu »). Sans texte, c'est le courriel qui est la capture (échec = 5xx).
// PAS de gating `purchased` (le plafond est surtout pré-achat ; la capture vaut aussi post-achat).
// Sécurité : POST, UUID v4 strict, formule échappée, secrets en env.

const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TOKEN   = process.env.AIRTABLE_TOKEN;
const API     = `https://api.airtable.com/v0/${BASE_ID}`;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONVOS    = 'tbl3KBgXthCPromxF';   // table Conversations (cockpit)
const MAX_TEXTE = 90000;

function formulaLiteral(v) {
  const s = String(v);
  if (!s.includes('"')) return `"${s}"`;
  if (!s.includes("'")) return `'${s}'`;
  return null;
}

// Capture durable de la demande au plafond dans Conversations. Greffe sur la conversation existante du client
// (thread_key = courriel = 1 fil par client, même convention que courriel-entrant) si elle existe, sinon crée.
// Renvoie true seulement si la demande est bien enregistrée.
async function capturerDemande(projet, email, details, headers) {
  const p = projet.fields || {};
  const now = new Date();
  const threadKey = email.toLowerCase().slice(0, 250);
  const post = p.commercial_status === 'purchased';
  const horodatage = now.toISOString().slice(0, 16).replace('T', ' ');

  // Conversation existante du client (même courriel) ?
  let existing = null;
  const litThread = formulaLiteral(threadKey);
  if (litThread !== null) {
    const fT = encodeURIComponent(`{thread_key}=${litThread}`);
    const rT = await fetch(`${API}/${CONVOS}?filterByFormula=${fT}&sort%5B0%5D%5Bfield%5D=recu_le&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=1`, { headers });
    if (rT.ok) existing = (((await rT.json().catch(() => ({}))).records) || [])[0] || null;
  }

  if (existing) {
    // GREFFE : la demande s'ajoute au fil de la MÊME conversation (pas de doublon) et la rouvre. On vide
    // brouillon_ia/resume_ia pour que brouillon-cron re-rédige sur le fil complet (et recatégorise).
    const sep = `\n\n──────── ${horodatage} (plafond) ────────\n`;
    const message    = ((existing.fields.message || '') + sep + details).slice(-MAX_TEXTE);
    const histoEntry = `↓ ${horodatage} — demande au plafond de ${email}\n${details}`;
    const historique = ((existing.fields.historique || '') + '\n\n' + histoEntry).slice(-MAX_TEXTE);
    const liens = [...new Set([...(Array.isArray(existing.fields.Projet) ? existing.fields.Projet : []), projet.id])];
    const r = await fetch(`${API}/${CONVOS}/${existing.id}`, {
      method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ typecast: true, fields: {
        message, historique, statut: 'a_verifier', brouillon_ia: '', resume_ia: '',
        recu_le: now.toISOString(), Projet: liens
      } })
    });
    return r.ok;
  }

  // Sinon : nouvelle conversation, pré-catégorisée modification (brouillon-cron confirmera).
  const r = await fetch(`${API}/${CONVOS}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ typecast: true, fields: {
      expediteur:   email,
      sujet:        `Demande (plafond atteint)${p.deceased_name ? ' : ' + p.deceased_name : ''}`,
      message:      details,
      historique:   `↓ ${horodatage} — demande au plafond de ${email}\n${details}`,
      recu_le:      now.toISOString(),
      statut:       'a_verifier',
      categorie_ia: 'modification',
      phase_achat:  post ? 'apres_achat' : 'avant_achat',
      thread_key:   threadKey,
      Projet:       [projet.id]
    } })
  });
  return r.ok;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Méthode non permise' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Requête invalide' }) }; }

  const token   = (body.token || '').trim();
  const email   = (body.email || '').toString().trim().slice(0, 120);
  const details = (body.details || '').toString().trim().slice(0, 4000);
  if (!UUID_V4.test(token))               return { statusCode: 400, body: JSON.stringify({ error: 'Token invalide' }) };
  if (!email || email.indexOf('@') < 1)   return { statusCode: 400, body: JSON.stringify({ error: 'Courriel invalide' }) };

  const headers = { Authorization: `Bearer ${TOKEN}` };

  try {
    // Project par token (token validé UUID -> littéral sûr). Pas de gate purchased (plafond = surtout pré-achat).
    const fP = encodeURIComponent(`{token}=${formulaLiteral(token)}`);
    const rP = await fetch(`${API}/Projects?filterByFormula=${fP}&maxRecords=1`, { headers });
    const dP = await rP.json();
    if (!dP.records || dP.records.length === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Introuvable' }) };   // 404 nu
    }
    const projet = dP.records[0];

    // 1. CAPTURE DURABLE de la demande (prioritaire = « rien perdre »). Échec avec texte fourni -> 5xx.
    if (details) {
      let capture = false;
      try { capture = await capturerDemande(projet, email, details, headers); }
      catch (_) { capture = false; }
      if (!capture) return { statusCode: 502, body: JSON.stringify({ error: 'Enregistrement impossible' }) };
    }

    // 2. Courriel de recontact sur le Projet. Sans texte, c'est la SEULE capture -> son échec = 5xx (comme avant).
    let emailOk = true;
    try {
      const r = await fetch(`${API}/Projects/${projet.id}`, {
        method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { cap_help_email: email, cap_help_at: new Date().toISOString() } })
      });
      emailOk = r.ok;
    } catch (_) { emailOk = false; }
    if (!details && !emailOk) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Enregistrement impossible' }) };
    }

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Erreur serveur' }) };
  }
};

// Observabilite : capture Sentry des exceptions non gerees (inerte sans SENTRY_DSN). Voir _lib/sentry.js.
const { withSentry } = require('./_lib/sentry');
exports.handler = withSentry(exports.handler);
