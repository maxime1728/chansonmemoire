/* cm-sentry.js — Sentry NAVIGATEUR (erreurs JS des pages), charge tot sur toutes les pages.
 *
 * Le DSN est PUBLIC (concu pour le client) -> ok en clair. Mais nos URLs contiennent ?id=TOKEN
 * (la cle d'acces du parcours) : on EFFACE le token + les UUID + le courriel de tout evenement
 * AVANT envoi (beforeSend/beforeBreadcrumb) -> aucune donnee sensible ne part chez Sentry (Loi 25).
 *
 * Monitoring d'erreurs = operationnel (pas du marketing) -> non gate par le consentement, sinon on
 * raterait justement les bugs qui surviennent avant le choix de consentement.
 */
(function () {
  if (window.__cmSentry) return; window.__cmSentry = true;

  function scrub(s) {
    if (typeof s !== 'string') return s;
    return s
      .replace(/([?&]id=)[^&#]+/gi, '$1REDACTED')                                                    // ?id=TOKEN
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, 'REDACTED')  // UUID v4 brut
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'REDACTED');                               // courriel
  }
  function scrubEvent(event) {
    try {
      if (event.request && event.request.url) event.request.url = scrub(event.request.url);
      if (event.message) event.message = scrub(event.message);
      if (Array.isArray(event.breadcrumbs)) event.breadcrumbs.forEach(function (b) {
        if (b && b.data && b.data.url) b.data.url = scrub(b.data.url);
        if (b && b.message) b.message = scrub(b.message);
      });
    } catch (e) {}
    return event;
  }

  // Le loader Sentry appelle sentryOnLoad si on veut piloter l'init nous-memes (avec le scrubbing).
  window.sentryOnLoad = function () {
    try {
      Sentry.init({
        sendDefaultPii: false,                       // pas d'IP/headers perso par defaut
        beforeSend: scrubEvent,
        beforeBreadcrumb: function (b) { if (b && b.data && b.data.url) b.data.url = scrub(b.data.url); return b; }
      });
    } catch (e) {}
  };

  // Loader officiel Sentry (DSN public). crossorigin pour des stacktraces propres.
  var s = document.createElement('script');
  s.src = 'https://js.sentry-cdn.com/87de23fc87affa685d8175308548712e.min.js';
  s.crossOrigin = 'anonymous';
  (document.head || document.documentElement).appendChild(s);
})();
