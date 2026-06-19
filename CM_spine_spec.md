# CM_spine_spec.md — Parcours digital complet (spine)

> Référence autoritaire du parcours client digital de Chanson Mémoire.
> **Portée :** spine 100 % digital, automatisable, launch-ready.
> **Hors portée (chantier séparé) :** upsells physiques — vidéo montage, plaques.
> Voir §9. Ne pas les coder dans ce spine.

---

## 1. Parcours (ordre des étapes)

`index` → `souvenirs` (survey) → `revision` (paroles) → `attente` (génération Suno ~5 min)
→ `apercu` (preview 60s + régénération ×3) → `achat` (Stripe + order bumps)
→ redirect `page complète` → courriel de livraison.

Token `?id=TOKEN` (UUID v4, généré au load du survey) porté sur **toutes** les pages.
Make écrit ; Netlify lit. Jamais l'inverse.

---

## 2. Étapes en détail

**index** — entrée. Voix solution-first. Divulgation IA présente.

**souvenirs (survey)** — collecte : `prenom_defunt, relation, style_musical, ambiance,
unicite, souvenirs, souvenir_garder, voix`. Au load : génère le token. Submit → webhook Make (Scénario A).

**revision (paroles)** — Netlify lit `titre/paroles/statut` par token. Le client approuve
les paroles avant production audio. (`voix` n'entre pas dans le prompt paroles, il va à Suno.)

**attente (génération Suno ~5 min)** — VRAIE attente. Suno génère la chanson **complète**,
stockée comme lien sur Airtable (Generation). Le preview 60s est une **troncature** de cette
piste complète. Page d'attente digne + poll du statut. **Filet :** si le client quitte,
un courriel le ramène quand c'est prêt. **Si Suno échoue/dépasse :** alerte (voir §6).

**apercu (preview)** — sert le clip 60s tronqué, jamais l'URL complète dans la réponse.
Régénération possible, **plafond 3** (compteur `regenerations_count`, régens *client* seulement).
Au 3e : message affiché, plus de régen → incitation à l'achat. Divulgation IA au point d'achat.

**achat (Stripe Checkout + order bumps)** — order bumps digitaux :
- PDF des paroles (généré depuis paroles stockées — trivial).
- Version instrumentale : stems de la piste achetée (voir §5). Générée une fois, à l'achat.
Pas de prix barré / « valeur de X$ » sans substantiation (Loi concurrence — violation déjà corrigée).

**redirect page complète** — `success_url` Stripe → page complète. La chanson complète
existe **déjà** → révélation quasi-instantanée. Course = lag webhook seulement → **poll léger
(quelques sec)**, état « finalisation » bref, jamais page vide. Révélation conditionnée à
`commercial_status = payé`, vérifiée serveur, jamais URL Cloudinary brute.

**courriel de livraison** — envoyé par le scénario déclenché au webhook **seulement quand le
statut est basculé et l'asset complet confirmé existant**. Même token. Remerciement + lien.

**téléchargement (propriété)** — la page complète offre un bouton **Télécharger** proéminent
servant le fichier complet (Cloudinary), gated sur statut payé. Cadré comme une vraie propriété :
la chanson leur appartient. C'est la base du modèle de possession (voir §9) — ce qui rend la
limite d'hébergement de 1 an acceptable.

---

## 3. Deux attentes distinctes (ne pas confondre)

| | Attente génération | Redirect post-achat |
|---|---|---|
| Où | avant `apercu` | après paiement |
| Durée | ~5 min (Suno réel) | quasi-nulle (lag webhook) |
| UX | page d'attente complète + courriel-filet | poll léger, état bref |
| Échec | alerte + replay génération | alerte + forcer livraison |

---

## 4. Routing & données

- **Make écrit** : upsert Client, create Project, paroles (HTTP), Generation, statut, audio link.
- **Netlify lit** : `lire-projet.js`, expose **uniquement** `titre/paroles/statut/audio_url/
  commercial_status`. Jamais email, Stripe IDs, attribution, photos.
- **Validation token** : regex UUID v4 stricte en amont, `400` avant tout appel Airtable.
- **Révélation complète** : gated sur `commercial_status` payé, vérif serveur.

---

## 5. Order bumps (digitaux uniquement dans ce spine)

- **PDF paroles** : générer depuis `paroles` stockées. Livraison digitale instantanée.
- **Instrumentale** : séparation de stems de la piste **déjà achetée** (pas une régénération).
  - API : `sunoapi.org` (wrapper tiers Suno), endpoint `POST /api/v1/vocal-removal/generate`,
    `type: separate_vocal` (2 stems voix + instrumental, ~10 crédits). Inputs : `taskId` + `audioId`
    de la génération d'origine. Async → callback retourne `instrumental_url`.
  - ⚠ `instrumental_url` n'est valide que **14 jours** → copier sur Cloudinary **immédiatement** au callback.
  - ⚠ Facturé à chaque appel, sans cache → générer **une seule fois**, à l'achat de l'order bump, puis stocker.
  - ⚠ Dépendance tierce (reseller, pas Suno officiel) → point de fragilité, prévoir un plan B.

---

## 6. Patron erreur / alerte / replay (transversal — appliqué à CHAQUE jonction)

Le client a demandé : alerte + message + replay **tout au long** du processus.
Patron unique réutilisé à chaque jonction, plutôt que re-spécifié à chaque étape.

**À chaque jonction : `try` → en cas d'échec :**
1. **Alerte** → courriel à Maxime seul, avec token du Project + l'erreur + l'étape.
2. **Message client** → digne, jamais technique (« on finalise ta chanson, tu la recevras
   par courriel sous peu »). Jamais de page vide ni d'erreur brute.
3. **Replay** → via Airtable (voir ci-dessous).

**Jonctions à couvrir :**
- J1 — Survey → Scénario A (paroles HTTP). Échec : génération paroles.
- J2 — Paroles approuvées → Suno (~5 min). **Jonction la plus critique** (durée + coût).
- J3 — Suno fait → Cloudinary + troncature preview + écriture lien Airtable.
- J4 — Paiement → webhook → bascule `commercial_status` → révélation.
- J5 — Envoi courriel de livraison.

**Mécanisme de replay (Airtable, Brigitte-friendly, zéro code) :**
- Case `🔁 Relancer génération` (couvre J1–J3) : un scénario Make la surveille → relit les
  inputs stockés du Project → relance HTTP paroles + Suno → écrit nouvelle Generation → décoche.
- Case `📨 Forcer livraison` (couvre J4–J5) : re-bascule statut payé + ré-envoie le courriel.
- **Compteur séparé** : le replay admin ne brûle JAMAIS une des 3 régens du client. Une panne
  système ne doit pas punir le client.

---

## 7. Sécurité (report des décisions lockées)

- Validation UUID v4 stricte avant tout accès (anti-énumération).
- `filterByFormula` paramétrés/échappés (défense en profondeur).
- Révélation complète gated sur statut payé, vérif serveur.
- `lire-projet.js` n'expose que les 5 champs autorisés.
- Audit énumération complet requis avant launch (flag ouvert).

---

## 8. Loi 25 & divulgation IA

- Preuve de consentement (`cgv_acceptees_at`) capturée au point d'achat.
- Divulgation IA présente au **point de décision d'achat** (avant clic Stripe), pas seulement index.
- Rétention : purge des Projets/Générations non-convertis selon politique définie ; Clients préservés.
  Modèle de possession et rétention 1 an : voir §9. (⚠ exception permanente pour pages liées à un QR physique.)

---

## 9. Possession, rétention & téléchargement

Principe fondateur : **séparer ce qui est possédé de ce qui est hébergé.**

- **Chanson = artefact possédé pour toujours.** Téléchargeable, proéminent, cadré comme propriété.
  Même si la page disparaît, l'hommage n'est jamais perdu.
- **Page en ligne = service hébergé, 1 an inclus.** Prolongé par l'abonnement (voir §10).
  L'abonnement ajoute du *nouveau*, ne retient jamais l'existant → pas de coercition.
- **Avant toute suppression à 1 an** : rappel courriel + confirmation que le téléchargement a été fait.
- **Rétention Loi 25** : 1 an défini = bonne minimisation, *à condition* de divulguer clairement
  la limite au point d'achat et d'offrir le téléchargement avant suppression.
- **Protection du consommateur (⚠ à valider)** : si le marketing évoque « pour toujours / souvenir
  vivant », la permanence doit pointer sur *le téléchargement* (chanson), pas sur la page. La limite
  de la page doit être divulguée, non enfouie.
- **⚠ Tension à résoudre AVANT de vendre des plaques QR** : une plaque physique permanente dont le
  QR pointe vers une page garantie 1 an = promesse brisée. Les pages liées à un QR exigent un palier
  d'hébergement **permanent**, distinct du 1 an de base, et exclues de la purge.

---

## 10. Teaser abonnement + waitlist (build v1, léger)

- Section sur la page perso, clairement étiquetée **« À venir »**. Aucun paiement, aucune date ferme,
  aucune promesse d'availability.
- Capture courriel waitlist → écrit dans Airtable avec le token, taggé `waitlist_abonnement`.
- Features montrées (signal « la mémoire grandit par la création », PAS des rituels génériques) :
  dépôt de souvenirs (collab famille), nouvelles œuvres récurrentes, vidéo-hommage évolutive,
  page famille partagée, lien + QR de partage (avec caveat permanence §9).
- Tout rappel de date = **opt-in et cadré solution-first** uniquement (ne jamais faire surgir le deuil).
- But : mesurer la demande avant de bâtir la plateforme d'abonnement (chantier distinct, post-validation).

---

## 11. Items ouverts (à résoudre avant de coder les morceaux concernés)

1. **Upsells physiques (chantier séparé, post-launch)** : vidéo montage + plaques. Exigent :
   - Plan de fulfillment (fournisseur impression, inventaire, expédition, taxes biens physiques, retours).
   - Traitement Loi 25 des photos (consentement, suppression, stockage sécurisé, accès).
   - **Résolution de la tension QR permanent vs hébergement 1 an** (voir §9) : palier permanent + exclusion de purge.
   - Économie unitaire + prix (drapeau Loi concurrence : aucun prix barré non substantié).
   - Charge opérationnelle (montage = travail manuel par commande).
2. **Plateforme d'abonnement (chantier distinct, post-validation waitlist)** : facturation récurrente,
   dépôt de souvenirs, génération d'œuvres, modération de contenu tiers, rétention/suppression.
3. **Prix order bumps + abonnement** — à fixer ; vérif conformité avant affichage.
