// tests/nurture-state.test.js — Tests unitaires (node:test, zero dependance) des helpers _lib/nurture-state.js.
// Lances en CI (node --test) sur chaque PR. Couvre la logique critique du Lot 5 : sortie client-level (#11),
// désabonnement client (#13), libellé sequence_active (#10).

const { test } = require('node:test');
const assert = require('node:assert');
const { lookupNombre, dejaClientAchete, clientDesabonne, etiquetteSequenceActive } = require('../netlify/functions/_lib/nurture-state');

test('lookupNombre : tableau [n], nombre brut, vide et non-numerique', () => {
  assert.strictEqual(lookupNombre([2]), 2);
  assert.strictEqual(lookupNombre(3), 3);
  assert.strictEqual(lookupNombre([]), 0);
  assert.strictEqual(lookupNombre(undefined), 0);
  assert.strictEqual(lookupNombre(['x']), 0);
});

test('dejaClientAchete : vrai des qu un achat existe au niveau client', () => {
  assert.strictEqual(dejaClientAchete({ client_purchases: [1] }), true);
  assert.strictEqual(dejaClientAchete({ client_purchases: [3] }), true);
  assert.strictEqual(dejaClientAchete({ client_purchases: [0] }), false);
  assert.strictEqual(dejaClientAchete({ client_purchases: 0 }), false);
  assert.strictEqual(dejaClientAchete({}), false);
  assert.strictEqual(dejaClientAchete(null), false);
});

test('clientDesabonne : reflete nurture_optout', () => {
  assert.strictEqual(clientDesabonne({ nurture_optout: true }), true);
  assert.strictEqual(clientDesabonne({ nurture_optout: false }), false);
  assert.strictEqual(clientDesabonne({}), false);
  assert.strictEqual(clientDesabonne(null), false);
});

test('etiquetteSequenceActive : dedoublonne, garde l ordre, joint par virgule', () => {
  assert.strictEqual(etiquetteSequenceActive(['rattrapage']), 'rattrapage');
  assert.strictEqual(etiquetteSequenceActive(['rattrapage', 'post_achat', 'post_achat']), 'rattrapage, post_achat');
  assert.strictEqual(etiquetteSequenceActive(['post_achat', 'parrainage', 'cross_sell']), 'post_achat, parrainage, cross_sell');
  assert.strictEqual(etiquetteSequenceActive([]), '');
  assert.strictEqual(etiquetteSequenceActive(['', null, '  ', 'relance']), 'relance');
  assert.strictEqual(etiquetteSequenceActive(undefined), '');
});
