// Collections de la trésorerie RUN — ADR-0034.
//
// Toutes portent `organizationId` : chaque requête est scopée par l'organisation
// active, un document d'une autre organisation est « introuvable » (404). Les
// montants sont des chaînes décimales (jamais des flottants) ; les dates civiles
// des chaînes `AAAA-MM-JJ` (jour de Kinshasa, ADR-0027).

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import type {
  ExpenseCategory,
  RecurrenceFrequency,
  ScenarioHypotheses,
  TreasuryAccountKind,
  TreasuryCurrency,
} from '@lalanda/engine';

// ─── Comptes ─────────────────────────────────────────────────────────────────

@Schema({ collection: 'treasury_accounts', timestamps: true, strict: true })
export class TreasuryAccount {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, required: true, enum: ['cash', 'bank', 'mobile_money'] })
  kind!: TreasuryAccountKind;

  @Prop({ type: String, default: null })
  institution!: string | null;

  /** Non modifiable après création. */
  @Prop({ type: String, required: true, enum: ['CDF', 'USD'] })
  currency!: TreasuryCurrency;

  /** Solde au DÉBUT du jour d'ouverture, décimal signé. */
  @Prop({ type: String, required: true })
  openingBalance!: string;

  /** Non modifiable après création. */
  @Prop({ type: String, required: true })
  openingDate!: string;

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
export type TreasuryAccountDocument = HydratedDocument<TreasuryAccount>;
export const TreasuryAccountSchema = SchemaFactory.createForClass(TreasuryAccount);
TreasuryAccountSchema.index({ organizationId: 1, active: -1, name: 1 });

// ─── Dépenses ────────────────────────────────────────────────────────────────

export interface ExpenseAttachment {
  /** Identifiant tiré au hasard (`storage/object-key.ts`) : la clé ne dérive de rien. */
  objectId: string;
  contentType: string;
  size: number;
  uploadedAt: Date;
  uploadedBy: string;
}

// ADR-0044 — P5 (§ 2.8, § 6.2) : dépense POSSÉDÉE par les achats. Non nulle, la
// dépense a été créée (ou rattachée) par un paiement fournisseur : la trésorerie ne
// la modifie, ne l'annule ni ne lui joint de pièce (`409 EXPENSE_OWNED_BY_PURCHASES`).
export interface ExpenseOrigin {
  kind: 'supplier_payment';
  paymentId: string;
  /** Numéro `PF…` du paiement, copie d'affichage (« Ouvrir le paiement PF… »). */
  paymentNumber: string;
  invoiceId: string;
  /** Rang de l'imputation de coût de la facture (`costAllocations`). */
  allocationIndex: number;
}

@Schema({ collection: 'treasury_expenses', timestamps: true, strict: true })
export class TreasuryExpense {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  spentOn!: string;

  @Prop({ type: String, required: true })
  amount!: string;

  @Prop({ type: String, required: true, enum: ['CDF', 'USD'] })
  currency!: TreasuryCurrency;

  @Prop({ type: String, required: true })
  category!: ExpenseCategory;

  @Prop({ type: String, required: true })
  label!: string;

  @Prop({ type: String, default: null })
  supplierName!: string | null;

  /** Clé de recherche normalisée du fournisseur (minuscules, sans accents). */
  @Prop({ type: String, default: null })
  supplierKey!: string | null;

  // ADR-0044 — P2 : fiche fournisseur (`suppliers`) de l'organisation, ou `null`
  // (« fournisseur de passage » en texte libre). Posée, `supplierName` n'est plus
  // qu'une copie d'affichage du nom de la fiche (§ 2.8).
  @Prop({ type: String, default: null })
  supplierId!: string | null;

  @Prop({ type: String, default: null })
  accountId!: string | null;

  /** Déclarée par l'utilisateur ; conservée, jamais utilisée dans un calcul (ADR-0034, d.o. n° 1). */
  @Prop({ type: String, default: null })
  deductibleVat!: string | null;

  @Prop({ type: String, default: null })
  reference!: string | null;

