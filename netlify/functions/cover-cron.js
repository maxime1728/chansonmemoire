// netlify/functions/cover-cron.js
//
// RELANCE COVER (remplace le scénario Make « Relance cover ») — fonction PLANIFIÉE (toutes les 15 min,
// netlify.toml). Trouve les corrections APPROUVÉES non encore lancées et déclenche la cover en
// appelant la fonction existante /api/lancer-cover (qui fait la vraie cover Suno + livraison).
// Best-effort : jamais d'exception qui casse le cron.

const BASE_ID  = process.env.AIRTABLE_BASE_ID;
const AT_TOKEN = process.env.AIRTABLE_TOKEN;
const API      = `https://api.airtable.com/v0/${BASE_ID}`;
const PROJECTS = 'tblh7O8eoog7RyTMJ';
const SITE     = 'https://chansonmemoire.ca';

exports.handler = async () => {
  let launched = 0;
  try {
    const r = await fetch(`${API}/${PROJECTS}?filterByFormula=${encodeURIComponent(
      `AND({approval_status}="approved", {cover_launched_at}="")`
    )}&maxRecords=20`, { headers: { Authorization: `Bearer ${AT_TOKEN}` } });
    const d = await r.json();
    const recs = (d && d.records) || [];

    for (const rec of recs) {
      const token = rec.fields.token;
      if (!token) continue;
      try {
        // lancer-cover gate purchased + approved + idempotence (pose cover_task_id/cover_launched_at).
        await fetch(`${SITE}/api/lancer-cover`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        });
        launched++;
      } catch (_) {}
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, launched }) };
  } catch (err) {
    console.error('[cover-cron]', err && err.message);
    return { statusCode: 200, body: JSON.stringify({ ok: false }) };
  }
};
