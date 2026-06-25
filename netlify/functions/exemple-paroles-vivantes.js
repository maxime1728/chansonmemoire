// netlify/functions/exemple-paroles-vivantes.js
//
// Rendu de la vidéo « paroles vivantes » pour l'EXEMPLE « Mon homme du lac »
// (page marketing exemple-page-memoire.html). Autonome : AUCUN Airtable, AUCUN token.
// Réutilise le MÊME module de design que la production (_lib/paroles-vivantes-timeline)
// et le MÊME ré-hébergement Cloudinary -> l'exemple reflète exactement le rendu livré.
//
// Idempotent + permanent : la vidéo finale est ré-hébergée sur Cloudinary à un public_id FIXE.
//   - GET (défaut)         -> si l'asset Cloudinary existe : { status:'done', url } ; sinon { status:'pending' }.
//   - GET ?render_id=...   -> sonde Creatomate ; si fini -> ré-héberge -> { status:'done', url }.
//   - POST (ou ?trigger=1) -> lance un rendu Creatomate -> { status:'pending', render_id }.
//
// Le déclenchement est derrière une action explicite (POST/clic) -> pas de rendu involontaire
// au simple chargement de page. Une fois rendu, l'asset Cloudinary est servi sans re-render (0 coût).
//
// Clés en env (déjà présentes en prod) : CREATOMATE_API_KEY, CREATOMATE_API_VERSION,
//   CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET. Option : EXEMPLE_AUDIO_START (sec du Couplet 2).

const { buildEditFromLyrics } = require('./_lib/paroles-vivantes-timeline');
const { rehost } = require('./_lib/cloudinary-rehost');

const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;
const CREATOMATE_VERSION = process.env.CREATOMATE_API_VERSION || 'v1';
const CLOUD = process.env.CLOUDINARY_CLOUD_NAME;

const FOLDER = 'paroles-vivantes';
const PUBLIC_ID = 'exemple_mhdl';                       // public_id FIXE -> idempotence
const AUDIO_START = Number(process.env.EXEMPLE_AUDIO_START || 0);   // sec ; début du Couplet 2 (0 = chanson complète)

const TITRE = 'Mon homme du lac';
const PRENOM = 'Michel';
const AUDIO_BASE = 'v1782355169/MON_HOMME_DU_LAC_EMOTIONNELLE_lwwoy1.mp3';
function audioUrl() {
  const tf = AUDIO_START > 0 ? `so_${AUDIO_START}/` : '';
  return `https://res.cloudinary.com/dcx1tfm47/video/upload/${tf}${AUDIO_BASE}`;
}

// Paroles à partir du Couplet 2 (« comme si c'était le début »). cleanLyrics retire les balises [..].
const LYRICS = [
  '[Couplet 2]',
  "Le chalet de Val-des-Bois c'était son royaume à lui",
  "Les fins de semaine d'automne avec les enfants, les amis",
  "Il faisait son bouilli le samedi, ça sentait dans tout le rang",
  "Tout le monde finissait par rentrer, attirés par l'odeur et le temps",
  "Il chantait faux en faisant la vaisselle, il s'en foutait ben raide",
  "Ses blagues plates qu'on connaissait par cœur, on les redemandait",
  "Parce que c'était lui, parce que c'était ça",
  "Michel dans sa cuisine, c'était le plus beau des combats",
  '',
  '[Refrain]',
  "Mon homme du lac, t'as pas fait de bruit en partant",
  "Comme t'avais vécu, discret, généreux, tout doucement",
  "T'es dans le café du matin, t'es dans le bois qui craque",
  "Mon homme du lac, t'es encore là dans chaque escale",
  "Dans les yeux de nos enfants, dans nos dimanches qui flânent",
  "Dans chaque coucher de soleil sur l'eau qui se promène",
  "Mon homme du lac, je t'entends encore rire",
  "T'as pas fini de vivre, t'as juste changé de rive",
  '',
  '[Couplet 3]',
  "Y'avait ces soirs-là où on restait sur le bord de l'eau",
  "Juste toi pis moi, les grenouilles pis les étoiles là-haut",
  "T'avais rien de compliqué à dire, pis c'était parfait",
  "Ces silences-là entre nous deux, ils valaient tout ce qu'on savait",
  "Nos trois enfants ont grandi avec tes mains dans leur chemin",
  "Roxanne, Patrick, Maude, t'étais leur roc, leur matin",
  "Aujourd'hui c'est eux qui portent ça, ce même amour tranquille",
  "Que t'as semé sans compter dans chaque petite île",
  '',
  '[Pont]',
  "J'aurais voulu te dire encore une fois",
  "Que tes matins de pêche, tes bouillons, tes grands bras autour de moi",
  "C'était pas ordinaire, même si on pensait que c'était ordinaire",
  "C'était toute ma vie Michel, c'était toute ma vie entière",
  "Le chalet est encore là, le lac est encore là",
  "Mais c'est plus pareil sans toi dans la chaloupe là-bas",
  "Je prends quand même mon café dehors le matin",
  "Pis je te parle un peu, pis ça fait du bien",
  '',
  '[Refrain]',
  "Mon homme du lac, t'as pas fait de bruit en partant",
  "Comme t'avais vécu, discret, généreux, tout doucement",
  "T'es dans le café du matin, t'es dans le bois qui craque",
  "Mon homme du lac, t'es encore là dans chaque escale",
  "Dans les yeux de nos enfants, dans nos dimanches qui flânent",
  "Dans chaque coucher de soleil sur l'eau qui se promène",
  "Mon homme du lac, je t'entends encore rire",
  "T'as pas fini de vivre, t'as juste changé de rive",
  '',
  '[Outro]',
  "Roxanne, Patrick, Maude, on va garder le chalet",
  "On va garder le bouilli, on va garder ta façon d'aimer",
  "Pis chaque automne quand le lac se calme et que le bois sent bon",
  "On va savoir que t'es là Michel, dans chaque saison"
].join('\n');

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}

