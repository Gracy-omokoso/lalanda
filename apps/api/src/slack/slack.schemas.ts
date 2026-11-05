// Collections de l'intégration Slack — ADR-0064 § 2 et § 3.
//
// AUCUNE ne porte de jeton : le jeton du bot vit chiffré dans `organization_secrets`
// (nature `slack_bot_token`, AAD liée à l'organisation). Toutes sont scopées par
// `organizationId`, et chaque lecture du module filtre par l'organisation de l'appelant.

import { SLACK_CONNECTION_STATUSES, type SlackConnectionStatus } from '@lalanda/shared/work';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

/** Connexion d'UNE organisation à SON espace Slack (une au plus par organisation). */
@Schema({ collection: 'slack_connections', timestamps: true, strict: true, minimize: false })
export class SlackConnection {
  @Prop({ type: String, required: true })
  organizationId!: string;

  /** Espace Slack (équipe) : identifiant et nom affiché. */
  @Prop({ type: String, required: true })
  teamId!: string;

  @Prop({ type: String, required: true })
  teamName!: string;

  @Prop({ type: String, default: null })
  appId!: string | null;

  @Prop({ type: String, default: null })
  botUserId!: string | null;

  @Prop({ type: [String], default: [] })
  scopes!: string[];

  @Prop({ type: String, required: true, enum: SLACK_CONNECTION_STATUSES as unknown as string[] })
  status!: SlackConnectionStatus;

  /** Code Slack (ou événement) qui a coupé la connexion — diagnostic, jamais de contenu. */
  @Prop({ type: String, default: null })
  statusReason!: string | null;

  @Prop({ type: Date, default: null })
  statusChangedAt!: Date | null;

  @Prop({ type: String, required: true })
  connectedByUserId!: string;

  @Prop({ type: Date, required: true })
  connectedAt!: Date;

  /** Compteurs d'envoi : messages remis, destinataires introuvables, échecs. */
  @Prop({ type: Object, default: () => ({ sent: 0, unmatched: 0, failed: 0 }) })
  stats!: { sent: number; unmatched: number; failed: number };

  @Prop({ type: String, default: null })
  lastErrorCode!: string | null;

  @Prop({ type: Date, default: null })
  lastErrorAt!: Date | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type SlackConnectionDocument = HydratedDocument<SlackConnection>;
export type SlackConnectionLean = SlackConnection & { _id: Types.ObjectId };
export const SlackConnectionSchema = SchemaFactory.createForClass(SlackConnection);
SlackConnectionSchema.index({ organizationId: 1 }, { unique: true });
// Événements Slack (`app_uninstalled`, `tokens_revoked`) : retrouvés par espace.
SlackConnectionSchema.index({ teamId: 1 });

/**
 * Correspondance membre Lalanda → membre Slack, mise en CACHE avec expiration
 * (`users.lookupByEmail` est limité en débit). `slackUserId: null` = introuvable,
 * gardé moins longtemps. `emailKey` (empreinte de l'adresse) invalide l'entrée quand
 * l'adresse change ; l'adresse elle-même n'est pas recopiée.
 */
@Schema({ collection: 'slack_user_links', timestamps: true, strict: true })
export class SlackUserLink {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  teamId!: string;

  @Prop({ type: String, required: true })
  userId!: string;

  @Prop({ type: String, required: true })
  emailKey!: string;

  @Prop({ type: String, default: null })
  slackUserId!: string | null;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;
}

export type SlackUserLinkDocument = HydratedDocument<SlackUserLink>;
export type SlackUserLinkLean = SlackUserLink & { _id: Types.ObjectId };
export const SlackUserLinkSchema = SchemaFactory.createForClass(SlackUserLink);
SlackUserLinkSchema.index({ organizationId: 1, userId: 1 }, { unique: true });
SlackUserLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/** Canal Slack d'un projet (facultatif) — ADR-0064 § 3. */
@Schema({ collection: 'slack_project_channels', timestamps: true, strict: true })
export class SlackProjectChannel {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  projectId!: string;

  @Prop({ type: String, required: true })
  channelId!: string;

  @Prop({ type: String, default: null })
  channelName!: string | null;

  /** Publication confirmée pour un projet PRIVÉ (« tout le canal verra »). */
  @Prop({ type: Boolean, default: false })
  privateConfirmed!: boolean;

  @Prop({ type: String, required: true })
  setByUserId!: string;

  @Prop({ type: Date, required: true })
  setAt!: Date;
}

export type SlackProjectChannelDocument = HydratedDocument<SlackProjectChannel>;
export type SlackProjectChannelLean = SlackProjectChannel & { _id: Types.ObjectId };
export const SlackProjectChannelSchema = SchemaFactory.createForClass(SlackProjectChannel);
SlackProjectChannelSchema.index({ organizationId: 1, projectId: 1 }, { unique: true });
