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

import {
  decryptPaymentDetails,
  paymentFingerprint,
  rewrapPaymentDetails,
} from '../purchases/suppliers/supplier-payment-crypto.js';
// ADR-0045 — H2 : données sensibles du personnel.
import {
  decryptHrPrivate,
  maskBankAccount,
  rewrapHrPrivate,
} from '../hr/private/hr-private-crypto.js';
// ADR-0045 — H4 : clés enveloppées des documents RH sensibles.
import { rewrapHrDocumentKey } from '../hr/documents/hr-document-crypto.js';
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

/** ADR-0044 — P2 : fiches fournisseurs (coordonnées de paiement chiffrées). */
const SUPPLIERS = 'suppliers';
/** ADR-0045 — H2 : données sensibles du personnel (cinq champs chiffrés par document). */
const HR_EMPLOYEE_PRIVATE = 'hr_employee_private';
const HR_PRIVATE_FIELD_KEYS = [
  'compensation',
  'bankDetails',
  'identity',
  'personalContact',
  'exitNote',
] as const;

/** ADR-0045 — H4 : documents RH sensibles (une clé de données enveloppée par document). */
const HR_DOCUMENTS = 'hr_documents';

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
    // ADR-0044 — P2 (§ 2.1.1) : coordonnées de paiement des fournisseurs.
    await this.rewrapSupplierPaymentMethods(keyring, actorUserId, report);
    // ADR-0045 — H2 (§ 2.4) : données sensibles du personnel.
    await this.rewrapHrEmployeePrivate(keyring, actorUserId, report);
    // ADR-0045 — H4 (§ 2.8) : clés enveloppées des documents RH sensibles.
    await this.rewrapHrDocumentKeys(keyring, actorUserId, report);

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
    for (const doc of await this.connection
      .collection(SUPPLIERS)
      .find({ 'paymentMethods.0': { $exists: true } }, { projection: { paymentMethods: 1 } })
      .toArray()) {
      for (const m of (doc['paymentMethods'] ?? []) as { cipher: EncryptedValue }[]) {
        if (m.cipher.keyId !== keyring.currentKeyId) remaining.add(m.cipher.keyId);
      }
    }
    // ADR-0045 — H2 (§ 2.4) : données sensibles du personnel.
    for (const doc of await this.connection.collection(HR_EMPLOYEE_PRIVATE).find({}).toArray()) {
      for (const field of HR_PRIVATE_FIELD_KEYS) {
        const f = doc[field] as { cipher?: EncryptedValue } | null | undefined;
        if (f?.cipher && f.cipher.keyId !== keyring.currentKeyId) remaining.add(f.cipher.keyId);
      }
    }
    // ADR-0045 — H4 (§ 2.8) : clés enveloppées des documents RH sensibles.
    for (const doc of await this.connection
      .collection(HR_DOCUMENTS)
      .find({ wrappedKey: { $type: 'object' } }, { projection: { wrappedKey: 1 } })
      .toArray()) {
      const k = doc['wrappedKey'] as EncryptedValue;
      if (k.keyId !== keyring.currentKeyId) remaining.add(k.keyId);
    }
    report.remainingKeyIds = [...remaining];
    return report;
  }

  /**
   * ADR-0044 — P2 (§ 2.1.1) : « Rotation : comprise dans `secrets:rewrap` ». Chaque
   * moyen de paiement d'une fiche `suppliers` est re-chiffré sous la clé courante,
   * à l'emplacement qu'utilise la lecture (`supplierPaymentLocation`), et son
   * empreinte, dérivée de la clé courante, est recalculée. Collection lue par la
   * connexion : ce module n'importe pas celui des achats. Écriture conditionnée par
   * la révision de la fiche (une saisie concurrente gagne, la rotation repassera) ;
   * la révision n'augmente pas : une rotation n'est pas une modification métier.
   */
  private async rewrapSupplierPaymentMethods(
    keyring: MasterKeyring,
    actorUserId: string,
    report: RewrapReport,
  ): Promise<void> {
    const col = this.connection.collection(SUPPLIERS);
    for (const doc of await col.find({ 'paymentMethods.0': { $exists: true } }).toArray()) {
      const organizationId = String(doc['organizationId']);
      const supplierId = String(doc._id);
      const methods = (doc['paymentMethods'] ?? []) as Array<{
        id: string;
        kind: 'bank' | 'mobile_money';
        fingerprint: string;
        cipher: EncryptedValue;
      }>;
      const changedIds: string[] = [];
      const next = methods.map((m) => {
        const outcome = rewrapPaymentDetails({
          organizationId,
          supplierId,
          methodId: m.id,
          record: m.cipher,
          keyring,
        });
        if (!outcome.changed) {
          report.skipped += 1;
          return m;
        }
        changedIds.push(m.id);
        const details = decryptPaymentDetails({
          organizationId,
          supplierId,
          methodId: m.id,
          kind: m.kind,
          record: outcome.record,
          keyring,
        });
        return {
          ...m,
          cipher: { ...outcome.record, last4: null },
          fingerprint: paymentFingerprint(organizationId, details, keyring),
        };
      });
      if (changedIds.length === 0) continue;
      const written = await this.inTransaction(async (session) => {
        const res = await col.updateOne(
          { _id: doc._id, revision: doc['revision'] },
          { $set: { paymentMethods: next } },
          session ? { session } : {},
        );
        if (res.modifiedCount === 0) return false;
        for (const methodId of changedIds) {
          await this.audit.record(
            {
              actorUserId,
              actorRole: 'system',
              action: 'secret.rewrapped',
              targetType: 'supplier_payment_method',
              targetId: methodId,
              // Ni valeur, ni masque, ni organisation (motif des secrets d'organisation).
              metadata: { keyId: keyring.currentKeyId },
            },
            session,
          );
        }
        return true;
      });
      if (written) report.rewrapped += changedIds.length;
    }
  }

  /**
   * ADR-0045 — H2 (§ 2.4) : « Rotation comprise dans `secrets:rewrap` ». Chaque champ
   * chiffré d'un dossier `hr_employee_private` est re-chiffré sous la clé courante, à
   * l'emplacement qu'utilise la lecture (`hrPrivateLocation`) ; les empreintes des
   * coordonnées bancaires, dérivées de la clé courante, sont recalculées (le masque
   * ne change pas). Collection lue par la connexion : ce module n'importe pas celui
   * des RH. Écriture conditionnée par la révision ; la révision n'augmente pas.
   */
  private async rewrapHrEmployeePrivate(
    keyring: MasterKeyring,
    actorUserId: string,
    report: RewrapReport,
  ): Promise<void> {
    const col = this.connection.collection(HR_EMPLOYEE_PRIVATE);
    for (const doc of await col.find({}).toArray()) {
      const organizationId = String(doc['organizationId']);
      const employeeId = String(doc['employeeId']);
      const set: Record<string, unknown> = {};
      const changed: string[] = [];
      for (const field of HR_PRIVATE_FIELD_KEYS) {
        const f = doc[field] as
          { cipher: EncryptedValue; masked: Record<string, unknown> } | null | undefined;
        if (!f?.cipher) continue;
        const outcome = rewrapHrPrivate({
          organizationId,
          employeeId,
          field,
          record: f.cipher,
          keyring,
        });
        if (!outcome.changed) {
          report.skipped += 1;
          continue;
        }
        let masked = f.masked;
        if (field === 'bankDetails') {
          const clear = decryptHrPrivate({
            organizationId,
            employeeId,
            field,
            record: outcome.record,
            keyring,
          });
          masked = {
            accounts: clear.accounts.map((a) => maskBankAccount(organizationId, a, keyring)),
          };
        }
        set[field] = { ...f, cipher: outcome.record, masked };
        changed.push(field);
      }
      if (changed.length === 0) continue;
      const written = await this.inTransaction(async (session) => {
        const res = await col.updateOne(
          { _id: doc._id, revision: doc['revision'] },
          { $set: set },
          session ? { session } : {},
        );
        if (res.modifiedCount === 0) return false;
        for (const section of changed) {
          await this.audit.record(
            {
              actorUserId,
              actorRole: 'system',
              action: 'secret.rewrapped',
              targetType: 'hr_employee_private',
              targetId: employeeId,
              // Ni valeur, ni masque, ni organisation (motif des fournisseurs).
              metadata: { section, keyId: keyring.currentKeyId },
            },
            session,
          );
        }
        return true;
      });
      if (written) report.rewrapped += changed.length;
    }
  }

  /**
   * ADR-0045 — H4 (§ 2.8) : documents RH sensibles. Chaque fichier est chiffré par une
   * clé de données aléatoire, elle-même enveloppée sous `MASTER_KEYRING` à
   * l'emplacement qu'utilise la lecture (`hrDocumentKeyLocation`) : seule cette clé
   * enveloppée est re-chiffrée ; l'objet au stockage, chiffré par la clé de données
   * inchangée, reste lisible tel quel. Un document supprimé n'a plus de clé (`null`) :
   * rien à faire. Écriture conditionnée par l'ancien `iv` (une suppression ou un
   * effacement concurrent gagne) ; la révision n'augmente pas.
   */
  private async rewrapHrDocumentKeys(
    keyring: MasterKeyring,
    actorUserId: string,
    report: RewrapReport,
  ): Promise<void> {
    const col = this.connection.collection(HR_DOCUMENTS);
    for (const doc of await col
      .find(
        { wrappedKey: { $type: 'object' } },
        { projection: { organizationId: 1, employeeId: 1, wrappedKey: 1 } },
      )
      .toArray()) {
      const record = doc['wrappedKey'] as EncryptedValue;
      const outcome = rewrapHrDocumentKey(
        {
          organizationId: String(doc['organizationId']),
          employeeId: String(doc['employeeId']),
          documentId: String(doc._id),
        },
        record,
        keyring,
      );
      if (!outcome.changed) {
        report.skipped += 1;
        continue;
      }
      const written = await this.inTransaction(async (session) => {
        const res = await col.updateOne(
          { _id: doc._id, 'wrappedKey.iv': record.iv, 'wrappedKey.keyId': record.keyId },
          { $set: { wrappedKey: outcome.record } },
          session ? { session } : {},
        );
        if (res.modifiedCount === 0) return false;
        await this.audit.record(
          {
            actorUserId,
            actorRole: 'system',
            action: 'secret.rewrapped',
            targetType: 'hr_document',
            targetId: String(doc._id),
            // Ni clé, ni libellé, ni organisation (motif des fournisseurs).
            metadata: { keyId: keyring.currentKeyId },
          },
          session,
        );
        return true;
      });
      if (written) report.rewrapped += 1;
    }
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
