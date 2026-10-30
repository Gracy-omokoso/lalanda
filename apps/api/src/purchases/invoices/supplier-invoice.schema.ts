// Collection `supplier_invoices` (ADR-0044 § 2.5).
// ADR-0044 — P4.
//
// « Payée » n'est JAMAIS stockée : le reste à payer est dérivé des paiements par le
// moteur (`payableSettlement`). Le rapprochement (`matching`) est la sortie du moteur
// (`matchInvoice`), recalculée à chaque écriture d'un brouillon et FIGÉE à la
// validation. Doublon : clé de référence normalisée UNIQUE par fournisseur hors
// factures annulées — la clé passe à `null` à l'annulation (un index partiel par
// `$type` reste lisible par toutes les versions de MongoDB).

import type {
  PurchaseCurrency,
  PurchaseMatchingMode,
  PurchaseMatchingStatus,
  SupplierInvoiceKind,
  SupplierInvoiceStatus,
} from '@lalanda/shared/purchases';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

import {
  PurchaseAttachmentDocSchema,
  type PurchaseAttachmentDoc,
} from '../attachments/purchase-attachments.js';
import { PurchaseCancellationSchema, type PurchaseCancellation } from '../receptions/reception.schema.js';

@Schema({ _id: false, strict: true })
export class SupplierInvoiceLine {
  @Prop({ type: String, default: null })
  orderLineId!: string | null;

  @Prop({ type: String, required: true })
  label!: string;

  @Prop({ type: String, required: true })
  quantity!: string;

  @Prop({ type: String, required: true })
  unitPrice!: string;

  @Prop({ type: String, default: null })
  discountPercent!: string | null;

  /** HT, rendu par le moteur (`computeOrderTotals`). */
  @Prop({ type: String, required: true })
  amount!: string;
}
const SupplierInvoiceLineSchema = SchemaFactory.createForClass(SupplierInvoiceLine);

@Schema({ _id: false, strict: true })
export class DeclaredTax {
  @Prop({ type: String, required: true })
  label!: string;

  @Prop({ type: String, required: true })
  amount!: string;
}
const DeclaredTaxSchema = SchemaFactory.createForClass(DeclaredTax);

@Schema({ _id: false, strict: true })
export class CostAllocation {
  @Prop({ type: String, required: true })
  category!: string;

  @Prop({ type: String, default: null })
  workProjectId!: string | null;

  @Prop({ type: String, required: true })
  amount!: string;
}
const CostAllocationSchema = SchemaFactory.createForClass(CostAllocation);

@Schema({ _id: false, strict: true })
export class StoredMatching {
  @Prop({ type: String, required: true })
  version!: string;

  @Prop({ type: String, required: true, enum: ['none', 'two_way', 'three_way'] })
  mode!: PurchaseMatchingMode;

  @Prop({ type: String, required: true, enum: ['not_applicable', 'matched', 'variance'] })
  status!: PurchaseMatchingStatus;

  /** Écarts et lignes tels que rendus par le moteur (aucune transformation). */
  @Prop({ type: [Object], default: [] })
  variances!: Record<string, unknown>[];

  @Prop({ type: [Object], default: [] })
  lines!: Record<string, unknown>[];
}
const StoredMatchingSchema = SchemaFactory.createForClass(StoredMatching);

@Schema({ _id: false, strict: true })
export class InvoiceDecision {
  @Prop({ type: String, required: true })
  by!: string;

  @Prop({ type: Date, required: true })
  at!: Date;

  @Prop({ type: String, required: true })
  reason!: string;

  @Prop({ type: Boolean, default: false })
  soleApprover!: boolean;
}
const InvoiceDecisionSchema = SchemaFactory.createForClass(InvoiceDecision);

@Schema({ collection: 'supplier_invoices', timestamps: true, strict: true })
export class SupplierInvoice {
  @Prop({ type: String, required: true })
  organizationId!: string;

