// ─────────────────────────────────────────────────────────────────────────────
// ÉCRITURE DES INTÉGRATIONS — ADR-0013 §4, §5, §6
//
// Trois propriétés que ce fichier doit tenir, et qui expliquent sa forme :
//
// 1. ÉCRITURE SEULE. `toIntegrationView()` est le SEUL point de sortie (première
//    des trois barrières d'ADR-0013 §4). Aucune autre méthode publique ne
//    renvoie de document Mongoose. Aucune ne renvoie de valeur déchiffrée.
//
// 2. TEST AVANT ÉCRITURE. Le test de connexion s'exécute sur les valeurs SOUMISES,
//    avant la moindre écriture. En cas d'échec : 422 et rien n'est persisté — pas
//    même `lastTest`, sinon un échec laisserait une trace d'écriture sur un
//    document que l'ADR dit ne pas devoir exister.
//
// 3. AUDIT TRANSACTIONNEL. « L'écriture de l'audit est dans la même transaction
//    que la modification du secret : pas de secret modifié sans trace » (§6).
// ─────────────────────────────────────────────────────────────────────────────

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';

import { CONNECTION_TESTER, type ConnectionTester } from './connection-tests.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { findWhitelistViolations, type UpdateIntegrationInput } from './integrations.dto.js';
import { Integration, type IntegrationDocument, type LastTestDoc } from './integration.schema.js';
import { MASTER_KEYRING } from './keyring.provider.js';
import { INTEGRATION_PROVIDERS, PROVIDER_SPECS, type IntegrationProvider } from './providers.js';
import { sanitizeProviderMessage } from './redaction.js';
import { encryptSecret, type EncryptedValue, type MasterKeyring } from './secrets-crypto.js';
import { SecretsService, type SecretSource } from './secrets.service.js';

/** Actions d'audit du lot (ADR-0013 §6). */
export const INTEGRATION_AUDIT_ACTIONS = [
  'integration.secret.updated',
  'integration.secret.deleted',
  'integration.tested',
  'integration.config.updated',
  'integration.enabled',
  'integration.disabled',
  'secret.rewrapped',
] as const;

/** Vue de lecture — « la seule forme jamais renvoyée » (ADR-0013 §4). */
export interface IntegrationSecretView {
  configured: boolean;
  /** 4 DERNIERS caractères, ou `null`. Le seul fragment autorisé. */
  last4: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  /** `db` | `env` | `null` — garde-fou n°1 de l'option C (ADR-0013). */
  source: SecretSource | null;
}

export interface IntegrationView {
  provider: IntegrationProvider;
  label: string;
  enabled: boolean;
  config: Record<string, string | number | boolean>;
  secrets: Record<string, IntegrationSecretView>;
  lastTest: { at: string; status: 'ok' | 'failed'; detail: string; forced: boolean } | null;
  /** Secrets sans lesquels l'intégration ne peut pas fonctionner. */
  requiredSecrets: string[];
  /** Ce que fait le bouton « Tester » — affiché avant qu'on le presse. */
  testDescription: string;
  updatedAt: string | null;
}

