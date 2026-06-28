// _lib/util.js — Petites fonctions PURES, partagees + testables (couvertes par tests/util.test.js).
// Objectif : centraliser la logique sujette aux bugs silencieux et la verrouiller par des tests en CI.

// Litteral pour filterByFormula Airtable. Renvoie null si la valeur contient les deux types de guillemets.
function formulaLiteral(v) {
  const s = String(v);
  if (!s.includes('"')) return `"${s}"`;
  if (!s.includes("'")) return `'${s}'`;
  return null;
}

// Extrait une valeur d'action Meta (les metriques video/landing sont des tableaux {action_type, value}).
function actionValue(arr, type) {
  if (!Array.isArray(arr)) return 0;
  const hit = arr.find(a => a && a.action_type === type);
  return hit ? Number(hit.value) || 0 : 0;
}

// Normalise l'ad account Meta : l'API exige le prefixe « act_ ». Ajoute-le si absent. '' reste ''.
function normalizeAdAccount(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return /^act_/i.test(s) ? s : 'act_' + s;
}

// Efface le token (?id=UUID), les UUID bruts et les courriels d'une chaine (logs/erreurs cote serveur).
function scrubToken(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/([?&]id=)[^&#]+/gi, '$1REDACTED')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, 'REDACTED')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'REDACTED');
}

module.exports = { formulaLiteral, actionValue, normalizeAdAccount, scrubToken };