// URL de l'asset Cloudinary final (public_id fixe). Sert de cache permanent.
function hostedUrl() {
  return CLOUD ? `https://res.cloudinary.com/${CLOUD}/video/upload/${FOLDER}/${PUBLIC_ID}.mp4` : '';
}
async function assetExists(url) {
  if (!url) return false;
  try { const r = await fetch(url, { method: 'HEAD' }); return r.ok; } catch (_) { return false; }
}

exports.handler = async (event) => {
  if (!CREATOMATE_API_KEY) return json(500, { error: 'Configuration vidéo manquante' });

  const qs = event.queryStringParameters || {};
  const wantsTrigger = event.httpMethod === 'POST' || qs.trigger === '1';

  // 0. Déjà rendu (asset Cloudinary permanent) -> on le sert, sans rien relancer.
  const hosted = hostedUrl();
  if (await assetExists(hosted)) return json(200, { status: 'done', url: hosted });

  // 1. Sonde d'un rendu en cours (le client repasse avec ?render_id=...).
  if (qs.render_id) {
    try {
      const r = await fetch(`https://api.creatomate.com/v1/renders/${encodeURIComponent(qs.render_id)}`,
        { headers: { Authorization: `Bearer ${CREATOMATE_API_KEY}` } });
      const d = await r.json();
      if (d && d.status === 'succeeded' && d.url) {
        const perm = await rehost(d.url, { folder: FOLDER, publicId: PUBLIC_ID, resourceType: 'video' });
        return json(200, { status: 'done', url: perm || d.url });
      }
      if (d && d.status === 'failed') return json(200, { status: 'failed' });
      return json(200, { status: 'pending', render_id: qs.render_id });
    } catch (_) { return json(200, { status: 'pending', render_id: qs.render_id }); }
  }

  // 2. Pas de déclenchement explicite -> on ne fait que signaler « pas encore prêt » (aucun coût).
  if (!wantsTrigger) return json(200, { status: 'pending' });

  // 3. Lance un rendu Creatomate (cadence douce : pas d'horodatage Suno pour cet exemple).
  try {
    const edit = buildEditFromLyrics({ titre: TITRE, prenom: PRENOM, lyrics: LYRICS, alignedWords: [], audioUrl: audioUrl() });
    if (!edit) return json(409, { error: 'Paroles vides' });
    const payload = (CREATOMATE_VERSION === 'v1') ? { source: edit } : edit;
    const rc = await fetch(`https://api.creatomate.com/${CREATOMATE_VERSION}/renders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CREATOMATE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const dc = await rc.json();
    const render = Array.isArray(dc) ? dc[0] : dc;
    if (!rc.ok || !render || !render.id) {
      console.error('[exemple-paroles-vivantes] Creatomate a refusé:', (dc && (dc.message || dc.error)) || `HTTP ${rc.status}`);
      return json(502, { error: 'Lancement de la vidéo échoué' });
    }
    if (render.status === 'succeeded' && render.url) {
      const perm = await rehost(render.url, { folder: FOLDER, publicId: PUBLIC_ID, resourceType: 'video' });
      return json(200, { status: 'done', url: perm || render.url });
    }
    return json(200, { status: 'pending', render_id: render.id });
  } catch (err) {
    console.error('[exemple-paroles-vivantes]', err && err.message);
    return json(500, { error: 'Erreur serveur' });
  }
};
