/* cm-name.js — Limite un nom AFFICHÉ à N mots (défaut 6).
   Certains clients (souvent âgés, qui lisent mal la consigne) saisissent une phrase
   entière dans le champ « nom ». On coupe à L'AFFICHAGE pour ne pas casser la mise en
   page. On NE touche PAS la donnée envoyée au serveur : seul l'affichage est limité.
   Coupe aux mots, sans ellipse (un nom reste un nom). Source unique = même règle partout. */
(function () {
  window.cmName = function (s, max) {
    if (!s) return '';
    max = max || 6;
    var words = String(s).trim().split(/\s+/).filter(Boolean);
    return words.slice(0, max).join(' ');
  };
})();
