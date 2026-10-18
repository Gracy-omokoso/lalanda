// Journal des échanges avec l'e-MCF — ADR-0021 §6.
//
// En ajout seul : aucun code ne met à jour ni ne supprime un échange, et aucune
// purge n'existe (la DGI exige de conserver la date, la requête et la réponse de
// chaque échange). JAMAIS d'en-tête : l'en-tête `Authorization` porte le jeton
// du contribuable. Le corps de réponse est tronqué à 32 Kio et passé par la
// rédaction avant écriture (`edef-exchange.journal.ts`).

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ collection: 'edef_exchanges', timestamps: false, strict: true })
export class EdefExchange {
  @Prop({ type: Date, required: true })
  at!: Date;

  @Prop({ type: String, default: null })
  organizationId!: string | null;

  @Prop({ type: String, default: null })
  pointOfSaleId!: string | null;

  @Prop({ type: String, required: true, enum: ['test', 'production'] })
  environment!: 'test' | 'production';

  @Prop({ type: String, required: true })
  method!: string;

  @Prop({ type: String, required: true })
  path!: string;

  @Prop({ type: Number, default: null })
  httpStatus!: number | null;

  @Prop({ type: Number, required: true })
  durationMs!: number;

  /** `ok` ou un `EdefFailureKind`. */
  @Prop({ type: String, required: true })
  outcome!: string;

  @Prop({ type: String, default: null })
  dgiErrorCode!: string | null;

  /** `null` pour un GET. */
  @Prop({ type: String, default: null })
  requestBody!: string | null;

  @Prop({ type: String, default: null })
  responseBody!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type EdefExchangeDocument = HydratedDocument<EdefExchange>;
export const EdefExchangeSchema = SchemaFactory.createForClass(EdefExchange);
EdefExchangeSchema.index({ organizationId: 1, at: -1 });
