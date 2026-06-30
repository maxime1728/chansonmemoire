// tests/cover-promotion.test.js — verrouille la RÈGLE DE PROMOTION des versions (modèle Generation-level).
// C'est le cœur du correctif « correction post-achat invisible » : une version cover livrée doit devenir
// la version active SEULEMENT en post-achat ET si elle est strictement plus récente (jamais de régression).
// Pure, zéro dépendance (node:test), tournée en CI sur chaque PR.

const { test } = require('node:test');
const assert = require('node:assert');
const { versionPlusRecenteAPublier } = require('../netlify/functions/_lib/cover');

test('post-achat + version livrée plus récente -> publie', () => {
  assert.strictEqual(versionPlusRecenteAPublier({ commercialStatus: 'purchased', activeNo: 2, deliveredNo: 3 }), true);
});

test('post-achat + même numéro -> ne publie pas (idempotent)', () => {
  assert.strictEqual(versionPlusRecenteAPublier({ commercialStatus: 'purchased', activeNo: 3, deliveredNo: 3 }), false);
});

test('post-achat + version livrée plus ancienne -> ne publie pas (jamais de régression)', () => {
  assert.strictEqual(versionPlusRecenteAPublier({ commercialStatus: 'purchased', activeNo: 5, deliveredNo: 4 }), false);
});

test('pré-achat (preview_only ou vide) -> ne publie jamais (lire-projet sert déjà la plus récente)', () => {
  assert.strictEqual(versionPlusRecenteAPublier({ commercialStatus: 'preview_only', activeNo: 1, deliveredNo: 2 }), false);
  assert.strictEqual(versionPlusRecenteAPublier({ commercialStatus: '', activeNo: 1, deliveredNo: 2 }), false);
});

test('numéros non entiers -> ne publie pas (donnée incomplète)', () => {
  assert.strictEqual(versionPlusRecenteAPublier({ commercialStatus: 'purchased', activeNo: NaN, deliveredNo: 3 }), false);
  assert.strictEqual(versionPlusRecenteAPublier({ commercialStatus: 'purchased', activeNo: 2, deliveredNo: undefined }), false);
});

test('numéros en chaîne (Airtable) -> coercés correctement', () => {
  assert.strictEqual(versionPlusRecenteAPublier({ commercialStatus: 'purchased', activeNo: '2', deliveredNo: '3' }), true);
  assert.strictEqual(versionPlusRecenteAPublier({ commercialStatus: 'purchased', activeNo: '3', deliveredNo: '3' }), false);
});

test('cas témoin Roxanne : achetée=2, cover livré=3 -> publie (rattrape la version fantôme)', () => {
  assert.strictEqual(versionPlusRecenteAPublier({ commercialStatus: 'purchased', activeNo: 2, deliveredNo: 3 }), true);
});

test('appel sans argument -> false (défensif, ne casse pas)', () => {
  assert.strictEqual(versionPlusRecenteAPublier(), false);
});
