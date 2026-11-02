// Vocabulaire de la console Lalanda (ADR-0053 — P0). Constantes seulement : aucune
// décision ici. La matrice rôle plateforme × action et les fonctions de décision vivent
// dans l'API (`apps/api/src/authz/platform-actions.ts`), qui réexporte ce catalogue.
//
// ── Deux espaces de noms qui ne se croisent jamais ────────────────────────────
//
// Une action plateforme porte sur une ressource DE LALANDA (comptes, abonnements,
// annonces, journal plateforme), jamais sur le contenu d'une organisation. Elle est
// préfixée `platform.` et n'appartient pas au vocabulaire des actions d'organisation
// (`permissions.ts`) : une route plateforme n'accepte aucun rôle d'organisation, une
// route d'organisation n'accepte aucune action plateforme (ADR-0053 § 2.3).

/**
 * Les six rôles plateforme (ADR-0012 § 2). Copie du vocabulaire de l'API
 * (`PLATFORM_ROLES`, `permissions.ts`) pour que le web et les schémas ne dépendent pas
 * de l'API ; un test de l'API vérifie l'égalité des deux listes.
 */
export const PLATFORM_ROLE_SLUGS = [
  'platform_super_admin',
  'platform_admin',
  'platform_support',
  'platform_billing',
  'platform_template_editor',
  'platform_country_pack_manager',
] as const;

export type PlatformRoleSlug = (typeof PLATFORM_ROLE_SLUGS)[number];

/** Les 21 actions plateforme (ADR-0053 § 5.1), dans l'ordre du tableau de l'ADR. */
export const PLATFORM_ACTIONS = [
  'platform.console.read',
  'platform.orgs.read',
  'platform.orgs.suspend',
  'platform.users.read',
  'platform.users.block',
  'platform.roles.manage',
  'platform.billing.read',
  'platform.billing.confirm',
  'platform.billing.grant',
  'platform.features.read',
  'platform.features.override',
  'platform.integrations.manage',
  'platform.audit.read',
  'platform.audit.export',
  'platform.announcements.draft',
  'platform.announcements.approve',
  'platform.stats.read',
  'platform.finance.read',
  'platform.finance.export',
  'platform.packs.manage',
  'platform.templates.manage',
] as const;

export type PlatformAction = (typeof PLATFORM_ACTIONS)[number];

export function isPlatformAction(value: unknown): value is PlatformAction {
  return typeof value === 'string' && (PLATFORM_ACTIONS as readonly string[]).includes(value);
}

/** Module de la console auquel appartient une action (onglets du lot P1). */
export const PLATFORM_CONSOLE_MODULES = [
  'socle',
  'accounts',
  'billing',
  'features',
  'integrations',
  'audit',
  'announcements',
  'stats',
  'finance',
  'packs',
  'templates',
] as const;

export type PlatformConsoleModule = (typeof PLATFORM_CONSOLE_MODULES)[number];

export interface PlatformActionDefinition {
  readonly label: string;
  readonly module: PlatformConsoleModule;
}

/** Libellé et module de chaque action (ADR-0053 § 5.1, colonnes « Libellé » et « Module »). */
export const PLATFORM_ACTION_DEFINITIONS: Readonly<
  Record<PlatformAction, PlatformActionDefinition>
