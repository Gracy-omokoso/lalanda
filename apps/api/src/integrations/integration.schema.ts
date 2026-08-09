// Collection `integrations` — ADR-0013 §1.
//
// Un document par (provider, scope, organizationId). `scope` vaut `'platform'` et
// `organizationId` vaut `null` en v1 : les deux champs existent pour qu'un futur
// périmètre par organisation n'impose pas de migration d'index (ADR-0013 §10,
// « Isolation des secrets par organisation »).
//
// ── Deuxième barrière anti-fuite (ADR-0013 §4) ────────────────────────────────
//
// La transformation `toJSON` ci-dessous supprime les champs chiffrés. Elle est
// REDONDANTE avec `toIntegrationView()` — et c'est le but : « trois barrières
// indépendantes contre la fuite, parce qu'une seule finit toujours par être
// contournée ». Le jour où un contrôleur renverra un document Mongoose par
// mégarde (`return doc` au lieu de `return toIntegrationView(doc)`), cette
// transformation évitera la fuite.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import { INTEGRATION_PROVIDERS, type IntegrationProvider } from './providers.js';
import { SECRET_ALGORITHM } from './secrets-crypto.js';

/** Sous-document `EncryptedValue` (ADR-0013 §1, second tableau). */
@Schema({ _id: false })
export class EncryptedValueDoc {
  @Prop({ type: String, required: true, default: SECRET_ALGORITHM })
  alg!: string;

  @Prop({ type: String, required: true })
  keyId!: string;

  @Prop({ type: String, required: true })
  salt!: string;

  @Prop({ type: String, required: true })
  iv!: string;

  @Prop({ type: String, required: true })
  ciphertext!: string;

  @Prop({ type: String, required: true })
  authTag!: string;

  /** 4 DERNIERS caractères, ou `null` sous 12 caractères (ADR-0013 §4). */
  @Prop({ type: String, default: null })
  last4!: string | null;

  @Prop({ type: Date, required: true })
  updatedAt!: Date;

  @Prop({ type: String, required: true })
  updatedBy!: string;
}

export const EncryptedValueSchema = SchemaFactory.createForClass(EncryptedValueDoc);

/** Résultat du dernier test de connexion (ADR-0013 §1, `detail` assaini). */
@Schema({ _id: false })
export class LastTestDoc {
  @Prop({ type: Date, required: true })
  at!: Date;

  @Prop({ type: String, required: true, enum: ['ok', 'failed'] })
  status!: 'ok' | 'failed';

  /** Message assaini par `sanitizeProviderMessage` — jamais brut. */
  @Prop({ type: String, default: '' })
  detail!: string;

  /** Le test a-t-il été contourné par `?force=true` (ADR-0013 §5) ? */
  @Prop({ type: Boolean, default: false })
  forced!: boolean;
}

export const LastTestSchema = SchemaFactory.createForClass(LastTestDoc);

/** Champs à ne JAMAIS laisser sortir — utilisés par la transformation et le test. */
export const FORBIDDEN_OUTPUT_FIELDS = ['ciphertext', 'iv', 'salt', 'authTag', 'keyId'] as const;

@Schema({ collection: 'integrations', timestamps: true, strict: true })
export class Integration {
  @Prop({ type: String, required: true, enum: INTEGRATION_PROVIDERS as unknown as string[] })
  provider!: IntegrationProvider;

  /** `'platform'` en v1 (ADR-0013 §1). */
  @Prop({ type: String, required: true, default: 'platform', enum: ['platform', 'organization'] })
  scope!: 'platform' | 'organization';

  /** `null` en v1. Présent pour le futur périmètre par organisation. */
  @Prop({ type: String, default: null })
  organizationId!: string | null;

  @Prop({ type: Boolean, required: true, default: false })
  enabled!: boolean;

  /** Configuration NON secrète, restreinte par la liste blanche du fournisseur. */
  @Prop({ type: Object, default: {} })
  config!: Record<string, string | number | boolean>;

  /** Table `nom → EncryptedValue`. Type `Object` : les noms varient par fournisseur. */
  @Prop({ type: Object, default: {} })
  secrets!: Record<string, EncryptedValueDoc>;

  @Prop({ type: LastTestSchema, default: null })
  lastTest!: LastTestDoc | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type IntegrationDocument = HydratedDocument<Integration>;
export const IntegrationSchema = SchemaFactory.createForClass(Integration);

// ADR-0013 §1 : index unique `{ provider, scope, organizationId }`.
IntegrationSchema.index({ provider: 1, scope: 1, organizationId: 1 }, { unique: true });

/**
 * DEUXIÈME BARRIÈRE — `toJSON` ampute le document de tout matériel cryptographique.
 *
 * Volontairement destructif plutôt que sélectif : on ne retire pas « les champs
 * sensibles de `secrets` », on remplace `secrets` par une table de booléens. Un
 * futur champ ajouté à `EncryptedValue` serait alors couvert d'office, là où une
 * liste de suppressions aurait laissé passer le nouveau venu en silence.
 */
IntegrationSchema.set('toJSON', {
  transform: (_doc, ret: Record<string, unknown>) => {
    const secrets = ret['secrets'] as Record<string, unknown> | undefined;
    if (secrets && typeof secrets === 'object') {
      ret['secrets'] = Object.fromEntries(Object.keys(secrets).map((name) => [name, true]));
    }
    return ret;
  },
});
