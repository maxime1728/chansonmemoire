// netlify/functions/_lib/purge.js
//
// Loi 25 — minimisation des données pour les projets NON achetés. Les projets ACHETÉS ne sont
// JAMAIS touchés (lien client actif conservé). Deux phases :
//   PHASE A (60 jours) : supprime les FICHIERS Cloudinary (audio) + vide les URLs Airtable.
//   PHASE B (6 mois)   : ANONYMISE les champs personnels (nom, courriel, souvenirs, paroles…),
//                        en gardant les colonnes non-personnelles (utm, dates, compteurs, style)
//                        pour le marketing. Le courriel du Client n'est effacé QUE s'il n'a AUCUN
//                        projet acheté (sinon c'est un client payant -> on garde).
//
// dryRun=true : ne supprime/écrit RIEN, renvoie seulement ce qui SERAIT purgé (vérification).

const { destroy, parseCloudinaryUrl } = require('./cloudinary-rehost');

const PROJECTS = 'tblh7O8eoog7RyTMJ';
const GENS     = 'tblfrHFe1zH9apNlp';
const CLIENTS  = 'tblQbF1OlE3uRxFra';

const DAYS_AUDIO = 60;
const DAYS_PII   = 180;   // 6 mois
const MAX_PER_RUN = 25;

// Champs personnels à VIDER (anonymisation). Uniquement des champs texte (vidage sûr).
const PROJ_PII = ['deceased_name', 'what_made_unique', 'memories', 'memory_to_keep',
  'delivery_signature_name', 'acceptance_ip', 'acceptance_user_agent', 'cap_help_email',
  'correction_request', 'adjusted_lyrics', 'signet_text'];
const GEN_PII  = ['lyrics', 'lyrics_phonetique', 'requested_changes', 'suggestions', 'song_title'];
const CLIENT_PII = ['email', 'contact_name'];

function lit(v) { const s = String(v); if (!s.includes('"')) return `"${s}"`; if (!s.includes("'")) return `'${s}'`; return null; }
function num(v, d) { if (Array.isArray(v)) v = v[0]; const n = Number(v); return Number.isFinite(n) ? n : d; }

async function nonAchetesAvant(api, headers, jours, champFait) {
  const f = `AND({commercial_status}!="purchased", IS_BEFORE({created_date}, DATEADD(NOW(),-${jours},'days')), {${champFait}}=BLANK())`;
  const r = await fetch(`${api}/${PROJECTS}?filterByFormula=${encodeURIComponent(f)}&maxRecords=${MAX_PER_RUN}`, { headers });
  return (((await r.json()) || {}).records) || [];
}
async function patch(api, headers, table, id, fields) {
  return fetch(`${api}/${table}/${id}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
}
async function generationsDu(api, headers, projetPrimary) {
  const l = lit(projetPrimary); if (l === null) return [];
  const r = await fetch(`${api}/${GENS}?filterByFormula=${encodeURIComponent(`{project}=${l}`)}`, { headers });
  return (((await r.json()) || {}).records) || [];
}

async function purger(api, headers, dryRun) {
  const now = new Date().toISOString();
  const out = { dryRun: !!dryRun, audio: { found: 0, traites: 0 }, pii: { found: 0, traites: 0 }, echantillon: { audio: [], pii: [] } };

  // ───────── PHASE A : suppression des fichiers audio (60 j) ─────────
  const aProjs = await nonAchetesAvant(api, headers, DAYS_AUDIO, 'assets_purged_at');
  out.audio.found = aProjs.length;
  for (const proj of aProjs) {
    const p = proj.fields;
    out.echantillon.audio.push({ token: (p.token || '').slice(0, 8), cree: p.created_date || '' });
    if (dryRun) continue;
    const gens = await generationsDu(api, headers, p.project);
    for (const g of gens) {
      const url = g.fields && g.fields.cloudinary_audio_url;
      if (!url) continue;
      const cp = parseCloudinaryUrl(url);
      if (cp) await destroy(cp.publicId, { resourceType: cp.resourceType, type: cp.type });
      await patch(api, headers, GENS, g.id, { cloudinary_audio_url: '', cloudinary_public_id: '' });
    }
    await patch(api, headers, PROJECTS, proj.id, { assets_purged_at: now });
    out.audio.traites++;
  }

  // ───────── PHASE B : anonymisation des PII (6 mois) ─────────
  const bProjs = await nonAchetesAvant(api, headers, DAYS_PII, 'anonymized_at');
  out.pii.found = bProjs.length;
  for (const proj of bProjs) {
    const p = proj.fields;
    out.echantillon.pii.push({ token: (p.token || '').slice(0, 8), cree: p.created_date || '' });
    if (dryRun) continue;
    // Projet : vide les champs personnels + horodate.
    const projPatch = { anonymized_at: now };
    PROJ_PII.forEach(k => { projPatch[k] = ''; });
    await patch(api, headers, PROJECTS, proj.id, projPatch);
    // Generations : vide le contenu personnel.
    const gens = await generationsDu(api, headers, p.project);
    for (const g of gens) {
      const gp = {}; GEN_PII.forEach(k => { gp[k] = ''; });
      await patch(api, headers, GENS, g.id, gp);
    }
    // Client : on n'efface le courriel/nom QUE s'il n'a AUCUN achat (sinon client payant -> garder).
    const link = Array.isArray(p.Client) ? p.Client[0] : null;
    if (link && num(p.client_purchases, 0) === 0) {
      const cp = {}; CLIENT_PII.forEach(k => { cp[k] = ''; });
      await patch(api, headers, CLIENTS, link, cp);
    }
    out.pii.traites++;
  }

  return out;
}

module.exports = { purger, DAYS_AUDIO, DAYS_PII, PROJ_PII, GEN_PII, CLIENT_PII };
