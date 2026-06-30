// netlify/functions/_lib/nurture-state.js
//
// Helpers PURS de l'état des séquences nurture (Lot 5). Aucune I/O : testés en unitaire (node:test, CI).
//   - lookupNombre            : lit une valeur de lookup Airtable (souvent un tableau [n]) comme nombre.
//   - dejaClientAchete        : le client a-t-il DÉJÀ acheté, au niveau CLIENT (lookup client_purchases) ? (#11)
//   - clientDesabonne         : le client a-t-il retiré son consentement marketing (nurture_optout) ? (#13)
//   - etiquetteSequenceActive : libellé lisible des séquences actives d'un projet (champ sequence_active, #10).
'use strict';

// Une valeur de lookup Airtable arrive souvent comme [n] (parfois n, ou [] si rien). Repli 0.
function lookupNombre(v) {
  if (Array.isArray(v)) v = v[0];
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// #11 (niveau CLIENT) : vrai dès qu'un achat existe sur N'IMPORTE quel projet du client.
// projectFields.client_purchases = lookup du rollup Clients.client_purchases, porté sur le Projet.
function dejaClientAchete(projectFields) {
  return lookupNombre(projectFields && projectFields.client_purchases) > 0;
}

// #13 (LCAP) : consentement marketing retiré au niveau client. Bloque l'enrôlement ET le ré-enrôlement
// sur un nouveau projet. Posé par desabonnement.js.
function clientDesabonne(clientFields) {
  return !!(clientFields && clientFields.nurture_optout);
}

// #10 : libellé lisible et stable des séquences actives d'un projet (champ sequence_active).
// Dédoublonne, conserve l'ordre fourni, joint par ', '. ['rattrapage','post_achat','post_achat']
// -> 'rattrapage, post_achat'. Liste vide -> '' (aucune séquence active).
function etiquetteSequenceActive(labels) {
  const vus = new Set();
  const out = [];
  for (const l of (labels || [])) {
    const s = String(l == null ? '' : l).trim();
    if (s && !vus.has(s)) { vus.add(s); out.push(s); }
  }
  return out.join(', ');
}

module.exports = { lookupNombre, dejaClientAchete, clientDesabonne, etiquetteSequenceActive };