> = {
  'platform.console.read': {
    label: 'Ouvrir la console et son tableau de bord',
    module: 'socle',
  },
  'platform.orgs.read': {
    label: 'Rechercher et consulter les organisations (métadonnées)',
    module: 'accounts',
  },
  'platform.orgs.suspend': { label: 'Suspendre et rétablir une organisation', module: 'accounts' },
  'platform.users.read': { label: 'Rechercher et consulter les comptes', module: 'accounts' },
  'platform.users.block': { label: 'Bloquer et débloquer un compte', module: 'accounts' },
  'platform.roles.manage': {
    label: 'Attribuer et retirer les rôles plateforme',
    module: 'accounts',
  },
  'platform.billing.read': {
    label: 'Consulter abonnements, demandes et paiements',
    module: 'billing',
  },
  'platform.billing.confirm': {
    label: 'Confirmer ou refuser un paiement manuel',
    module: 'billing',
  },
  'platform.billing.grant': {
    label: 'Octroyer une offre sans paiement, la retirer',
    module: 'billing',
  },
  'platform.features.read': {
    label: 'Consulter le catalogue des fonctionnalités par offre',
    module: 'features',
  },
  'platform.features.override': {
    label: 'Accorder une dérogation de fonctionnalité',
    module: 'features',
  },
  'platform.integrations.manage': {
    label: 'Gérer les intégrations de la plateforme',
    module: 'integrations',
  },
  'platform.audit.read': {
    label: 'Consulter le journal plateforme et les événements de sécurité',
    module: 'audit',
  },
  'platform.audit.export': { label: 'Exporter le journal plateforme', module: 'audit' },
  'platform.announcements.draft': { label: 'Préparer une annonce', module: 'announcements' },
  'platform.announcements.approve': {
    label: 'Approuver et envoyer une annonce',
    module: 'announcements',
  },
  'platform.stats.read': { label: 'Consulter les statistiques agrégées', module: 'stats' },
  'platform.finance.read': { label: 'Consulter les finances du site', module: 'finance' },
  'platform.finance.export': { label: 'Exporter les finances du site', module: 'finance' },
  'platform.packs.manage': {
    label: 'Gérer les Country Packs et plans comptables',
    module: 'packs',
  },
  'platform.templates.manage': { label: 'Gérer les modèles sectoriels', module: 'templates' },
};

// ── Motifs (ADR-0053 § 2.6, § 4) ───────────────────────────────────────────────

/**
 * Catégorie de motif d'une suspension, d'un blocage, d'un octroi ou d'une dérogation
 * (`reasonCategory`, § 4).
 */
export const PLATFORM_REASON_CATEGORIES = [
  'unpaid',
  'abuse',
  'fraud',
  'legal',
  'request',
  'other',
] as const;

export type PlatformReasonCategory = (typeof PLATFORM_REASON_CATEGORIES)[number];

export const PLATFORM_REASON_CATEGORY_LABELS: Readonly<Record<PlatformReasonCategory, string>> = {
  unpaid: 'Impayé',
  abuse: 'Abus',
  fraud: 'Fraude',
  legal: 'Motif légal',
  request: 'Demande du client',
  other: 'Autre',
};

/**
 * Motif d'ouverture d'une fiche détaillée d'organisation ou de compte (§ 2.6) : la
 * lecture est journalisée avec ce motif (`platform.organization.viewed`,
 * `platform.user.viewed`).
 */
export const PLATFORM_VIEW_REASONS = [
  'support',
  'billing',
  'security',
  'abuse',
  'legal_request',
] as const;

export type PlatformViewReason = (typeof PLATFORM_VIEW_REASONS)[number];

export const PLATFORM_VIEW_REASON_LABELS: Readonly<Record<PlatformViewReason, string>> = {
  support: 'Assistance',
  billing: 'Facturation',
  security: 'Sécurité',
  abuse: 'Abus',
  legal_request: 'Demande légale',
};

/** Effet d'une suspension administrative (O4, décision ouverte n° 4 : `read_only` par défaut). */
export const PLATFORM_SUSPENSION_MODES = ['read_only', 'full'] as const;
export type PlatformSuspensionMode = (typeof PLATFORM_SUSPENSION_MODES)[number];
export const PLATFORM_DEFAULT_SUSPENSION_MODE: PlatformSuspensionMode = 'read_only';

// ── Bornes et valeurs par défaut (décisions ouvertes, valeurs les plus prudentes) ──

