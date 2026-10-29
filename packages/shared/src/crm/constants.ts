// Constantes du CRM complet (ADR-0040 § 1 et § 2). ADR-0040 — C0.
//
// Libellé d'interface ↔ code : « Compte » = `CrmAccount` (entreprise, prospect ou
// client), « Responsable » = `ownerId`, « Assigné » = `assigneeUserId`
// (docs/GLOSSAIRE.md). Ce fichier ne contient que des unions fermées, des bornes
// et des codes : aucune règle financière ni fiscale. Les règles de la fiche client
// (type DGI, NIF) restent celles de Ventes, appliquées par son service.

/** Nature d'un compte (ADR-0040 § 2.1) : dénormalisée de `customerId`. */
export const CRM_ACCOUNT_KINDS = ['prospect', 'customer'] as const;
export type CrmAccountKind = (typeof CRM_ACCOUNT_KINDS)[number];

/** Comment un prospect est devenu client (§ 3.1.1). */
export const CRM_ACCOUNT_CONVERSION_MODES = ['created', 'linked'] as const;
export type CrmAccountConversionMode = (typeof CRM_ACCOUNT_CONVERSION_MODES)[number];

/** Modes du corps de conversion (§ 3.1.1). */
export const CRM_ACCOUNT_CONVERT_MODES = ['create', 'link'] as const;
export type CrmAccountConvertMode = (typeof CRM_ACCOUNT_CONVERT_MODES)[number];

/** Bornes TECHNIQUES des champs d'un compte (§ 2.1), mêmes que la fiche client pour les coordonnées. */
export const CRM_ACCOUNT_LIMITS = Object.freeze({
  name: 200,
  industry: 80,
  origin: 80,
  website: 255,
  phone: 30,
  email: 254,
  address: 255,
  notes: 5_000,
  search: 100,
});

/** Pagination par curseur des listes de comptes (motif de `time-cursor.ts`). */
export const CRM_PAGE_LIMIT_DEFAULT = 50;
export const CRM_PAGE_LIMIT_MAX = 100;

/** Même motif que la fiche client (`sales.dto.ts`). */
export const CRM_PHONE_PATTERN = /^\+?[0-9][0-9 .-]{6,19}$/;

/** Filtre « les miens » (`ownerId=me`) des listes (§ 3.1, § 3.2). */
export const CRM_OWNER_ME = 'me' as const;

/**
 * Codes d'erreur et d'avertissement des comptes (§ 2 et § 3.1). Stables : le web
 * les traduit, les tests les citent.
 */
export const CRM_ACCOUNT_ERROR_CODES = [
  'CRM_ACCOUNT_IDENTITY_FROM_CUSTOMER',
  'CRM_ACCOUNT_FOLLOWS_CUSTOMER',
  'CRM_ACCOUNT_IN_USE',
  'CRM_ACCOUNT_NOT_FOUND',
  'CRM_ACCOUNT_MERGED',
  'CRM_ACCOUNT_MERGE_INTO_SELF',
  'CRM_ACCOUNT_NOT_PROSPECT',
  'CRM_OWNER_NOT_ELIGIBLE',
  'CRM_USE_ACCOUNT_ID',
  'STALE_REVISION',
] as const;
export type CrmAccountErrorCode = (typeof CRM_ACCOUNT_ERROR_CODES)[number];

export const CRM_ACCOUNT_WARNING_CODES = ['CRM_ACCOUNT_SIMILAR_NAME'] as const;
export type CrmAccountWarningCode = (typeof CRM_ACCOUNT_WARNING_CODES)[number];

/**
 * État d'une section de la fiche 360° (§ 3.1.2) : connue, masquée faute de droit,
 * ou vide. Une section masquée ne porte AUCUNE donnée.
 */
export const CRM_SECTION_STATUSES = ['known', 'hidden', 'empty'] as const;
export type CrmSectionStatus = (typeof CRM_SECTION_STATUSES)[number];
