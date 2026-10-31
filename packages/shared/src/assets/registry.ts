// Contrats HTTP des équipements (ADR-0046 § 3, § 5.2). ADR-0046 — S5.
//
// Corps `.strict()`, montants en chaînes, dates civiles `AAAA-MM-JJ` au jour de Kinshasa.
// Réutilise les briques de `common.ts` (S0). Les liens (catégorie, fournisseur, facture
// fournisseur, dépense, collaborateur, projet, emplacement, membre, document) sont
// vérifiés DANS L'ORGANISATION par le service (404 sinon) : le schéma ne juge que la
// forme. Aucune règle comptable ni fiscale : l'estimation est une ESTIMATION DE GESTION
// sans durée par défaut ; une cession est DÉCLARÉE, sans facture ni encaissement.

import { z } from 'zod';

import {
  AssetAmount,
  AssetAssigneeSchema,
  AssetCalendarDay,
  AssetCoverageKindSchema,
  AssetCurrencySchema,
  AssetExpectedRevision,
  AssetId,
  AssetMaintenanceKindSchema,
  AssetMaintenanceRecurrenceSchema,
  AssetManagementDepreciationSchema,
  AssetReminderDays,
  assetFr,
  assetIssue,
  assetOptionalText,
  assetRequiredText,
} from './common.js';
import {
  ASSET_DISPOSAL_KINDS,
  ASSET_LIMITS,
  ASSET_PAGE_LIMIT_DEFAULT,
  ASSET_PAGE_LIMIT_MAX,
  ASSET_STATUSES,
} from './constants.js';

const L = ASSET_LIMITS;

/**
 * Délai de rappel accepté par le moteur des équipements (`ASSET_REMINDER_DAYS_BOUNDS`,
 * 0 à 120 jours, comme les RH) : plus étroit que la brique commune (365).
 */
export const ASSET_REMINDER_DAYS_ENGINE_MAX = 120;
const ReminderDays = AssetReminderDays.max(ASSET_REMINDER_DAYS_ENGINE_MAX);

/** Statuts qu'une fiche peut prendre à la main ; `disposed` passe par la cession. */
export const ASSET_EDITABLE_STATUSES = [
  'in_service',
  'in_storage',
  'under_maintenance',
  'lost',
] as const;
export type AssetEditableStatus = (typeof ASSET_EDITABLE_STATUSES)[number];
const EditableStatus = z.enum(ASSET_EDITABLE_STATUSES, assetFr('Statut non modifiable ici.'));

// ── Équipements (§ 3.1) ─────────────────────────────────────────────────────

/** Acquisition : date, coût et devise ; liens FACULTATIFS, qui ne créent rien. */
export const AssetAcquisitionBody = z
  .object({
    on: AssetCalendarDay,
    cost: AssetAmount,
    currency: AssetCurrencySchema,
    supplierId: AssetId.nullable().optional(),
    supplierInvoiceId: AssetId.nullable().optional(),
    expenseId: AssetId.nullable().optional(),
    note: assetOptionalText(L.note).optional(),
  })
  .strict();
export type AssetAcquisitionBody = z.output<typeof AssetAcquisitionBody>;

const assetFields = {
  name: assetRequiredText(L.name, 'Nom'),
  categoryId: AssetId,
  tag: assetOptionalText(L.tag).optional(),
  brand: assetOptionalText(L.brand).optional(),
  model: assetOptionalText(L.model).optional(),
  serialNumber: assetOptionalText(L.serialNumber).optional(),
  acquisition: AssetAcquisitionBody,
  stockItemId: AssetId.nullable().optional(),
  locationId: AssetId.nullable().optional(),
  managementDepreciation: AssetManagementDepreciationSchema.nullable().optional(),
  notes: assetOptionalText(L.notes).optional(),
};

export const CreateAssetBody = z
  .object({
    ...assetFields,
    status: z
      .enum(['in_service', 'in_storage'], assetFr('Statut initial : in_service ou in_storage.'))
      .optional(),
  })
  .strict();
export type CreateAssetBody = z.output<typeof CreateAssetBody>;

/** Modification partielle ; `expectedRevision` obligatoire (`409 STALE_REVISION`). */
export const UpdateAssetBody = z
  .object({
    expectedRevision: AssetExpectedRevision,
    name: assetFields.name.optional(),
    categoryId: AssetId.optional(),
    tag: assetFields.tag,
    brand: assetFields.brand,
    model: assetFields.model,
    serialNumber: assetFields.serialNumber,
    acquisition: AssetAcquisitionBody.optional(),
    stockItemId: assetFields.stockItemId,
    locationId: assetFields.locationId,
    managementDepreciation: assetFields.managementDepreciation,
    notes: assetFields.notes,
    status: EditableStatus.optional(),
  })
  .strict();
export type UpdateAssetBody = z.output<typeof UpdateAssetBody>;