  @Prop({ type: Object, default: null })
  attachment!: ExpenseAttachment | null;

  /** Occurrence de dépense récurrente confirmée — `null` pour une dépense ponctuelle. */
  @Prop({ type: String, default: null })
  recurringExpenseId!: string | null;

  @Prop({ type: String, default: null })
  occurrenceDate!: string | null;

  /**
   * Projet du RUN (`work_projects`) auquel la dépense est rattachée — ADR-0039
   * § 2.10. `null` par défaut ; lu par la marge du projet, sans autre effet
   * (pont vers le réalisé, catégories, prévision : inchangés).
   */
  @Prop({ type: String, default: null })
  workProjectId!: string | null;

  // ADR-0044 — P5 : `null` = dépense directe ; sinon possédée par les achats.
  @Prop({ type: Object, default: null })
  origin!: ExpenseOrigin | null;

  @Prop({ type: String, required: true, enum: ['recorded', 'cancelled'], default: 'recorded' })
  status!: 'recorded' | 'cancelled';

  @Prop({ type: String, default: null })
  cancelReason!: string | null;

  @Prop({ type: Date, default: null })
  cancelledAt!: Date | null;

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
export type TreasuryExpenseDocument = HydratedDocument<TreasuryExpense>;
export const TreasuryExpenseSchema = SchemaFactory.createForClass(TreasuryExpense);
TreasuryExpenseSchema.index({ organizationId: 1, spentOn: -1, _id: -1 });
TreasuryExpenseSchema.index({ organizationId: 1, accountId: 1, spentOn: 1 });
TreasuryExpenseSchema.index({ organizationId: 1, supplierKey: 1 });
// ADR-0044 — P2 (§ 2.8) : dépenses d'une fiche fournisseur.
TreasuryExpenseSchema.index(
  { organizationId: 1, supplierId: 1, spentOn: 1 },
  { partialFilterExpression: { supplierId: { $type: 'string' } } },
);
// ADR-0044 — P5 (§ 2.8) : un paiement ne crée jamais deux fois la même dépense.
TreasuryExpenseSchema.index(
  { organizationId: 1, 'origin.paymentId': 1, 'origin.invoiceId': 1, 'origin.allocationIndex': 1 },
  {
    unique: true,
    partialFilterExpression: { 'origin.paymentId': { $type: 'string' } },
    name: 'treasury_expense_supplier_payment_unique',
  },
);
// ADR-0039 § 2.10 : dépenses d'un projet du RUN (marge, filtre de liste).
TreasuryExpenseSchema.index(
  { organizationId: 1, workProjectId: 1 },
  { partialFilterExpression: { workProjectId: { $type: 'string' } } },
);
// Confirmer deux fois la même occurrence ne crée qu'une dépense (ADR-0034 § 3).
// Une occurrence ANNULÉE sort de l'index : elle redevient « à confirmer ».
TreasuryExpenseSchema.index(
  { organizationId: 1, recurringExpenseId: 1, occurrenceDate: 1 },
  {
    unique: true,
    partialFilterExpression: { recurringExpenseId: { $type: 'string' }, status: 'recorded' },
    name: 'treasury_expense_occurrence_unique',
  },
);

// ─── Dépenses récurrentes ────────────────────────────────────────────────────

@Schema({ collection: 'treasury_recurring_expenses', timestamps: true, strict: true })
export class TreasuryRecurringExpense {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  label!: string;

  @Prop({ type: String, required: true })
  amount!: string;

  @Prop({ type: String, required: true, enum: ['CDF', 'USD'] })
  currency!: TreasuryCurrency;

  @Prop({ type: String, required: true })
  category!: ExpenseCategory;

  @Prop({ type: String, default: null })
  supplierName!: string | null;

  // ADR-0044 — P2 : fiche fournisseur, comme sur les dépenses (§ 2.8).
  @Prop({ type: String, default: null })
  supplierId!: string | null;

  @Prop({ type: String, default: null })
  accountId!: string | null;

