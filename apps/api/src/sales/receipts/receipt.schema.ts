// Collection `sales_receipts` — encaissements (ADR-0031 § 1).
//
// Un document par argent reçu, lettré sur une ou plusieurs factures finales de
// la même devise. Montants en chaînes décimales (docs/26). Jamais effacé : une
// erreur s'annule (`cancelled`, motif obligatoire), l'historique reste.
//
// Seul écrivain : `ReceiptsService`.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

export const RECEIPT_STATUSES = ['recorded', 'cancelled'] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export interface StoredAllocation {
  invoiceId: string;
  /** Numéro définitif de la facture, recopié pour la lecture et la recherche. */
  invoiceNumber: string | null;
  amount: string;
}

@Schema({ collection: 'sales_receipts', timestamps: true, strict: true, minimize: false })
export class SalesReceipt {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true, enum: RECEIPT_STATUSES as unknown as string[] })
  status!: ReceiptStatus;

  /** Date civile de réception `AAAA-MM-JJ` (Kinshasa). */
  @Prop({ type: String, required: true })
  receivedOn!: string;

  @Prop({ type: String, required: true })
  amount!: string;

  @Prop({ type: String, required: true, enum: ['CDF', 'USD'] })
  currency!: 'CDF' | 'USD';

  @Prop({ type: String, required: true })
  method!: string;

  @Prop({ type: String, default: null })
  reference!: string | null;

  @Prop({ type: String, default: null })
  note!: string | null;

  @Prop({ type: [Object], required: true })
  allocations!: StoredAllocation[];

  /** Factures lettrées (identifiants) : index de lecture du règlement. */
  @Prop({ type: [String], required: true })
  invoiceIds!: string[];

  @Prop({ type: Object, default: null })
  cancellation!: { at: Date; by: string; reason: string } | null;

  /** Version du calcul (`RECEIVABLES_VERSION`) qui a contrôlé l'écriture. */
  @Prop({ type: String, required: true })
  calculationVersion!: string;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type SalesReceiptDocument = HydratedDocument<SalesReceipt>;
export type SalesReceiptLean = SalesReceipt & { _id: Types.ObjectId };
export const SalesReceiptSchema = SchemaFactory.createForClass(SalesReceipt);

SalesReceiptSchema.index({ organizationId: 1, receivedOn: -1, _id: -1 });
SalesReceiptSchema.index({ organizationId: 1, invoiceIds: 1, status: 1 });
