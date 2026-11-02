// Collection `sales_document_links` — ADR-0050 § 2.7 (O2). ADR-0050 — V2.
//
// Le lien facture ↔ commande, contrat ou échéance vit CÔTÉ ENGAGEMENT : la facture,
// figée par `contentSha256` et versée au journal électronique, ignore la commande
// comme elle ignore le devis (ADR-0035) et le projet (ADR-0039 O3). Aucun champ n'est
// ajouté à `sales_invoices`.
//
// Une facture appartient à un engagement au plus (index unique). Un brouillon supprimé
// laisse un lien orphelin, ignoré à la lecture et nettoyé au passage (motif
// `work_invoice_links`). Ce lien n'a AUCUN effet fiscal ni comptable : ni la
// comptabilité ni le pont vers le réalisé ne le lisent (§ 4.5).

import {
  SALES_DOCUMENT_LINK_KINDS,
  type SalesDocumentLinkKind,
} from '@lalanda/shared/sales-contracts';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

/** Ligne de facture rattachée à une ligne d'engagement, posée à la préparation. */
export interface SalesDocumentLineMapEntry {
  invoiceLineIndex: number;
  lineRef: string;
  quantity: string;
}

@Schema({ collection: 'sales_document_links', timestamps: false, strict: true })
export class SalesDocumentLink {
  @Prop({ type: String, required: true })
  organizationId!: string;

  /** `sales_invoices` de l'organisation. */
  @Prop({ type: String, required: true })
  invoiceId!: string;

  @Prop({ type: String, required: true, enum: [...SALES_DOCUMENT_LINK_KINDS] })
  kind!: SalesDocumentLinkKind;

  @Prop({ type: String, default: null })
  orderId!: string | null;

  @Prop({ type: String, default: null })
  contractId!: string | null;

  /** Échéance d'un échéancier (`schedule_item`). */
  @Prop({ type: String, default: null })
  itemRef!: string | null;

  /** Date d'occurrence d'un abonnement (`subscription_occurrence`), `AAAA-MM-JJ`. */
  @Prop({ type: String, default: null })
  occurrenceDate!: string | null;

  @Prop({ type: [Object], default: [] })
  lineMap!: SalesDocumentLineMapEntry[];

  /** Acompte seulement : montant demandé (cible), dans la devise du document. */
  @Prop({ type: String, default: null })
  requestedAmount!: string | null;

  @Prop({ type: Date, required: true })
  linkedAt!: Date;

  /** Utilisateur, ou `system:subscriptions` pour la tâche (lot V5). */
  @Prop({ type: String, required: true })
  linkedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type SalesDocumentLinkDocument = HydratedDocument<SalesDocumentLink>;
export type SalesDocumentLinkLean = SalesDocumentLink & { _id: Types.ObjectId };
export const SalesDocumentLinkSchema = SchemaFactory.createForClass(SalesDocumentLink);
SalesDocumentLinkSchema.index({ organizationId: 1, invoiceId: 1 }, { unique: true });
SalesDocumentLinkSchema.index(
  { organizationId: 1, contractId: 1, occurrenceDate: 1 },
  { unique: true, partialFilterExpression: { kind: 'subscription_occurrence' } },
);
SalesDocumentLinkSchema.index(
  { organizationId: 1, contractId: 1, itemRef: 1 },
  { unique: true, partialFilterExpression: { kind: 'schedule_item' } },
);
SalesDocumentLinkSchema.index({ organizationId: 1, orderId: 1, linkedAt: 1 });
SalesDocumentLinkSchema.index({ organizationId: 1, contractId: 1, linkedAt: 1 });
