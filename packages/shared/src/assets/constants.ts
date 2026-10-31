// Constantes des équipements (ADR-0046 § 1, § 3 et § 5.2). ADR-0046 — S0.
//
// Libellé d'interface ↔ code (ADR-0046 § 1) : « Équipement » = `Asset`, « Catégorie
// d'équipement » = `AssetCategory`, « Affectation » = `AssetAssignment`, « Intervention
// de maintenance » = `AssetMaintenance`, « Garantie, assurance, contrat » =
// `AssetCoverage`, « Réglages des équipements » = `AssetSettings`.
//
// AUCUNE règle comptable ni fiscale (ADR-0046 § 9) : l'estimation de valeur est une
// ESTIMATION DE GESTION linéaire, paramétrée par l'utilisateur, sans durée par défaut
// (décision ouverte n° 13), calculée par le moteur `@lalanda/engine` (`assets`, lot S2).
// Aucune règle d'assurance obligatoire n'est posée.

/** Devises d'un coût d'acquisition, d'une intervention ou d'une cession : jamais converties. */
export const ASSET_CURRENCIES = ['CDF', 'USD'] as const;
export type AssetCurrency = (typeof ASSET_CURRENCIES)[number];

// ── Équipements (§ 3.1) ─────────────────────────────────────────────────────

/** Statut d'un équipement ; `disposed` est terminal (réouverture : `assets.manage`, motif). */
export const ASSET_STATUSES = [
  'in_service',
  'in_storage',
  'under_maintenance',
  'lost',
  'disposed',
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/** Nature d'une cession déclarée : aucune facture, aucun encaissement (décision n° 15). */
export const ASSET_DISPOSAL_KINDS = [
  'scrapped',
  'sold',
  'donated',
  'lost',
  'stolen',
  'returned',
] as const;
export type AssetDisposalKind = (typeof ASSET_DISPOSAL_KINDS)[number];

/** Numéro d'un équipement : compteur NON annuel par organisation (`EQ-NNNNNN`). */
export const ASSET_NUMBER_PREFIX = 'EQ-';
export const ASSET_NUMBER_PATTERN = /^EQ-\d{6}$/;

/**
 * Libellé obligatoire de toute estimation de valeur, partout où elle est servie ou
 * affichée (O7, § 9). Le moteur rend `label: 'management_estimate'`.
 */
export const ASSET_MANAGEMENT_ESTIMATE_KEY = 'management_estimate';
export const ASSET_MANAGEMENT_ESTIMATE_LABEL =
  'Estimation de gestion — n’est pas un amortissement comptable ou fiscal';

// ── Affectations (§ 3.2) ────────────────────────────────────────────────────

/** À qui ou à quoi un équipement est affecté. */
export const ASSET_ASSIGNEE_KINDS = ['employee', 'project', 'location', 'member'] as const;
export type AssetAssigneeKind = (typeof ASSET_ASSIGNEE_KINDS)[number];

// ── Maintenance (§ 3.3) ─────────────────────────────────────────────────────

export const ASSET_MAINTENANCE_KINDS = ['preventive', 'corrective', 'inspection'] as const;
export type AssetMaintenanceKind = (typeof ASSET_MAINTENANCE_KINDS)[number];

export const ASSET_MAINTENANCE_STATUSES = ['planned', 'done', 'cancelled'] as const;
export type AssetMaintenanceStatus = (typeof ASSET_MAINTENANCE_STATUSES)[number];

// ── Couvertures (§ 3.4) ─────────────────────────────────────────────────────

export const ASSET_COVERAGE_KINDS = ['warranty', 'insurance', 'service_contract'] as const;
export type AssetCoverageKind = (typeof ASSET_COVERAGE_KINDS)[number];

/**
 * État d'une échéance (moteur `expiryStatus`, partagé avec la bibliothèque de
 * documents, § 7.2).
 */
export const EXPIRY_STATUSES = ['expired', 'due_soon', 'ok'] as const;
export type ExpiryStatus = (typeof EXPIRY_STATUSES)[number];

// ── Catégories et réglages (§ 3.5) ──────────────────────────────────────────

/** Catégories proposées à l'activation, modifiables, SANS durée. */
export const ASSET_DEFAULT_CATEGORIES = Object.freeze([
  'Informatique',
  'Téléphonie',
  'Véhicules',
  'Machines et outillage',
  'Mobilier',
  'Autre',
] as const);

export const ASSET_SETTINGS_DEFAULTS = Object.freeze({
  reminderDays: 30,
  maintenanceDueSoonDays: 7,
  showDepreciationEstimate: true,
});

// ── Bornes ──────────────────────────────────────────────────────────────────

export const ASSET_LIMITS = Object.freeze({
  name: 200,
  tag: 40,
  brand: 80,
  model: 80,
  serialNumber: 80,
  notes: 5_000,
  note: 1_000,
  reason: 500,
  categoryName: 80,
  provider: 120,
  reference: 80,
  performedBy: 120,
  buyer: 120,
  condition: 500,
  depreciationYearsMin: 1,
  depreciationYearsMax: 50,
  maintenanceEveryMonthsMin: 1,
  maintenanceEveryMonthsMax: 60,
  reminderDaysMax: 365,
  amountDecimals: 2,
});

export const ASSET_PAGE_LIMIT_DEFAULT = 50;
export const ASSET_PAGE_LIMIT_MAX = 100;

// ── Codes ───────────────────────────────────────────────────────────────────

export const ASSET_ERROR_CODES = [
  'ASSET_TAG_EXISTS',
  'ASSET_DISPOSED',
  'ASSET_NOT_DISPOSED',
  'ASSET_ALREADY_ASSIGNED',
  'ASSET_NOT_ASSIGNED',
  'ASSET_CATEGORY_NAME_EXISTS',
  'STALE_REVISION',
] as const;
export type AssetErrorCode = (typeof ASSET_ERROR_CODES)[number];

/** Constats et avertissements (§ 3.1, § 3.2, § 6.3). */
export const ASSET_FINDING_CODES = [
  'ASSET_SERIAL_DUPLICATE',
  'ASSET_HELD_BY_FORMER_EMPLOYEE',
  'INVESTMENT_EXPENSES_WITHOUT_ASSET',
] as const;
export type AssetFindingCode = (typeof ASSET_FINDING_CODES)[number];

export const ASSET_AUDIT_EVENTS = [
  'assets.disposed',
  'assets.reinstated',
  'assets.register.exported',
] as const;
export type AssetAuditEvent = (typeof ASSET_AUDIT_EVENTS)[number];
