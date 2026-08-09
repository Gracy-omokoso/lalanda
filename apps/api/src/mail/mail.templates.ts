// Gabarits des trois emails transactionnels (S22a).
//
// ── Contraintes de rendu, et pourquoi ────────────────────────────────────────
//  1. AUCUNE IMAGE DISTANTE. Pas de logo hébergé, pas de pixel de suivi. Une
//     image distante se charge depuis un serveur tiers au moment de la lecture :
//     elle révèle l'IP et l'heure d'ouverture du destinataire, et la plupart des
//     clients la bloquent de toute façon, laissant un cadre vide à la place du
//     seul élément de marque. Le monogramme est donc du texte stylé en CSS.
//  2. STYLES EN LIGNE UNIQUEMENT. Gmail supprime les blocs <style> dans une
//     partie de ses rendus ; un email dont la mise en forme vit dans un <style>
//     arrive nu.
//  3. TABLEAU DE MISE EN PAGE. Outlook (moteur Word) ne sait pas centrer une
//     <div> avec `margin: auto`. Un <table> centré est la seule construction qui
//     tienne partout.
//  4. VARIANTE TEXTE COMPLÈTE, LIEN COMPRIS. Un client qui refuse le HTML doit
//     pouvoir terminer l'opération, pas lire « activez le HTML ». C'est aussi ce
//     que voit un lecteur d'écran mal servi par le HTML.
//  5. LE LIEN EST ÉCRIT EN CLAIR sous le bouton. Un bouton dont on ne peut pas
//     lire la destination est exactement la forme d'un email d'hameçonnage ; et
//     un lien copiable sauve l'utilisateur dont le client de messagerie casse
//     les URL longues.
//
// ── Ce qui n'est PAS ici ─────────────────────────────────────────────────────
// Aucune traduction : le produit est francophone (docs/04-UX-UI). Le jour où une
// seconde langue existe, ces fonctions prennent une locale — elles sont déjà
// pures et sans état, c'est le seul changement nécessaire.

import type { MailMessage } from './mail.types.js';

/** Corps d'un message sans destinataire — le gabarit ne choisit pas à qui il parle. */
export type RenderedMail = Omit<MailMessage, 'to'>;

/** Nom affiché du produit. Une constante : il apparaît dans les trois gabarits. */
const PRODUCT = 'Lalanda';

/**
 * Échappement HTML des valeurs interpolées.
 *
 * Indispensable : `organizationName`, `inviterName` et `name` viennent de saisies
 * utilisateur. Sans échappement, un nom d'organisation contenant du balisage
 * réécrirait le corps du message — un email est un document HTML rendu chez le
 * destinataire, pas une chaîne inerte.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface LayoutInput {
  /** Titre visible en tête du message (et repris dans la variante texte). */
  heading: string;
  /** Paragraphes d'introduction, déjà en français, non échappés par l'appelant. */
  paragraphs: string[];
  /** Libellé du bouton d'action. */
  ctaLabel: string;
  /** Destination du bouton. Toujours une URL absolue. */
  ctaUrl: string;
  /** Paragraphes de clôture (expiration, « si vous n'êtes pas à l'origine… »). */
  footnotes: string[];
}

/**
 * Enveloppe commune aux trois messages.
 *
 * Les paragraphes reçus sont ÉCHAPPÉS ici : les appelants composent des phrases
 * à partir de données utilisateur, et centraliser l'échappement au point de
 * rendu évite qu'un gabarit ajouté plus tard l'oublie.
 */
function layout(input: LayoutInput): RenderedMail {
  const paragraphs = input.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1f2430;">${escapeHtml(p)}</p>`,
    )
    .join('');

  const footnotes = input.footnotes
    .map(
      (p) =>
        `<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6b7280;">${escapeHtml(p)}</p>`,
    )
    .join('');

  const html = [
    '<!-- Lalanda — email transactionnel. Aucune image distante, aucun script. -->',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f6f8;padding:24px 12px;">',
    '<tr><td align="center">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">',
    '<tr><td style="padding:28px 32px 8px;">',
    // Monogramme en texte : voir contrainte n°1 (aucune image distante).
    '<div style="display:inline-block;width:36px;height:36px;line-height:36px;text-align:center;background-color:#111827;color:#ffffff;border-radius:8px;font-weight:700;font-size:18px;">L</div>',
    `<div style="margin-top:14px;font-size:20px;font-weight:600;color:#111827;">${escapeHtml(input.heading)}</div>`,
    '</td></tr>',
    `<tr><td style="padding:16px 32px 0;">${paragraphs}</td></tr>`,
    '<tr><td style="padding:8px 32px 4px;">',
    `<a href="${escapeHtml(input.ctaUrl)}" style="display:inline-block;padding:12px 22px;background-color:#111827;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">${escapeHtml(input.ctaLabel)}</a>`,
    '</td></tr>',
    // Contrainte n°5 : la destination doit rester lisible et copiable.
    '<tr><td style="padding:14px 32px 0;">',
    '<p style="margin:0 0 6px;font-size:13px;color:#6b7280;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :</p>',
    `<p style="margin:0;font-size:13px;word-break:break-all;"><a href="${escapeHtml(input.ctaUrl)}" style="color:#1d4ed8;">${escapeHtml(input.ctaUrl)}</a></p>`,
    '</td></tr>',
    `<tr><td style="padding:20px 32px 4px;border-top:1px solid #f0f1f3;">${footnotes}</td></tr>`,
    `<tr><td style="padding:0 32px 26px;"><p style="margin:0;font-size:12px;color:#9ca3af;">${PRODUCT} — message automatique, merci de ne pas y répondre.</p></td></tr>`,
    '</table>',
    '</td></tr>',
    '</table>',
  ].join('');

  const text = [
    input.heading,
    '',
    ...input.paragraphs,
    '',
    `${input.ctaLabel} : ${input.ctaUrl}`,
    '',
    ...input.footnotes,
    '',
    `${PRODUCT} — message automatique, merci de ne pas y répondre.`,
  ].join('\n');

  return { subject: '', html, text };
}

