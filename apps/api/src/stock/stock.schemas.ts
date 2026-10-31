// Collections des stocks (ADR-0046 § 1, § 2). ADR-0046 — S3.
//
// Toutes portent `organizationId`, `revision`, `createdBy`, `updatedBy`, horodatages et
// `_schemaVersion`. Le grand livre `stock_movements` est en AJOUT SEUL (seul `unitCost`
// d'une entrée se corrige, § 2.3.1) ; `stock_levels` n'est qu'un cache recalculable,
// incrémenté dans la transaction de chaque mouvement (§ 2.5). Les quantités du cache
// sont des `Decimal128` pour que `$inc` additionne exactement, sans flottant.

import type {
  StockCostStatus,
  StockCountScope,
  StockCountStatus,
  StockCurrency,
  StockItemKind,
  StockLocationKind,
  StockMovementKind,
  StockPendingProposal,
  StockPendingReason,
  StockPendingStatus,
  StockSalesIssueMode,
  StockVoucherKind,
  StockVoucherStatus,
} from '@lalanda/shared/stock';
import { Schema as MongooseSchema, type Types } from 'mongoose';

type Base = {
  _id: Types.ObjectId;
  organizationId: string;
  revision: number;
  createdBy: string;
  updatedBy: string;
  _schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

const base = {
  organizationId: { type: String, required: true },
  revision: { type: Number, required: true, default: 1 },
  createdBy: { type: String, required: true },
  updatedBy: { type: String, required: true },
  _schemaVersion: { type: Number, required: true, default: 1 },
};

// ── Articles (§ 2.1) ────────────────────────────────────────────────────────

export type StockItemLean = Base & {
  code: string | null;
  codeKey: string | null;
  name: string;
  sortName: string;
  searchKey: string;
  description: string | null;
  kind: StockItemKind;
  catalogItemId: string | null;
  unit: string;
  unitConversions: { unit: string; factor: string }[];
  costCurrency: StockCurrency;
  tracked: boolean;
  discreteUnit: boolean;
  defaultLocationId: string | null;
  reorder: { minQuantity: string; targetQuantity: string | null; locationId: string | null } | null;
  preferredSupplierId: string | null;
  active: boolean;
};

export class StockItem {}
export const StockItemSchema = new MongooseSchema(
  {
    ...base,
    code: { type: String, default: null },
    codeKey: { type: String, default: null },
    name: { type: String, required: true },
    sortName: { type: String, required: true },
    searchKey: { type: String, required: true },
    description: { type: String, default: null },
    kind: { type: String, required: true, enum: ['goods', 'consumable', 'material'] },
    catalogItemId: { type: String, default: null },
    unit: { type: String, required: true },
    unitConversions: {
      type: [{ _id: false, unit: { type: String }, factor: { type: String } }],
      default: [],
    },
    costCurrency: { type: String, required: true, enum: ['CDF', 'USD'] },
    tracked: { type: Boolean, required: true, default: true },
    discreteUnit: { type: Boolean, required: true, default: false },
    defaultLocationId: { type: String, default: null },
    reorder: { type: Object, default: null },
    preferredSupplierId: { type: String, default: null },
    active: { type: Boolean, required: true, default: true },
  },
  { collection: 'stock_items', timestamps: true, strict: true, minimize: false },
);
StockItemSchema.index({ organizationId: 1, sortName: 1, _id: 1 });
StockItemSchema.index({ organizationId: 1, active: 1, kind: 1 });
StockItemSchema.index(
  { organizationId: 1, codeKey: 1 },
  { unique: true, partialFilterExpression: { codeKey: { $type: 'string' } } },
);
StockItemSchema.index(
  { organizationId: 1, catalogItemId: 1 },
  { unique: true, partialFilterExpression: { catalogItemId: { $type: 'string' } } },
);

// ── Emplacements (§ 2.2) ────────────────────────────────────────────────────

export type StockLocationLean = Base & {
  name: string;
  nameKey: string;
  kind: StockLocationKind;
  workProjectId: string | null;
  address: string | null;
  responsibleUserId: string | null;
  isDefault: boolean;
  pointOfSaleIds: string[];
  active: boolean;
};

export class StockLocation {}
export const StockLocationSchema = new MongooseSchema(
  {
    ...base,
    name: { type: String, required: true },
    nameKey: { type: String, required: true },
    kind: {
      type: String,
      required: true,
      enum: ['warehouse', 'shop', 'vehicle', 'site', 'other'],
    },
    workProjectId: { type: String, default: null },
    address: { type: String, default: null },
    responsibleUserId: { type: String, default: null },
    isDefault: { type: Boolean, required: true, default: false },
    pointOfSaleIds: { type: [String], default: [] },
    active: { type: Boolean, required: true, default: true },
  },
  { collection: 'stock_locations', timestamps: true, strict: true, minimize: false },
);
StockLocationSchema.index({ organizationId: 1, nameKey: 1 }, { unique: true });
StockLocationSchema.index(
  { organizationId: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } },
);

