// Collections de la double authentification de la console (ADR-0053 — P8). Portée
// PLATEFORME : aucune organisation, une ligne par opérateur (et par session vérifiée).
//
// Les modèles déclarent la forme et les INDEX ; les lectures et écritures passent par le
// pilote natif (`two-factor.store.ts`) parce que `PlatformAuthGuard` les lit sur chaque
// requête de console sans injection de modèle.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import { EncryptedValueDoc, EncryptedValueSchema } from '../integrations/integration.schema.js';

export const TWO_FACTOR_COLLECTION = 'platform_two_factor';
export const TWO_FACTOR_SESSIONS_COLLECTION = 'platform_two_factor_sessions';

@Schema({ _id: false })
export class BackupCodeHash {
  /** SHA-256(sel ‖ code). Jamais le code. */
  @Prop({ type: String, required: true })
  hash!: string;

  @Prop({ type: String, required: true })
  salt!: string;

  /** Posé à l'usage : un code ne sert qu'une fois. */
  @Prop({ type: Date, default: null })
  usedAt!: Date | null;
}
export const BackupCodeHashSchema = SchemaFactory.createForClass(BackupCodeHash);

@Schema({ collection: 'platform_two_factor', timestamps: true, strict: true })
export class PlatformTwoFactor {
  @Prop({ type: String, required: true })
  userId!: string;

  /** `pending` : secret remis, code pas encore vérifié. `active` : enrôlé. */
  @Prop({ type: String, required: true, enum: ['pending', 'active'] })
  status!: 'pending' | 'active';

  /** Secret TOTP chiffré sous `SECRETS_MASTER_KEY` (ADR-0013), jamais servi. */
  @Prop({ type: EncryptedValueSchema, required: true })
  secret!: EncryptedValueDoc;

  @Prop({ type: [BackupCodeHashSchema], default: [] })
  backupCodes!: BackupCodeHash[];

  /** Dernier pas TOTP accepté — anti-rejeu. */
  @Prop({ type: Number, default: null })
  lastUsedStep!: number | null;

  @Prop({ type: Number, default: 0 })
  failedAttempts!: number;

  @Prop({ type: Date, default: null })
  lockedUntil!: Date | null;

  @Prop({ type: Date, default: null })
  enrolledAt!: Date | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type PlatformTwoFactorDocument = HydratedDocument<PlatformTwoFactor>;
export const PlatformTwoFactorSchema = SchemaFactory.createForClass(PlatformTwoFactor);
PlatformTwoFactorSchema.index({ userId: 1 }, { unique: true });

/** Session de console vérifiée par un code (empreinte SHA-256 du cookie, jamais le jeton). */
@Schema({ collection: 'platform_two_factor_sessions', timestamps: true, strict: true })
export class PlatformTwoFactorSession {
  @Prop({ type: String, required: true })
  userId!: string;

  @Prop({ type: String, required: true })
  sessionFingerprint!: string;

  @Prop({ type: Date, required: true })
  verifiedAt!: Date;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type PlatformTwoFactorSessionDocument = HydratedDocument<PlatformTwoFactorSession>;
export const PlatformTwoFactorSessionSchema =
  SchemaFactory.createForClass(PlatformTwoFactorSession);
PlatformTwoFactorSessionSchema.index({ userId: 1, sessionFingerprint: 1 }, { unique: true });
// Nettoyage seulement : le contrôle filtre sur `expiresAt` à chaque lecture.
PlatformTwoFactorSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });
