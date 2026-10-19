// Erreurs de l'e-MCF : catégorie, message français et conduite — ADR-0024 § 5.
//
// Chaque code d'erreur de l'annexe de la documentation DGI est rattaché à une
// CATÉGORIE (tableau du § 5) et reçoit un message français RÉDIGÉ PAR LALANDA :
// jamais une copie du libellé DGI. L'utilisateur voit toujours les deux — notre
// phrase, et le code et le libellé renvoyés par la DGI, tels quels (exigence
// DGI). Les libellés DGI ne figurent donc pas ici : ils viennent de la réponse.
//
// La décision de réessayer reste HUMAINE (§ 5) : `retryable` dit seulement si
// un bouton « Relancer » a un sens une fois le document en échec.

import type { EdefFailure } from './edef.types.js';

/** Catégories du § 5. */
export const EDEF_ERROR_CATEGORIES = [
  'data',
  'configuration',
  'capacity',
  'temporary',
  'server',
  'state',
  'totals_mismatch',
  'duplicate_pending',
  'unknown',
] as const;
export type EdefErrorCategory = (typeof EDEF_ERROR_CATEGORIES)[number];

/** Catégories hors annexe : défaillances HTTP et transport (§ 5, dernier alinéa ; § 9.2). */
export type EdefTransportCategory = 'token_rejected' | 'network' | 'precondition';

export interface EdefErrorDescription {
  /** Code DGI tel que reçu (normalisé : sans espaces, sans zéros de tête). */
  code: string;
  category: EdefErrorCategory;
  /** Français, rédigé par Lalanda, affichable. */
  message: string;
  /** Un nouvel essai humain a-t-il un sens une fois le document en échec ? */
  retryable: boolean;
  /** Alerte plateforme (journal serveur et audit) : nos contrôles ou notre configuration sont en cause. */
  platformAlert: boolean;
}

interface CategoryRule {
  retryable: boolean;
  platformAlert: boolean;
}

/** Conduite par catégorie (§ 5, colonnes « Effet » et « Réessayable »). */
export const EDEF_CATEGORY_RULES: Readonly<Record<EdefErrorCategory, CategoryRule>> = Object.freeze(
  {
    // Facture mal formée : se corrige en brouillon. Sur un document validé par nos
    // contrôles, c'est aussi une alerte : nos contrôles ont laissé passer quelque chose.
    data: { retryable: false, platformAlert: true },
    // ISF vide : se corrige côté plateforme, pas par l'utilisateur.
    configuration: { retryable: false, platformAlert: true },
    capacity: { retryable: true, platformAlert: false },
    temporary: { retryable: true, platformAlert: false },
    // Rendu incertain : le rattrapage conclut, pas l'utilisateur.
    server: { retryable: false, platformAlert: false },
    // Ambigu : jamais interprété seul, vérification par `GET /api/invoice/{uid}`.
    state: { retryable: false, platformAlert: false },
    // Le contenu figé donnerait le même écart.
    totals_mismatch: { retryable: false, platformAlert: true },
    // Une demande à nous traîne : le rattrapage l'annule.
    duplicate_pending: { retryable: false, platformAlert: false },
    unknown: { retryable: false, platformAlert: true },
  },
);

/**
 * Codes de l'annexe DGI et nos messages. La catégorie suit le tableau du § 5
 * d'ADR-0024 ; un code absent de cette table est `unknown`.
 */
