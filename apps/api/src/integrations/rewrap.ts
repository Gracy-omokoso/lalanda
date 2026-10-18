// Migration `secrets:rewrap` — ADR-0013 §3, étape 2 de la procédure de rotation.
//
// Pour chaque `EncryptedValue` dont le `keyId` n'est pas le courant : déchiffrer
// avec l'ancienne clé, re-chiffrer avec la nouvelle (NOUVEAU salt, NOUVEL iv,
// NOUVELLE AAD — le keyId change, donc l'AAD change nécessairement), écrire dans
// une transaction par document, et journaliser un `secret.rewrapped` par
// enregistrement.
//
// IDEMPOTENTE : les enregistrements déjà au `keyId` courant sont ignorés sans
// être déchiffrés. La migration est rejouable, y compris après une interruption
// en plein vol — c'est ce qui permet de la relancer sans réfléchir quand un
// déploiement s'est mal passé au milieu.
//
// DEUX COLLECTIONS depuis ADR-0021 §4.2 : `integrations` (portée plateforme) et
// `organization_secrets` (portée organisation). Même procédure, même idempotence,
// un `secret.rewrapped` par enregistrement. Oublier la seconde rendrait les jetons
// e-MCF indéchiffrables au retrait de l'ancienne clé : `remainingKeyIds` couvre
// donc les deux, et l'exploitant ne retire `_PREVIOUS` que s'il est vide.

import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';

import { Integration, type IntegrationDocument } from './integration.schema.js';
import { MASTER_KEYRING } from './keyring.provider.js';
import {
  OrganizationSecret,
  type OrganizationSecretDocument,
} from './organization-secret.schema.js';
import { encryptedValueOf, organizationSecretLocation } from './organization-secrets.service.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { rewrapSecret, type EncryptedValue, type MasterKeyring } from './secrets-crypto.js';
import { SecretsService } from './secrets.service.js';

export interface RewrapReport {
  /** Enregistrements réellement re-chiffrés. */
  rewrapped: number;
  /** Enregistrements déjà au `keyId` courant — ignorés. */
  skipped: number;
  /** `keyId` restant après passage : doit être vide pour retirer `_PREVIOUS`. */
  remainingKeyIds: string[];
}

@Injectable()
export class RewrapService {
  private readonly logger = new Logger(RewrapService.name);

  constructor(
    @InjectModel(Integration.name) private readonly model: Model<IntegrationDocument>,
    @InjectModel(OrganizationSecret.name)
    private readonly orgSecrets: Model<OrganizationSecretDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(MASTER_KEYRING) private readonly keyring: MasterKeyring | null,
    @Inject(PlatformAuditService) private readonly audit: PlatformAuditService,
    @Inject(SecretsService) private readonly secrets: SecretsService,
  ) {}

