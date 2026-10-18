// Point de vente e-MCF — ADR-0021 §4.1.
//
// Le jeton e-MCF est lié à UN e-MCF (un point de vente), pas au contribuable :
// une organisation à deux points de vente a deux jetons. Le jeton n'est JAMAIS
// ici : il vit dans le coffre de portée organisation (`ORGANIZATION_SECRETS`,
// `ownerId` = `_id` de ce document).
//
// Pas de suppression : retirer un point de vente le désactive et détruit son
// jeton ; le document reste, parce que les factures des lots suivants le
// référenceront.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ _id: false, strict: true })
export class EmcfDgiSnapshot {
  @Prop({ type: String, default: null })
  nif!: string | null;

  @Prop({ type: String, default: null })
  nim!: string | null;

  @Prop({ type: Date, required: true })
  tokenValidUntil!: Date;

  @Prop({ type: String, default: null })
  emcfStatus!: string | null;

  @Prop({ type: String, default: null })
  shopName!: string | null;

  @Prop({ type: [String], default: [] })
  address!: string[];

  @Prop({ type: [String], default: [] })
  contacts!: string[];

  @Prop({ type: String, default: null })
  apiVersion!: string | null;

  @Prop({ type: Date, required: true })
  checkedAt!: Date;
}
const EmcfDgiSnapshotSchema = SchemaFactory.createForClass(EmcfDgiSnapshot);

@Schema({ _id: false, strict: true })
export class EmcfLastTest {
  @Prop({ type: Date, required: true })
  at!: Date;

  @Prop({ type: Boolean, required: true })
  ok!: boolean;

  @Prop({ type: String, default: null })
  code!: string | null;

  /** Assaini : jamais le jeton. */
  @Prop({ type: String, required: true })
  message!: string;
}
const EmcfLastTestSchema = SchemaFactory.createForClass(EmcfLastTest);

@Schema({ collection: 'emcf_points_of_sale', timestamps: true, strict: true })
export class EmcfPointOfSale {
  @Prop({ type: String, required: true })
  organizationId!: string;

  /** Fixé à la création. */
  @Prop({ type: String, required: true, enum: ['test', 'production'] })
  environment!: 'test' | 'production';

  @Prop({ type: String, required: true })
  label!: string;

  @Prop({ type: String, default: null })
  expectedNim!: string | null;

  @Prop({ type: Boolean, required: true, default: true })
  enabled!: boolean;

  /** Dernier relevé DGI VALIDÉ ; `null` tant qu'aucun test n'a réussi. */
  @Prop({ type: EmcfDgiSnapshotSchema, default: null })
  dgi!: EmcfDgiSnapshot | null;

  @Prop({ type: EmcfLastTestSchema, default: null })
  lastTest!: EmcfLastTest | null;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export type EmcfPointOfSaleDocument = HydratedDocument<EmcfPointOfSale>;
export const EmcfPointOfSaleSchema = SchemaFactory.createForClass(EmcfPointOfSale);
EmcfPointOfSaleSchema.index({ organizationId: 1, environment: 1 });
// Un e-MCF n'appartient qu'à UNE organisation Lalanda (409 EMCF_ALREADY_REGISTERED).
EmcfPointOfSaleSchema.index(
  { environment: 1, 'dgi.nim': 1 },
  { unique: true, partialFilterExpression: { 'dgi.nim': { $type: 'string' } } },
);
