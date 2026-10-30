// Collection `purchase_orders` — demandes d'achat puis bons de commande
// (ADR-0044 § 2.3). ADR-0044 — P3.
//
// Un seul document, deux phases (O1) : `phase: 'request'` (brouillon, soumise,
// approuvée ou refusée), puis `phase: 'order'` à l'approbation complète (numéro
// `BC`). Isolation : chaque document porte `organizationId` ; une demande d'une
// autre organisation est introuvable (404). Les montants (`totals`, `lines.amount`)
// sont ceux rendus par le moteur (`computeOrderTotals`), recalculés à chaque
// écriture ; les taxes sont DÉCLARÉES par le fournisseur, jamais calculées (§ 9).
//
// `partially_received` et `received` sont DÉRIVÉS des réceptions par le moteur
// (`orderReceptionStatus`) et dénormalisés par le lot P4 dans sa transaction.

import type {
  PurchaseApprovalCount,
  PurchaseApprovalDecisionValue,
  PurchaseCurrency,
  PurchaseLineKind,
  PurchaseOrderPhase,
  PurchaseOrderSentVia,
  PurchaseOrderStatus,
} from '@lalanda/shared/purchases';
import {
  PURCHASE_LINE_KINDS,
  PURCHASE_ORDER_PHASES,
  PURCHASE_ORDER_STATUSES,
} from '@lalanda/shared/purchases';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({ _id: false, strict: true })
export class PurchaseOrderLine {
  @Prop({ type: String, required: true })
  id!: string;

  @Prop({ type: String, required: true })
  label!: string;

  @Prop({ type: String, required: true })
  quantity!: string;

  @Prop({ type: String, default: null })
  unit!: string | null;

  @Prop({ type: String, required: true })
  unitPrice!: string;

  @Prop({ type: String, default: null })
  discountPercent!: string | null;

  @Prop({ type: String, required: true, enum: PURCHASE_LINE_KINDS })
  kind!: PurchaseLineKind;

  @Prop({ type: Boolean, required: true })
  receivable!: boolean;

  @Prop({ type: String, default: null })
  category!: string | null;

  @Prop({ type: String, default: null })
  workProjectId!: string | null;

  @Prop({ type: String, default: null })
  itemRef!: string | null;

  /** Montant HT de la ligne, rendu par le moteur. */
  @Prop({ type: String, required: true })
  amount!: string;
}
const PurchaseOrderLineSchema = SchemaFactory.createForClass(PurchaseOrderLine);

@Schema({ _id: false, strict: true })
export class PurchaseDeclaredTax {
  @Prop({ type: String, required: true })
  label!: string;

  @Prop({ type: String, required: true })
  amount!: string;
}
const PurchaseDeclaredTaxSchema = SchemaFactory.createForClass(PurchaseDeclaredTax);

@Schema({ _id: false, strict: true })
export class PurchaseOrderTotals {
  @Prop({ type: String, required: true })
  subtotal!: string;

  @Prop({ type: String, required: true })
  taxes!: string;

  @Prop({ type: String, required: true })
  total!: string;

  /** Version du moteur qui a rendu ces totaux (`PURCHASES_VERSION`). */
  @Prop({ type: String, required: true })
  engineVersion!: string;
}
const PurchaseOrderTotalsSchema = SchemaFactory.createForClass(PurchaseOrderTotals);

@Schema({ _id: false, strict: true })
export class PurchaseApproval {
  @Prop({ type: String, required: true })
  userId!: string;

  @Prop({ type: String, required: true, enum: ['approved', 'rejected'] })
  decision!: PurchaseApprovalDecisionValue;

  @Prop({ type: Date, required: true })
  at!: Date;

  @Prop({ type: String, default: null })
  comment!: string | null;

  @Prop({ type: Boolean, required: true, default: false })
  soleApprover!: boolean;
}
const PurchaseApprovalSchema = SchemaFactory.createForClass(PurchaseApproval);

@Schema({ _id: false, strict: true })
export class PurchaseOrderCancellation {
  @Prop({ type: Date, required: true })
  at!: Date;

  @Prop({ type: String, required: true })
  by!: string;