  /** `FF{AA}{MM}-NNNNNN`, pièce interne hors série fiscale. */
  @Prop({ type: String, required: true })
  internalNumber!: string;

  @Prop({ type: String, required: true })
  supplierId!: string;

  @Prop({ type: String, required: true })
  supplierReference!: string;

  /** Majuscules, sans espace ni tiret ; `null` une fois la facture annulée. */
  @Prop({ type: String, default: null })
  supplierReferenceKey!: string | null;

  @Prop({ type: String, required: true, enum: ['invoice', 'credit_note'], default: 'invoice' })
  kind!: SupplierInvoiceKind;

  /** Avoir : facture qu'il diminue (même fournisseur, même devise). */
  @Prop({ type: String, default: null })
  creditedInvoiceId!: string | null;

  @Prop({ type: String, required: true })
  invoiceDate!: string;

  @Prop({ type: String, required: true })
  receivedOn!: string;

  @Prop({ type: String, required: true })
  dueDate!: string;

  @Prop({ type: String, required: true, enum: ['CDF', 'USD'] })
  currency!: PurchaseCurrency;

  @Prop({ type: [String], default: [] })
  orderIds!: string[];

  @Prop({ type: [SupplierInvoiceLineSchema], default: [] })
  lines!: SupplierInvoiceLine[];

  @Prop({ type: String, required: true })
  subtotal!: string;

  @Prop({ type: [DeclaredTaxSchema], default: [] })
  taxes!: DeclaredTax[];

  @Prop({ type: String, required: true })
  total!: string;

  /** Déclarée, conservée pour le comptable, JAMAIS utilisée dans un calcul. */
  @Prop({ type: String, default: null })
  deductibleVat!: string | null;

  @Prop({ type: [CostAllocationSchema], required: true })
  costAllocations!: CostAllocation[];

  @Prop({ type: PurchaseAttachmentDocSchema, default: null })
  attachment!: PurchaseAttachmentDoc | null;

  @Prop({ type: String, required: true, enum: ['draft', 'validated', 'cancelled'] })
  status!: SupplierInvoiceStatus;

  @Prop({ type: StoredMatchingSchema, required: true })
  matching!: StoredMatching;

  @Prop({ type: InvoiceDecisionSchema, default: null })
  forcedValidation!: InvoiceDecision | null;

  @Prop({ type: InvoiceDecisionSchema, default: null })
  disputed!: InvoiceDecision | null;

  @Prop({ type: Date, default: null })
  validatedAt!: Date | null;

  @Prop({ type: String, default: null })
  validatedBy!: string | null;

  @Prop({ type: PurchaseCancellationSchema, default: null })
  cancellation!: PurchaseCancellation | null;

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

export type SupplierInvoiceDocument = HydratedDocument<SupplierInvoice>;
export type SupplierInvoiceLean = SupplierInvoice & { _id: Types.ObjectId };
export const SupplierInvoiceSchema = SchemaFactory.createForClass(SupplierInvoice);

// § 2.5 : échéancier et retards ; par fournisseur ; par commande ; par projet ;
// doublon de référence par fournisseur (hors annulées).
SupplierInvoiceSchema.index({ organizationId: 1, status: 1, dueDate: 1 });
SupplierInvoiceSchema.index({ organizationId: 1, supplierId: 1, invoiceDate: 1 });
SupplierInvoiceSchema.index({ organizationId: 1, orderIds: 1 });
SupplierInvoiceSchema.index(
  { organizationId: 1, 'costAllocations.workProjectId': 1 },
  { partialFilterExpression: { 'costAllocations.workProjectId': { $type: 'string' } } },
);
SupplierInvoiceSchema.index({ organizationId: 1, updatedAt: -1, _id: -1 });
SupplierInvoiceSchema.index(
  { organizationId: 1, supplierId: 1, supplierReferenceKey: 1 },
  {
    unique: true,
    partialFilterExpression: { supplierReferenceKey: { $type: 'string' } },
    name: 'supplier_invoice_reference_unique',
  },
);
