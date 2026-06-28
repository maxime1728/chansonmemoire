// canari-data-cron.js — Canari DATA-QUALITY (lecture seule). Verifie des invariants sur les VRAIS
// Projets recents et alerte si quelque chose cloche silencieusement. Heartbeat a la fin. Horaire.
//
// Invariant verifie : tout Projet cree depuis >20 min et <24 h, ayant atteint une etape funnel
// (funnel_step rempli), DOIT avoir capi_lead_sent=coche (le Lead CAPI est bien parti). Sinon = bug
// de tracking silencieux (ex. META_CAPI_TOKEN expire) -> alerte. (20 min = on laisse le temps a la CAPI.)

const { alerte } = require('./_lib/alerte');
const { beat } = require('./_lib/heartbeat');
const { withSentry } = require('./_lib/sentry');

const BASE_ID  = process.env.AIRTABLE_BASE_ID;
const AT_TOKEN = process.env.AIRTABLE_TOKEN;
const API      = `https://api.airtable.com/v0/${BASE_ID}`;

const F = { funnel:'fldepcYRBoQsGoVkJ', capi_lead:'flddLKcA4uTgAk2z6', created:'fldUkL1hruJn979oB', token:'fldqBcPOplqI7pmTh', utm_content:'fld717FXmUvBBAahC' };

exports.handler = withSentry(async () => {
  if (!BASE_ID || !AT_TOKEN) return { statusCode: 200, body: 'no-config' };
  const headers = { Authorization: `Bearer ${AT_TOKEN}` };
  const sansLead = [];
  let erreur = null;

  try {
    const url = `${API}/Projects?pageSize=100&returnFieldsByFieldId=true`
      + `&sort%5B0%5D%5Bfield%5D=${F.created}&sort%5B0%5D%5Bdirection%5D=desc`
      + `&fields%5B%5D=${F.funnel}&fields%5B%5D=${F.capi_lead}&fields%5B%5D=${F.created}&fields%5B%5D=${F.token}&fields%5B%5D=${F.utm_content}`;
    const r = await fetch(url, { headers });
    if (!r.ok) { erreur = 'lecture Projects HTTP ' + r.status; }
    else {
      const d = await r.json();
      const now = Date.now();
      for (const rec of (d.records || [])) {
        const f = rec.fields || {};
        const created = Date.parse(f[F.created] || '') || 0;
        const ageMin = (now - created) / 60000;
        if (ageMin > 24 * 60) break;          // tries desc : au-dela de 24h on arrete
        if (ageMin < 20) continue;            // trop recent : on laisse le temps a la CAPI
        if (f[F.utm_content] === 'CANARI_first') continue;   // Projet du canari e2e (pas de Lead par design)
        const aFunnel  = !!f[F.funnel];       // a atteint une etape (funnel_step rempli)
        const leadSent = f[F.capi_lead] === true;
        if (aFunnel && !leadSent) sansLead.push(f[F.token] || rec.id);
      }
    }
  } catch (e) { erreur = 'exception ' + (e && e.message); }

  if (erreur) {
    await alerte('canari-data', 'Lecture data-quality impossible', { erreur });
    await beat('canari-data-cron', true);
    return { statusCode: 200, body: JSON.stringify({ ok: false, erreur }) };
  }
  if (sansLead.length) {
    await alerte('canari-data', `${sansLead.length} Projet(s) recent(s) avec funnel mais SANS Lead CAPI (capi_lead_sent)`, { tokens: sansLead.slice(0, 10) });
    await beat('canari-data-cron', true);
    return { statusCode: 200, body: JSON.stringify({ ok: false, sansLead: sansLead.length }) };
  }
  await beat('canari-data-cron');
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
});
