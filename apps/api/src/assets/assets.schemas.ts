// Collections des équipements (ADR-0046 § 1, § 3). ADR-0046 — S5.
//
// Toutes portent `organizationId`. Montants en chaînes décimales (jamais de flottant),
// dates civiles `AAAA-MM-JJ` au jour de Kinshasa. `asset_assignments` est en AJOUT
// SEUL : une affectation n'est jamais effacée, seule sa date de retour est posée (une
// seule ouverte par équipement, index unique partiel).

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type {
  AssetAssigneeInput,
  AssetCoverageKind,
  AssetCurrency,
  AssetDisposalKind,
  AssetMaintenanceKind,
  AssetMaintenanceStatus,
  AssetStatus,
} from '@lalanda/shared/assets';
import type { HydratedDocument, Types } from 'mongoose';

// ── Équipement ──────────────────────────────────────────────────────────────

export interface AssetAcquisitionDoc {
  on: string;
  /** `null` (ou absent sur un document ancien) = coût inconnu, jamais « 0 ». */
  cost: string | null;
  currency: AssetCurrency;
  supplierId: string | null;
  supplierInvoiceId: string | null;
  expenseId: string | null;
  note: string | null;
}

export interface AssetCurrentAssignmentDoc {
  assignmentId: string;
  assignee: AssetAssigneeInput;
  from: string;
}

export interface AssetDepreciationDoc {
  years: number;
  residualValue: string;
  startOn: string;
}

export interface AssetDisposalDoc {
  on: string;
  kind: AssetDisposalKind;
  proceeds: string | null;
  currency: AssetCurrency | null;
  buyer: string | null;
  reason: string;
  by: string;
}

@Schema({ collection: 'assets', timestamps: true, strict: true, minimize: false })
export class Asset {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  number!: string;

  @Prop({ type: String, default: null })
  tag!: string | null;

  @Prop({ type: String, required: true })
  name!: string;

  /** Nom normalisé : tri. */
  @Prop({ type: String, required: true })
  sortName!: string;

  @Prop({ type: String, required: true })
  categoryId!: string;

  @Prop({ type: String, default: null })
  brand!: string | null;

  @Prop({ type: String, default: null })
  model!: string | null;

  @Prop({ type: String, default: null })
  serialNumber!: string | null;

  @Prop({ type: String, required: true })
  status!: AssetStatus;

  @Prop({ type: Object, required: true })
  acquisition!: AssetAcquisitionDoc;

  @Prop({ type: String, default: null })
  stockItemId!: string | null;

  @Prop({ type: String, default: null })
  locationId!: string | null;

  @Prop({ type: Object, default: null })
  currentAssignment!: AssetCurrentAssignmentDoc | null;

  @Prop({ type: Object, default: null })
  managementDepreciation!: AssetDepreciationDoc | null;

  @Prop({ type: Object, default: null })
  disposal!: AssetDisposalDoc | null;

  @Prop({ type: String, default: null })
  notes!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}
export type AssetDocument = HydratedDocument<Asset>;
export type AssetLean = Asset & { _id: Types.ObjectId };
export const AssetSchema = SchemaFactory.createForClass(Asset);
AssetSchema.index({ organizationId: 1, number: 1 }, { unique: true, name: 'asset_number_unique' });
AssetSchema.index(
  { organizationId: 1, tag: 1 },
  {
    unique: true,
    partialFilterExpression: { tag: { $type: 'string' } },
    name: 'asset_tag_unique',
  },
);
AssetSchema.index({ organizationId: 1, status: 1, sortName: 1 });
AssetSchema.index({ organizationId: 1, categoryId: 1 });
AssetSchema.index(
  { organizationId: 1, 'currentAssignment.assignee.employeeId': 1 },
  {
    partialFilterExpression: { 'currentAssignment.assignee.employeeId': { $type: 'string' } },
    name: 'asset_current_employee',
  },
);
AssetSchema.index(
  { organizationId: 1, 'currentAssignment.assignee.workProjectId': 1 },
  {
    partialFilterExpression: { 'currentAssignment.assignee.workProjectId': { $type: 'string' } },
    name: 'asset_current_project',
  },
);
AssetSchema.index(
  { organizationId: 1, 'acquisition.supplierId': 1 },
  {
    partialFilterExpression: { 'acquisition.supplierId': { $type: 'string' } },
    name: 'asset_acquisition_supplier',
  },
);

// ── Affectations (ajout seul) ───────────────────────────────────────────────

@Schema({ collection: 'asset_assignments', timestamps: true, strict: true, minimize: false })
export class AssetAssignment {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  assetId!: string;

  @Prop({ type: Object, required: true })
  assignee!: AssetAssigneeInput;

  @Prop({ type: String, required: true })
  from!: string;

  @Prop({ type: String, default: null })
  to!: string | null;

  @Prop({ type: String, required: true })
  handedOverBy!: string;

  @Prop({ type: String, default: null })
  returnedBy!: string | null;

  @Prop({ type: String, default: null })
  conditionOut!: string | null;

  @Prop({ type: String, default: null })
  conditionIn!: string | null;

  @Prop({ type: String, default: null })
  note!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}
export type AssetAssignmentDocument = HydratedDocument<AssetAssignment>;
export type AssetAssignmentLean = AssetAssignment & { _id: Types.ObjectId };
export const AssetAssignmentSchema = SchemaFactory.createForClass(AssetAssignment);
AssetAssignmentSchema.index({ organizationId: 1, assetId: 1, from: 1 });
AssetAssignmentSchema.index(
  { organizationId: 1, assetId: 1 },
  { unique: true, partialFilterExpression: { to: null }, name: 'asset_assignment_open_unique' },
);