// ── Grand livre (§ 2.3) ─────────────────────────────────────────────────────

export type StockMovementSource =
  | { kind: 'reception'; receptionId: string; orderLineId: string }
  | { kind: 'invoice'; invoiceId: string; lineIndex: number }
  | { kind: 'voucher'; voucherId: string; lineId: string }
  | { kind: 'count'; countId: string; lineId: string }
  | { kind: 'pending'; pendingLineId: string };

export type StockMovementLean = Base & {
  itemId: string;
  locationId: string;
  kind: StockMovementKind;
  /** Signée, canonique à trois décimales (`"-4.000"`). */
  quantity: string;
  occurredOn: string;
  unitCost: string | null;
  costStatus: StockCostStatus;
  source: StockMovementSource;
  sourceKey: string;
  workProjectId: string | null;
  transferId: string | null;
  reason: { key: string; note: string | null } | null;
  reversalOf: string | null;
};

export class StockMovement {}
export const StockMovementSchema = new MongooseSchema(
  {
    ...base,
    itemId: { type: String, required: true },
    locationId: { type: String, required: true },
    kind: { type: String, required: true },
    quantity: { type: String, required: true },
    occurredOn: { type: String, required: true },
    unitCost: { type: String, default: null },
    costStatus: {
      type: String,
      required: true,
      enum: ['valued', 'pending_cost', 'not_applicable'],
    },
    source: { type: Object, required: true },
    sourceKey: { type: String, required: true },
    workProjectId: { type: String, default: null },
    transferId: { type: String, default: null },
    reason: { type: Object, default: null },
    reversalOf: { type: String, default: null },
  },
  { collection: 'stock_movements', timestamps: true, strict: true, minimize: false },
);
StockMovementSchema.index({ organizationId: 1, itemId: 1, occurredOn: 1, _id: 1 });
StockMovementSchema.index({ organizationId: 1, locationId: 1, itemId: 1 });
StockMovementSchema.index(
  { organizationId: 1, workProjectId: 1, occurredOn: 1 },
  { partialFilterExpression: { workProjectId: { $type: 'string' } } },
);
StockMovementSchema.index({ organizationId: 1, sourceKey: 1 }, { unique: true });
StockMovementSchema.index({ organizationId: 1, 'source.voucherId': 1 });

// ── Cache des niveaux (§ 2.5) ───────────────────────────────────────────────

export type StockLevelLean = {
  _id: Types.ObjectId;
  organizationId: string;
  itemId: string;
  locationId: string;
  quantity: Types.Decimal128;
  lastMovementAt: Date | null;
  engineVersion: string;
  _schemaVersion: number;
};

