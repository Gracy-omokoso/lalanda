// Paiements fournisseurs — collection `supplier_payments` (ADR-0044 § 2.6). ADR-0044 — P5.
//
// Un paiement est une pièce interne `PF…` qui CRÉE (ou rattache) des dépenses de
// trésorerie possédées par les achats. Il n'est jamais effacé : il est annulé avec
// un motif, et ses dépenses créées avec lui, dans la même transaction. Montants en
// chaînes décimales ; dates civiles au jour de Kinshasa.

import type {
  PurchaseCurrency,
  SupplierPaymentChannel,
  SupplierPaymentOrigin,
  SupplierPaymentStatus,
} from '@lalanda/shared/purchases';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

export interface SupplierPaymentAllocation {
  invoiceId: string;
  amount: string;
}

export interface SupplierPaymentLinkedExpense {
  id: string;
  /** `kept` : la dépense est devenue le paiement ; `replaced` : annulée et remplacée par des parts. */
  mode: 'kept' | 'replaced';
}

export interface SupplierPaymentCancellation {
  at: Date;
  by: string;
  reason: string;
}

@Schema({ collection: 'supplier_payments', timestamps: true, strict: true })
export class SupplierPayment {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  number!: string;

  @Prop({ type: String, required: true })
  supplierId!: string;

  @Prop({ type: String, required: true, enum: ['CDF', 'USD'] })
  currency!: PurchaseCurrency;

  @Prop({ type: String, required: true })
  paidOn!: string;

  @Prop({ type: String, required: true })
  amount!: string;

  @Prop({ type: String, default: null })
  accountId!: string | null;

  @Prop({
    type: String,
    required: true,
    enum: ['bank_transfer', 'mobile_money', 'cash', 'cheque', 'other'],
  })
  method!: SupplierPaymentChannel;

  @Prop({ type: String, default: null })
  paymentMethodId!: string | null;

  @Prop({ type: String, default: null })
  reference!: string | null;

  @Prop({ type: [Object], required: true })
  allocations!: SupplierPaymentAllocation[];

  /** Dépenses créées (ou la dépense gardée) — `treasury_expenses`. */
  @Prop({ type: [String], default: [] })
  expenseIds!: string[];

  @Prop({ type: String, required: true, enum: ['recorded', 'linked_expense'] })
  origin!: SupplierPaymentOrigin;

  @Prop({ type: Object, default: null })
  linkedExpense!: SupplierPaymentLinkedExpense | null;

  @Prop({ type: String, required: true, enum: ['recorded', 'cancelled'], default: 'recorded' })
  status!: SupplierPaymentStatus;

  @Prop({ type: Object, default: null })
  cancellation!: SupplierPaymentCancellation | null;

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

export type SupplierPaymentDocument = HydratedDocument<SupplierPayment>;
export type SupplierPaymentLean = SupplierPayment & { _id: Types.ObjectId };
export const SupplierPaymentSchema = SchemaFactory.createForClass(SupplierPayment);
SupplierPaymentSchema.index({ organizationId: 1, supplierId: 1, paidOn: 1 });
SupplierPaymentSchema.index({ organizationId: 1, 'allocations.invoiceId': 1 });
SupplierPaymentSchema.index({ organizationId: 1, paidOn: -1, _id: -1 });
SupplierPaymentSchema.index(
  { organizationId: 1, number: 1 },
  { unique: true, name: 'supplier_payment_number_unique' },
);
