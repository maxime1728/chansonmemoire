// netlify/functions/mailgun-events.js
//
// WEBHOOK Mailgun (events) — observabilité des courriels (Phase 3). Reçoit les événements de livraison de
// Mailgun (delivered / opened / clicked / failed / complained) et met à jour la ligne `Courriels` créée à
// l'envoi par _lib/courriel.js, rattachée sur le Message-Id.
//
// Sécurité : signature HMAC-SHA256(timestamp + token) == signature, clé MAILGUN_SIGNING_KEY (même schéma que
// courriel-entrant ; ici le POST est en JSON { signature, event-data }, pas en multipart).
// Statut : on n'écrase JAMAIS en arrière (un 'clicked' tardif ne doit pas être ramené à 'livré'). 'rejeté' gagne.
// Best-effort : un event pour un courriel non suivi (Message-Id inconnu) -> 200 silencieux. Idempotent.
// Env : MAILGUN_SIGNING_KEY, AIRTABLE_TOKEN, AIRTABLE_BASE_ID.

const crypto = require('crypto');

const BASE = process.env.AIRTABLE_BASE_ID;
const AT   = process.env.AIRTABLE_TOKEN;
const API  = `https://api.airtable.com/v0/${BASE}`;
const SIGNING_KEY = process.env.MAILGUN_SIGNING_KEY;
const COURRIELS = 'Courriels';
const CONVOS = 'tbl3KBgXthCPromxF';
const CONVO_LINK_FIELD = 'fldKyTLaRXbGoFitP';   // lien Conversation (réciproque) sur la ligne Courriels

// Rang des statuts : on ne redescend jamais. 'rejeté' est terminal et l'emporte.
const RANG = { 'envoyé': 1, 'livré': 2, 'ouvert': 3, 'cliqué': 4, 'rejeté': 9 };

function formulaLiteral(v) {
  const s = String(v);
  if (!s.includes('"')) return `"${s}"`;
  if (!s.includes("'")) return `'${s}'`;
  return null;
}

function verifie(timestamp, token, signature) {
  if (!SIGNING_KEY || !timestamp || !token || !signature) return false;
  const attendu = crypto.createHmac('sha256', SIGNING_KEY).update(String(timestamp) + String(token)).digest('hex');
  try {
    const a = Buffer.from(attendu), b = Buffer.from(String(signature));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) { return false; }
}

// Mappe un event Mailgun -> { statut, champs de date }. Renvoie null pour les events ignorés.
function mapEvent(evt, isoNow, row) {
  const f = (row && row.fields) || {};
  switch (evt) {
    case 'delivered': return { statut: 'livré',  fields: { livre_le: f.livre_le || isoNow } };
    case 'opened':    return { statut: 'ouvert', fields: { ouvert_le: f.ouvert_le || isoNow, ouvertures: (parseInt(f.ouvertures, 10) || 0) + 1 } };
    case 'clicked':   return { statut: 'cliqué', fields: { clique_le: f.clique_le || isoNow } };
    case 'failed':    return { statut: 'rejeté', fields: { bounced: true } };
    case 'complained':return { statut: 'rejeté', fields: { bounced: true } };
    default:          return null;   // accepted / stored / unsubscribed... : ignorés
  }
}

// Conversation liée à une ligne Courriels (lue par ID de champ -> robuste au nom du réciproque auto-créé).
async function conversationDuCourriel(courrielId) {
  try {
    const r = await fetch(`${API}/${COURRIELS}/${courrielId}?returnFieldsByFieldId=true`, { headers: { Authorization: `Bearer ${AT}` } });
    if (!r.ok) return '';
    const link = ((await r.json()).fields || {})[CONVO_LINK_FIELD];
    return (Array.isArray(link) && link[0]) || '';
  } catch (_) { return ''; }
}

// Propage le statut de livraison au fil lié (dernier_envoi_statut), même garde anti-régression. Best-effort.
async function propagerAuFil(courrielId, statut) {
  const convoId = await conversationDuCourriel(courrielId);
  if (!convoId) return;
  try {
    const rc = await fetch(`${API}/${CONVOS}/${convoId}`, { headers: { Authorization: `Bearer ${AT}` } });
    if (!rc.ok) return;
    const actuel = ((await rc.json()).fields || {}).dernier_envoi_statut || 'envoyé';
    if ((RANG[statut] || 0) >= (RANG[actuel] || 0)) {
      await fetch(`${API}/${CONVOS}/${convoId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${AT}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ typecast: true, fields: { dernier_envoi_statut: statut } })
      });
    }
  } catch (_) {}
}

async function trouverParMessageId(mid) {
  const lit = formulaLiteral(mid);
  if (lit === null) return null;
  const f = encodeURIComponent(`{message_id}=${lit}`);
  const r = await fetch(`${API}/${COURRIELS}?filterByFormula=${f}&maxRecords=1`, { headers: { Authorization: `Bearer ${AT}` } });
  if (!r.ok) return null;
  return (((await r.json()).records) || [])[0] || null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '{}' };
  if (!SIGNING_KEY) { console.error('[mailgun-events] MAILGUN_SIGNING_KEY manquant'); return { statusCode: 500, body: '{}' }; }
  if (!BASE || !AT) { console.error('[mailgun-events] Airtable manquant'); return { statusCode: 500, body: '{}' }; }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return { statusCode: 400, body: '{}' }; }

  const sig = body.signature || {};
  if (!verifie(sig.timestamp, sig.token, sig.signature)) return { statusCode: 403, body: '{}' };

  const ed  = body['event-data'] || {};
  const evt = ed.event || '';
  const mid = (((ed.message && ed.message.headers && ed.message.headers['message-id']) || '')).replace(/^<|>$/g, '');
  if (!mid) return { statusCode: 200, body: '{}' };   // pas de Message-Id -> rien à rattacher

  try {
    const row = await trouverParMessageId(mid);
    if (!row) return { statusCode: 200, body: '{}' };  // courriel non suivi (alerte interne, etc.)

    const isoNow = new Date(ed.timestamp ? ed.timestamp * 1000 : Date.now()).toISOString();
    const m = mapEvent(evt, isoNow, row);
    if (!m) return { statusCode: 200, body: '{}' };

    const fields = Object.assign({}, m.fields);
    // Statut : on n'avance que vers l'avant (un event en retard ne fait pas régresser le statut).
    const actuel = (row.fields && row.fields.statut) || 'envoyé';
    if ((RANG[m.statut] || 0) >= (RANG[actuel] || 0)) fields.statut = m.statut;

    await fetch(`${API}/${COURRIELS}/${row.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${AT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ typecast: true, fields })
    });

    // Reflète le statut sur le fil de support lié (vue inbox), si la ligne est rattachée à une conversation.
    await propagerAuFil(row.id, m.statut);

    return { statusCode: 200, body: '{}' };
  } catch (err) {
    console.error('[mailgun-events]', err && err.message);
    return { statusCode: 200, body: '{}' };   // best-effort : on ne demande pas à Mailgun de rejouer en boucle
  }
};

// Observabilite : capture Sentry des exceptions non gerees (inerte sans SENTRY_DSN). Voir _lib/sentry.js.
const { withSentry } = require('./_lib/sentry');
exports.handler = withSentry(exports.handler);
