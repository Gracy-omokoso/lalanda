// Collections `sales_orders` et `sales_order_counters` — ADR-0050 § 2.2. ADR-0050 — V2.
//
// Une COMMANDE CLIENT est un document distinct du devis et de la facture : le client
// commande, avec sa propre référence, des lignes qu'on facture en une ou plusieurs
// fois. Client, lignes et montants ont EXACTEMENT les formes du devis (ADR-0035 § 1),
// composées par le code des factures ; chaque ligne porte un `lineRef` stable.
//
// Une seule commande VIVANTE (non annulée) par devis : `liveQuoteId` vaut l'identifiant
// du devis tant que la commande n'est pas annulée, `null` sinon, sous index unique
// partiel. Le reste à facturer est DÉRIVÉ à la lecture (moteur `orderInvoicing`).

import { SALES_ORDER_STATUSES, type SalesOrderStatus } from '@lalanda/shared/sales-contracts';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

import type { StoredCustomer, StoredDocumentAmounts } from '../../invoices/invoice.types.js';
import type { EngagementLine } from '../common/engagement-document.js';

export type SalesOrderSource =
  | { kind: 'quote'; quoteId: string; quoteVersion: number }
  | { kind: 'contract'; contractId: string };

/** Geste daté et motivé (clôture, annulation). */
export interface SalesOrderStep {
  at: Date;
  by: string;
  reason: string;
}

@Schema({ collection: 'sales_orders', timestamps: true, strict: true, minimize: false })
export class SalesOrder {
  @Prop({ type: String, required: true })
  organizationId!: string;

  /** `CC{AA}{MM}-NNNNNN` — hors série fiscale, trous admis. */
  @Prop({ type: String, required: true })
  number!: string;

  @Prop({ type: String, required: true, enum: [...SALES_ORDER_STATUSES] })
  status!: SalesOrderStatus;

  /** Client de l'organisation (obligatoire, décision ouverte n° 20). */
  @Prop({ type: String, required: true })
  customerId!: string;

  /** Numéro du bon de commande du client. */
  @Prop({ type: String, default: null })
  customerReference!: string | null;

  /** Date de la commande du client, `AAAA-MM-JJ`. */
  @Prop({ type: String, required: true })
  orderedOn!: string;

  @Prop({ type: Object, default: null })
  source!: SalesOrderSource | null;

  /** Devis source tant que la commande n'est pas annulée (index unique partiel). */
  @Prop({ type: String, default: null })
  liveQuoteId!: string | null;

  @Prop({ type: String, default: null })
  opportunityId!: string | null;

  @Prop({ type: String, required: true, enum: ['CDF', 'USD'] })
  currency!: 'CDF' | 'USD';

  @Prop({ type: String, required: true, enum: ['ttc', 'ht'] })
  priceMode!: 'ttc' | 'ht';

  @Prop({ type: Object, required: true })
  customer!: StoredCustomer;

  @Prop({ type: [Object], default: [] })
  lines!: EngagementLine[];

  @Prop({ type: Object, required: true })
  documentAmounts!: StoredDocumentAmounts;

  @Prop({ type: String, default: null })
  requestedDeliveryDate!: string | null;

  @Prop({ type: String, default: null })
  notes!: string | null;

  @Prop({ type: Date, default: null })
  confirmedAt!: Date | null;

  @Prop({ type: String, default: null })
  confirmedBy!: string | null;

  @Prop({ type: Object, default: null })
  closure!: SalesOrderStep | null;

  @Prop({ type: Object, default: null })
  cancellation!: SalesOrderStep | null;

  @Prop({ type: String, required: true })
  searchKey!: string;

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

export type SalesOrderDocument = HydratedDocument<SalesOrder>;
export type SalesOrderLean = SalesOrder & { _id: Types.ObjectId };
export const SalesOrderSchema = SchemaFactory.createForClass(SalesOrder);
SalesOrderSchema.index({ organizationId: 1, createdAt: -1, _id: -1 });
SalesOrderSchema.index({ organizationId: 1, number: 1 }, { unique: true });
SalesOrderSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
SalesOrderSchema.index({ organizationId: 1, customerId: 1, createdAt: -1 });
SalesOrderSchema.index(
  { organizationId: 1, liveQuoteId: 1 },
  { unique: true, partialFilterExpression: { liveQuoteId: { $type: 'string' } } },
);

/** Compteur annuel des commandes clients (Kinshasa) ; trous admis. */
@Schema({ collection: 'sales_order_counters', strict: true })
export class SalesOrderCounter {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: Number, required: true })
  year!: number;

  @Prop({ type: Number, required: true, default: 0 })
  last!: number;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type SalesOrderCounterDocument = HydratedDocument<SalesOrderCounter>;
export const SalesOrderCounterSchema = SchemaFactory.createForClass(SalesOrderCounter);
SalesOrderCounterSchema.index({ organizationId: 1, year: 1 }, { unique: true });
