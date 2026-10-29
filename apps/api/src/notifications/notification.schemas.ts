// Collections de la boîte de notifications in-app (ADR-0039 § 2.11).
//
//   notifications              une ligne par (destinataire, événement), expirée par index TTL
//   notification_preferences   un document par (organisation, utilisateur) : types coupés
//
// Le titre est FIGÉ à l'émission : il n'est jamais recalculé à la lecture. Ce qui
// est revérifié à la lecture, c'est `requiredAction` (le destinataire doit encore
// la détenir pour voir la ligne).

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import {
  NOTIFICATION_KINDS,
  NOTIFICATION_SOURCE_MODULES,
  type NotificationKind,
  type NotificationSource,
} from '@lalanda/shared/notifications';

@Schema({ collection: 'notifications', timestamps: true, strict: true })
export class Notification {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  recipientUserId!: string;

  @Prop({ type: String, required: true, enum: NOTIFICATION_KINDS as unknown as string[] })
  kind!: NotificationKind;

  /** Action RBAC que le destinataire doit ENCORE détenir pour voir la ligne. */
  @Prop({ type: String, required: true })
  requiredAction!: string;

  @Prop({
    type: {
      _id: false,
      module: {
        type: String,
        required: true,
        enum: NOTIFICATION_SOURCE_MODULES as unknown as string[],
      },
      entityType: { type: String, required: true, enum: ['task', 'project'] },
      entityId: { type: String, required: true },
      projectId: { type: String, required: false },
    },
    required: true,
  })
  source!: NotificationSource;

  /** ≤ 200 caractères, figé à l'émission. */
  @Prop({ type: String, required: true })
  title!: string;

  /** Chemin relatif de l'application (`isNotificationHref`). */
  @Prop({ type: String, required: true })
  href!: string;

  /** `null` pour un rappel automatique. */
  @Prop({ type: String, default: null })
  actorUserId!: string | null;

  /** Facultatif : unique par (organisation, destinataire) — index partiel. */
  @Prop({ type: String, required: false })
  dedupeKey?: string;

  @Prop({ type: Date, default: null })
  readAt!: Date | null;

  /**
   * Expiration : `createdAt` + `NOTIFICATIONS_RETENTION_DAYS` (180 jours par
   * défaut). L'index TTL porte sur ce champ, et non sur `createdAt` avec un
   * `expireAfterSeconds` calculé : changer la durée ne crée ainsi aucun conflit
   * d'options d'index au démarrage (motif de `morning_brief_ai_logs`).
   */
  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}
export type NotificationDocument = HydratedDocument<Notification>;
export const NotificationSchema = SchemaFactory.createForClass(Notification);
/** Liste, compteur de non lues, « tout marquer comme lu » (ADR-0039 § 2.11). */
NotificationSchema.index({ recipientUserId: 1, organizationId: 1, readAt: 1, createdAt: -1 });
/** Liste complète triée (curseur `createdAt`, `_id`). */
NotificationSchema.index({ recipientUserId: 1, organizationId: 1, createdAt: -1, _id: -1 });
/** Déduplication : une seule notification par clé et par destinataire. */
NotificationSchema.index(
  { organizationId: 1, recipientUserId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);
/** Conservation : la ligne disparaît passé `expiresAt`. */
NotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

@Schema({ collection: 'notification_preferences', timestamps: true, strict: true })
export class NotificationPreferences {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  userId!: string;

  /** Types coupés. Absence de document = rien de coupé. */
  @Prop({ type: [String], required: true, default: [] })
  mutedKinds!: NotificationKind[];

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}
export type NotificationPreferencesDocument = HydratedDocument<NotificationPreferences>;
export const NotificationPreferencesSchema = SchemaFactory.createForClass(NotificationPreferences);
NotificationPreferencesSchema.index({ organizationId: 1, userId: 1 }, { unique: true });
