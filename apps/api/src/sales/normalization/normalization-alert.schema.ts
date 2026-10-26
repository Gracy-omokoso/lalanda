// Collection `normalization_alerts` — alertes e-mail de la normalisation DGI
// (ADR-0024, décision ouverte n° 3, amendement du 21 oct. 2026).
//
// Une ligne par alerte DÉCIDÉE : elle sert de verrou de dédoublonnage (index
// unique) et de journal (destinataires, remises). Seul écrivain :
// `NormalizationAlertsService`.
//
// Dédoublonnage : { organisation, cause, sujet, fenêtre }. La fenêtre (`bucket`)
// est choisie par la cause — l'heure pleine de l'événement (refus de jeton,
// numéro abandonné), ou le début de l'épisode (incertitude, expiration du
// jeton) : jamais plus d'une alerte par cause et par sujet dans l'heure, et une
// seule par épisode quand l'état dure.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import type { NormalizationAlertCause } from '../../mail/mail.templates.js';

export const NORMALIZATION_ALERT_CAUSES: readonly NormalizationAlertCause[] = [
  'normalization_uncertain',
  'number_abandoned',
  'token_rejected',
  'token_expired',
];

@Schema({ collection: 'normalization_alerts', timestamps: false, strict: true })
export class NormalizationAlert {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true, enum: NORMALIZATION_ALERT_CAUSES as unknown as string[] })
  cause!: NormalizationAlertCause;

  /** `sales_invoice` ou `point_of_sale`. */
  @Prop({ type: String, required: true, enum: ['sales_invoice', 'point_of_sale'] })
  subjectType!: 'sales_invoice' | 'point_of_sale';

  @Prop({ type: String, required: true })
  subjectId!: string;

  /** Fenêtre de dédoublonnage (voir l'en-tête). */
  @Prop({ type: Date, required: true })
  bucket!: Date;

  /** Instant qui date l'alerte (début de l'incertitude, abandon, refus, expiration). */
  @Prop({ type: Date, required: true })
  since!: Date;

  /** Décision d'envoi. */
  @Prop({ type: Date, required: true })
  at!: Date;

  /** Administrateurs fiscaux trouvés (adresse connue). */
  @Prop({ type: Number, required: true, default: 0 })
  recipients!: number;

  /** Messages remis au transport. */
  @Prop({ type: Number, required: true, default: 0 })
  delivered!: number;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type NormalizationAlertDocument = HydratedDocument<NormalizationAlert>;
export const NormalizationAlertSchema = SchemaFactory.createForClass(NormalizationAlert);

NormalizationAlertSchema.index(
  { organizationId: 1, cause: 1, subjectId: 1, bucket: 1 },
  { unique: true },
);
