// netlify/functions/_lib/lyrics.js
//
// Utilitaires paroles partagés.
//
// 1) stripSectionTags : retire les BALISES DE SECTION Suno ([Intro], [Couplet], [Chorus], [Bridge],
//    [Outro]…) — présentes dans les paroles stockées pour STRUCTURER la chanson côté Suno, mais qui
//    ne doivent JAMAIS être montrées au client (aperçu, révision, PDF). À appliquer à chaque affichage.
//
// 2) accentFor : accent/langue à injecter dans le STYLE Suno selon la langue de la chanson — sinon une
//    chanson espagnole avec « Quebec French accent » sonne faux.

'use strict';

function stripSectionTags(text) {
  return String(text || '')
    .replace(/^[^\S\r\n]*\[[^\]\r\n]*\][^\S\r\n]*$/gm, '')   // lignes ne contenant qu'une balise [..]
    .replace(/\n{3,}/g, '\n\n')                               // au plus une ligne vide d'affilée
    .replace(/^\s+|\s+$/g, '');                               // trim
}

const ACCENTS = {
  'fr-CA': 'Quebec French accent, Canadian French',
  'fr-FR': 'French (France) accent',
  'en':    'English',
  'es':    'Spanish'
};
function accentFor(code) { return ACCENTS[code] || ACCENTS['fr-CA']; }

module.exports = { stripSectionTags, accentFor };