export interface ActorContext {
  userId: string;
  platformRole: string;
  ip: string | null;
  userAgent: string | null;
}

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    @InjectModel(Integration.name) private readonly model: Model<IntegrationDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(MASTER_KEYRING) private readonly keyring: MasterKeyring | null,
    @Inject(SecretsService) private readonly secrets: SecretsService,
    @Inject(PlatformAuditService) private readonly audit: PlatformAuditService,
    @Inject(CONNECTION_TESTER) private readonly tester: ConnectionTester,
  ) {}

  // ── Lecture ────────────────────────────────────────────────────────────────

  /** Les cinq fournisseurs, configurés ou non — l'absence est une information. */
  async list(): Promise<IntegrationView[]> {
    const docs = await this.model.find({ scope: 'platform' }).exec();
    const byProvider = new Map(docs.map((d) => [d.provider, d]));
    return INTEGRATION_PROVIDERS.map((p) => this.toIntegrationView(p, byProvider.get(p) ?? null));
  }

  async get(provider: IntegrationProvider): Promise<IntegrationView> {
    const doc = await this.model.findOne({ provider, scope: 'platform' }).exec();
    return this.toIntegrationView(provider, doc);
  }

  /**
   * PREMIÈRE BARRIÈRE — unique point de sortie (ADR-0013 §4).
   *
   * Ne sont recopiés que des champs NOMMÉS un par un. Aucun `...doc`, aucun
   * `toObject()`, aucune boucle sur les clés du document : un champ ajouté au
   * schéma demain n'apparaîtra pas ici tant que quelqu'un ne l'aura pas écrit,
   * ce qui est exactement la propriété recherchée pour une structure dont la
   * moitié des champs est du matériel cryptographique.
   */
  toIntegrationView(
    provider: IntegrationProvider,
    doc: IntegrationDocument | null,
  ): IntegrationView {
    const spec = PROVIDER_SPECS[provider];
    const secrets: Record<string, IntegrationSecretView> = {};
    for (const name of spec.secrets) {
      const record = doc?.secrets?.[name] as EncryptedValue | undefined;
      secrets[name] = {
        configured: Boolean(record) || this.secrets.sourceOfRecord(provider, name, false) === 'env',
        last4: record?.last4 ?? null,
        updatedAt: record?.updatedAt ? new Date(record.updatedAt).toISOString() : null,
        updatedBy: record?.updatedBy ?? null,
        source: this.secrets.sourceOfRecord(provider, name, Boolean(record)),
      };
    }

    // `config` est filtré par la liste blanche À LA SORTIE aussi, et pas seulement
    // à l'entrée : un document écrit par une version antérieure, par une migration
    // ou à la main en base pourrait porter une clé qui n'est plus autorisée.
    const config: Record<string, string | number | boolean> = {};
    for (const key of spec.config) {
      const value = doc?.config?.[key];
      if (value !== undefined && value !== null) config[key] = value;
    }

    return {
      provider,
      label: spec.label,
      enabled: doc?.enabled ?? false,
      config,
      secrets,
      lastTest: doc?.lastTest
        ? {
            at: new Date(doc.lastTest.at).toISOString(),
            status: doc.lastTest.status,
            detail: doc.lastTest.detail ?? '',
            forced: doc.lastTest.forced ?? false,
          }
        : null,
      requiredSecrets: [...spec.requiredSecrets],
      testDescription: spec.testDescription,
      updatedAt: doc
        ? new Date((doc as unknown as { updatedAt: Date }).updatedAt).toISOString()
        : null,
    };
  }

  // ── Écriture ───────────────────────────────────────────────────────────────

  /**
   * Crée ou met à jour une intégration : `config`, `enabled`, et remplacement de
   * secrets. Teste AVANT d'écrire (ADR-0013 §5).
   *
   * `force` correspond à `?force=true` : « une dérogation tracée vaut mieux qu'un
   * contrôle qu'on finit par retirer parce qu'il bloque ».
   */
  async update(
    provider: IntegrationProvider,
    input: UpdateIntegrationInput,
    actor: ActorContext,
    force: boolean,
  ): Promise<IntegrationView> {
    const violations = findWhitelistViolations(provider, input);
    if (violations.length > 0) {
      throw new BadRequestException({
        code: 'UNKNOWN_FIELD',
        message:
          'Champs refusés — hors liste blanche du fournisseur. Un secret ne peut pas être ' +
          'rangé dans `config` : il y serait stocké en clair.',
        violations,
      });
    }

    const submittedSecrets = Object.entries(input.secrets ?? {});
    const hasNewValue = submittedSecrets.some(([, v]) => typeof v === 'string');
    if (hasNewValue && !this.keyring) {
      throw new BadRequestException({
        code: 'VAULT_UNAVAILABLE',
        message:
          "SECRETS_MASTER_KEY est absente de l'environnement : aucun secret ne peut être " +
          'chiffré. Voir ADR-0013 §8.',
      });
    }

    const existing = await this.model.findOne({ provider, scope: 'platform' }).exec();

    // ── Test de connexion, sur les valeurs SOUMISES, avant toute écriture ──────
    let testResult: LastTestDoc | null = null;
    if (hasNewValue || input.config !== undefined) {
      testResult = (await this.runTest(provider, existing, input, force)).lastTest;
      if (!testResult.forced && testResult.status === 'failed') {
        // 422 et RIEN n'est persisté : ni le secret, ni `lastTest`. Enregistrer
        // l'échec créerait le document que l'ADR dit ne pas devoir exister, et
        // ferait apparaître dans `/admin` une intégration « configurée » qui ne
        // l'est pas.
        throw new UnprocessableEntityException({
          code: 'INTEGRATION_TEST_FAILED',
          message: `Le test de connexion a échoué : ${testResult.detail}`,
          detail: testResult.detail,
        });
      }
    }

    // ── Construction du document cible ────────────────────────────────────────
    const doc =
      existing ??
      new this.model({
        provider,
        scope: 'platform',
        organizationId: null,
        enabled: false,
        config: {},
        secrets: {},
        _schemaVersion: 1,
      });

    const auditEntries: Array<{
      action: string;
      secretName: string | null;
      meta: Record<string, string | number | boolean | null>;
    }> = [];

    if (input.config !== undefined) {
      doc.config = { ...(doc.config ?? {}), ...input.config };
      doc.markModified('config');
      auditEntries.push({
        action: 'integration.config.updated',
        secretName: null,
        meta: { keys: Object.keys(input.config).join(',') },
      });
    }

    if (input.enabled !== undefined && input.enabled !== doc.enabled) {
      doc.enabled = input.enabled;
      auditEntries.push({
        action: input.enabled ? 'integration.enabled' : 'integration.disabled',
        secretName: null,
        meta: {},
      });
    }

    const nextSecrets: Record<string, EncryptedValue> = {
      ...((doc.secrets ?? {}) as unknown as Record<string, EncryptedValue>),
    };
    for (const [name, value] of submittedSecrets) {
      const before = nextSecrets[name]?.last4 ?? null;
      if (value === null) {
        if (nextSecrets[name] === undefined) continue;
        delete nextSecrets[name];
        auditEntries.push({
          action: 'integration.secret.deleted',
          secretName: name,
          meta: { last4Before: before, last4After: null },
        });
        continue;
      }
      const record = encryptSecret({
        location: { documentId: String(doc._id), provider, secretName: name },
        value,
        keyring: this.keyring!,
        updatedBy: actor.userId,
      });
      nextSecrets[name] = record;
      auditEntries.push({
        action: 'integration.secret.updated',
        secretName: name,
        // ADR-0013 §6 : `last4Before`/`last4After` conservés — « ils n'exposent
        // rien de plus que ce que /admin affiche déjà et répondent à la seule
        // question utile en investigation ». JAMAIS la valeur.
        meta: { last4Before: before, last4After: record.last4 },
      });
    }
    doc.secrets = nextSecrets as never;
    doc.markModified('secrets');

    if (testResult) {
      doc.lastTest = testResult;
      auditEntries.push({
        action: 'integration.tested',
        secretName: null,
        meta: { result: testResult.status, forced: testResult.forced },
      });
    }

    await this.inTransaction(async (session) => {
      await doc.save({ session });
      for (const entry of auditEntries) {
        await this.recordAudit(
          actor,
          entry.action,
          provider,
          entry.secretName,
          entry.meta,
          session,
        );
      }
    });

    // ADR-0013 §2 : cache invalidé À TOUTE écriture. Après la transaction, pas
    // avant : une transaction annulée ne doit pas avoir vidé le cache d'une
    // valeur toujours en vigueur.
    this.secrets.invalidate(provider);

    const saved = await this.model.findOne({ provider, scope: 'platform' }).exec();
    return this.toIntegrationView(provider, saved);
  }

  /** Supprime un secret nommé. `DELETE /admin/integrations/:provider/secrets/:name`. */
  async deleteSecret(
    provider: IntegrationProvider,
    name: string,
    actor: ActorContext,
  ): Promise<IntegrationView> {
    if (!PROVIDER_SPECS[provider].secrets.includes(name)) {
      throw new BadRequestException({
        code: 'UNKNOWN_FIELD',
        message: `« ${name} » n'est pas un secret de ${provider}.`,
      });
    }
    const doc = await this.model.findOne({ provider, scope: 'platform' }).exec();
    const record = doc?.secrets?.[name] as EncryptedValue | undefined;
    if (!doc || !record) {
      // Idempotent : supprimer un secret absent n'est pas une erreur, et un 404
      // renseignerait sur l'état de configuration à qui n'a pas déjà la vue.
      return this.toIntegrationView(provider, doc);
    }

    const next = { ...(doc.secrets as unknown as Record<string, EncryptedValue>) };
    const before = record.last4 ?? null;
    delete next[name];
    doc.secrets = next as never;
    doc.markModified('secrets');

    await this.inTransaction(async (session) => {
      await doc.save({ session });
      await this.recordAudit(
        actor,
        'integration.secret.deleted',
        provider,
        name,
        { last4Before: before, last4After: null },
        session,
      );
    });
    this.secrets.invalidate(provider);
    return this.toIntegrationView(
      provider,
      await this.model.findOne({ provider, scope: 'platform' }).exec(),
    );
  }

  /**
   * Test de connexion à la demande, sur les valeurs DÉJÀ stockées.
   * `POST /admin/integrations/:provider/test`.
   */
  async testStored(
    provider: IntegrationProvider,
    actor: ActorContext,
  ): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
    const doc = await this.model.findOne({ provider, scope: 'platform' }).exec();
    const { lastTest, latencyMs } = await this.runTest(provider, doc, {}, false);
    if (doc) {
      doc.lastTest = lastTest;
      await this.inTransaction(async (session) => {
        await doc.save({ session });
        await this.recordAudit(
          actor,
          'integration.tested',
          provider,
          null,
          { result: lastTest.status, forced: false },
          session,
        );
      });
    } else {
      // Rien à mettre à jour, mais le test reste un acte à tracer : c'est une
      // sollicitation d'un fournisseur externe avec les identifiants de la
      // plateforme.
      await this.recordAudit(actor, 'integration.tested', provider, null, {
        result: lastTest.status,
        forced: false,
      });
    }
    return { ok: lastTest.status === 'ok', latencyMs, detail: lastTest.detail };
  }

  // ── Interne ────────────────────────────────────────────────────────────────

  /**
   * Exécute le test avec, dans l'ordre de priorité : les secrets SOUMIS, puis
   * ceux déjà en base, puis ceux de l'environnement de secours.
   *
   * Le mélange est nécessaire : tester `stripe.webhookSecret` seul exige la
   * `restrictedKey`, qui n'est pas dans la requête. Le tester avec l'ANCIENNE
   * valeur du secret qu'on est en train de remplacer serait en revanche un
   * contresens — d'où l'ordre, la valeur soumise gagnant toujours.
   */
  private async runTest(
    provider: IntegrationProvider,
    existing: IntegrationDocument | null,
    input: UpdateIntegrationInput,
    force: boolean,
  ): Promise<{ lastTest: LastTestDoc; latencyMs: number }> {
    const stored = await this.secrets.plainSecretsOf(existing);
    const plain: Record<string, string> = { ...stored };

    for (const name of PROVIDER_SPECS[provider].secrets) {
      if (plain[name] === undefined) {
        const fromEnv = await this.secrets.resolve(provider, name);
        if (fromEnv?.source === 'env') plain[name] = fromEnv.secret.expose();
      }
    }
    for (const [name, value] of Object.entries(input.secrets ?? {})) {
      if (value === null) delete plain[name];
      else plain[name] = value;
    }

    const config = { ...(existing?.config ?? {}), ...(input.config ?? {}) };

    let result: { ok: boolean; latencyMs: number; detail: string };
    try {
      result = await this.tester.test({ provider, config, secrets: plain });
    } catch (err) {
      // Un testeur qui LÈVE au lieu de renvoyer un échec est un défaut du testeur,
      // pas du secret. On le traite quand même comme un échec — mais le message
      // passe par la même passe de rédaction, sans quoi une trace de pile
      // remonterait telle quelle dans `lastTest.detail`.
      result = {
        ok: false,
        latencyMs: 0,
        detail: sanitizeProviderMessage(err, Object.values(plain)),
      };
      this.logger.error(`Testeur ${provider} en défaut : ${result.detail}`);
    }

    return {
      lastTest: {
        at: new Date(),
        status: result.ok ? 'ok' : 'failed',
        // Double rédaction : le testeur assainit déjà, mais rien ne garantit
        // qu'un testeur injecté par un tiers le fasse.
        detail: sanitizeProviderMessage(result.detail, Object.values(plain)),
        forced: force && !result.ok,
      } as LastTestDoc,
      latencyMs: result.latencyMs,
    };
  }

  /** Écriture d'audit STRICTE, dans la transaction de l'appelant (§6). */
  private async recordAudit(
    actor: ActorContext,
    action: string,
    provider: IntegrationProvider,
    secretName: string | null,
    meta: Record<string, string | number | boolean | null>,
    session?: ClientSession,
  ): Promise<void> {
    await this.audit.record(
      {
        actorUserId: actor.userId,
        actorRole: actor.platformRole,
        action,
        targetType: 'integration',
        targetId: provider,
        // Aucune valeur, aucun fragment au-delà de `last4` (ADR-0013 §6).
        metadata: {
          ...meta,
          secretName,
          ip: actor.ip,
          userAgent: actor.userAgent ? actor.userAgent.slice(0, 200) : null,
        },
      },
      session,
    );
  }

  /**
   * Transaction Mongoose, avec le même repli documenté que `members.service.ts`.
   *
   * Ce que le repli coûte ICI, explicitement : sur un `mongod` autonome (poste de
   * développement), un secret peut être écrit alors que sa trace d'audit échoue.
   * ADR-0013 §6 exige l'atomicité; la CI et la production tournent sur un replica
   * set et l'obtiennent. Rendre l'écriture de secrets impossible en local
   * pousserait à développer contre une base de production, ce qui serait un
   * risque bien plus grand que celui qu'on couvre.
   */
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
      if (isTransactionUnsupported(err)) return fn(undefined);
      throw err;
    } finally {
      await session.endSession();
    }
  }
}

function isTransactionUnsupported(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes('Transaction numbers are only allowed on a replica set') ||
    message.includes('Transactions are not supported') ||
    message.includes('does not support transactions')
  );
}