const CODES: Readonly<Record<string, { category: EdefErrorCategory; message: string }>> = {
  '1': {
    category: 'capacity',
    message:
      'L’e-MCF a déjà trop de factures en attente, sans doute envoyées par un autre logiciel. Réessayez dans deux minutes.',
  },
  '3': { category: 'data', message: 'La DGI n’a pas accepté le type de cette facture.' },
  '4': {
    category: 'data',
    message: 'La DGI attend la référence de la facture d’origine pour cet avoir.',
  },
  '5': {
    category: 'data',
    message: 'La DGI n’a pas accepté le format de la référence de la facture d’origine.',
  },
  '7': { category: 'data', message: 'La DGI n’a pas accepté le mode de paiement indiqué.' },
  '8': { category: 'data', message: 'La DGI refuse une facture sans article.' },
  '9': {
    category: 'data',
    message: 'La DGI n’a pas accepté le groupe de taxation d’un article.',
  },
  '10': {
    category: 'temporary',
    message:
      'La DGI n’a pas pu vérifier la facture d’origine de cet avoir pour le moment. Réessayez plus tard.',
  },
  '11': { category: 'data', message: 'La DGI a refusé cet avoir après contrôle.' },
  '12': {
    category: 'data',
    message: 'La DGI estime que cet avoir ne correspond pas à la facture d’origine.',
  },
  '13': {
    category: 'data',
    message: 'La DGI attend le nom de la personne qui émet la facture.',
  },
  '14': {
    category: 'data',
    message: 'La DGI a refusé le montant de la facture, jugé hors limites.',
  },
  '15': { category: 'data', message: 'La DGI attend un nom pour chaque article.' },
  '16': { category: 'data', message: 'La DGI refuse une facture d’un montant nul.' },
  '17': {
    category: 'data',
    message: 'La DGI a refusé le montant d’un paiement, jugé hors limites.',
  },
  '18': {
    category: 'data',
    message: 'La DGI refuse une quantité ou un prix négatif.',
  },
  '19': {
    category: 'data',
    message: 'La DGI refuse une quantité ou un prix égal à zéro.',
  },
  '20': {
    category: 'state',
    message:
      'La DGI ne reconnaît plus cette demande en attente : elle a peut-être déjà été traitée. Lalanda vérifie son état.',
  },
  '21': { category: 'data', message: 'La DGI n’a pas accepté la taxe spécifique d’un article.' },
  '22': {
    category: 'data',
    message: 'La DGI n’a pas accepté le montant de taxe spécifique d’un article.',
  },
  '23': {
    category: 'data',
    message: 'La DGI n’a pas accepté le montant de taxe spécifique d’un article.',
  },
  '24': { category: 'data', message: 'La DGI n’a pas accepté le type d’un article.' },
  '25': { category: 'data', message: 'La DGI n’a pas accepté le type de client.' },
  '26': {
    category: 'data',
    message: 'La DGI n’a pas accepté la forme de la taxe spécifique d’un article.',
  },
  '27': { category: 'data', message: 'La DGI n’a pas accepté la nature de cet avoir.' },
  '31': { category: 'data', message: 'La DGI attend le numéro de la facture.' },
  '32': {
    category: 'configuration',
    message:
      'La DGI n’a pas reconnu l’identifiant du logiciel de facturation. L’équipe Lalanda est prévenue.',
  },
  '33': { category: 'data', message: 'La DGI n’a pas accepté le mode de prix (TTC ou HT).' },
  '41': { category: 'data', message: 'La DGI attend le nom du client pour cette facture.' },
  '42': { category: 'data', message: 'La DGI attend le NIF du client pour cette facture.' },
  '50': {
    category: 'totals_mismatch',
    message:
      'Écart de calcul entre Lalanda et la DGI sur le total de la facture. La demande est annulée et l’équipe Lalanda est prévenue.',
  },
  '51': {
    category: 'totals_mismatch',
    message:
      'Écart de calcul entre Lalanda et la DGI sur la TVA de la facture. La demande est annulée et l’équipe Lalanda est prévenue.',
  },
  '60': {
    category: 'temporary',
    message:
      'La DGI n’a pas pu contrôler cet avoir pour le moment, son service étant indisponible. Réessayez plus tard.',
  },
  '61': {
    category: 'server',
    message: 'La DGI a signalé une erreur pendant la normalisation. Lalanda vérifie son état.',
  },
  '63': {
    category: 'duplicate_pending',
    message:
      'Une demande portant ce numéro de facture est déjà en attente à la DGI. Lalanda la solde avant de conclure.',
  },
  '99': {
    category: 'server',
    message: 'La DGI a signalé une erreur de traitement. Lalanda vérifie son état.',
  },
};

/** Codes de l'annexe connus de Lalanda (pour les tests et la documentation). */
export const EDEF_KNOWN_ERROR_CODES: readonly string[] = Object.freeze(Object.keys(CODES));

/** Message d'un code que la table ne connaît pas. */
export const EDEF_UNKNOWN_ERROR_MESSAGE =
  'La DGI a refusé la facture pour une raison que Lalanda ne connaît pas encore. L’équipe Lalanda est prévenue.';

/** `" 07 "` → `"7"` ; une chaîne non numérique est seulement débarrassée de ses espaces. */
export function normalizeEdefErrorCode(code: string | number): string {
  const text = String(code).trim();
  return /^\d+$/.test(text) ? String(Number.parseInt(text, 10)) : text;
}

/** Catégorie, message et conduite d'un code d'erreur DGI. Ne lève jamais. */
export function describeEdefError(code: string | number): EdefErrorDescription {
  const normalized = normalizeEdefErrorCode(code);
  const known = Object.prototype.hasOwnProperty.call(CODES, normalized)
    ? CODES[normalized]
    : undefined;
  const category: EdefErrorCategory = known?.category ?? 'unknown';
  return {
    code: normalized,
    category,
    message: known?.message ?? EDEF_UNKNOWN_ERROR_MESSAGE,
    ...EDEF_CATEGORY_RULES[category],
  };
}

/**
 * Catégorie d'une défaillance du client (§ 5 et § 9.2) : la catégorie du code
 * pour une erreur métier, sinon une catégorie de transport.
 *
 * - `unauthorized` (401) → `token_rejected` : la DGI n'a rien traité ;
 * - `timeout`, `network` → `network` ; `server` (5xx) et `invalid_response` →
 *   `server` : dans les deux cas la DGI a PEUT-ÊTRE traité la demande ;
 * - `production_disabled` → `precondition` : aucun appel n'est parti ;
 * - `business` sans code (4xx nu) → `unknown`.
 */
export function edefFailureCategory(
  failure: EdefFailure,
): EdefErrorCategory | EdefTransportCategory {
  switch (failure.kind) {
    case 'business':
      return failure.dgiErrorCode === null
        ? 'unknown'
        : describeEdefError(failure.dgiErrorCode).category;
    case 'unauthorized':
      return 'token_rejected';
    case 'timeout':
    case 'network':
      return 'network';
    case 'server':
    case 'invalid_response':
      return 'server';
    case 'production_disabled':
      return 'precondition';
  }
}
