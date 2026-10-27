// Gabarits des trois emails transactionnels (S22a).
//
// ── Contraintes de rendu, et pourquoi ────────────────────────────────────────
//  1. AUCUNE IMAGE DISTANTE. Pas de logo hébergé, pas de pixel de suivi. Une
//     image distante se charge depuis un serveur tiers au moment de la lecture :
//     elle révèle l'IP et l'heure d'ouverture du destinataire, et la plupart des
//     clients la bloquent de toute façon, laissant un cadre vide à la place du
//     seul élément de marque. Le logo est donc JOINT au message (`cid:`, voir
//     `mail.logo.ts`) : il voyage avec l'email, s'affiche sans « afficher les
//     images », et ne révèle rien à l'ouverture. Son `alt` reste lisible si un
//     client le masque malgré tout.
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

import { LOGO_CID, LOGO_DISPLAY_HEIGHT, LOGO_DISPLAY_WIDTH, LOGO_IMAGE } from './mail.logo.js';
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
    // Logo joint au message (`cid:`), voir contrainte n°1. Largeur et hauteur en
    // attributs ET en style : Outlook ne lit que les premiers, et sans hauteur
    // fixée le texte saute à l'affichage de l'image.
    `<img src="cid:${LOGO_CID}" alt="${PRODUCT}" width="${LOGO_DISPLAY_WIDTH}" height="${LOGO_DISPLAY_HEIGHT}" style="display:block;width:${LOGO_DISPLAY_WIDTH}px;height:${LOGO_DISPLAY_HEIGHT}px;border:0;outline:none;text-decoration:none;font-size:20px;font-weight:700;color:#111827;">`,
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

  return { subject: '', html, text, inlineImages: [LOGO_IMAGE] };
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
 * Facture normalisée DGI désactivée (ADR-0021, décision n° 5).
 *
 * Envoyé à CHAQUE Propriétaire de l'organisation : la désactivation fait sortir
 * l'organisation de la facturation certifiée par la DGI, et elle peut avoir été
 * décidée par un Directeur financier. Le message dit qui, quand et pourquoi —
 * le motif saisi est recopié tel quel (échappé par la mise en page commune).
 * Il ne contient ni NIF, ni jeton, ni identifiant e-MCF.
 */
export function renderNormalizedInvoicingDisabled(input: {
  /** Page Fiscalité de l'organisation. */
  url: string;
  organizationName: string;
  deactivatedAt: Date;
  reason: string;
  actorName?: string | null;
}): RenderedMail {
  const actor = input.actorName?.trim();
  const rendered = layout({
    heading: 'Facture normalisée désactivée',
    paragraphs: [
      'Bonjour,',
      `La facture normalisée DGI a été désactivée pour l'organisation « ${input.organizationName} » le ${formatDateFr(input.deactivatedAt)}${actor ? `, par ${actor}` : ''}.`,
      `Motif indiqué : « ${input.reason} »`,
      "Tant qu'elle reste désactivée, les factures de cette organisation ne sont plus transmises à la DGI pour normalisation. La désactivation est inscrite au journal d'audit de l'organisation.",
    ],
    ctaLabel: "Ouvrir l'onglet Fiscalité",
    ctaUrl: input.url,
    footnotes: [
      'Vous recevez ce message parce que vous êtes Propriétaire de cette organisation sur Lalanda.',
      "Si cette désactivation n'était pas prévue, connectez-vous et vérifiez le journal d'audit de l'organisation.",
    ],
  });

  return {
    ...rendered,
    subject: `${PRODUCT} — facture normalisée désactivée pour ${input.organizationName}`,
  };
}

/** Causes d'une alerte de normalisation (ADR-0024, décision ouverte n° 3, amendement du 21 oct. 2026). */
export type NormalizationAlertCause =
  'normalization_uncertain' | 'number_abandoned' | 'token_rejected' | 'token_expired';

/**
 * Alerte de normalisation DGI — envoyée aux administrateurs fiscaux de
 * l'organisation (Propriétaire, Directeur financier : `fiscal.manage`).
 *
 * Elle dit ce qui se passe, sur quel document ou quel point de vente, et quoi
 * faire. Elle ne contient ni NIF, ni jeton, ni identifiant e-MCF, ni montant :
 * le détail se lit dans Lalanda, derrière la connexion.
 */
