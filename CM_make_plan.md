# **CM — Plan Make complet (scénarios, sécurité, Loi 25\)**

Relu depuis le début de la conversation. Architecture arrêtée : **token généré dans le survey**, **Make orchestre** (création client/projet \+ génération paroles), **Netlify lit** (fonction `lire-projet`, gratuit \+ rapide), polling sur les pages d'attente.

**Principe de séquençage : on teste par ordre d'irréversibilité, pas par ordre de page.** Si le pied de la chaîne casse, rien d'autre ne marche.

---

## **Vue d'ensemble du flux**

```
INDEX (trafic Meta)
  └─ capture fbclid / _fbp / _fbc / utm  (cookies + params URL)

SURVEY (souvenirs.html)
  ├─ génère token = crypto.randomUUID()
  ├─ POST → MAKE A  (données + token + attribution + consentement)
  └─ redirect → /revision?id=TOKEN

MAKE A  (séquentiel, un seul scénario)
  1. Webhook
  2. Upsert Client (par email)            → récupère Client Record ID
  3. Create Project (token, données, attribution, consentement)
  4. HTTP → Anthropic API (paroles + titre)
  5. Parse JSON
  6. Create Generation (lyrics, status=lyrics_generated)

/revision?id=TOKEN
  └─ polling → /api/lire-projet → affiche dès status=lyrics_generated
     ├─ client confirme            → MAKE B
     └─ client demande des modifs  → MAKE B (regeneration)

MAKE B  (confirmation / modification des paroles)
  → si confirmé : déclenche génération AUDIO (Suno)
  → si modifs   : nouvelle Generation (type=regeneration) avec requested_changes

MAKE C  (callback Suno — async)
  → reçoit l'audio → upload Cloudinary → écrit cloudinary_audio_url
  → status = audio_generated

/apercu?id=TOKEN  (preview + Stripe Checkout)
  └─ AperÇu audio + bouton payer (139,97 $) + order bumps

MAKE D  (webhook Stripe — la chaîne argent)
  → commercial_status=purchased, purchase_date, amount, stripe_payment_intent
  → Meta CAPI (Purchase, avec fbc/fbp)
  → courriel de livraison

/page-chanson?id=TOKEN  (révisions post-achat, max 5)
/page-memoire?id=TOKEN  (livraison finale, partage famille) — lecture UNIQUE, pas de polling
```

---

## **MAKE A — Création (le scénario qu'on monte en premier)**

