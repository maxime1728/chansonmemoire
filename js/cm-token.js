/* cm-token.js — sort le token (?id=) de l'URL des pages de livraison.
 *
 * POURQUOI : le token est la clé d'accès (chanson + page mémoire = données sensibles). Tant qu'il est
 * dans l'URL, il fuit vers Meta (event_source_url du pixel fbq), l'historique du navigateur et un
 * éventuel partage/capture de lien.
 *
 * COMMENT : au tout premier chargement (SYNCHRONE, dans le <head>, AVANT cm-pixel.js et cm-attrib.js),
 * on lit le token, on le met en RÉSERVE (sessionStorage, isolé par onglet) puis on le retire de l'URL.
 * On NE retire QUE `id` (on garde utm, fbclid, mode, maj, base, name, upsell_ok). On expose ensuite
 * window.CM_TOKEN (string) et window.cmToken() (lecture robuste : mémoire -> URL -> réserve).
 *
 * GARDE-FOU ANTI-RÉGRESSION : on ne nettoie l'URL QUE si la mise en réserve a réussi. Si sessionStorage
 * est bloqué (navigation privée stricte), on GARDE le token dans l'URL -> la page marche au refresh,
 * aucune casse. Les pages utilisent aussi un repli `window.cmToken ? … : (ancienne lecture URL)`, donc
 * si ce fichier n'est pas chargé, le comportement est strictement celui d'avant.
 */
(function () {
  var tok = '';
  try {
    var u = new URL(window.location.href);
    var fromUrl = u.searchParams.get('id') || '';
    var stashed = '';
    try { stashed = sessionStorage.getItem('cm_tok') || ''; } catch (e) {}
    tok = fromUrl || stashed;
    if (fromUrl) {
      var stashOk = false;
      try {
        sessionStorage.setItem('cm_tok', fromUrl);
        stashOk = (sessionStorage.getItem('cm_tok') === fromUrl);
      } catch (e) { stashOk = false; }
      if (stashOk) {
        try {
          u.searchParams.delete('id');
          window.history.replaceState(null, '', u.pathname + (u.search || '') + (u.hash || ''));
        } catch (e) {}
      }
    }
  } catch (e) {}
  window.CM_TOKEN = tok;
  window.cmToken = function () {
    if (window.CM_TOKEN) return window.CM_TOKEN;
    try { return new URLSearchParams(window.location.search).get('id') || sessionStorage.getItem('cm_tok') || ''; }
    catch (e) { return ''; }
  };
})();