export const PLATFORM_LIMITS = {
  /** `GET /admin/users?q=` : recherche obligatoire d'au moins trois caractères (§ 2.6). */
  searchMinLength: 3,
  /** Note interne d'un blocage, d'une suspension, d'un octroi (§ 6.1) : dix caractères. */
  internalNoteMinLength: 10,
  internalNoteMaxLength: 1_000,
  /** Message destiné au client (§ 4) : 500 caractères. */
  clientMessageMaxLength: 500,
  /** Motif d'attribution d'un rôle plateforme : obligatoire (§ 5.3). */
  roleReasonMinLength: 10,
  roleReasonMaxLength: 500,
  /** `platform_support` : échéance obligatoire, 90 jours au plus (décision n° 18). */
  supportRoleMaxDays: 90,
  /** Dérogation de fonctionnalité : échéance obligatoire, 90 jours au plus (décision n° 10). */
  featureOverrideMaxDays: 90,
  /** Octroi manuel au-delà duquel une seconde personne est exigée (§ 5.3, décision n° 8). */
  grantSecondPersonDays: 90,
  /** Annonce : titre, corps en texte brut (§ 4), expiration par défaut (§ 6.6). */
  announcementTitleMaxLength: 120,
  announcementBodyMaxLength: 2_000,
  announcementDefaultExpiryDays: 30,
  /** Écart toléré entre le compte approuvé et le compte recalculé à l'envoi (§ 6.6). */
  announcementRecountTolerance: 0.1,
  /** Statistiques : aucune case de moins de cinq organisations (décision n° 13). */
  statsMinCell: 5,
  /** Session de console : 12 heures d'inactivité (§ 2.4, décision n° 2). */
  consoleSessionIdleHours: 12,
} as const;

// ── Miroir pseudonyme (O3-c, § 2.5) ────────────────────────────────────────────

/**
 * Acteur inscrit dans le journal d'une ORGANISATION pour un geste plateforme qui la
 * touche. Jamais l'identifiant ni le rôle de l'opérateur (fuite F3).
 */
export const PLATFORM_MIRROR_ACTOR_ID = 'platform:lalanda';
export const PLATFORM_MIRROR_ACTOR_ROLE = 'platform';
export const PLATFORM_MIRROR_ACTOR_LABEL = 'Équipe Lalanda';

// ── Codes d'erreur de la console (§ 7) ─────────────────────────────────────────

export const PLATFORM_ERROR_CODES = [
  'SEARCH_REQUIRED',
  'REASON_REQUIRED',
  'REAUTH_REQUIRED',
  'ACCOUNT_BLOCKED',
  'PLATFORM_2FA_REQUIRED',
  'FEATURE_NOT_IN_PLAN',
  'PLATFORM_SELF_DEALING',
  'SELF_APPROVAL_FORBIDDEN',
  'SELF_GRANT_FORBIDDEN',
  'SECOND_PERSON_REQUIRED',
  'AUDIENCE_COUNT_MISMATCH',
  'REAPPROVAL_REQUIRED',
  'ORGANIZATION_SUSPENDED',
  'PLATFORM_ROUTE_REQUIRED',
] as const;

export type PlatformErrorCode = (typeof PLATFORM_ERROR_CODES)[number];

// ── Finances du site : mots interdits (§ 6.8, décision n° 14) ──────────────────

/**
 * Tant qu'ADR-0047 n'est pas tranché, la console parle d'« encaissements constatés » et
 * de « revenu récurrent déclaré », jamais de chiffre d'affaires, de facturé ni de TVA.
 */
export const PLATFORM_FINANCE_FORBIDDEN_WORDS = [
  "chiffre d'affaires",
  'chiffre d’affaires',
  'facturé',
  'tva',
] as const;

/** Mots interdits trouvés dans un libellé ou une clé (insensible à la casse). */
export function findForbiddenPlatformFinanceWords(text: string): string[] {
  const lower = text.toLowerCase();
  return PLATFORM_FINANCE_FORBIDDEN_WORDS.filter((word) =>
    word === 'tva' ? /(^|[^a-z])tva([^a-z]|$)/.test(lower) : lower.includes(word),
  );
}