/** Cession DÉCLARÉE (§ 3.1, décision ouverte n° 15) : aucune facture, aucun encaissement. */
export const DisposeAssetBody = z
  .object({
    expectedRevision: AssetExpectedRevision,
    on: AssetCalendarDay,
    kind: z.enum(ASSET_DISPOSAL_KINDS, assetFr('Nature de cession inconnue.')),
    proceeds: AssetAmount.nullable().optional(),
    currency: AssetCurrencySchema.nullable().optional(),
    buyer: assetOptionalText(L.buyer).optional(),
    reason: assetRequiredText(L.reason, 'Motif'),
  })
  .strict()
  .superRefine((b, ctx) => {
    const hasProceeds = b.proceeds !== undefined && b.proceeds !== null;
    const hasCurrency = b.currency !== undefined && b.currency !== null;
    if (hasProceeds !== hasCurrency) {
      assetIssue(ctx, 'CURRENCY_REQUIRED', 'Un prix de cession exige sa devise.', ['currency']);
    }
  });
export type DisposeAssetBody = z.output<typeof DisposeAssetBody>;

/** Réouverture d'un équipement cédé : `assets.manage`, motif, audit. */
export const ReinstateAssetBody = z
  .object({
    expectedRevision: AssetExpectedRevision,
    reason: assetRequiredText(L.reason, 'Motif'),
  })
  .strict();
export type ReinstateAssetBody = z.output<typeof ReinstateAssetBody>;

export const ListAssetsQuery = z
  .object({
    status: z.enum([...ASSET_STATUSES, 'active', 'all']).default('active'),
    categoryId: AssetId.optional(),
    employeeId: AssetId.optional(),
    workProjectId: AssetId.optional(),
    supplierId: AssetId.optional(),
    cursor: z.string().min(1).max(64).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(ASSET_PAGE_LIMIT_MAX)
      .default(ASSET_PAGE_LIMIT_DEFAULT),
  })
  .strict();
export type ListAssetsQuery = z.output<typeof ListAssetsQuery>;

/** Fiche : `on` = date de l'estimation de gestion (défaut : aujourd'hui à Kinshasa). */
export const GetAssetQuery = z.object({ on: AssetCalendarDay.optional() }).strict();
export type GetAssetQuery = z.output<typeof GetAssetQuery>;

// ── Affectations (§ 3.2) ────────────────────────────────────────────────────

export const AssignAssetBody = z
  .object({
    expectedRevision: AssetExpectedRevision,
    assignee: AssetAssigneeSchema,
    /** Remise ; défaut : aujourd'hui. */
    from: AssetCalendarDay.optional(),
    conditionOut: assetOptionalText(L.condition).optional(),
    note: assetOptionalText(L.note).optional(),
  })
  .strict();
export type AssignAssetBody = z.output<typeof AssignAssetBody>;

export const ReturnAssetBody = z
  .object({
    expectedRevision: AssetExpectedRevision,
    /** Retour ; défaut : aujourd'hui. */
    on: AssetCalendarDay.optional(),
    conditionIn: assetOptionalText(L.condition).optional(),
    note: assetOptionalText(L.note).optional(),
  })
  .strict();
export type ReturnAssetBody = z.output<typeof ReturnAssetBody>;

// ── Maintenance (§ 3.3) ─────────────────────────────────────────────────────

function costWithCurrency(
  b: { cost?: string | null; currency?: string | null },
  ctx: z.RefinementCtx,
): void {
  const hasCost = b.cost !== undefined && b.cost !== null;
  const hasCurrency = b.currency !== undefined && b.currency !== null;
  if (hasCost && !hasCurrency) {
    assetIssue(ctx, 'CURRENCY_REQUIRED', 'Un coût exige sa devise.', ['currency']);
  }
}

export const CreateMaintenanceBody = z
  .object({
    kind: AssetMaintenanceKindSchema,
    status: z
      .enum(['planned', 'done'], assetFr('Statut initial : planned ou done.'))
      .default('planned'),
    plannedOn: AssetCalendarDay.nullable().optional(),
    doneOn: AssetCalendarDay.nullable().optional(),
    cost: AssetAmount.nullable().optional(),
    currency: AssetCurrencySchema.nullable().optional(),
    supplierId: AssetId.nullable().optional(),
    supplierInvoiceId: AssetId.nullable().optional(),
    performedBy: assetOptionalText(L.performedBy).optional(),
    note: assetOptionalText(L.note).optional(),
    recurrence: AssetMaintenanceRecurrenceSchema.nullable().optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    costWithCurrency(b, ctx);
    if (b.status === 'planned' && !b.plannedOn) {
      assetIssue(ctx, 'FIELD_REQUIRED', 'Date prévue obligatoire.', ['plannedOn']);
    }
    if (b.status === 'done' && !b.doneOn) {
      assetIssue(ctx, 'FIELD_REQUIRED', 'Date de réalisation obligatoire.', ['doneOn']);
    }
    if (b.recurrence && b.kind !== 'preventive') {
      assetIssue(ctx, 'RECURRENCE_PREVENTIVE_ONLY', 'Seule une maintenance préventive se répète.', [
        'recurrence',
      ]);
    }
  });
export type CreateMaintenanceBody = z.output<typeof CreateMaintenanceBody>;