  /**
   * Exécute la migration. `actorUserId` identifie qui a lancé la rotation —
   * `'system'` pour une exécution automatisée de déploiement.
   */
  async run(actorUserId = 'system'): Promise<RewrapReport> {
    if (!this.keyring) {
      throw new Error(
        'SECRETS_MASTER_KEY absente : impossible de re-chiffrer quoi que ce soit (ADR-0013 §3).',
      );
    }
    const keyring = this.keyring;
    const report: RewrapReport = { rewrapped: 0, skipped: 0, remainingKeyIds: [] };

    for (const doc of await this.model.find({}).exec()) {
      const current = doc.secrets as unknown as Record<string, EncryptedValue>;
      const next: Record<string, EncryptedValue> = { ...current };
      const changedNames: string[] = [];

      for (const [name, record] of Object.entries(current ?? {})) {
        const outcome = rewrapSecret({
          location: { documentId: String(doc._id), provider: doc.provider, secretName: name },
          record,
          keyring,
        });
        if (!outcome.changed) {
          report.skipped += 1;
          continue;
        }
        next[name] = outcome.record;
        changedNames.push(name);
      }

      if (changedNames.length === 0) continue;

      doc.secrets = next as never;
      doc.markModified('secrets');
      await this.inTransaction(async (session) => {
        await doc.save({ session });
        for (const name of changedNames) {
          await this.audit.record(
            {
              actorUserId,
              actorRole: 'system',
              action: 'secret.rewrapped',
              targetType: 'integration',
              targetId: doc.provider,
              // Ni valeur ni `last4` : une rotation ne change pas la valeur, et
              // répéter le `last4` à chaque rotation le multiplierait dans le
              // journal sans rien apprendre à personne.
              metadata: { secretName: name, keyId: keyring.currentKeyId },
            },
            session,
          );
        }
      });
      report.rewrapped += changedNames.length;
      this.logger.log(`${doc.provider} : ${changedNames.length} secret(s) re-chiffré(s).`);
    }

    await this.rewrapOrganizationSecrets(keyring, actorUserId, report);

    this.secrets.invalidateAll();

    // Étape 3 de la procédure : « vérifier qu'aucun document ne porte l'ancien
    // keyId, puis retirer _PREVIOUS ». Le rapport le dit explicitement plutôt que
    // de laisser l'exploitant le déduire d'un compteur à zéro.
    const remaining = new Set<string>();
    for (const doc of await this.model.find({}).exec()) {
      for (const record of Object.values(
        (doc.secrets ?? {}) as unknown as Record<string, EncryptedValue>,
      )) {
        if (record.keyId !== keyring.currentKeyId) remaining.add(record.keyId);
      }
    }
    for (const doc of await this.orgSecrets.find({}).exec()) {
      if (doc.value.keyId !== keyring.currentKeyId) remaining.add(doc.value.keyId);
    }
    report.remainingKeyIds = [...remaining];
    return report;
  }

  /**
   * Secrets de portée organisation (ADR-0021 §4.2) — un enregistrement par document.
   *
   * L'emplacement est celui qu'utilise la lecture (`organizationSecretLocation`) :
   * une seule définition, sans quoi la rotation re-chiffrerait sous un emplacement
   * que `resolve` ne reconnaîtrait pas. Pas de cache à invalider : le coffre
   * d'organisation n'en a pas.
   */
  private async rewrapOrganizationSecrets(
    keyring: MasterKeyring,
    actorUserId: string,
    report: RewrapReport,
  ): Promise<void> {
    for (const doc of await this.orgSecrets.find({}).exec()) {
      const outcome = rewrapSecret({
        location: organizationSecretLocation(doc),
        record: encryptedValueOf(doc),
        keyring,
      });
      if (!outcome.changed) {
        report.skipped += 1;
        continue;
      }
      const written = await this.inTransaction(async (session) => {
        // Écriture conditionnée par l'ancien `keyId` : si une saisie concurrente a
        // remplacé le jeton entre la lecture et l'écriture, elle l'a chiffré sous la
        // clé courante, et la rotation ne doit pas l'écraser avec l'ancienne valeur.
        const res = await this.orgSecrets
          .updateOne(
            { _id: doc._id, 'value.keyId': doc.value.keyId, 'value.iv': doc.value.iv },
            { $set: { value: outcome.record } },
            session ? { session } : {},
          )
          .exec();
        if (res.modifiedCount === 0) return false;
        await this.audit.record(
          {
            actorUserId,
            actorRole: 'system',
            action: 'secret.rewrapped',
            targetType: 'organization_secret',
            targetId: String(doc._id),
            // Ni valeur ni `last4`, et pas l'organisation : le journal plateforme
            // n'a pas à lister les clients qui détiennent un jeton e-MCF.
            metadata: { kind: doc.kind, keyId: keyring.currentKeyId },
          },
          session,
        );
        return true;
      });
      // Compté HORS de la transaction : `withTransaction` peut rejouer le rappel.
      if (written) report.rewrapped += 1;
    }
  }

  private async inTransaction<T>(
    fn: (session: ClientSession | undefined) => Promise<T>,
  ): Promise<T> {
    let session: ClientSession;
    try {
      session = await this.connection.startSession();
    } catch {
      return fn(undefined);
    }
    try {
      let result!: T;
      await session.withTransaction(async () => {
        result = await fn(session);
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes('Transaction numbers are only allowed on a replica set') ||
        message.includes('Transactions are not supported') ||
        message.includes('does not support transactions')
      ) {
        return fn(undefined);
      }
      throw err;
    } finally {
      await session.endSession();
    }
  }
}