// ── Maintenance ─────────────────────────────────────────────────────────────

@Schema({ collection: 'asset_maintenance', timestamps: true, strict: true, minimize: false })
export class AssetMaintenance {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  assetId!: string;

  @Prop({ type: String, required: true })
  kind!: AssetMaintenanceKind;

  @Prop({ type: String, required: true })
  status!: AssetMaintenanceStatus;

  @Prop({ type: String, default: null })
  plannedOn!: string | null;

  @Prop({ type: String, default: null })
  doneOn!: string | null;

  @Prop({ type: String, default: null })
  cost!: string | null;

  @Prop({ type: String, default: null })
  currency!: AssetCurrency | null;

  @Prop({ type: String, default: null })
  supplierId!: string | null;

  @Prop({ type: String, default: null })
  supplierInvoiceId!: string | null;

  @Prop({ type: String, default: null })
  performedBy!: string | null;

  @Prop({ type: String, default: null })
  note!: string | null;

  @Prop({ type: Object, default: null })
  recurrence!: { everyMonths: number } | null;

  /** Intervention suivante créée par la récurrence (idempotence de `done`). */
  @Prop({ type: String, default: null })
  nextId!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}
export type AssetMaintenanceDocument = HydratedDocument<AssetMaintenance>;
export type AssetMaintenanceLean = AssetMaintenance & { _id: Types.ObjectId };
export const AssetMaintenanceSchema = SchemaFactory.createForClass(AssetMaintenance);
AssetMaintenanceSchema.index({ organizationId: 1, assetId: 1, plannedOn: 1 });
AssetMaintenanceSchema.index({ organizationId: 1, status: 1, plannedOn: 1 });

// ── Couvertures ─────────────────────────────────────────────────────────────

@Schema({ collection: 'asset_coverages', timestamps: true, strict: true, minimize: false })
export class AssetCoverage {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  assetId!: string;

  @Prop({ type: String, required: true })
  kind!: AssetCoverageKind;

  @Prop({ type: String, required: true })
  provider!: string;

  @Prop({ type: String, default: null })
  reference!: string | null;

  @Prop({ type: String, required: true })
  startOn!: string;

  @Prop({ type: String, required: true })
  endOn!: string;

  @Prop({ type: String, default: null })
  cost!: string | null;

  @Prop({ type: String, default: null })
  currency!: AssetCurrency | null;

  @Prop({ type: String, default: null })
  documentId!: string | null;

  @Prop({ type: Number, default: null })
  reminderDays!: number | null;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}
export type AssetCoverageDocument = HydratedDocument<AssetCoverage>;
export type AssetCoverageLean = AssetCoverage & { _id: Types.ObjectId };
export const AssetCoverageSchema = SchemaFactory.createForClass(AssetCoverage);
AssetCoverageSchema.index({ organizationId: 1, assetId: 1, endOn: 1 });

// ── Catégories ──────────────────────────────────────────────────────────────

@Schema({ collection: 'asset_categories', timestamps: true, strict: true })
export class AssetCategory {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, required: true })
  nameKey!: string;

  @Prop({ type: Boolean, required: true, default: true })
  active!: boolean;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}
export type AssetCategoryDocument = HydratedDocument<AssetCategory>;
export type AssetCategoryLean = AssetCategory & { _id: Types.ObjectId };
export const AssetCategorySchema = SchemaFactory.createForClass(AssetCategory);
AssetCategorySchema.index(
  { organizationId: 1, nameKey: 1 },
  { unique: true, name: 'asset_category_name_unique' },
);

// ── Réglages ────────────────────────────────────────────────────────────────

@Schema({ collection: 'asset_settings', timestamps: true, strict: true })
export class AssetSettings {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: Number, required: true })
  reminderDays!: number;

  @Prop({ type: Number, required: true })
  maintenanceDueSoonDays!: number;

  @Prop({ type: Boolean, required: true })
  showDepreciationEstimate!: boolean;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type AssetSettingsDocument = HydratedDocument<AssetSettings>;
export const AssetSettingsSchema = SchemaFactory.createForClass(AssetSettings);
AssetSettingsSchema.index({ organizationId: 1 }, { unique: true, name: 'asset_settings_org' });

// ── Compteurs (non annuels : `year` = 0) ────────────────────────────────────

@Schema({ collection: 'asset_counters', timestamps: false, strict: true })
export class AssetCounter {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  kind!: string;

  @Prop({ type: Number, required: true })
  year!: number;

  @Prop({ type: Number, required: true, default: 0 })
  last!: number;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type AssetCounterDocument = HydratedDocument<AssetCounter>;
export const AssetCounterSchema = SchemaFactory.createForClass(AssetCounter);
AssetCounterSchema.index(
  { organizationId: 1, kind: 1, year: 1 },
  { unique: true, name: 'asset_counter_unique' },
);

// ── Réclamations des rappels (`assets.reminders`) ───────────────────────────

@Schema({ collection: 'asset_reminder_claims', timestamps: false, strict: true })
export class AssetReminderClaim {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  dedupeKey!: string;

  @Prop({ type: Date, required: true })
  claimedAt!: Date;
}
export type AssetReminderClaimDocument = HydratedDocument<AssetReminderClaim>;
export const AssetReminderClaimSchema = SchemaFactory.createForClass(AssetReminderClaim);
AssetReminderClaimSchema.index(
  { organizationId: 1, dedupeKey: 1 },
  { unique: true, name: 'asset_reminder_claim_unique' },
);