export class StockLevel {}
export const StockLevelSchema = new MongooseSchema(
  {
    organizationId: { type: String, required: true },
    itemId: { type: String, required: true },
    locationId: { type: String, required: true },
    quantity: { type: MongooseSchema.Types.Decimal128, required: true },
    lastMovementAt: { type: Date, default: null },
    engineVersion: { type: String, required: true },
    _schemaVersion: { type: Number, required: true, default: 1 },
  },
  { collection: 'stock_levels', strict: true, minimize: false },
);
StockLevelSchema.index({ organizationId: 1, itemId: 1, locationId: 1 }, { unique: true });
StockLevelSchema.index({ organizationId: 1, locationId: 1 });

// ── Bons (§ 2.4) ────────────────────────────────────────────────────────────

export type StockVoucherLineDoc = {
  id: string;
  itemId: string;
  quantity: string;
  direction: 'in' | 'out' | null;
  unitCost: string | null;
  note: string | null;
};

export type StockVoucherLean = Base & {
  number: string;
  kind: StockVoucherKind;
  status: StockVoucherStatus;
  fromLocationId: string | null;
  toLocationId: string | null;
  postedOn: string;
  lines: StockVoucherLineDoc[];
  workProjectId: string | null;
  recipient: string | null;
  employeeId: string | null;
  supplierId: string | null;
  receptionId: string | null;
  reason: { key: string; note: string | null } | null;
  note: string | null;
  posting: { at: Date; by: string } | null;
  cancellation: { at: Date; by: string; reason: string } | null;
  wentNegative: boolean;
};

export class StockVoucher {}
export const StockVoucherSchema = new MongooseSchema(
  {
    ...base,
    number: { type: String, required: true },
    kind: { type: String, required: true },
    status: { type: String, required: true, enum: ['draft', 'posted', 'cancelled'] },
    fromLocationId: { type: String, default: null },
    toLocationId: { type: String, default: null },
    postedOn: { type: String, required: true },
    lines: { type: [Object], required: true },
    workProjectId: { type: String, default: null },
    recipient: { type: String, default: null },
    employeeId: { type: String, default: null },
    supplierId: { type: String, default: null },
    receptionId: { type: String, default: null },
    reason: { type: Object, default: null },
    note: { type: String, default: null },
    posting: { type: Object, default: null },
    cancellation: { type: Object, default: null },
    wentNegative: { type: Boolean, required: true, default: false },
  },
  { collection: 'stock_vouchers', timestamps: true, strict: true, minimize: false },
);
StockVoucherSchema.index({ organizationId: 1, createdAt: -1, _id: -1 });
StockVoucherSchema.index({ organizationId: 1, number: 1 }, { unique: true });

// ── « À traiter » (§ 2.6) ───────────────────────────────────────────────────

export type StockPendingLineLean = Base & {
  reason: StockPendingReason;
  status: StockPendingStatus;
  sourceKey: string;
  proposal: StockPendingProposal;
  movementId: string | null;
  /** Article retenu à la résolution (mémorise `itemRef` → article). */
  resolvedItemId: string | null;
  closure: { at: Date; by: string; note: string | null } | null;
};

export class StockPendingLine {}
export const StockPendingLineSchema = new MongooseSchema(
  {
    ...base,
    reason: { type: String, required: true },
    status: { type: String, required: true, enum: ['open', 'resolved', 'dismissed'] },
    sourceKey: { type: String, required: true },
    proposal: { type: Object, required: true },
    movementId: { type: String, default: null },
    resolvedItemId: { type: String, default: null },
    closure: { type: Object, default: null },
  },
  { collection: 'stock_pending_lines', timestamps: true, strict: true, minimize: false },
);
StockPendingLineSchema.index({ organizationId: 1, status: 1, reason: 1, createdAt: 1 });
StockPendingLineSchema.index({ organizationId: 1, sourceKey: 1 }, { unique: true });
StockPendingLineSchema.index({ organizationId: 1, 'proposal.orderId': 1, 'proposal.itemRef': 1 });

