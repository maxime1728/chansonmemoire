// tests/plafond-suno.test.js — verrouille la règle de comptage v2 du plafond (cover OU régé = 1 appel Suno).
// Règle Maxime 2026-06-30 : paroles texte jamais ; tout appel Suno livré compte, sauf admin ; pas d'exemption
// "paroles seules". Pur (node:test), tourné en CI.

const { test } = require('node:test');
const assert = require('node:assert');
const { compteAppelSuno, compteApresAchat, PLAFOND_SUNO } = require('../netlify/functions/_lib/comptage');

const livre = (extra) => ({ generation_status: 'audio_generated', type: 'cover', ...extra });

test('plafond = 4', () => {
  assert.strictEqual(PLAFOND_SUNO, 4);
});

test('cover livré pré-achat compte côté pré, pas côté post', () => {
  const g = livre({ post_purchase: false });
  assert.strictEqual(compteAppelSuno(g, false), true);
  assert.strictEqual(compteAppelSuno(g, true), false);
});

test('cover livré post-achat compte côté post', () => {
  const g = livre({ post_purchase: true });
  assert.strictEqual(compteAppelSuno(g, true), true);
});

test('régé (song_regeneration) compte au même titre qu\'un cover', () => {
  const g = livre({ type: 'song_regeneration', post_purchase: true });
  assert.strictEqual(compteAppelSuno(g, true), true);
});

test('PAS d\'exemption paroles-seules en v2 (contrairement à compteApresAchat legacy)', () => {
  const g = livre({ post_purchase: true, correction_paroles_seules: true });
  assert.strictEqual(compteApresAchat(g), false);     // legacy : exempté
  assert.strictEqual(compteAppelSuno(g, true), true); // v2 : compte (un cover EST un appel Suno)
});

test('paroles (texte, pas de Suno) ne comptent jamais', () => {
  assert.strictEqual(compteAppelSuno({ generation_status: 'audio_generated', type: 'lyrics', post_purchase: true }, true), false);
  assert.strictEqual(compteAppelSuno({ generation_status: 'audio_generated', type: 'lyrics_regeneration', post_purchase: false }, false), false);
});

test('appel admin ne compte jamais', () => {
  assert.strictEqual(compteAppelSuno(livre({ post_purchase: true, admin_triggered: true }), true), false);
});

test('échec (pas audio_generated) ne compte jamais', () => {
  assert.strictEqual(compteAppelSuno(livre({ post_purchase: true, generation_status: 'audio_pending' }), true), false);
  assert.strictEqual(compteAppelSuno(livre({ post_purchase: true, generation_status: 'failed' }), true), false);
});
