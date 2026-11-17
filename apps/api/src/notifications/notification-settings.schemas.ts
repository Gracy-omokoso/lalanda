// Collections des réglages de notification et du journal d'envoi — ADR-0079 § 4 à § 6.
//
//   notification_settings       un document par (organisation, personne) : mode choisi,
//                               surcharges PAR MODE, « mes propres actions », heures calmes
//   notification_org_settings   un document par organisation : modes par défaut,
//                               obligations, plafond quotidien WhatsApp
//   notification_deliveries     une ligne par (notification, destinataire) : le sort de
//                               chaque canal ; ni titre ni contenu ; expiration 90 jours
//
// Les clés des surcharges sont les types ENCODÉS (`work:task_assigned`) : MongoDB lit
// un point comme un chemin. Tout est ADDITIF : aucune collection existante n'est
// modifiée ; `work_notification_preferences` et `notification_preferences` restent
// lues (conversion paresseuse, § 4.3) et ne sont jamais vidées.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

/** `work.task_assigned` → `work:task_assigned` (clé de document). */
export function encodeKind(kind: string): string {
  return kind.replace(/\./g, ':');
}
/** Inverse d'`encodeKind`. */
export function decodeKind(key: string): string {
  return key.replace(/:/g, '.');
}

export type StoredOverrides = Record<string, Record<string, Partial<Record<string, boolean>>>>;

@Schema({ collection: 'notification_settings', timestamps: true, strict: true, minimize: false })
export class NotificationSettingsDoc {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  userId!: string;

  /** `null` : défaut de l'organisation pour le rôle (§ 4.1). */
  @Prop({ type: String, default: null })
  mode!: string | null;

  /** `{ <mode>: { <type encodé>: { bell?, email?, slack?, whatsapp? } } }`. */
  @Prop({ type: Object, default: {} })
  overrides!: StoredOverrides;

  @Prop({ type: Boolean, default: false })
  notifyOwnActions!: boolean;

  @Prop({ type: Object, default: null })
  quietHours!: { enabled: boolean; start: number; end: number } | null;

  /** `adr-0061` : converti depuis les préférences des Projets (§ 4.3). */
  @Prop({ type: String, default: null })
  migratedFrom!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}
export type NotificationSettingsDocument = HydratedDocument<NotificationSettingsDoc>;
export type NotificationSettingsLean = NotificationSettingsDoc & { _id: Types.ObjectId };
export const NotificationSettingsSchema = SchemaFactory.createForClass(NotificationSettingsDoc);
NotificationSettingsSchema.index({ organizationId: 1, userId: 1 }, { unique: true });

@Schema({ collection: 'notification_org_settings', timestamps: true, strict: true, minimize: false })
export class NotificationOrgSettingsDoc {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  projectLeadMode!: string;

  @Prop({ type: String, required: true })
  memberMode!: string;

  @Prop({ type: Object, default: {} })
  byRole!: Record<string, string>;

  @Prop({ type: [{ _id: false, kind: String, channel: String }], default: [] })
  mandatory!: { kind: string; channel: string }[];

  @Prop({ type: Number, required: true })
  whatsappDailyCap!: number;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, default: null })
  updatedBy!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}
export type NotificationOrgSettingsDocument = HydratedDocument<NotificationOrgSettingsDoc>;
export type NotificationOrgSettingsLean = NotificationOrgSettingsDoc & { _id: Types.ObjectId };
export const NotificationOrgSettingsSchema = SchemaFactory.createForClass(
  NotificationOrgSettingsDoc,
);
NotificationOrgSettingsSchema.index({ organizationId: 1 }, { unique: true });

export interface StoredChannelOutcome {
  status: string;
  reason: string | null;
  at: Date;
}

@Schema({ collection: 'notification_deliveries', timestamps: false, strict: true, minimize: false })
export class NotificationDeliveryDoc {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  userId!: string;

  @Prop({ type: String, required: true })
  kind!: string;

  @Prop({ type: String, required: true })
  module!: string;

  /** Identifiant de l'objet (tâche, projet…) : regroupement des rafales. Jamais un titre. */
  @Prop({ type: String, default: null })
  entityId!: string | null;

  @Prop({ type: String, default: null })
  projectId!: string | null;

  @Prop({ type: Object, default: {} })
  channels!: Record<string, StoredChannelOutcome>;

  @Prop({ type: Boolean, default: false })
  test!: boolean;

  @Prop({ type: Date, required: true })
  createdAt!: Date;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type NotificationDeliveryDocument = HydratedDocument<NotificationDeliveryDoc>;
export type NotificationDeliveryLean = NotificationDeliveryDoc & { _id: Types.ObjectId };
export const NotificationDeliverySchema = SchemaFactory.createForClass(NotificationDeliveryDoc);
/** Journal de la personne (récent d'abord). */
NotificationDeliverySchema.index({ organizationId: 1, userId: 1, createdAt: -1, _id: -1 });
/** Journal de l'organisation (administration). */
NotificationDeliverySchema.index({ organizationId: 1, createdAt: -1, _id: -1 });
/** Rafales : même personne, même type, même objet, fenêtre courte. */
NotificationDeliverySchema.index({ organizationId: 1, userId: 1, kind: 1, entityId: 1, createdAt: -1 });
/** Conservation bornée (90 jours). */
NotificationDeliverySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
