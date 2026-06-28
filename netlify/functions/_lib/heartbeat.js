// _lib/heartbeat.js — « Dead man's switch » via Healthchecks.io.
// Chaque cron ping a la FIN d'un run reussi. Si un ping manque (cron en panne, non planifie,
// timeout...), Healthchecks ALERTE tout seul. C'est le seul moyen de detecter un cron qui ne tourne PLUS.
//
// Deux modes (INERTE si aucun n'est pose) :
//   • HC_PING_KEY = cle de ping du PROJET -> 1 check AUTO par cron (slug), granularite max (recommande :
//     on sait QUEL cron est mort). Le check se cree au 1er ping (?create=1).
//   • HC_PING_URL = URL d'un check UNIQUE (https://hc-ping.com/<uuid>) -> tous les crons pingent ce check.
//     Plus simple, mais un seul voyant pour tout (rouge = « un cron est mort », sans dire lequel).
//   Si les deux sont poses, HC_PING_KEY (granulaire) gagne.

const KEY = process.env.HC_PING_KEY || '';
const URL_UNIQUE = (process.env.HC_PING_URL || '').replace(/\/+$/, '');

// beat(slug)        -> signale un succes.
// beat(slug, true)  -> signale un echec (Healthchecks marque DOWN immediatement).
async function beat(slug, fail) {
  let url = '';
  if (KEY && slug) url = `https://hc-ping.com/${KEY}/${encodeURIComponent(slug)}${fail ? '/fail' : ''}?create=1`;
  else if (URL_UNIQUE) url = URL_UNIQUE + (fail ? '/fail' : '');
  if (!url) return;
  try { await fetch(url, { method: 'POST' }); } catch (_) {}
}

module.exports = { beat };
