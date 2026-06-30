// tests/courriel-expediteur.test.js — verrouille le ROUTAGE From / sous-domaine d'envoi par TYPE (Lot 6).
// Règle (protéger le domaine racine) : on envoie TOUJOURS via un sous-domaine (jamais la racine).
// From AFFICHÉ = racine pour le transactionnel + support (confiance) ; sous-domaine info. pour le
// marketing répétable (nurture/sequence/recovery), pour ne jamais exposer la racine aux plaintes.
// Pur, node:test, tourné en CI sur chaque PR.

const { test } = require('node:test');
const assert = require('node:assert');
const { expediteurParType } = require('../netlify/functions/_lib/courriel');

// Efface les surcharges MAILGUN_* pour tester les DÉFAUTS de façon déterministe, puis restaure.
const KEYS = ['MAILGUN_FROM_ACHAT', 'MAILGUN_FROM_MARKETING', 'MAILGUN_FROM_SUPPORT',
              'MAILGUN_DOMAIN_ACHAT', 'MAILGUN_DOMAIN_MARKETING', 'MAILGUN_DOMAIN_SUPPORT', 'MAILGUN_DOMAIN'];
function sansEnv(fn) {
  const sauve = {};
  for (const k of KEYS) { sauve[k] = process.env[k]; delete process.env[k]; }
  try { fn(); } finally { for (const k of KEYS) { if (sauve[k] === undefined) delete process.env[k]; else process.env[k] = sauve[k]; } }
}

test('transactionnel (achat/cadeau/cover) -> From RACINE affiché', () => {
  sansEnv(() => {
    for (const t of ['achat', 'cadeau', 'cover']) {
      assert.match(expediteurParType(t).from, /<nathalie@chansonmemoire\.ca>/, `${t} doit afficher la racine`);
    }
  });
});

test('support -> From RACINE affiché + envoi via le sous-domaine support', () => {
  sansEnv(() => {
    const e = expediteurParType('support');
    assert.match(e.from, /<nathalie@chansonmemoire\.ca>/);
    assert.strictEqual(e.domain, 'support.chansonmemoire.ca');
  });
});

test('marketing (nurture/sequence/recovery) -> From sur le sous-domaine info. (protège la racine)', () => {
  sansEnv(() => {
    for (const t of ['nurture', 'sequence', 'recovery']) {
      assert.match(expediteurParType(t).from, /<nathalie@info\.chansonmemoire\.ca>/, `${t} ne doit PAS exposer la racine`);
    }
  });
});

test('type inconnu -> traité comme transactionnel (From racine, jamais échec silencieux)', () => {
  sansEnv(() => {
    assert.match(expediteurParType('autre').from, /<nathalie@chansonmemoire\.ca>/);
  });
});

test('les variables MAILGUN_FROM_* surchargent le défaut', () => {
  const sauve = process.env.MAILGUN_FROM_ACHAT;
  process.env.MAILGUN_FROM_ACHAT = 'Test <x@exemple.ca>';
  try { assert.strictEqual(expediteurParType('achat').from, 'Test <x@exemple.ca>'); }
  finally { if (sauve === undefined) delete process.env.MAILGUN_FROM_ACHAT; else process.env.MAILGUN_FROM_ACHAT = sauve; }
});

test('le domaine d ENVOI marketing vient de l env (MAILGUN_DOMAIN_MARKETING)', () => {
  const sauve = process.env.MAILGUN_DOMAIN_MARKETING;
  process.env.MAILGUN_DOMAIN_MARKETING = 'info.chansonmemoire.ca';
  try { assert.strictEqual(expediteurParType('nurture').domain, 'info.chansonmemoire.ca'); }
  finally { if (sauve === undefined) delete process.env.MAILGUN_DOMAIN_MARKETING; else process.env.MAILGUN_DOMAIN_MARKETING = sauve; }
});
