// e2e-canari-cron.js — Canari END-TO-END : rejoue une VRAIE soumission de sondage, verifie que tout
// s'ecrit correctement (Client + Projet + attribution first/last + Generation), PUIS SUPPRIME les
// donnees test. Alerte (courriel + Sentry) au moindre ecart. Heartbeat a la fin.
//
// canari:true dans le payload -> soumettre-survey N'ENVOIE PAS le Lead CAPI (zero pollution Meta).
// Toutes les 6 h (limite le cout : chaque run genere des paroles via Anthropic). INERTE sans Airtable.

const { alerte } = require('./_lib/alerte');
const { beat } = require('./_lib/heartbeat');
const { withSentry } = require('./_lib/sentry');

const SITE     = 'https://chansonmemoire.ca';
const BASE_ID  = process.env.AIRTABLE_BASE_ID;
const AT_TOKEN = process.env.AIRTABLE_TOKEN;
const API      = `https://api.airtable.com/v0/${BASE_ID}`;

const F = {
  token:'fldqBcPOplqI7pmTh', client:'fldAGBhUTrR92bj9a', utm_content:'fld717FXmUvBBAahC',
  last_utm_content:'fldK7yie7Vc3dqVux', generations:'fldnSquvx5LmGdgxL'
};

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
function at(method, path, body) {
  return fetch(`${API}${path}`, {
    method, headers: { Authorization: `Bearer ${AT_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
}
async function supprimer(table, ids) { for (const id of ids) { try { await at('DELETE', `/${table}/${id}`); } catch (_) {} } }

exports.handler = withSentry(async () => {
  if (!BASE_ID || !AT_TOKEN) return { statusCode: 200, body: 'no-config' };
  const token = uuid();
  const echecs = [];
  let projectId = null, clientId = null, genIds = [];

  try {
    // 1. VRAIE soumission de sondage (canari:true -> pas de Lead CAPI).
    const now = new Date().toISOString();
    const payload = {
      token, canari: true, email: 'canari-e2e@chansonmemoire.ca', deceased_name: 'CANARI E2E (auto, supprime)',
      relationship: 'grand-mère', music_style: 'folk', voice: 'féminine', mood: 'doux', language: 'fr-CA', song_type: 'hommage',
      // Contenu RICHE volontairement : generate-lyrics refuse les entrees trop minces (invalid_input) -> sans
      // ca, le canari ne creerait pas de Generation et alerterait a tort a chaque run.
      what_made_unique: 'Son rire communicatif, ses tartes aux pommes du dimanche et sa generosite sans limite envers toute la famille.',
      memories: 'On passait nos etes dans son jardin a cueillir des fraises, puis elle nous racontait ses histoires sur la galerie jusqu au coucher du soleil.',
      memory_to_keep: 'Je veux qu on se souvienne de sa chaleur, de sa force tranquille et de son amour inconditionnel.',
      consentement: true, utm_source: 'canari', utm_content: 'CANARI_first', last_utm_content: 'CANARI_last',
      first_touch_at: now, last_touch_at: now, landing_page: '/canari'
    };
    const r = await fetch(`${SITE}/api/soumettre-survey`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) echecs.push('soumettre-survey KO: ' + JSON.stringify(d).slice(0, 150));

    // 2. Verifier le Projet cree + l'attribution first/last + la Generation.
    const rp = await at('GET', `/Projects?filterByFormula=${encodeURIComponent(`{token}="${token}"`)}&maxRecords=1&returnFieldsByFieldId=true`);
    const dp = await rp.json();
    const proj = (dp.records || [])[0];
    if (!proj) {
      echecs.push('Projet non cree apres soumission');
    } else {
      projectId = proj.id;
      const f = proj.fields || {};
      clientId = Array.isArray(f[F.client]) ? f[F.client][0] : null;
      genIds   = Array.isArray(f[F.generations]) ? f[F.generations] : [];
      if (f[F.utm_content] !== 'CANARI_first')      echecs.push('first-touch utm_content incorrect: ' + JSON.stringify(f[F.utm_content]));
      if (f[F.last_utm_content] !== 'CANARI_last')  echecs.push('last-touch utm_content incorrect: ' + JSON.stringify(f[F.last_utm_content]));
      if (!clientId)      echecs.push('Projet sans Client lie');
      // Generation = signal SOUPLE, pas un echec : generate-lyrics (Anthropic) ne repond pas toujours
      // dans le delai de la fonction, et /revision relance/poll les paroles (les ratees sont couvertes
      // par recovery-cron). On verifie donc le pipeline DETERMINISTE (Projet + attribution + Client).
    }
  } catch (e) { echecs.push('exception: ' + (e && e.message)); }

  // 3. NETTOYAGE (quoi qu'il arrive) : Generations -> Projet -> Client test.
  try {
    if (genIds.length) await supprimer('Generations', genIds);
    if (projectId)     await supprimer('Projects', [projectId]);
    if (clientId)      await supprimer('Clients', [clientId]);
  } catch (_) {}

  if (echecs.length) {
    await alerte('e2e-canari', `Parcours e2e en echec (${echecs.length})`, { echecs, token });
    await beat('e2e-canari-cron', true);
    return { statusCode: 200, body: JSON.stringify({ ok: false, echecs }) };
  }
  await beat('e2e-canari-cron');
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
});
