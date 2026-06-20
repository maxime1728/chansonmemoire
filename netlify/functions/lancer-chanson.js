// netlify/functions/lancer-chanson.js
// PROXY serveur : la page appelle CE endpoint, jamais le webhook Make directement.
// But (sécurité C) : l'URL du webhook + le secret partagé restent côté serveur
// (variables d'env Netlify), invisibles dans le code source de la page.
//   - MAKE_C_GEN_WEBHOOK_URL : l'URL du webhook CM - MAKE C-gen
//   - MAKE_WEBHOOK_SECRET    : secret partagé, vérifié par un filtre dans le scénario Make
// Renvoie tel quel la réponse de Make (ex. {status:'plafond', message:...}).

const WEBHOOK = process.env.MAKE_C_GEN_WEBHOOK_URL;
const SECRET  = process.env.MAKE_WEBHOOK_SECRET || '';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Méthode non permise' }) };
  }
  if (!WEBHOOK) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Configuration serveur manquante' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Requête invalide' }) }; }

  const token = (body.token || '').trim();
  if (!UUID_V4.test(token)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Token invalide' }) };
  }

  // On ne transmet QUE des champs connus (pas de passage libre vers Make).
  const payload = {
    token:             token,
    mode:              body.mode || 'song',
    post_purchase:     body.post_purchase === true,
    sans_modification: body.sans_modification === true,
    demande_client:    (body.demande_client || '').toString().slice(0, 2000),
    secret:            SECRET   // vérifié côté Make ; jamais exposé au navigateur
  };

  try {
    const r = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(() => ({}));
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Lancement impossible' }) };
  }
};
