// netlify/functions/_lib/brouillon.js
//
// Génération PARTAGÉE du brouillon de réponse client (voix de marque Chanson Mémoire). Source UNIQUE
// utilisée par brouillon-cron (rédaction auto en file) ET par le cockpit (action regen_draft : régénérer
// avec un TON choisi). Éviter la dérive du prompt de marque = une seule définition ici.
//
// Voix de marque (CLAUDE.md §1) : SOLUTION-FIRST, québécois, digne, vouvoiement. Garde-fou légal (§2) :
// remboursement / allégation = confiance basse, jamais auto.

const MAX_PROJETS = 3;
const MAX_TEXTE   = 90000;
const TIMEOUT_MS  = 20000;

// Prompt de marque (déplacé depuis brouillon-cron, inchangé). Le TON par défaut est déjà « chaleureux » ;
// tonDirective() permet de le basculer en « factuel » sans réécrire tout le prompt.
const SYSTEM = `Tu es l'assistant du SERVICE CLIENT de Chanson Mémoire (chansons hommage et cadeau personnalisées, marché québécois francophone).

Ta tâche : à partir de l'échange reçu d'un client et du contexte de ses projets, rédiger un BROUILLON de réponse que l'équipe relira avant envoi.

LE FIL PEUT CONTENIR PLUSIEURS MESSAGES : le client a parfois écrit en plusieurs courriels successifs. Lis TOUT le fil et réponds au besoin global (en priorité ce qui est resté sans réponse / le plus récent).

PLUSIEURS PROJETS : si le contexte contient plus d'un projet, identifie DE QUELLE chanson le client parle grâce au prénom de la personne ou au contenu. Si c'est ambigu, demande-lui poliment de préciser — n'invente pas.

LIEN DE LA PAGE : si le client veut accéder à sa chanson / la réécouter, suivre l'avancement, ou demande une modification, INCLUS le lien de sa page (le champ "lien_page" du contexte du bon projet). C'est là qu'il écoute, télécharge et demande ses modifications. N'invente JAMAIS d'autre lien ; si "lien_page" est vide, n'en mets aucun.

FORMAT DES LIENS (IMPÉRATIF) : écris TOUJOURS un lien en markdown [texte court et clair](url), JAMAIS l'URL nue. Exemple : [votre page Chanson Mémoire](URL). Si le client a plusieurs projets, nomme chaque lien par la personne, ex. [la chanson de Prénom](URL). Les liens deviennent cliquables dans le courriel envoyé.

TON POUR LES MODIFICATIONS (IMPÉRATIF) : si la demande est une modification de la chanson (paroles, style, prononciation, etc.), réponds comme si la correction est DÉJÀ APPLIQUÉE. Invite le client à réécouter sa version corrigée au lien MAINTENANT. N'écris JAMAIS au futur (« nous allons corriger », « dès que ce sera prêt », « nous vous ferons signe ») : la nouvelle version est déjà là.

VOIX DE MARQUE (IMPÉRATIF) :
- Français QUÉBÉCOIS, naturel, chaleureux, sobre et digne. Vouvoiement.
- SOLUTION-FIRST : n'ouvre JAMAIS sur le deuil ou la douleur. Entre par ce qu'on offre / ce qu'on peut faire.
- Pas larmoyant, pas de clichés. Concis et humain.
- N'utilise JAMAIS le tiret cadratin/long (—) : remplace-le par une virgule, un deux-points, une parenthèse ou un point.
- NE signe PAS et n'ajoute AUCUNE formule finale (bonne journée, au plaisir, cordialement...) : la salutation du moment et la signature (Nathalie, L'équipe Chanson Mémoire) sont ajoutées AUTOMATIQUEMENT à l'envoi. Termine sur ta dernière phrase utile.

GARDE-FOUS, NE JAMAIS faire de façon autonome (mets alors confiance="basse") :
- Promettre, confirmer ou refuser un REMBOURSEMENT.
- Avancer un prix, une promotion, une garantie de résultat ou une allégation.
- Toute question juridique, plainte, ou litige.
Dans ces cas, rédige un accusé de réception empathique qui dit qu'un membre de l'équipe revient personnellement — sans rien promettre.

CONFIANCE :
- "haute" : question simple répondable avec le contexte (état de la commande, accès à la chanson, délais).
- "moyenne" : demande de modification claire, ou question partiellement couverte, ou projet ambigu.
- "basse" : remboursement, plainte, sujet sensible/légal, ou contexte insuffisant.

CATÉGORIE : "question" | "modification" | "remboursement" | "remerciement" | "autre".

RÉPONDS UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"brouillon":"<la réponse complète, prête à relire>","confiance":"haute|moyenne|basse","categorie":"question|modification|remboursement|remerciement|autre"}`;

