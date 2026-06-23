// netlify/functions/lancer-cover.js
//
// RELANCE Suno après APPROBATION d'une demande de modification (2ᵉ moitié de la boucle décortique).
// Appelé par MAKE (Search Records : approval_status = approved ET cover_launched_at vide) → POST { token }.
// Réutilise le CHEMIN PROUVÉ : proxy vers le webhook C-gen (comme lancer-chanson). C-gen applique le
// plafond post-achat, génère via Suno et crée la nouvelle Generation. AUCUNE clé Suno ici.
//
// ⚠️ CONTRAT C-GEN (côté Make, à vérifier/brancher par Maxime) : pour une relance `post_purchase` en
//    mode `cover`/`regeneration`, C-gen DOIT utiliser `adjusted_lyrics` + `adjusted_style_prompt` du
//    Project (posés par decortique.js) au lieu des paroles/style d'origine — sinon la relance régénère
//    les ANCIENNES paroles. (Les champs sont déjà sur le Project ; c'est une lecture côté C-gen.)
//
// Idempotence : pose `cover_launched_at` après un appel webhook réussi → le filtre Make (champ vide)
//   évite toute double-relance.
// Sécurité : POST, UUID v4 strict, gaté `purchased` + `approval_status = approved`, secret en env.

const BASE_ID  = process.env.AIRTABLE_BASE_ID;
const AT_TOKEN = process.env.AIRTABLE_TOKEN;
const API      = `https://api.airtable.com/v0/${BASE_ID}`;
const WEBHOOK  = process.env.MAKE_C_GEN_WEBHOOK_URL;   // même webhook que lancer-chanson
const SECRET   = process.env.MAKE_WEBHOOK_SECRET || '';
const UUID_V4  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formulaLiteral(v) {
  const s = String(v);
  if (!s.includes('"')) return `"${s}"`;
  if (!s.includes("'")) return `'${s}'`;
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Méthode non permise' }) };
  if (!WEBHOOK) return { statusCode: 500, body: JSON.stringify({ error: 'Configuration serveur manquante' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Requête invalide' }) }; }

  const token = (body.token || '').trim();
  if (!UUID_V4.test(token)) return { statusCode: 400, body: JSON.stringify({ error: 'Token invalide' }) };

  const headers = { Authorization: `Bearer ${AT_TOKEN}` };

  try {
    // 1. Project par token.
    const fP = encodeURIComponent(`{token}=${formulaLiteral(token)}`);
    const rP = await fetch(`${API}/Projects?filterByFormula=${fP}&maxRecords=1`, { headers });
    const dP = await rP.json();
    if (!dP.records || dP.records.length === 0) return { statusCode: 404, body: JSON.stringify({ error: 'Introuvable' }) };
    const projet = dP.records[0];
    const p = projet.fields;

    // 2. Garde-fous. Cover = post-achat + correction APPROUVÉE uniquement.
    if (p.commercial_status !== 'purchased') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Réservé après achat' }) };
    }
    // États « rien à faire » -> 200 (Make ne doit pas les voir comme des erreurs).
    if (p.approval_status !== 'approved') {
      return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'not_approved' }) };
    }
    if (p.cover_launched_at) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, already: true }) };   // idempotence
    }

    const mode = (p.mode_correction === 'regeneration') ? 'regeneration' : 'cover';

    // 3. Proxy vers C-gen (chemin prouvé : plafond + Suno + nouvelle Generation gérés là).
    //    C-gen relit le Project — dont adjusted_lyrics/adjusted_style_prompt (voir CONTRAT en tête).
    const rW = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, mode, post_purchase: true, secret: SECRET })
    });
    if (!rW.ok) {
      console.error('[lancer-cover] webhook C-gen a échoué:', `HTTP ${rW.status}`);   // pas de marquage -> Make réessaiera
      return { statusCode: 502, body: JSON.stringify({ error: 'Relance impossible' }) };
    }
    const data = await rW.json().catch(() => ({}));   // ex. {status:'plafond', message:...} = traité, on marque quand même

    // 4. Marque la relance (idempotence) -> Make (filtre cover_launched_at vide) ne relancera plus.
    await fetch(`${API}/Projects/${projet.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { cover_launched_at: new Date().toISOString() } })
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, mode, cgen: data }) };
  } catch (err) {
    console.error('[lancer-cover]', err && err.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erreur serveur' }) };
  }
};
