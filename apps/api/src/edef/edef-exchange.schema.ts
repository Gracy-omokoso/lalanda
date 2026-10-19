// Journal des échanges avec l'e-MCF — ADR-0021 §6, amendé par ADR-0024 § 6
// (version 2).
//
// En ajout seul : aucun code ne met à jour ni ne supprime un échange, et aucune
// purge n'existe (la DGI exige de conserver la date, la requête et la réponse de
// chaque échange). JAMAIS d'en-tête : l'en-tête `Authorization` porte le jeton
// du contribuable. Les corps sont tronqués à 32 Kio et passés par la rédaction
// avant écriture (`edef-exchange.journal.ts`).
//
// Version 2 (ADR-0024 § 6) : un appel de facturation (`POST`, `confirm`,
// `cancel`) laisse DEUX entrées liées par `exchangeId` — `request`, écrite
// strictement AVANT l'envoi, puis `response`. Une lecture laisse une seule
// entrée `complete`. Les entrées de version 1 (lectures d'avant ce lot) n'ont
// ni `exchangeId` ni `entry` : elles se lisent comme des `complete`.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/** Version courante du document (ADR-0024 § 6). */
export const EDEF_EXCHANGE_SCHEMA_VERSION = 2;

/** Nature d'une entrée du journal (v2). */
export const EDEF_EXCHANGE_ENTRY_KINDS = ['request', 'response', 'complete'] as const;
export type EdefExchangeEntryKind = (typeof EDEF_EXCHANGE_ENTRY_KINDS)[number];

@Schema({ collection: 'edef_exchanges', timestamps: false, strict: true })
export class EdefExchange {
  @Prop({ type: Date, required: true })
  at!: Date;

  /** UUID qui lie l'entrée `request` à son entrée `response` (v2) ; absent en v1. */
  @Prop({ type: String, default: null })
  exchangeId!: string | null;

  /** `request` · `response` · `complete` (v2) ; absent en v1 (= `complete`). */
  @Prop({ type: String, default: null })
  entry!: EdefExchangeEntryKind | null;

  @Prop({ type: String, default: null })
  organizationId!: string | null;

  @Prop({ type: String, default: null })
  pointOfSaleId!: string | null;

  /** Document de vente concerné (`POST`, `confirm`, `cancel`) ; `null` pour une lecture. */
  @Prop({ type: String, default: null })
  invoiceId!: string | null;

  /** Numéro de facture transmis (`rn`). */
  @Prop({ type: String, default: null })
  rn!: string | null;

  /** Identifiant DGI de la demande, dès qu'il est connu. */
  @Prop({ type: String, default: null })
  uid!: string | null;

  @Prop({ type: String, required: true, enum: ['test', 'production'] })
  environment!: 'test' | 'production';

  @Prop({ type: String, required: true })
  method!: string;

  @Prop({ type: String, required: true })
  path!: string;

  @Prop({ type: Number, default: null })
  httpStatus!: number | null;

  /** `null` pour une entrée `request` (rien n'est encore mesuré). */
  @Prop({ type: Number, default: null })
  durationMs!: number | null;

  /** `ok` ou un `EdefFailureKind` ; `null` pour une entrée `request`. */
  @Prop({ type: String, default: null })
  outcome!: string | null;

  @Prop({ type: String, default: null })
  dgiErrorCode!: string | null;

  /** Corps envoyé (entrée `request`) ; `null` pour un GET et pour une entrée `response`. */
  @Prop({ type: String, default: null })
  requestBody!: string | null;

  @Prop({ type: String, default: null })
  responseBody!: string | null;

  @Prop({ type: Number, required: true, default: EDEF_EXCHANGE_SCHEMA_VERSION })
  _schemaVersion!: number;
}

export type EdefExchangeDocument = HydratedDocument<EdefExchange>;
export const EdefExchangeSchema = SchemaFactory.createForClass(EdefExchange);
EdefExchangeSchema.index({ organizationId: 1, at: -1 });
// ADR-0024 § 6 : historique des échanges d'un document, ordre chronologique.
EdefExchangeSchema.index(
  { invoiceId: 1, at: 1 },
  { partialFilterExpression: { invoiceId: { $type: 'string' } } },
);
