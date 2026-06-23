// netlify/functions/_lib/nurture-emails.js
//
// Séquence marketing « rattrapage » (5 courriels) pour les non-acheteurs ayant rempli le formulaire.
// Voix de marque : solution-first, digne, JAMAIS ouvrir sur le deuil ; aucun témoignage inventé,
// aucun prix de référence, aucune fausse urgence. Conforme LCAP (désabonnement + identification).
//
// Cadence (heures) :
//   - inscription -> +1 h     : courriel 1
//   - après courriel 1 -> +24 h : courriel 2  (J+1)
//   - après courriel 2 -> +48 h : courriel 3  (J+3)
//   - après courriel 3 -> +48 h : courriel 4  (J+5)
//   - après courriel 4 -> +72 h : courriel 5  (J+8)
'use strict';

const ENROLL_DELAY_H = 1;                       // délai avant le 1er courriel
const GAP_AFTER_H = { 1: 24, 2: 48, 3: 48, 4: 72 };   // délai vers le courriel suivant après l'envoi n
const TOTAL = 5;

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

// Gabarit commun : papier crème, bouton mauve vers l'aperçu, pied LCAP (désabonnement + adresse).
function layout({ titre, corps, lien, cta, unsub, postal }) {
  return `<div style="font-family:Georgia,serif;color:#2E1A28;line-height:1.7;max-width:560px;margin:auto;">` +
    `<p style="font-size:18px;color:#5C2D4A;margin:0 0 14px;">${titre}</p>` +
    `<p style="margin:0 0 22px;">${corps}</p>` +
    `<p style="margin:0 0 28px;"><a href="${lien}" style="background:#5C2D4A;color:#F5F0EA;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;">${cta}</a></p>` +
    `<hr style="border:none;border-top:1px solid #E5DAE0;margin:22px 0 12px;">` +
    `<p style="font-size:12px;color:#9A8A96;margin:0;">` +
    `Vous recevez ce message parce que vous avez créé une chanson sur chansonmemoire.ca.<br>` +
    `Chanson Mémoire${postal ? ' — ' + esc(postal) : ''}<br>` +
    `<a href="${unsub}" style="color:#9A8A96;">Se désabonner</a></p></div>`;
}

// Retourne { subject, html } du courriel n (1..5). ctx = { prenom, lien, unsub, postal }.
function build(n, ctx) {
  const prenom = esc(ctx.prenom || '');
  const pour   = prenom ? ` en hommage à ${prenom}` : '';
  const base   = { lien: ctx.lien, unsub: ctx.unsub, postal: ctx.postal };

  switch (n) {
    case 1: return {
      subject: 'Votre chanson est prête à écouter',
      html: layout({ ...base,
        titre: 'Votre chanson vous attend.',
        corps: `Vous avez commencé à créer une chanson${pour}. Votre aperçu est prêt — prenez un moment pour l’écouter, au calme.`,
        cta: 'Écouter ma chanson' })
    };
    case 2: return {
      subject: 'Composée à partir de vos mots',
      html: layout({ ...base,
        titre: 'Une création faite avec soin.',
        corps: `Votre chanson est née des souvenirs que vous avez partagés : une mélodie originale, une voix, en français d’ici. Réécoutez-la quand le moment vous convient.`,
        cta: 'Réécouter ma chanson' })
    };
    case 3: return {
      subject: 'Une trace qui se garde',
      html: layout({ ...base,
        titre: 'Un souvenir qui se partage.',
        corps: `Une chanson, ça se garde, ça se partage avec les proches, ça se rejoue lors d’un rassemblement ou d’une date qui compte. La vôtre est toujours là.`,
        cta: 'Revenir à ma chanson' })
    };
    case 4: return {
      subject: 'Une question ? Écrivez-nous',
      html: layout({ ...base,
        titre: 'On est là pour vous.',
        corps: `Quelque chose vous retient ou n’est pas clair ? Répondez simplement à ce courriel — on vous accompagne avec plaisir pour finaliser votre hommage.`,
        cta: 'Voir ma chanson' })
    };
    default: return {
      subject: 'Votre chanson reste disponible',
      html: layout({ ...base,
        titre: 'Quand vous serez prêt.',
        corps: `Sans pression : votre aperçu demeure accessible. Elle est là, prête à devenir un souvenir que vous garderez précieusement.`,
        cta: 'Écouter ma chanson' })
    };
  }
}

module.exports = { ENROLL_DELAY_H, GAP_AFTER_H, TOTAL, build };