export const UpdateMaintenanceBody = z
  .object({
    expectedRevision: AssetExpectedRevision,
    plannedOn: AssetCalendarDay.optional(),
    status: z.enum(['planned', 'cancelled'], assetFr('Statut : planned ou cancelled.')).optional(),
    cost: AssetAmount.nullable().optional(),
    currency: AssetCurrencySchema.nullable().optional(),
    supplierId: AssetId.nullable().optional(),
    supplierInvoiceId: AssetId.nullable().optional(),
    performedBy: assetOptionalText(L.performedBy).optional(),
    note: assetOptionalText(L.note).optional(),
    recurrence: AssetMaintenanceRecurrenceSchema.nullable().optional(),
  })
  .strict()
  .superRefine(costWithCurrency);
export type UpdateMaintenanceBody = z.output<typeof UpdateMaintenanceBody>;

/** Intervention faite ; préventive récurrente → la suivante est planifiée (moteur). */
export const CompleteMaintenanceBody = z
  .object({
    expectedRevision: AssetExpectedRevision,
    doneOn: AssetCalendarDay,
    cost: AssetAmount.nullable().optional(),
    currency: AssetCurrencySchema.nullable().optional(),
    performedBy: assetOptionalText(L.performedBy).optional(),
    note: assetOptionalText(L.note).optional(),
  })
  .strict()
  .superRefine(costWithCurrency);
export type CompleteMaintenanceBody = z.output<typeof CompleteMaintenanceBody>;

// ── Couvertures (§ 3.4) ─────────────────────────────────────────────────────

const coverageFields = {
  kind: AssetCoverageKindSchema,
  provider: assetRequiredText(L.provider, 'Prestataire'),
  reference: assetOptionalText(L.reference).optional(),
  startOn: AssetCalendarDay,
  endOn: AssetCalendarDay,
  cost: AssetAmount.nullable().optional(),
  currency: AssetCurrencySchema.nullable().optional(),
  documentId: AssetId.nullable().optional(),
  /** `null` ou absent : réglage de l'organisation (30 jours par défaut). */
  reminderDays: ReminderDays.nullable().optional(),
};

function coverageDates(b: { startOn?: string; endOn?: string }, ctx: z.RefinementCtx): void {
  if (b.startOn !== undefined && b.endOn !== undefined && b.endOn < b.startOn) {
    assetIssue(ctx, 'END_BEFORE_START', 'La fin précède le début.', ['endOn']);
  }
}

export const CreateCoverageBody = z
  .object(coverageFields)
  .strict()
  .superRefine((b, ctx) => {
    costWithCurrency(b, ctx);
    coverageDates(b, ctx);
  });
export type CreateCoverageBody = z.output<typeof CreateCoverageBody>;

export const UpdateCoverageBody = z
  .object({
    expectedRevision: AssetExpectedRevision,
    provider: coverageFields.provider.optional(),
    reference: coverageFields.reference,
    startOn: AssetCalendarDay.optional(),
    endOn: AssetCalendarDay.optional(),
    cost: coverageFields.cost,
    currency: coverageFields.currency,
    documentId: coverageFields.documentId,
    reminderDays: coverageFields.reminderDays,
  })
  .strict()
  .superRefine((b, ctx) => {
    costWithCurrency(b, ctx);
    coverageDates(b, ctx);
  });
export type UpdateCoverageBody = z.output<typeof UpdateCoverageBody>;

// ── Échéances, rapports ─────────────────────────────────────────────────────

export const AssetDeadlinesQuery = z
  .object({
    /** Horizon en jours : échéances passées et à venir sous ce délai (défaut : réglages). */
    within: z.coerce.number().int().min(0).max(366).optional(),
  })
  .strict();
export type AssetDeadlinesQuery = z.output<typeof AssetDeadlinesQuery>;

export const AssetReportsQuery = z.object({ on: AssetCalendarDay.optional() }).strict();
export type AssetReportsQuery = z.output<typeof AssetReportsQuery>;

// ── Catégories et réglages (§ 3.5) ──────────────────────────────────────────

export const CreateAssetCategoryBody = z
  .object({ name: assetRequiredText(L.categoryName, 'Nom de la catégorie') })
  .strict();
export type CreateAssetCategoryBody = z.output<typeof CreateAssetCategoryBody>;

export const UpdateAssetCategoryBody = z
  .object({
    expectedRevision: AssetExpectedRevision,
    name: assetRequiredText(L.categoryName, 'Nom de la catégorie').optional(),
    active: z.boolean().optional(),
  })
  .strict();
export type UpdateAssetCategoryBody = z.output<typeof UpdateAssetCategoryBody>;

/** Révision `0` tant que rien n'est enregistré (motif des réglages RH). */
export const UpdateAssetSettingsBody = z
  .object({
    expectedRevision: z.number().int().min(0),
    reminderDays: ReminderDays.optional(),
    maintenanceDueSoonDays: ReminderDays.optional(),
    showDepreciationEstimate: z.boolean().optional(),
  })
  .strict();
export type UpdateAssetSettingsBody = z.output<typeof UpdateAssetSettingsBody>;
