// Collection `purchase_counters` — compteurs des pièces internes des achats
// (ADR-0044 § 1, § 2.3 à § 2.6). ADR-0044 — P3.
//
// Un document par `organizationId + kind + year` : `kind` est la nature de la pièce
// (`request` → `DA`, `order` → `BC`, `invoice` → `FF`, `payment` → `PF`). Compteurs
// ANNUELS au jour de Kinshasa, trous admis, HORS série fiscale (motif d'ADR-0035).

import type { PurchaseNumberKind } from '@lalanda/shared/purchases';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ collection: 'purchase_counters', strict: true })
export class PurchaseCounter {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true, enum: ['request', 'order', 'invoice', 'payment'] })
  kind!: PurchaseNumberKind;

  @Prop({ type: Number, required: true })
  year!: number;

  @Prop({ type: Number, required: true, default: 0 })
  last!: number;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type PurchaseCounterDocument = HydratedDocument<PurchaseCounter>;
export const PurchaseCounterSchema = SchemaFactory.createForClass(PurchaseCounter);
PurchaseCounterSchema.index({ organizationId: 1, kind: 1, year: 1 }, { unique: true });
