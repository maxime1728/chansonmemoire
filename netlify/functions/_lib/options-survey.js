// netlify/functions/_lib/options-survey.js
//
// SOURCE UNIQUE des options offertes au client (style musical, ambiance/mood, voix). Ce sont les listes
// blanches EXACTES du survey : elles doivent matcher les single-selects Airtable AU CARACTÈRE PRÈS (sinon
// PATCH 422). Utilisées pour VALIDER (essayer-style) ET pour peupler les menus du studio cockpit (mêmes
// choix que le client). Toute modification d'une option = ici + le single-select Airtable correspondant.

const STYLES = ['Pop', 'Country', 'R&B', 'Rock', 'Jazz', 'Acoustique', 'Douce Mélodie',
  'Orchestre Gospel', 'Hip-Hop', 'Cinématographique', 'Latin / Salsa', 'Reggae', 'Électronique / Dance'];

// Union hommage + cadeau (comme dans essayer-style).
const MOODS  = ['Émotionnelle', 'Tendre', 'Paisible', 'Inspirante', 'Reconnaissante', 'Festive', 'Optimiste',
  'Mélancolique', 'Romantique', 'Joyeuse et entrainante', 'Drôle et enjouée', 'Énergique'];

const VOICES = ['Masculin', 'Féminin'];

module.exports = { STYLES, MOODS, VOICES };
