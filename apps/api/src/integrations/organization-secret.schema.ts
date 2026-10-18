// Collection `organization_secrets` — coffre de portée ORGANISATION (ADR-0021 §4.2).
//
// Un document par (organisation, nature, objet propriétaire) : aujourd'hui, le jeton
// e-MCF d'UN point de vente. Distincte de `integrations` (ADR-0021 O3) : le chemin
// plateforme (`SecretsService`) n'a aucun modèle pour cette collection, il est donc
// physiquement incapable d'en lire un document, et réciproquement.
//
// ── Mêmes barrières anti-fuite qu'`integrations` (ADR-0013 §4) ────────────────
//
// `toJSON` ET `toObject` remplacent `value` par un marqueur : un `return doc`
// accidentel, un `JSON.stringify(doc)`, un `String(doc)` ou un `console.log(doc)`
// (qui passe par `util.inspect`, que Mongoose fait suivre à `toObject`) ne
// recopient ni `ciphertext`, ni `iv`, ni `salt`, ni `authTag`, ni `keyId`.
// Le service lit le chiffré par accès direct au champ hydraté (`doc.value`), qui
// n'emprunte aucune de ces deux transformations.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import { EncryptedValueDoc, EncryptedValueSchema } from './integration.schema.js';
import {
  ORGANIZATION_SECRET_KINDS,
  type OrganizationSecretKind,
} from './organization-secrets.port.js';
import { REDACTED } from './secret-value.js';

@Schema({ collection: 'organization_secrets', timestamps: true, strict: true })
export class OrganizationSecret {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true, enum: ORGANIZATION_SECRET_KINDS as unknown as string[] })
  kind!: OrganizationSecretKind;

  /** Identifiant de l'objet propriétaire — ici, le point de vente e-MCF. */
  @Prop({ type: String, required: true })
  ownerId!: string;

  /** Même sous-document qu'ADR-0013 §1 ; jamais sérialisé (voir plus bas). */
  @Prop({ type: EncryptedValueSchema, required: true })
  value!: EncryptedValueDoc;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type OrganizationSecretDocument = HydratedDocument<OrganizationSecret>;
export const OrganizationSecretSchema = SchemaFactory.createForClass(OrganizationSecret);

// ADR-0021 §4.2 : un seul secret par (organisation, nature, propriétaire). L'index
// couvre aussi la recherche groupée de `describeMany` (préfixe organisation + nature).
OrganizationSecretSchema.index({ organizationId: 1, kind: 1, ownerId: 1 }, { unique: true });

/**
 * Remplace le sous-document chiffré par le marqueur `[redacted]`.
 *
 * Remplacement entier, pas suppression sélective de champs : un champ ajouté demain
 * à `EncryptedValue` serait couvert d'office. Idempotente (`toObject` puis `toJSON`).
 */
function amputerLeChiffre(_doc: unknown, ret: unknown): unknown {
  const bag = ret as Record<string, unknown>;
  if ('value' in bag) bag['value'] = REDACTED;
  return bag;
}

OrganizationSecretSchema.set('toJSON', { transform: amputerLeChiffre });
OrganizationSecretSchema.set('toObject', { transform: amputerLeChiffre });