| \# | Module | Action | Mapping clé |
| ----- | ----- | ----- | ----- |
| 1 | **Webhook** | Reçoit le POST du survey | Payload : token, prenom\_defunt, relation, style\_musical, voix, ambiance, unicite, souvenirs, souvenir\_garder, email, consentement, fbclid, fbp, fbc, utm\_\*, landing\_page |
| 2 | **Airtable › Upsert a Record** | Table **Clients**, clé de recherche \= `email` | `email`, `contact_first_name`, `consent_status`\=`received`, `consent_date`\=`now()`, `last_activity_date`\=`now()`. → **récupère le Record ID** |
| 3 | **Airtable › Create a Record** | Table **Projects** | `client` \= **\[Record ID de l'étape 2\]** · `token` \= `{{1.token}}` · champs survey · `commercial_status`\=`preview_only` · `occasion`\=`memorial` · attribution (utm/fbclid/fbc/fbp/landing\_page) · **`cgv_acceptees_at`\=`now()`** · → **récupère le Project Record ID** |
| 4 | **HTTP › Make a request** | POST `https://api.anthropic.com/v1/messages` | Voir bloc API ci-dessous |
| 5 | **JSON › Parse JSON** | Parse `body.content[0].text` | Anthropic renvoie du texte ; il faut le parser pour extraire `titre`/`paroles` |
| 6 | **Airtable › Create a Record** | Table **Generations** | `project` \= **\[Project Record ID de l'étape 3\]** · `generation_no`\=`1` · `type`\=`preview` · `lyrics` · `song_title` · `generation_status`\=`lyrics_generated` |

### **Bloc API Anthropic (module 4\)**

* **URL** : `https://api.anthropic.com/v1/messages`  
* **Method** : POST  
* **Headers** :  
  * `x-api-key` : clé Anthropic (connexion/variable Make, **jamais en dur**)  
  * `anthropic-version` : `2023-06-01`  
  * `content-type` : `application/json`  
* **Body (raw JSON)** :

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 2000,
  "system": "PROMPT VOIX DE MARQUE CM — solution-first, identité québécoise, jamais ouvrir sur le deuil. Structure couplet/refrain. Réponds UNIQUEMENT en JSON valide: {\"titre\":\"...\",\"paroles\":\"...\"} sans aucun texte avant ou après.",
  "messages": [
    { "role": "user", "content": "Personne: {{prenom_defunt}}. Relation: {{relation}}. Style: {{style_musical}}. Voix: {{voix}}. Ambiance: {{ambiance}}. Ce qui la rendait unique: {{unicite}}. Souvenirs: {{souvenirs}}. À garder: {{souvenir_garder}}." }
  ]
}
```

* **Piège** : force le JSON pur dans le system prompt, sinon le modèle ajoute « Voici les paroles : » et le Parse JSON plante.

---

## **MAKE B — Confirmation / modification des paroles**

Déclenché par `revision.html` (POST avec `token`, `modifications`, `sans_modification`).

* **Branche A — confirmé** (`sans_modification=true`) : → déclenche la génération AUDIO (appel Suno sur les `lyrics` de la dernière Generation).  
* **Branche B — modifications** (`modifications` non vide) : → **Router/Filter** : `regenerations_count < 5` ?  
  * oui → nouvelle Generation (`type`\=`regeneration`, `generation_no`\+1, `requested_changes`\=modifs) \+ régénère paroles via Anthropic → retour révision  
  * non → courriel « limite atteinte, contactez-nous », pas de création

⚠️ **Décision ouverte** : le `revision.html` actuel redirige vers `/attente-chanson` après *toute* soumission. Si modifs → il devrait revenir afficher les nouvelles paroles, pas filer à l'attente. À clarifier avant de brancher la branche B.

---

## **MAKE C — Callback Suno (async)**

Suno est **asynchrone à callback** : tu lances la génération, Suno te rappelle quand c'est prêt. → **scénario séparé** qui *reçoit* le callback.

1. Webhook (reçoit le callback Suno : audio prêt \+ identifiant pour matcher la Generation)  
2. Télécharge l'audio → **upload Cloudinary**  
3. Airtable › Update Generation : `cloudinary_audio_url`, `generation_status`\=`audio_generated`

Matcher le callback à la bonne Generation : il faut un identifiant (Suno task ID) stocké au lancement. C'est probablement l'usage réel de `task_id` — **à confirmer**.

---

## **MAKE D — Webhook Stripe (la chaîne argent)**

1. Webhook Stripe (événement `checkout.session.completed`)  
2. Airtable › Update Project : `commercial_status`\=`purchased`, `purchase_date`\=`now()`, `amount`, `stripe_session_id`, `stripe_payment_intent`  
3. **Meta CAPI** : event `Purchase` côté serveur, avec `fbc`/`fbp` \+ email hashé → attribution impossible à bloquer par adblock  
4. Courriel de livraison (lien `/page-chanson?id=TOKEN` ou `/page-memoire?id=TOKEN`)

**Anti double-traitement** : vérifier que `stripe_payment_intent` n'est pas déjà écrit avant de traiter (Stripe peut envoyer 2 fois le webhook).

---

## **Les 6 jonctions à tester (ordre \= irréversible d'abord)**

1. **Survey → Airtable.** Soumets un faux survey : la fiche Project apparaît-elle avec TOUT (champs \+ token \+ attribution \+ cgv\_acceptees\_at) ? Si ça casse, rien d'autre ne marche.  
2. **Token → bonne page, bon domaine.** Le lien généré pointe-t-il sur **chansonmemoire.ca** et `?id=TOKEN` correct ?  
3. **/revision lit les paroles par token.** Ouvre `/revision?id=TOKEN` : les vraies paroles de CE token s'affichent (polling → `lyrics_generated`) ?  
4. **Stripe → paid.** Vrai paiement 1 $ : Project passe à `purchased`, CAPI fire avec fbc/fbp, livraison débloquée ?  
5. **Fallback courriel 15 min.** Onglet fermé après confirmation : le courriel part-il avec le lien **sur .ca** et le bon token ?  
6. **Compteur de révisions, côté serveur.** 6e demande de modif bloquée par le filtre Make (`regenerations_count`) ?

**Test isolé recommandé AVANT Make** : crée à la main un Project (token=`test-123`) \+ une Generation `lyrics_generated`, va sur `/revision?id=test-123`. Si les paroles s'affichent, toute la chaîne lecture (fonction \+ toml \+ variables \+ noms de champs) est bonne indépendamment de Make.

---

## **Sécurité (non négociable)**

* **Token \= UUID v4** (122 bits, non devinable). Jamais le record ID Airtable dans l'URL.  
* **`lire-projet.js` renvoie filtré** : titre, paroles, statut, audio, commercial\_status. **JAMAIS** email, stripe\_\*, attribution. Décidé champ par champ côté serveur.  
* **404 nu** sur introuvable — ne jamais révéler « existe mais pas payé » (aide au sondage).  
* **PAT Airtable scopé serré** : scopes `data.records:read` \+ `data.records:write`, accès à la **base CM uniquement**. Si fuite → ne touche que CM.  
* **Secrets en variables d'env Netlify** (`AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`), jamais dans le HTML/JS client. Clé Anthropic et Suno : même règle, côté serveur seulement.  
* **Polling borné** : 5 sec d'intervalle, arrêt à `lyrics_generated`/terminal, plafond 2 min. Pas de ping infini. Page finale \= lecture unique, zéro polling.  
* **Rate limit Airtable (5 req/sec/base)** : géré naturellement par l'intervalle de 5 sec. Rien à implémenter à ce volume.

---

## **Loi 25 & conformité légale (drapeaux systématiques)**

* **`cgv_acceptees_at`** horodaté par Make (`now()` serveur), pas le client. Sans ça, aucune preuve de consentement.  
* **`consent_status` \= withdrawn** → arrêter tout courriel à ce client. Prévoir le mécanisme de retrait.  
* **Divulgation IA au point d'achat** : à maintenir dans le copy du funnel (aperçu/checkout). Ne pas retirer.  
* **CAPI \= transfert de données client à Meta** (email hashé, fbc/fbp) → doit être couvert par la politique de confidentialité et le consentement. À valider avant de brancher.  
* **Loi sur la concurrence** : tout prix de référence / prix barré sur l'aperçu doit être substantié. Order bumps (PDF, instrumental) : prix validés **côté serveur**.  
* **Protection du consommateur** : **aucun témoignage / avis / résultat fabriqué.** (Historique de violations corrigées.)  
* ⚠️ Tout livrable légal \= **point de départ à faire valider**, jamais un avis juridique.

---

## **Ce que tu allais oublier (checklist)**

1. **`cgv_acceptees_at` n'est écrit nulle part** tant que tu ne l'ajoutes pas au Create Project (module A-3). Loi 25\.  
2. **Bug domaine (vu dans le chat pixel)** : `canonical` / `og:url` pointaient sur `netlify.app`, et les liens légaux \+ courriel Brigitte sur `.com`. **Doit être `.ca` partout.** À corriger.  
3. **Témoignages** : 5 avis avec noms \+ villes — substantiés et consentis, ou retirés avant trafic payant.  
4. **Le `fbp` ne se reconstruit pas** côté serveur. S'il n'est pas capté au navigateur (maintenant fait dans le survey corrigé), ton CAPI perd en match quality.  
5. **Suno \= scénario séparé** (callback async). Ne pas l'empiler dans Make A.  
6. **Upload Cloudinary** \= une étape Make à ne pas oublier entre Suno et l'affichage (sinon tu sers une URL Suno temporaire).  
7. **Doublon `payment_intent` vs `stripe_payment_intent`** dans Projects → en supprimer un.  
8. **`generation_status` orthographe exacte** : le polling Netlify attend `lyrics_generated`. Une faute \= page qui tourne dans le vide.  
9. **Confirme `cloudinary_audio_url`** au caractère près dans Generations.  
10. **Coût Make vs Netlify** : surveille ton compteur d'ops mensuel quand tu scales le Meta spend (la génération paroles dans Make consomme des ops).  
11. **Régénérations pré-paiement \= coût Suno** : `generations_count` reste visible pour détecter un abus si le profil de trafic change.  
12. **`delivery_url` manquant** sur Upsells : nulle part où stocker les livrables vendus.