// ── Inventaires (§ 2.7) ─────────────────────────────────────────────────────

export type StockCountEntryDoc = { countedQuantity: string; countedAt: Date; countedBy: string };

export type StockCountLineDoc = {
  id: string;
  itemId: string;
  countedQuantity: string | null;
  countedAt: Date | null;
  countedBy: string | null;
  note: string | null;
  unitCost: string | null;
  recounts: StockCountEntryDoc[];
};

export type StockCountLean = Base & {
  number: string;
  locationId: string;
  scope: StockCountScope;
  itemIds: string[];
  status: StockCountStatus;
  blind: boolean;
  assignees: string[];
  note: string | null;
  lines: StockCountLineDoc[];
  submission: { at: Date; by: string } | null;
  validation: { at: Date; by: string; comment: string | null; soleApprover: boolean } | null;
  cancellation: { at: Date; by: string; reason: string } | null;
};

export class StockCount {}
export const StockCountSchema = new MongooseSchema(
  {
    ...base,
    number: { type: String, required: true },
    locationId: { type: String, required: true },
    scope: { type: String, required: true, enum: ['all', 'items'] },
    itemIds: { type: [String], default: [] },
    status: {
      type: String,
      required: true,
      enum: ['draft', 'counting', 'submitted', 'validated', 'cancelled'],
    },
    blind: { type: Boolean, required: true, default: true },
    assignees: { type: [String], default: [] },
    note: { type: String, default: null },
    lines: { type: [Object], default: [] },
    submission: { type: Object, default: null },
    validation: { type: Object, default: null },
    cancellation: { type: Object, default: null },
  },
  { collection: 'stock_counts', timestamps: true, strict: true, minimize: false },
);
StockCountSchema.index({ organizationId: 1, createdAt: -1, _id: -1 });
StockCountSchema.index({ organizationId: 1, number: 1 }, { unique: true });

// ── Réglages (§ 2.8) ────────────────────────────────────────────────────────

export type StockSettingsLean = Base & {
  salesIssueMode: StockSalesIssueMode;
  allowNegativeManualMoves: boolean;
  adjustmentReasons: { key: string; label: string }[];
  countReminderDays: number;
  alertRecipients: 'holders';
  defaultCostCurrency: StockCurrency;
  dormantDays: number | null;
  defaultLocationId: string;
};

export class StockSettings {}
export const StockSettingsSchema = new MongooseSchema(
  {
    ...base,
    salesIssueMode: { type: String, required: true },
    allowNegativeManualMoves: { type: Boolean, required: true },
    adjustmentReasons: { type: [Object], required: true },
    countReminderDays: { type: Number, required: true },
    alertRecipients: { type: String, required: true },
    defaultCostCurrency: { type: String, required: true, enum: ['CDF', 'USD'] },
    dormantDays: { type: Number, default: null },
    defaultLocationId: { type: String, required: true },
  },
  { collection: 'stock_settings', timestamps: true, strict: true, minimize: false },
);
StockSettingsSchema.index({ organizationId: 1 }, { unique: true });

// ── Compteurs (§ 1) ─────────────────────────────────────────────────────────

/** `issue` → BS, `transfer` → BT, `adjustment` → BJ, `count` → IV. */
export type StockCounterKind = 'BS' | 'BT' | 'BJ' | 'IV';

export class StockCounter {}
export const StockCounterSchema = new MongooseSchema(
  {
    organizationId: { type: String, required: true },
    kind: { type: String, required: true, enum: ['BS', 'BT', 'BJ', 'IV'] },
    year: { type: Number, required: true },
    last: { type: Number, required: true, default: 0 },
    _schemaVersion: { type: Number, required: true, default: 1 },
  },
  { collection: 'stock_counters', strict: true },
);
StockCounterSchema.index({ organizationId: 1, kind: 1, year: 1 }, { unique: true });