  @Prop({ type: String, required: true })
  reason!: string;
}
const PurchaseOrderCancellationSchema = SchemaFactory.createForClass(PurchaseOrderCancellation);

@Schema({ collection: 'purchase_orders', timestamps: true, strict: true, minimize: false })
export class PurchaseOrder {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true, enum: PURCHASE_ORDER_PHASES })
  phase!: PurchaseOrderPhase;

  @Prop({ type: String, required: true, enum: PURCHASE_ORDER_STATUSES })
  status!: PurchaseOrderStatus;

  @Prop({ type: String, default: null })
  requestNumber!: string | null;

  @Prop({ type: String, default: null })
  orderNumber!: string | null;

  @Prop({ type: String, required: true })
  requestedBy!: string;

  @Prop({ type: String, required: true })
  title!: string;

  @Prop({ type: String, default: null })
  justification!: string | null;

  @Prop({ type: String, default: null })
  supplierId!: string | null;

  /** Copie d'affichage du nom de la fiche, posée à chaque écriture. */
  @Prop({ type: String, default: null })
  supplierName!: string | null;

  @Prop({ type: String, required: true, enum: ['CDF', 'USD'] })
  currency!: PurchaseCurrency;

  @Prop({ type: [PurchaseOrderLineSchema], required: true })
  lines!: PurchaseOrderLine[];

  @Prop({ type: [PurchaseDeclaredTaxSchema], default: [] })
  declaredTaxes!: PurchaseDeclaredTax[];

  @Prop({ type: PurchaseOrderTotalsSchema, required: true })
  totals!: PurchaseOrderTotals;

  @Prop({ type: String, default: null })
  expectedOn!: string | null;

  @Prop({ type: String, default: null })
  deliveryAddress!: string | null;

  /** Figé à la soumission par le moteur (`requiredApprovals`) ; `null` en brouillon. */
  @Prop({ type: Number, default: null })
  requiredApprovals!: PurchaseApprovalCount | null;

  @Prop({ type: [PurchaseApprovalSchema], default: [] })
  approvals!: PurchaseApproval[];

  @Prop({ type: String, default: null })
  approvedTotal!: string | null;

  @Prop({ type: Date, default: null })
  submittedAt!: Date | null;

  /** Jour de soumission (Kinshasa) : échéance de l'élément « Approbation ». */
  @Prop({ type: String, default: null })
  submittedOn!: string | null;

  @Prop({ type: Date, default: null })
  approvedAt!: Date | null;

  @Prop({ type: Date, default: null })
  sentAt!: Date | null;

  @Prop({ type: String, default: null, enum: [null, 'email', 'manual'] })
  sentVia!: PurchaseOrderSentVia | null;

  @Prop({ type: PurchaseOrderCancellationSchema, default: null })
  cancellation!: PurchaseOrderCancellation | null;

  @Prop({ type: Date, default: null })
  closedAt!: Date | null;

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

export type PurchaseOrderDocument = HydratedDocument<PurchaseOrder>;
export type PurchaseOrderLean = PurchaseOrder & { _id: Types.ObjectId };
export const PurchaseOrderSchema = SchemaFactory.createForClass(PurchaseOrder);

// § 2.3 : listes par statut, fournisseur, demandeur ; commandes d'un projet ;
// numéros uniques par organisation.
PurchaseOrderSchema.index({ organizationId: 1, status: 1, updatedAt: -1 });
PurchaseOrderSchema.index({ organizationId: 1, updatedAt: -1, _id: -1 });
PurchaseOrderSchema.index({ organizationId: 1, supplierId: 1, createdAt: -1 });
PurchaseOrderSchema.index({ organizationId: 1, requestedBy: 1, status: 1 });
PurchaseOrderSchema.index(
  { organizationId: 1, 'lines.workProjectId': 1 },
  { partialFilterExpression: { 'lines.workProjectId': { $type: 'string' } } },
);
PurchaseOrderSchema.index(
  { organizationId: 1, requestNumber: 1 },
  { unique: true, partialFilterExpression: { requestNumber: { $type: 'string' } } },
);
PurchaseOrderSchema.index(
  { organizationId: 1, orderNumber: 1 },
  { unique: true, partialFilterExpression: { orderNumber: { $type: 'string' } } },
);
