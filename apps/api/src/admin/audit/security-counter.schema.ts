// Compteurs d'événements de sécurité de la console (ADR-0053 § 6.5 — lot P5).
//
// Portée PLATEFORME, et volontairement pauvre : un document par jour UTC et par nature,
// un nombre. Aucun identifiant de compte, aucune adresse IP (même hachée), aucun chemin,
// aucune organisation — l'agrégat est la seule chose conservée, pas l'événement.
// L'incrément est atomique (`$inc` sur `{ day, kind }` unique).

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ collection: 'platform_security_counters', timestamps: true })
export class PlatformSecurityCounter {
  /** Jour UTC, `AAAA-MM-JJ`. */
  @Prop({ type: String, required: true })
  day!: string;

  /** Nature (`PLATFORM_SECURITY_EVENT_KINDS`, source `counter`). */
  @Prop({ type: String, required: true })
  kind!: string;

  @Prop({ type: Number, required: true, default: 0 })
  count!: number;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type PlatformSecurityCounterDocument = HydratedDocument<PlatformSecurityCounter>;
export const PlatformSecurityCounterSchema = SchemaFactory.createForClass(PlatformSecurityCounter);

PlatformSecurityCounterSchema.index({ day: 1, kind: 1 }, { unique: true });
