// netlify/functions/_lib/comptage.js
//
// SOURCE UNIQUE de la règle de comptage des chansons (sans rollup Airtable).
// Utilisé par lancer-chanson (plafond + stat) et sentinelle-cron (recalcul après livraison).
//
// Règle (validée avec Maxime) : une Generation compte comme « chanson réussie » seulement si
// l'audio Suno a été LIVRÉ. Donc :
//   - les paroles (lyrics / lyrics_regeneration) ne comptent jamais (pas de Suno) ;
//   - les échecs ne comptent jamais (generation_status n'atteint pas audio_generated) ;
//   - ce que l'équipe déclenche (admin_triggered) ne compte jamais.
// On distingue AVANT achat (post_purchase faux) et APRÈS achat (post_purchase vrai).

const SONG_TYPES = ['song', 'song_regeneration', 'cover'];

function estChansonLivree(g) {
  return !!g
    && g.generation_status === 'audio_generated'
    && SONG_TYPES.includes(g.type)
    && !g.admin_triggered;
}

// Compte AVANT achat (plafond 4/projet + cumul client) : chanson livrée, client, pré-achat.
function compteAvantAchat(g) {
  return estChansonLivree(g) && !g.post_purchase;
}

// Compte APRÈS achat (plafond 4/projet) : chanson livrée, client, post-achat, hors « paroles seules ».
// (correction_paroles_seules = cover déclenché par une demande de PAROLES uniquement -> exempté.)
// LEGACY : gardé pour le comportement flag-OFF. La règle v2 (compteAppelSuno) RETIRE cette exemption.
function compteApresAchat(g) {
  return estChansonLivree(g) && !!g.post_purchase && !g.correction_paroles_seules;
}

// ── PLAFOND v2 (flag PLAFOND_V2) — règle tranchée par Maxime 2026-06-30 ───────────────────────────────
// « Les paroles (texte) sont TOUJOURS illimitées ; dès qu'il y a un APPEL SUNO (cover OU régé) ça compte
//   comme 1, SAUF si déclenché par admin. » -> PAS d'exemption paroles-seules : un cover EST un appel Suno.
// Pré-achat = compteAvantAchat (déjà sans exemption). Post-achat = livré + post_purchase, exemption RETIRÉE.
const PLAFOND_SUNO = 4;

function formulaLiteral(v) {
  const s = String(v);
  if (!s.includes('"')) return `"${s}"`;
  if (!s.includes("'")) return `'${s}'`;
  return null;
}

// Une Generation compte-t-elle comme 1 appel Suno du côté demandé (pré ou post achat) ?
function compteAppelSuno(g, postPurchase) {
  return estChansonLivree(g) && (!!g.post_purchase === !!postPurchase);
}

// Nombre d'appels Suno comptables d'un projet, du côté demandé. Best-effort (0 si pépin réseau).
async function nbAppelsSuno(api, headers, projectPrimary, postPurchase) {
  const lit = formulaLiteral(projectPrimary);
  if (lit === null) return 0;
  try {
    const f = encodeURIComponent(`{project}=${lit}`);
    const r = await fetch(`${api}/Generations?filterByFormula=${f}`, { headers });
    if (!r.ok) return 0;
    const recs = ((await r.json()).records) || [];
    return recs.reduce((n, rec) => n + (compteAppelSuno(rec.fields, postPurchase) ? 1 : 0), 0);
  } catch (_) { return 0; }
}

// Recalcule les compteurs d'un projet à partir de SES Generations, et les écrit (best-effort).
// `api` = base URL Airtable, `headers` = { Authorization }. Renvoie { avant, apres }.
async function recomputerProjet(api, headers, projetId, projetPrimary) {
  const out = { avant: 0, apres: 0 };
  try {
    const lit = (() => { const s = String(projetPrimary); return s.includes('"') ? (s.includes("'") ? null : `'${s}'`) : `"${s}"`; })();
    if (lit === null) return out;
    const f = encodeURIComponent(`{project}=${lit}`);
    const r = await fetch(`${api}/Generations?filterByFormula=${f}`, { headers });
    if (!r.ok) return out;
    const recs = ((await r.json()).records) || [];
    for (const rec of recs) {
      if (compteAvantAchat(rec.fields)) out.avant++;
      if (compteApresAchat(rec.fields)) out.apres++;
    }
    await fetch(`${api}/Projects/${projetId}`, {
      method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { chansons_reussies_avant: out.avant } })
    });
  } catch (_) { /* best-effort : ne bloque jamais l'appelant */ }
  return out;
}

module.exports = { SONG_TYPES, estChansonLivree, compteAvantAchat, compteApresAchat, recomputerProjet, PLAFOND_SUNO, compteAppelSuno, nbAppelsSuno };
