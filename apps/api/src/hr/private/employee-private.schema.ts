// Données sensibles du collaborateur, chiffrées (ADR-0045 § 2.4). ADR-0045 — H2.
//
// Un document par collaborateur (`{ organizationId, employeeId }` unique), créé à la
// première écriture. Chaque champ (quatre sections et `exitNote`) vaut
// `{ cipher, masked, changedAt, changedBy } | null` : `cipher` est le JSON du clair
// chiffré par `secrets-crypto.ts` (AES-256-GCM, AAD = organisation + collaborateur +
// section) ; `masked` est la seule forme lue sans `reveal` (jamais un montant, un
// numéro de compte ni un numéro de pièce).
//
// `idExpiries` recopie EN CLAIR la nature et l'expiration des pièces d'identité (sans
// numéro), pour que la tâche de rappels n'ait jamais à déchiffrer (§ 6.4).
//
// Sérialisation : `toJSON` et `toObject` remplacent tout chiffré par `[redacted]`.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

import type { EncryptedValue } from '../../integrations/secrets-crypto.js';
import { REDACTED } from '../../integrations/secret-value.js';

export interface PrivateFieldDoc {
  cipher: EncryptedValue;
  masked: Record<string, unknown>;
  changedAt: Date;
  changedBy: string;
}

export const PRIVATE_FIELD_KEYS = [
  'compensation',
  'bankDetails',
  'identity',
  'personalContact',
  'exitNote',
] as const;

@Schema({ collection: 'hr_employee_private', timestamps: true, strict: true })
export class EmployeePrivate {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  employeeId!: string;

  @Prop({ type: Object, default: null })
  compensation!: PrivateFieldDoc | null;

  @Prop({ type: Object, default: null })
  bankDetails!: PrivateFieldDoc | null;

  @Prop({ type: Object, default: null })
  identity!: PrivateFieldDoc | null;

  @Prop({ type: Object, default: null })
  personalContact!: PrivateFieldDoc | null;

  @Prop({ type: Object, default: null })
  exitNote!: PrivateFieldDoc | null;

  /** Nature et expiration des pièces d'identité, EN CLAIR, sans numéro (rappels). */
  @Prop({ type: [Object], default: [] })
  idExpiries!: { kind: string; expiresOn: string }[];

  /** Dernier changement de coordonnées bancaires (bandeau de sept jours). */
  @Prop({ type: Date, default: null })
  bankDetailsChangedAt!: Date | null;

  @Prop({ type: String, default: null })
  bankDetailsChangedBy!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type EmployeePrivateDocument = HydratedDocument<EmployeePrivate>;
export type EmployeePrivateLean = EmployeePrivate & { _id: Types.ObjectId };
export const EmployeePrivateSchema = SchemaFactory.createForClass(EmployeePrivate);

EmployeePrivateSchema.index(
  { organizationId: 1, employeeId: 1 },
  { unique: true, name: 'hr_employee_private_unique' },
);
EmployeePrivateSchema.index(
  { organizationId: 1, 'idExpiries.expiresOn': 1 },
  { partialFilterExpression: { 'idExpiries.0': { $exists: true } } },
);

/** Remplace chaque chiffré par `[redacted]`. Idempotente. */
function amputerLesChiffres(_doc: unknown, ret: unknown): unknown {
  const bag = ret as Record<string, unknown>;
  for (const key of PRIVATE_FIELD_KEYS) {
    const field = bag[key];
    if (field !== null && typeof field === 'object') {
      bag[key] = { ...(field as object), cipher: REDACTED };
    }
  }
  return bag;
}

EmployeePrivateSchema.set('toJSON', { transform: amputerLesChiffres });
EmployeePrivateSchema.set('toObject', { transform: amputerLesChiffres });
