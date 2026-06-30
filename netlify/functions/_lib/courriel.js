// netlify/functions/_lib/courriel.js
//
// ENVOI CENTRALISÉ des courriels CLIENT + JOURNALISATION (Phase 3, observabilité courriels).
// Un seul point de passage pour tous les envois Mailgun « client » : il POST le message, récupère le
// Message-Id renvoyé par Mailgun, et crée une ligne dans la table `Courriels` (1 ligne/courriel). Le
// webhook `mailgun-events` met ensuite à jour livré/ouvert/cliqué/rejeté en rattachant sur ce Message-Id.
//
// Conçu pour remplacer les helpers `envoyerCourriel(to, subject, html)` dispersés dans les fonctions, en
// gardant leurs variations : domaine/from par sous-domaine (achat/marketing/support), pièce jointe (PDF du
// cadeau), en-têtes custom (List-Unsubscribe, In-Reply-To/References pour les fils de support).
//
// Best-effort sur le LOG : jamais une exception de journalisation ne doit casser un envoi. Si Mailgun ou
// Airtable manquent (env vide), tout est inerte (no-op) — comme les anciens helpers.
// Env : MAILGUN_API_KEY, MAILGUN_DOMAIN, MAILGUN_FROM, AIRTABLE_TOKEN, AIRTABLE_BASE_ID.

const COURRIELS = 'Courriels';   // table de journalisation (créée côté Airtable, schéma additif)
const CLIENTS   = 'tblQbF1OlE3uRxFra';
const TYPES_SUPPRIMABLES = new Set(['nurture', 'sequence', 'recovery']);   // flux RÉPÉTABLES : on saute les adresses mortes
const TYPES_MARKETING    = new Set(['nurture', 'sequence']);               // marketing : on saute AUSSI les clients désabonnés (nurture_optout, LCAP)

function formulaLiteral(v) {
  const s = String(v);
  if (!s.includes('"')) return `"${s}"`;
  if (!s.includes("'")) return `'${s}'`;
  return null;
}

// Résout le recId du Projet à partir d'un token (UUID). Best-effort -> '' si indisponible.
async function projetIdParToken(token) {
  const BASE = process.env.AIRTABLE_BASE_ID, AT = process.env.AIRTABLE_TOKEN;
  const lit = formulaLiteral(token);
  if (!BASE || !AT || !token || lit === null) return '';
  try {
    const f = encodeURIComponent(`{token}=${lit}`);
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/Projects?filterByFormula=${f}&maxRecords=1`, {
      headers: { Authorization: `Bearer ${AT}` }
    });
    if (!r.ok) return '';
    const rec = (((await r.json()).records) || [])[0];
    return (rec && rec.id) || '';
  } catch (_) { return ''; }
}

// Faut-il sauter cet envoi répétable pour `to` ? Adresse morte (email_invalide) -> on saute tous les
// répétables (nurture/séquences/recovery). Désabonnement marketing (nurture_optout) -> on saute en plus
// nurture/séquences, mais PAS recovery (la récupération est un dû au client, pas du marketing).
// Best-effort : false si Airtable indisponible (on n'empêche jamais un envoi par excès de prudence).
async function estSupprime(to, type) {
  const BASE = process.env.AIRTABLE_BASE_ID, AT = process.env.AIRTABLE_TOKEN;
  const lit = formulaLiteral(to);
  if (!BASE || !AT || !to || lit === null) return false;
  try {
    const f = encodeURIComponent(`LOWER({email})=LOWER(${lit})`);
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${CLIENTS}?filterByFormula=${f}&maxRecords=1`, { headers: { Authorization: `Bearer ${AT}` } });
    if (!r.ok) return false;
    const c = (((await r.json()).records) || [])[0];
    if (!c || !c.fields) return false;
    if (c.fields.email_invalide) return true;                               // adresse morte (bounce/plainte)
    if (TYPES_MARKETING.has(type) && c.fields.nurture_optout) return true;  // désabonné du marketing (LCAP)
    return false;
  } catch (_) { return false; }
}

