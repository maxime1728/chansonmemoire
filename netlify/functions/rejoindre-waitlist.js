// netlify/functions/rejoindre-waitlist.js
// Inscription a la liste d'attente d'une fonctionnalite a venir (v1 : Page Vivante, depuis
// page-souvenir). Ecrit un enregistrement dans la table Waitlist (courriel + projet honore)
// et pose aussi le drapeau waitlist_memoire sur le Project (signal conserve pour les autres flux).
// Securite : POST, UUID v4 strict, gate `purchased`, secrets en env. Anti-doublon par token+type.

const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TOKEN   = process.env.AIRTABLE_TOKEN;
const API     = `https://api.airtable.com/v0/${BASE_ID}`;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Types de liste d'attente acceptes (whitelist -> pas d'option singleSelect arbitraire).
const TYPES = ['page_vivante'];

// Echappe une valeur pour un litteral filterByFormula (meme logique que lire-projet).
function formulaLiteral(v) {
  const s = String(v);
  if (!s.includes('"')) return `"${s}"`;
  if (!s.includes("'")) return `'${s}'`;
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Méthode non permise' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Requête invalide' }) }; }

  const token = (body.token || '').trim();
  if (!UUID_V4.test(token)) return { statusCode: 400, body: JSON.stringify({ error: 'Token invalide' }) };

  const email = (body.email || '').toString().trim().toLowerCase();
  if (!email || email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Courriel invalide' }) };
  }

  const type = TYPES.includes(body.type) ? body.type : 'page_vivante';
  const headers = { Authorization: `Bearer ${TOKEN}` };

  try {
    // 1. Retrouver le Project par token (token deja valide UUID -> litteral sur).
    const formule = encodeURIComponent(`{token}=${formulaLiteral(token)}`);
    const rP = await fetch(`${API}/Projects?filterByFormula=${formule}&maxRecords=1`, { headers });
    const dP = await rP.json();
    if (!dP.records || dP.records.length === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Introuvable' }) };   // 404 nu
    }
    const projet = dP.records[0];

    // Liste d'attente = post-achat uniquement (comme choix-memoire).
    if (projet.fields.commercial_status !== 'purchased') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Non autorisé' }) };
    }

    // 2. Anti-doublon : deja inscrit pour ce token + ce type -> on renvoie ok sans re-creer.
    const tokLit = formulaLiteral(token), typeLit = formulaLiteral(type);
    if (tokLit && typeLit) {
      const dedup = encodeURIComponent(`AND({token}=${tokLit}, {type}=${typeLit})`);
      const rD = await fetch(`${API}/Waitlist?filterByFormula=${dedup}&maxRecords=1`, { headers });
      const dD = await rD.json();
      if (dD.records && dD.records.length > 0) {
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, already: true }) };
      }
    }

    // 3. Creer l'enregistrement dans la vraie liste (table Waitlist).
    const r = await fetch(`${API}/Waitlist`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: {
        email,
        type,
        deceased_name: projet.fields.deceased_name || '',
        token,
        source: 'page-souvenir',
        enrolled_at: new Date().toISOString()
      } })
    });
    if (!r.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Écriture impossible' }) };
    }

    // 4. Drapeau sur le Project (signal conserve pour les autres flux). Best-effort, ne bloque pas.
    try {
      await fetch(`${API}/Projects/${projet.id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { waitlist_memoire: true } })
      });
    } catch (_) {}

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Erreur serveur' }) };
  }
};

// Observabilite : capture Sentry des exceptions non gerees (inerte sans SENTRY_DSN). Voir _lib/sentry.js.
const { withSentry } = require('./_lib/sentry');
exports.handler = withSentry(exports.handler);