export function renderNormalizationAlert(input: {
  cause: NormalizationAlertCause;
  /** Fiche du document, ou page Fiscalité pour un point de vente. */
  url: string;
  organizationName: string;
  /** Référence lisible : numéro ou référence pro forma, ou nom du point de vente. */
  subjectLabel: string;
  /** Instant qui date l'alerte : début de l'incertitude, abandon, refus, expiration. */
  since: Date;
  /** Numéro abandonné (cause `number_abandoned`). */
  number?: string | null;
}): RenderedMail {
  const org = input.organizationName;
  const when = formatDateFr(input.since);
  const common = `Vous recevez ce message parce que vous gérez la fiscalité de l'organisation « ${org} » sur Lalanda (Propriétaire ou Directeur financier).`;
  const content = ((): {
    subject: string;
    heading: string;
    paragraphs: string[];
    ctaLabel: string;
    footnote: string;
  } => {
    switch (input.cause) {
      case 'normalization_uncertain':
        return {
          subject: `normalisation incertaine pour ${input.subjectLabel}`,
          heading: 'Normalisation DGI à vérifier',
          paragraphs: [
            'Bonjour,',
            `Lalanda ne sait pas encore si la DGI a normalisé le document ${input.subjectLabel} de l'organisation « ${org} » : la réponse de la DGI manque depuis le ${when}.`,
            "Lalanda revérifie automatiquement auprès de la DGI. Tant que l'état n'est pas établi, ce document n'est pas une facture et ne doit pas être remis au client.",
            "Si l'état reste incertain, vérifiez auprès de la DGI, puis suivez les indications de la fiche du document.",
          ],
          ctaLabel: 'Ouvrir le document',
          footnote: "Vous ne recevrez pas d'autre message pour cette même incertitude.",
        };
      case 'number_abandoned':
        return {
          subject: `numéro de facture abandonné (${input.number ?? input.subjectLabel})`,
          heading: 'Numéro de facture abandonné',
          paragraphs: [
            'Bonjour,',
            `Le numéro ${input.number ?? '(inconnu)'}, réservé pour le document ${input.subjectLabel} de l'organisation « ${org} », n'a pas pu être rendu le ${when} : d'autres numéros avaient déjà été attribués.`,
            "Ce numéro reste un trou dans la série des factures. Il est tracé, avec son motif, dans le journal électronique de l'organisation : gardez-le pour répondre à un contrôle.",
          ],
          ctaLabel: 'Ouvrir le document',
          footnote: 'Le motif exact figure sur la fiche du document et dans le journal.',
        };
      case 'token_rejected':
        return {
          subject: `jeton e-MCF refusé par la DGI (${input.subjectLabel})`,
          heading: 'Jeton e-MCF refusé par la DGI',
          paragraphs: [
            'Bonjour,',
            `Le ${when}, la DGI a refusé le jeton du point de vente « ${input.subjectLabel} » de l'organisation « ${org} ».`,
            "Tant que le jeton n'est pas renouvelé, les factures de ce point de vente ne peuvent plus être normalisées, ni vérifiées auprès de la DGI.",
            'Obtenez un nouveau jeton sur le portail de la DGI, puis enregistrez-le dans l’onglet Fiscalité.',
          ],
          ctaLabel: "Ouvrir l'onglet Fiscalité",
          footnote:
            'Au plus un message par heure et par point de vente tant que le refus persiste.',
        };
      case 'token_expired':
        return {
          subject: `jeton e-MCF expiré (${input.subjectLabel})`,
          heading: 'Jeton e-MCF expiré',
          paragraphs: [
            'Bonjour,',
            `Le jeton du point de vente « ${input.subjectLabel} » de l'organisation « ${org} » a expiré le ${when}.`,
            "Tant qu'il n'est pas renouvelé, les factures de ce point de vente ne peuvent plus être normalisées.",
            'Obtenez un nouveau jeton sur le portail de la DGI, puis enregistrez-le dans l’onglet Fiscalité.',
          ],
          ctaLabel: "Ouvrir l'onglet Fiscalité",
          footnote: 'Vous ne recevrez pas d’autre message pour cette même échéance.',
        };
    }
  })();
  const rendered = layout({
    heading: content.heading,
    paragraphs: content.paragraphs,
    ctaLabel: content.ctaLabel,
    ctaUrl: input.url,
    footnotes: [common, content.footnote],
  });
  return { ...rendered, subject: `${PRODUCT} — ${content.subject}` };
}

/** Contenu du brief du matin, déjà rédigé par le moteur (ADR-0033 § 8). */
export interface MorningBriefMailContent {
  organizationName: string;
  /** « mercredi 21 octobre 2026 » — jour de Kinshasa. */
  dateLabel: string;
  /** Faits clés, déjà formatés (« Chiffre d'affaires HT du mois (CDF) : 1 250,00 CDF »). */
  facts: string[];
  alerts: string[];
  recommendations: string[];
}

/**
 * Brief du matin (ADR-0033 § 8).
 *
 * Contenu DÉTERMINISTE : faits, alertes et recommandations du moteur. Aucun
 * paragraphe rédigé par l'IA ne part par e-mail — l'explication se demande dans
 * l'application, où elle est vérifiée et sourcée. Le nom de l'organisation est
 * une saisie utilisateur : `layout` l'échappe, comme tout paragraphe.
 */
export function renderMorningBrief(input: MorningBriefMailContent, url: string): RenderedMail {
  const section = (titre: string, lignes: string[], vide: string): string[] =>
    lignes.length > 0 ? [titre, ...lignes.map((l) => `• ${l}`)] : [`${titre} ${vide}`];
  const rendered = layout({
    heading: `Brief du matin — ${input.organizationName}`,
    paragraphs: [
      `Situation au ${input.dateLabel}.`,
      ...input.facts,
      ...section('Alertes prioritaires :', input.alerts, 'aucune.'),
      ...section('Recommandations :', input.recommendations, 'aucune.'),
    ],
    ctaLabel: 'Ouvrir le brief du matin',
    ctaUrl: url,
    footnotes: [
      'Chiffres calculés par Lalanda à partir de vos factures. Les indicateurs « à renseigner » ou « non disponibles » ne sont pas évalués.',
      'Vous recevez ce message parce que vous avez activé l’envoi quotidien du brief. Vous pouvez le désactiver depuis la page du brief.',
    ],
  });
  return { ...rendered, subject: `${PRODUCT} — brief du matin, ${input.organizationName}` };
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
