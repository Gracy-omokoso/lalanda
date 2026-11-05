// Préférences de notification des Projets, par (organisation, utilisateur) —
// ADR-0061 § 2. Sans document : défauts de `defaultWorkNotificationPreferences()`.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({
  collection: 'work_notification_preferences',
  timestamps: true,
  strict: true,
  minimize: false,
})
export class WorkNotificationPreferencesDoc {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  userId!: string;

  /** `{ <événement>: { bell, email } }` — complété par les défauts à la lecture. */
  @Prop({ type: Object, default: {} })
  events!: Record<string, { bell: boolean; email: boolean }>;

  @Prop({ type: Object, default: {} })
  digest!: { enabled?: boolean; hour?: number; workingDaysOnly?: boolean };

  /** Jour de Kinshasa du dernier résumé RÉCLAMÉ (au plus un par jour). */
  @Prop({ type: String, default: null })
  digestLastSentOn!: string | null;

  /** Index partiel du résumé (`digest.enabled`), dénormalisé pour la tâche récurrente. */
  @Prop({ type: Boolean, default: false })
  digestEnabled!: boolean;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type WorkNotificationPreferencesDocument = HydratedDocument<WorkNotificationPreferencesDoc>;
export type WorkNotificationPreferencesLean = WorkNotificationPreferencesDoc & {
  _id: Types.ObjectId;
};
export const WorkNotificationPreferencesSchema = SchemaFactory.createForClass(
  WorkNotificationPreferencesDoc,
);
WorkNotificationPreferencesSchema.index({ organizationId: 1, userId: 1 }, { unique: true });
WorkNotificationPreferencesSchema.index({ digestEnabled: 1, digestLastSentOn: 1 });
