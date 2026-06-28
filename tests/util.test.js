// tests/util.test.js — Tests unitaires (node:test, zero dependance) des helpers _lib/util.js.
// Lances en CI (node --test) sur chaque PR -> une regression sur ces fonctions bloque le merge.

const { test } = require('node:test');
const assert = require('node:assert');
const { formulaLiteral, actionValue, normalizeAdAccount, scrubToken } = require('../netlify/functions/_lib/util');

test('formulaLiteral : entoure de guillemets doubles par defaut', () => {
  assert.strictEqual(formulaLiteral('abc'), '"abc"');
  assert.strictEqual(formulaLiteral('a@b.com'), '"a@b.com"');
});

test('formulaLiteral : bascule sur guillemets simples si la valeur contient un guillemet double', () => {
  assert.strictEqual(formulaLiteral('a"b'), "'a\"b'");
});

test('formulaLiteral : null si les deux types de guillemets sont presents', () => {
  assert.strictEqual(formulaLiteral('a"b\'c'), null);
});

test('actionValue : retourne la valeur du bon action_type', () => {
  const arr = [{ action_type: 'video_view', value: '42' }, { action_type: 'landing_page_view', value: '7' }];
  assert.strictEqual(actionValue(arr, 'video_view'), 42);
  assert.strictEqual(actionValue(arr, 'landing_page_view'), 7);
});

test('actionValue : 0 si absent, non-tableau, ou valeur non numerique', () => {
  assert.strictEqual(actionValue([], 'video_view'), 0);
  assert.strictEqual(actionValue(null, 'video_view'), 0);
  assert.strictEqual(actionValue([{ action_type: 'video_view', value: 'NaN' }], 'video_view'), 0);
});

test('normalizeAdAccount : ajoute act_ si absent, garde si present, vide reste vide', () => {
  assert.strictEqual(normalizeAdAccount('1045674522960266'), 'act_1045674522960266');
  assert.strictEqual(normalizeAdAccount('act_1045674522960266'), 'act_1045674522960266');
  assert.strictEqual(normalizeAdAccount('  123  '), 'act_123');
  assert.strictEqual(normalizeAdAccount(''), '');
  assert.strictEqual(normalizeAdAccount(undefined), '');
});

test('scrubToken : efface ?id=TOKEN, les UUID bruts et les courriels', () => {
  const uuid = '11111111-2222-4333-8444-555555555555';
  assert.strictEqual(scrubToken('/revision?id=' + uuid), '/revision?id=REDACTED');
  assert.strictEqual(scrubToken('token ' + uuid + ' fin'), 'token REDACTED fin');
  assert.strictEqual(scrubToken('contact a@b.com svp'), 'contact REDACTED svp');
  assert.strictEqual(scrubToken('rien a cacher'), 'rien a cacher');
});
