// Fenêtre de ré-authentification (ADR-0013 §5).
//
// Une ligne par (utilisateur, session) ayant re-saisi son mot de passe. Aucun
// mot de passe, aucun jeton : uniquement l'EMPREINTE de la session et une date
// d'expiration. Un vidage de cette collection ne donne rien à un attaquant — il
// n'y a rien à rejouer, seulement à constater qui a écrit et quand, ce que
// l'audit dit déjà mieux.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ collection: 'platform_reauth', timestamps: true, strict: true })
export class PlatformReauth {
  @Prop({ type: String, required: true, index: true })
  userId!: string;

  /** SHA-256 du jeton de session. Jamais le jeton lui-même. */
  @Prop({ type: String, required: true })
  sessionFingerprint!: string;

  @Prop({ type: Date, required: true })
  confirmedAt!: Date;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type PlatformReauthDocument = HydratedDocument<PlatformReauth>;
export const PlatformReauthSchema = SchemaFactory.createForClass(PlatformReauth);

PlatformReauthSchema.index({ userId: 1, sessionFingerprint: 1 }, { unique: true });

// Purge automatique deux heures après expiration. Le TTL est un CONFORT de
// nettoyage, jamais le contrôle : `assertRecent` filtre sur `expiresAt` à chaque
// appel, sans quoi le délai de balayage de MongoDB (jusqu'à 60 s) prolongerait
// silencieusement chaque fenêtre.
PlatformReauthSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7200 });
