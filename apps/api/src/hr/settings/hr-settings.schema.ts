// Réglages RH — un document par organisation (ADR-0045 § 2.2). ADR-0045 — H2.
//
// Le lot H2 LIT ces réglages et applique les valeurs par défaut de
// `HR_SETTINGS_DEFAULTS` tant que rien n'est enregistré : aucun document n'est créé
// à la lecture. Le schéma est souple (`strict: false`) : l'écriture des réglages
// viendra avec leurs écrans, et un champ inconnu ou invalide retombe sur sa valeur
// par défaut plutôt que de faire échouer une lecture.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ collection: 'hr_settings', timestamps: true, strict: false })
export class HrSettings {
  @Prop({ type: String, required: true, unique: true })
  organizationId!: string;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  // ADR-0051 — H10 : notes de frais et avances (§ 2.7). Lus et VÉRIFIÉS par
  // `hr/expenses/hr-expenses-settings.service.ts` (défauts prudents à la lecture : avance
  // sur salaire et régularisation déclarée éteintes, aucun plafond, aucun seuil).
  @Prop({ type: Object })
  expenses?: Record<string, unknown>;

  @Prop({ type: Object })
  advances?: Record<string, unknown>;
}

export type HrSettingsDocument = HydratedDocument<HrSettings>;
export const HrSettingsSchema = SchemaFactory.createForClass(HrSettings);