  @Prop({ type: String, required: true, enum: ['weekly', 'monthly', 'quarterly', 'yearly'] })
  frequency!: RecurrenceFrequency;

  @Prop({ type: String, required: true })
  startDate!: string;

  @Prop({ type: String, default: null })
  endDate!: string | null;

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
export type TreasuryRecurringExpenseDocument = HydratedDocument<TreasuryRecurringExpense>;
export const TreasuryRecurringExpenseSchema =
  SchemaFactory.createForClass(TreasuryRecurringExpense);
TreasuryRecurringExpenseSchema.index({ organizationId: 1, active: -1, label: 1 });

// ─── Mouvements hors dépenses (virements, autres entrées et sorties) ─────────

export type TreasuryMovementKind = 'transfer' | 'other_in' | 'other_out';

@Schema({ collection: 'treasury_movements', timestamps: true, strict: true })
export class TreasuryMovement {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true, enum: ['transfer', 'other_in', 'other_out'] })
  kind!: TreasuryMovementKind;

  @Prop({ type: String, required: true })
  date!: string;

  @Prop({ type: String, required: true })
  label!: string;

  /** Compte débité (`transfer`, `other_out`). */
  @Prop({ type: String, default: null })
  fromAccountId!: string | null;

  /** Compte crédité (`transfer`, `other_in`). */
  @Prop({ type: String, default: null })
  toAccountId!: string | null;

  /** Montant sorti du compte débité. */
  @Prop({ type: String, default: null })
  amountOut!: string | null;

  /** Montant entré sur le compte crédité (différent seulement entre deux devises). */
  @Prop({ type: String, default: null })
  amountIn!: string | null;

  @Prop({ type: String, default: null })
  reference!: string | null;

  @Prop({ type: String, required: true, enum: ['recorded', 'cancelled'], default: 'recorded' })
  status!: 'recorded' | 'cancelled';

  @Prop({ type: String, default: null })
  cancelReason!: string | null;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}
export type TreasuryMovementDocument = HydratedDocument<TreasuryMovement>;
export const TreasuryMovementSchema = SchemaFactory.createForClass(TreasuryMovement);
TreasuryMovementSchema.index({ organizationId: 1, date: -1, _id: -1 });

// ─── Réglages : minimum de trésorerie, hypothèses, pont vers le réalisé ─────

/**
 * Part PROPRE au report des dépenses : interrupteur et table de correspondance.
 * Le projet relié et le mois d'ouverture de l'exercice 1 sont le rattachement
 * COMMUN aux deux ponts (`run_actuals_bridges`, `RunLinkService`) : ils ne sont
 * plus stockés ici (ADR-0034, amendement du 26 oct. 2026).
 */
export interface TreasuryBridgeConfig {
  enabled: boolean;
  mapping: Partial<Record<ExpenseCategory, string>>;
  updatedAt: Date | null;
  updatedBy: string | null;
}

/** Report des dépenses tel qu'il s'applique : part propre + rattachement commun. */
export interface EffectiveTreasuryBridge {
  enabled: boolean;
  projectId: string | null;
  firstMonth: string | null;
  mapping: Partial<Record<ExpenseCategory, string>>;
}

@Schema({ collection: 'treasury_settings', timestamps: true, strict: true })
export class TreasurySettings {
  @Prop({ type: String, required: true, unique: true })
  organizationId!: string;

  /** Minimum de trésorerie par devise ; absent = 0 (ADR-0034, d.o. n° 5). */
  @Prop({ type: Object, default: {} })
  minimumBalances!: Partial<Record<TreasuryCurrency, string>>;

  /** Hypothèses des trois scénarios ; absentes = valeurs par défaut proposées. */
  @Prop({ type: Object, default: null })
  scenarios!: Record<'optimistic' | 'probable' | 'pessimistic', ScenarioHypotheses> | null;

  @Prop({ type: Object, default: null })
  bridge!: TreasuryBridgeConfig | null;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}
export type TreasurySettingsDocument = HydratedDocument<TreasurySettings>;
export const TreasurySettingsSchema = SchemaFactory.createForClass(TreasurySettings);