/** Salutation personnalisée quand le nom est connu, neutre sinon. */
function greeting(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? `Bonjour ${trimmed},` : 'Bonjour,';
}

/**
 * Vérification d'adresse email.
 *
 * Sert DEUX flux, volontairement : la vérification à l'inscription (better-auth)
 * et la vérification d'un changement d'adresse (`account/`). Le message est le
 * même — « prouvez que cette boîte est la vôtre » — seule l'URL diffère. Deux
 * gabarits divergeraient à la première retouche.
 */
export function renderEmailVerification(input: {
  url: string;
  name?: string | null;
  /** Vrai quand il s'agit de confirmer un CHANGEMENT d'adresse, pas une inscription. */
  isEmailChange?: boolean;
  /** Durée de validité annoncée, en heures. */
  expiresInHours: number;
}): RenderedMail {
  const heading = input.isEmailChange
    ? 'Confirmez votre nouvelle adresse'
    : 'Confirmez votre adresse email';

  const rendered = layout({
    heading,
    paragraphs: [
      greeting(input.name),
      input.isEmailChange
        ? `Vous avez demandé à utiliser cette adresse pour votre compte ${PRODUCT}. Confirmez-la pour que le changement prenne effet.`
        : `Bienvenue sur ${PRODUCT}. Confirmez votre adresse pour activer toutes les fonctionnalités de votre compte.`,
    ],
    ctaLabel: 'Confirmer mon adresse',
    ctaUrl: input.url,
    footnotes: [
      `Ce lien est valable ${input.expiresInHours} heures et ne peut servir qu'une seule fois.`,
      input.isEmailChange
        ? "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre adresse actuelle reste inchangée."
        : "Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message.",
    ],
  });

  return {
    ...rendered,
    subject: input.isEmailChange
      ? `${PRODUCT} — confirmez votre nouvelle adresse email`
      : `${PRODUCT} — confirmez votre adresse email`,
  };
}

/**
 * Invitation à rejoindre une organisation.
 *
 * Le rôle proposé est annoncé DANS le message : la personne qui accepte doit
 * savoir ce qu'elle accepte, et un rôle affiché seulement après acceptation
 * transforme un consentement en surprise.
 */
export function renderInvitation(input: {
  url: string;
  organizationName: string;
  roleLabel: string;
  inviterName?: string | null;
  /** Date d'expiration de l'invitation, déjà connue de l'appelant. */
  expiresAt: Date;
}): RenderedMail {
  const inviter = input.inviterName?.trim();
  const who = inviter ? `${inviter} vous invite` : 'Vous êtes invité·e';

  const rendered = layout({
    heading: `Rejoignez ${input.organizationName} sur ${PRODUCT}`,
    paragraphs: [
      'Bonjour,',
      `${who} à rejoindre l'organisation « ${input.organizationName} » sur ${PRODUCT}, avec le rôle « ${input.roleLabel} ».`,
      `${PRODUCT} sert à construire et suivre des plans financiers. Acceptez l'invitation pour accéder à l'espace de cette organisation.`,
    ],
    ctaLabel: "Accepter l'invitation",
    ctaUrl: input.url,
    footnotes: [
      `Cette invitation expire le ${formatDateFr(input.expiresAt)}.`,
      "Elle n'est valable que pour cette adresse email. Si vous ne connaissez pas cette organisation, ignorez ce message.",
    ],
  });

  return {
    ...rendered,
    subject: `${PRODUCT} — invitation à rejoindre ${input.organizationName}`,
  };
}

/**
 * Réinitialisation de mot de passe.
 *
 * Le message ne confirme JAMAIS l'existence du compte à un tiers : il n'est
 * envoyé qu'à une adresse existante, et son contenu ne divulgue ni le nom de
 * l'organisation ni aucune donnée du compte. Voir l'absence d'énumération côté
 * API (better-auth répond à l'identique pour une adresse inconnue).
 */
export function renderPasswordReset(input: {
  url: string;
  name?: string | null;
  /** Durée de validité annoncée, en minutes — volontairement courte. */
  expiresInMinutes: number;
}): RenderedMail {
  const rendered = layout({
    heading: 'Réinitialisation de votre mot de passe',
    paragraphs: [
      greeting(input.name),
      `Vous avez demandé à réinitialiser le mot de passe de votre compte ${PRODUCT}. Choisissez un nouveau mot de passe en suivant le lien ci-dessous.`,
    ],
    ctaLabel: 'Choisir un nouveau mot de passe',
    ctaUrl: input.url,
    footnotes: [
      `Ce lien est valable ${input.expiresInMinutes} minutes et ne peut servir qu'une seule fois.`,
      "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable et personne n'a accédé à votre compte.",
    ],
  });

  return { ...rendered, subject: `${PRODUCT} — réinitialisation de votre mot de passe` };
}

/**
 * Date lisible en français, en UTC.
 *
 * UTC et non le fuseau du serveur : un email daté « 14 h » selon le fuseau
 * d'une machine de production est faux pour à peu près tout le monde. Le suffixe
 * le dit explicitement plutôt que de laisser deviner.
 */
export function formatDateFr(date: Date): string {
  const formatted = new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date);
  return `${formatted} (UTC)`;
}