// Crée la ligne Courriels. Best-effort : ne lève jamais. messageId peut être vide (Mailgun n'a pas renvoyé
// d'id) -> on log quand même l'envoi, sans corrélation webhook possible.
// Retourne le recordId de la ligne Courriels créée ('' si rien). Best-effort : ne lève jamais.
// Le rattachement au fil (lien Conversation) se fait côté appelant (repondre-courriel) via le champ Courriels.
async function logCourriel({ type, to, subject, projetId, token, messageId }) {
  const BASE = process.env.AIRTABLE_BASE_ID, AT = process.env.AIRTABLE_TOKEN;
  if (!BASE || !AT) return '';
  try {
    let pid = projetId || '';
    if (!pid && token) pid = await projetIdParToken(token);
    const fields = {
      type:         type || 'autre',
      destinataire: to || '',
      objet:        subject || '',
      envoye_le:    new Date().toISOString(),
      statut:       'envoyé',
      message_id:   messageId || ''
    };
    if (pid) fields.Projet = [pid];
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${COURRIELS}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${AT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ typecast: true, fields })   // typecast : crée les choix de type/statut au besoin
    });
    if (!r.ok) return '';
    try { return ((await r.json()).id) || ''; } catch (_) { return ''; }
  } catch (_) { return ''; }   // la journalisation ne bloque jamais un envoi
}

// Envoi central. opts :
//   to, subject, html, text       (text optionnel)
//   from   (def. MAILGUN_FROM), domain (def. MAILGUN_DOMAIN), apiKey (def. MAILGUN_API_KEY)
//   headers      { 'List-Unsubscribe': '<...>', 'In-Reply-To': '<mid>', ... } -> préfixés 'h:'
//   attachment   { buffer, filename, contentType }
//   type, projetId, token         (pour le log)
//   log          (def. true) ; tracking (def. false : piloté au niveau du DOMAINE Mailgun)
// Retour : { ok, id } (id = Message-Id Mailgun, sans chevrons).
async function envoyerCourriel(opts) {
  opts = opts || {};
  const apiKey = opts.apiKey || process.env.MAILGUN_API_KEY;
  const domain = opts.domain || process.env.MAILGUN_DOMAIN;
  const from   = opts.from   || process.env.MAILGUN_FROM || 'Chanson Mémoire <info@chansonmemoire.ca>';
  const to     = opts.to;
  if (!apiKey || !domain || !to || !String(to).includes('@')) return { ok: false, id: '' };

  // Hygiène de liste + consentement (LCAP) : pour les flux RÉPÉTABLES, on ne ré-écrit jamais à une adresse
  // morte (bounce/plainte) ; pour le marketing (nurture/séquences), on saute aussi les clients désabonnés.
  // Le transactionnel et le support ne sont PAS suppressés ici (on tente toujours un reçu / une réponse).
  if (TYPES_SUPPRIMABLES.has(opts.type) && await estSupprime(to, opts.type)) {
    return { ok: false, id: '', skipped: 'supprime' };
  }

  const form = new FormData();
  form.append('from', from);
  form.append('to', to);
  form.append('subject', opts.subject || '');
  if (opts.html != null) form.append('html', opts.html);
  if (opts.text != null) form.append('text', opts.text);
  if (opts.tracking) { form.append('o:tracking-opens', 'yes'); form.append('o:tracking-clicks', 'yes'); }
  if (opts.headers) {
    for (const k in opts.headers) {
      if (opts.headers[k] != null) form.append('h:' + k, opts.headers[k]);
    }
  }
  if (opts.attachment && opts.attachment.buffer) {
    form.append('attachment',
      new Blob([opts.attachment.buffer], { type: opts.attachment.contentType || 'application/octet-stream' }),
      opts.attachment.filename || 'piece-jointe');
  }

  const auth = 'Basic ' + Buffer.from('api:' + apiKey).toString('base64');
  let id = '';
  try {
    const r = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, { method: 'POST', headers: { Authorization: auth }, body: form });
    if (!r.ok) {
      console.error('[courriel] Mailgun', r.status, (await r.text().catch(() => '')).slice(0, 200));
      return { ok: false, id: '' };
    }
    try { id = ((await r.json()).id || '').replace(/^<|>$/g, ''); } catch (_) {}
  } catch (e) {
    console.error('[courriel] envoi', e && e.message);
    return { ok: false, id: '' };
  }

  if (opts.log !== false) {
    await logCourriel({ type: opts.type, to: to, subject: opts.subject, projetId: opts.projetId, token: opts.token, messageId: id });
  }
  return { ok: true, id };
}

module.exports = { envoyerCourriel, logCourriel, projetIdParToken };
