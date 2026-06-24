// netlify/functions/repondre-courriel.js
//
// SUPPORT — ENVOI de la réponse depuis Airtable (Phase 2). Déclenché par le BOUTON « Envoyer » de
// l'interface Boîte de support -> Automation Airtable -> POST ici { id, secret }.
//
// Envoie au client le texte de `reponse` (ou, à défaut, le `brouillon_ia`) :
//   - depuis l'adresse de support CM (nathalie@chansonmemoire.ca) ;
//   - enveloppé dans un TEMPLATE de marque (papier, serif mauve) -> courriel propre ;
//   - DANS LE FIL d'origine (In-Reply-To / References = message_id) ;
//   - sujet « Re: … ».
// Puis marque la conversation : statut=repondu, repondu_le=now, reponse=ce qui a été envoyé.
//
// SÉCURITÉ : gate par `secret` == MAKE_WEBHOOK_SECRET. id doit être un recordId valide.
// Env : MAKE_WEBHOOK_SECRET, MAILGUN_API_KEY, AIRTABLE_TOKEN, AIRTABLE_BASE_ID,
//       MAILGUN_DOMAIN_SUPPORT (défaut chansonmemoire.ca), MAILGUN_FROM_SUPPORT (défaut nathalie@…).
//   NB : pour envoyer DEPUIS nathalie@chansonmemoire.ca, le domaine racine doit être VÉRIFIÉ en envoi
//        (DKIM/SPF) dans Mailgun. Sinon, pointer MAILGUN_DOMAIN_SUPPORT/FROM vers achat.chansonmemoire.ca.

const BASE_ID  = process.env.AIRTABLE_BASE_ID;
const AT_TOKEN = process.env.AIRTABLE_TOKEN;
const API      = `https://api.airtable.com/v0/${BASE_ID}`;
const SECRET   = process.env.MAKE_WEBHOOK_SECRET;

const MG_KEY    = process.env.MAILGUN_API_KEY;
const MG_DOMAIN = process.env.MAILGUN_DOMAIN_SUPPORT || 'chansonmemoire.ca';
const MG_FROM   = process.env.MAILGUN_FROM_SUPPORT || 'Chanson Mémoire <nathalie@chansonmemoire.ca>';

const CONVOS = 'tbl3KBgXthCPromxF';
const REC_ID = /^rec[A-Za-z0-9]{14}$/;

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Enveloppe le texte (saisi/édité par l'humain) dans le template de marque. PAS de signature ajoutée
// (le texte la contient déjà) — juste un pied discret en lettrage.
function corpsHtml(texte) {
  const t = esc(texte).replace(/\r?\n/g, '<br>');
  return `<div style="font-family:Georgia,'Times New Roman',serif;color:#2E1A28;line-height:1.7;font-size:16px;max-width:560px;">` +
    `<div>${t}</div>` +
    `<hr style="border:none;border-top:1px solid #E5DAE0;margin:24px 0 12px;">` +
    `<div style="color:#9A8A96;font-size:12px;letter-spacing:.3px;">Chanson Mémoire · chansonmemoire.ca</div>` +
    `</div>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Méthode non permise' }) };
  if (!SECRET) { console.error('[repondre-courriel] MAKE_WEBHOOK_SECRET manquant'); return { statusCode: 500, body: JSON.stringify({ error: 'Configuration manquante' }) }; }
  if (!MG_KEY)  return { statusCode: 500, body: JSON.stringify({ error: 'Mailgun non configuré' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return { statusCode: 400, body: JSON.stringify({ error: 'Requête invalide' }) }; }
  if ((body.secret || '') !== SECRET) return { statusCode: 403, body: JSON.stringify({ error: 'Non autorisé' }) };

  const id = (body.id || '').toString().trim();
  if (!REC_ID.test(id)) return { statusCode: 400, body: JSON.stringify({ error: 'id invalide' }) };

  const headers = { Authorization: `Bearer ${AT_TOKEN}` };

  try {
    // 1. Lire la conversation.
    const rC = await fetch(`${API}/${CONVOS}/${id}`, { headers });
    if (!rC.ok) return { statusCode: 404, body: JSON.stringify({ error: 'Conversation introuvable' }) };
    const f = (await rC.json()).fields || {};

    const to = (f.expediteur || '').toString().trim();
    if (!to.includes('@')) return { statusCode: 409, body: JSON.stringify({ error: 'Destinataire invalide' }) };

    // 2. Le texte à envoyer : la réponse finale, sinon le brouillon IA.
    const corps = ((f.reponse && f.reponse.trim()) ? f.reponse : (f.brouillon_ia || '')).trim();
    if (!corps) return { statusCode: 409, body: JSON.stringify({ error: 'Aucun texte à envoyer (réponse et brouillon vides)' }) };

    // 3. Sujet « Re: … » (dédupliqué).
    let subject = (f.sujet || '').toString().trim() || 'votre message';
    if (!/^\s*re\s*:/i.test(subject)) subject = 'Re: ' + subject;

    // 4. Envoi Mailgun, DANS LE FIL (In-Reply-To/References = message_id d'origine).
    const form = new FormData();
    form.append('from', MG_FROM);
    form.append('to', to);
    form.append('subject', subject);
    form.append('text', corps);
    form.append('html', corpsHtml(corps));
    const msgId = (f.message_id || '').toString().trim();
    if (msgId) {
      const mid = msgId.startsWith('<') ? msgId : `<${msgId}>`;
      form.append('h:In-Reply-To', mid);
      form.append('h:References', mid);
    }
    const auth = 'Basic ' + Buffer.from('api:' + MG_KEY).toString('base64');
    const rM = await fetch(`https://api.mailgun.net/v3/${MG_DOMAIN}/messages`, { method: 'POST', headers: { Authorization: auth }, body: form });
    if (!rM.ok) {
      const detail = await rM.text().catch(() => '');
      console.error('[repondre-courriel] Mailgun', rM.status, detail);
      return { statusCode: 502, body: JSON.stringify({ error: 'Envoi échoué', mailgun_status: rM.status, detail }) };
    }

    // 5. Marque la conversation comme répondue (et garde le texte envoyé).
    await fetch(`${API}/${CONVOS}/${id}`, {
      method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { statut: 'repondu', repondu_le: new Date().toISOString(), reponse: corps } })
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, to }) };
  } catch (err) {
    console.error('[repondre-courriel]', err && err.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erreur serveur' }) };
  }
};