// Directive de TON ajoutée au prompt. Défaut = 'chaleureux' (la voix de marque telle quelle, aucun ajout).
// 'factuel' = même voix (québécois, vouvoiement, solution-first, zéro tiret) mais plus directe et sobre.
function tonDirective(ton) {
  if (ton === 'factuel') {
    return `\n\nTON DEMANDÉ POUR CE BROUILLON : FACTUEL. Va droit au but : informatif, sobre, phrases courtes, l'essentiel d'abord. Moins de chaleur affective, mais toujours poli, respectueux et au vouvoiement. Tu gardes TOUTES les règles ci-dessus (solution-first, lien markdown, zéro tiret cadratin, pas de signature).`;
  }
  return '';   // 'chaleureux' (défaut) : rien à ajouter, la voix de marque est déjà chaleureuse.
}

function extraireJson(txt) {
  if (!txt) return null;
  const i = txt.indexOf('{'), j = txt.lastIndexOf('}');
  if (i === -1 || j === -1 || j < i) return null;
  try { return JSON.parse(txt.slice(i, j + 1)); } catch (_) { return null; }
}

// Contexte de chaque projet lié (cap MAX_PROJETS) -> aide l'IA à savoir DE QUELLE chanson on parle + le lien.
async function construireContexts({ api, headers, projectsTable, site, projectIds }) {
  const contexts = [];
  for (const pid of (projectIds || []).slice(-MAX_PROJETS)) {
    try {
      const rP = await fetch(`${api}/${projectsTable}/${pid}`, { headers });
      if (rP.ok) {
        const p = (await rP.json()).fields || {};
        contexts.push({
          prenom_personne: p.deceased_name || '',
          type: p.song_type || 'hommage',
          langue: p.language || 'fr-CA',
          statut_commande: p.commercial_status || 'preview_only',
          etape: p.approval_status || '',
          // Lien PAR PROJET : vendu -> page de livraison ; pré-achat -> page aperçu (jamais le lien complet).
          lien_page: !p.token ? ''
            : (p.commercial_status === 'purchased'
                ? (p.page_url || `${site}/espace-client?id=${encodeURIComponent(p.token)}`)
                : `${site}/apercu?id=${encodeURIComponent(p.token)}`)
        });
      }
    } catch (_) {}
  }
  return contexts;
}

// Appel Anthropic AVEC timeout (jamais bloquer l'appelant). Renvoie {brouillon, confiance, categorie} ou null.
// `ton` : 'chaleureux' (défaut) | 'factuel'.
async function genererBrouillon({ key, fields: f, contexts, ton }) {
  if (!key) return null;
  const nProjets = Array.isArray(f.Projet) ? f.Projet.length : (contexts || []).length;
  const drapeauProjets = nProjets > 1
    ? `\n⚠ CE CLIENT A ${nProjets} PROJETS (chansons distinctes). Identifie de LAQUELLE il parle d'après le fil ; si c'est ambigu, demande-le-lui poliment au lieu de supposer. Nomme chaque chanson par la personne honorée.\n`
    : '';
  const userPrompt =
    `ÉCHANGE REÇU\nDe : ${f.expediteur || ''}\nSujet : ${f.sujet || '(aucun)'}\n\nFil (du plus ancien au plus récent) :\n${(f.message || '').slice(-MAX_TEXTE)}\n${drapeauProjets}\n` +
    `CONTEXTE DES PROJETS DU CLIENT (peut être vide) :\n${JSON.stringify(contexts || [])}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1200, system: SYSTEM + tonDirective(ton), messages: [{ role: 'user', content: userPrompt }] })
    });
    if (!res.ok) { console.error('[brouillon] Anthropic', res.status); return null; }
    const data = await res.json().catch(() => ({}));
    const txt = (data.content && data.content[0] && data.content[0].text) || '';
    return extraireJson(txt);
  } catch (e) { console.error('[brouillon] Anthropic', e && e.message); return null; }
  finally { clearTimeout(timer); }
}

module.exports = { SYSTEM, tonDirective, extraireJson, construireContexts, genererBrouillon, MAX_TEXTE, MAX_PROJETS };
