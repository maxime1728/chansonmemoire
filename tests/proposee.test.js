// tests/proposee.test.js — verrouille les champs d'une Generation `proposée` (state-move Lot 4, Bloc C1).
// Pure, zero dependance (node:test), tournee en CI sur chaque PR.

const { test } = require('node:test');
const assert = require('node:assert');
const { champsGenProposee } = require('../netlify/functions/_lib/cover');

test('champsGenProposee : champs de base (proposée, cover, post-achat)', () => {
  const f = champsGenProposee({ projetId: 'recABC', genNo: 4, lyrics: 'des paroles', style: 'style x', songTitle: 'Titre' });
  assert.deepStrictEqual(f.project, ['recABC']);
  assert.strictEqual(f.generation_no, 4);
  assert.strictEqual(f.type, 'cover');
  assert.strictEqual(f.version_status, 'proposée');
  assert.strictEqual(f.post_purchase, true);
  assert.strictEqual(f.lyrics, 'des paroles');
  assert.strictEqual(f.gen_style_prompt, 'style x');
  assert.strictEqual(f.song_title, 'Titre');
  // une proposée n'est PAS audio_pending : pas de generation_status (sinon le sentinelle la surveillerait).
  assert.ok(!('generation_status' in f));
});

test('champsGenProposee : champs optionnels omis si absents + titre par defaut', () => {
  const f = champsGenProposee({ projetId: 'rec1', genNo: 1 });
  assert.ok(!('gen_voice' in f));
  assert.ok(!('gen_music_style' in f));
  assert.ok(!('gen_mood' in f));
  assert.ok(!('Conversations' in f));
  assert.strictEqual(f.song_title, 'Pour toujours');
  assert.strictEqual(f.lyrics, '');
});

test('champsGenProposee : lien Conversation + voix + ambiance quand fournis', () => {
  const f = champsGenProposee({ projetId: 'rec1', genNo: 2, voice: 'Féminin', musicStyle: 'Pop', mood: 'Tendre', convoId: 'recCONV' });
  assert.deepStrictEqual(f.Conversations, ['recCONV']);
  assert.strictEqual(f.gen_voice, 'Féminin');
  assert.strictEqual(f.gen_music_style, 'Pop');
  assert.strictEqual(f.gen_mood, 'Tendre');
});

test('champsGenProposee : type regeneration conserve, sinon retombe sur cover', () => {
  assert.strictEqual(champsGenProposee({ projetId: 'r', genNo: 1, type: 'regeneration' }).type, 'regeneration');
  assert.strictEqual(champsGenProposee({ projetId: 'r', genNo: 1, type: 'autre' }).type, 'cover');
});
