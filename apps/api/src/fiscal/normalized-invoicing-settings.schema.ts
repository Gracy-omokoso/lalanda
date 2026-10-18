// Réglage de la facture normalisée d'une organisation — ADR-0021 §3.
//
// SEUL `NormalizedInvoicingService` écrit cette collection (R4, vérifié par
// `normalized-invoicing.writer.test.ts`). Les autres services la lisent par
// `NormalizedInvoicingStateReader`, qui n'expose aucune écriture.
//
// Aucun document = facture normalisée désactivée, environnement de test.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type NormalizedInvoicingState = 'disabled' | 'enabled';

@Schema({ collection: 'normalized_invoicing_settings', timestamps: true, strict: true })
export class NormalizedInvoicingSettings {
  @Prop({ type: String, required: true, unique: true })
  organizationId!: string;

  @Prop({ type: String, required: true, enum: ['disabled', 'enabled'], default: 'disabled' })
  state!: NormalizedInvoicingState;

  @Prop({ type: String, required: true, enum: ['test', 'production'], default: 'test' })
  environment!: 'test' | 'production';

  /** Posé à la première activation, JAMAIS remis à `null`. */
  @Prop({ type: Date, default: null })
  firstActivatedAt!: Date | null;

  @Prop({ type: Date, default: null })
  activatedAt!: Date | null;

  @Prop({ type: String, default: null })
  activatedBy!: string | null;

  @Prop({ type: Date, default: null })
  deactivatedAt!: Date | null;

  @Prop({ type: String, default: null })
  deactivatedBy!: string | null;

  @Prop({ type: String, default: null })
  deactivationReason!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type NormalizedInvoicingSettingsDocument = HydratedDocument<NormalizedInvoicingSettings>;
export const NormalizedInvoicingSettingsSchema = SchemaFactory.createForClass(
  NormalizedInvoicingSettings,
);
// Recherche « même NIF ailleurs » (R1, nif_elsewhere).
NormalizedInvoicingSettingsSchema.index({ state: 1, environment: 1 });
