# SETUP — Airtable + Make (production musicale)

Pas-à-pas pour appliquer l'architecture. **Base Airtable de TEST + scénario Make sandbox uniquement.**
Rien ici ne touche la prod. Ordre : Airtable d'abord (le pied de la chaîne), puis Make.

---

## 1. Airtable (base de test dupliquée)

### Table **Projects** — ajouter
| Champ | Type |
|---|---|
| `song_regenerations_count` | Rollup sur `generations` — `COUNT(values)`, filtre `type = 'song_regeneration'` ET `post_purchase = 0` |
| `post_purchase_regenerations_count` | Rollup sur `generations` — filtre `(type='song_regeneration' OU type='cover')` ET `post_purchase = 1` |
| `recevoir_clicked_at` | Date (avec heure) |
| `delivery_signature_name` | Single line text |
| `delivery_signature_at` | Date (avec heure) |
| `delivery_accessed_at` | Date (avec heure) |
| `delivery_acceptance_text_version` | Single line text |
| `acceptance_ip` | Single line text |
| `acceptance_user_agent` | Single line text |
| `downloaded_at` | Date (avec heure) |
| `download_count` | Number (integer) |

À **retirer** : `task_id` (Projects) et le doublon `payment_intent`.

### Table **Generations** — ajouter / modifier
| Champ | Type |
|---|---|
| `suno_task_id` | Single line text |
| `song_id` | Single line text |
| `post_purchase` | Checkbox |
| `type` | Single select — valeurs : `lyrics`, `lyrics_regeneration`, `song`, `song_regeneration`, `cover` |
| `generation_status` | Single select — ajouter la valeur `audio_pending` (garder `lyrics_generated`, `audio_generated`, `validated`) |
| `cloudinary_audio_url` | URL — **confirmer le nom exact au caractère près** (lu par `lire-projet.js` / `telecharger.js`) |

> ⚠️ Orthographe **exacte** des valeurs `generation_status` : le polling Netlify attend `audio_generated`.

### PAT Airtable
Scopes `data.records:read` + `data.records:write`, accès à la **base de test uniquement**.
Renseigner `AIRTABLE_TOKEN` + `AIRTABLE_BASE_ID` en variables d'env Netlify.

---

## 2. Make (scénario sandbox)

### Connexions / variables (jamais en dur)
- `SUNO_API_KEY`, `ANTHROPIC_API_KEY`, connexion Airtable (base test), connexion Cloudinary.

### Ordre de montage
1. **MAKE C-cb** (callback) en premier — voir `MAKE_C-cb.json`. Crée le webhook, **copie son URL**.
2. **MAKE C-gen** (lancement) — voir `MAKE_C-gen.json`. Colle l'URL du webhook MAKE C-cb dans
   `callBackUrl` (corps HTTP de `http_bodies.json#suno_generate` / `#suno_upload_cover`).
3. **Data Store** `style × ambiance` → chaîne `style` Suno (ton mini-prompt de directives).
4. Brancher les déclencheurs front :
   - `/apercu` bouton « Régénérer » → `/souvenirs?id=TOKEN` → MAKE A (régén paroles) → `/revision` → approbation → MAKE C-gen.
   - `page-chanson` « Régénérer la chanson » / « cover » → POST direct au webhook **MAKE C-gen**
     (remplacer `MAKE_C_GEN_WEBHOOK` dans `page-chanson.html`).

### Webhooks à câbler dans le code
- `souvenirs.html` → `MAKE_WEBHOOK_A` (déjà présent).
- `page-chanson.html` → `MAKE_C_GEN_WEBHOOK` (placeholder à remplacer).

---

## 3. Tests (par irréversibilité)
1. **Lecture isolée** : créer à la main un Project (`token` UUID) + Generation `audio_generated` →
   `/apercu?id=TOKEN` joue le preview 60s.
2. **Pré-remplissage** : `/souvenirs?id=TOKEN` ré-affiche les réponses (lire-survey).
3. **Lancement chanson** : approbation `/revision` → MAKE C-gen → `suno_task_id` écrit, statut `audio_pending`.
4. **Callback** : MAKE C-cb reçoit `complete` → garde piste [0] → Cloudinary → `audio_generated` →
   `/attente` redirige vers `/apercu`.
5. **Plafond** : 6e régén chanson bloquée (compteur serveur). Paroles : illimitées.
6. **Preuve livraison** : `page-chanson` gate → signature → champs preuve écrits sur Project →
   révélation + téléchargement (log `downloaded_at`).

---

## 4. Drapeaux avant launch
- **Légal (BLOQUANT)** : texte d'acceptation / clause remboursement (LPC Québec) + divulgation IA →
  faire valider. Le code ne fait que capturer la preuve.
- **Loi 25** : rétention/purge des Projects non convertis ; signature + IP à couvrir dans la
  politique de confidentialité.
- **`lire-projet.js`** : le durcissement (UUID + échappement) vit dans la PR sécurité — s'assurer
  qu'elle est mergée.
