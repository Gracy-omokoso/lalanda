// Numéro WhatsApp des personnes, quotas et webhook Meta — ADR-0065 § 1 à § 7.
//
// ── Ce que ce service garantit ────────────────────────────────────────────────
//
// 1. DONNÉE PERSONNELLE. Toute méthode prend l'organisation ET la personne de
//    l'APPELANT (jamais un identifiant reçu) : personne — pas même le Propriétaire —
//    ne lit le numéro d'un collègue. Les journaux, l'audit et les erreurs ne portent
//    que la forme masquée (`+243 81 *** **12`), ou rien.
// 2. CONSENTEMENT PROUVÉ. Un numéro ne reçoit de notification qu'une fois VÉRIFIÉ par
//    un code à 6 chiffres reçu sur WhatsApp (empreinte seule gardée, 10 min, 5 essais,
//    3 codes par heure). « STOP » ou « ARRET » reçu du numéro coupe tout.
// 3. COÛT BORNÉ. Chaque message accepté par Meta (codes compris) est compté par
//    organisation et par mois de Kinshasa ; au plafond, plus rien ne part.
// 4. INTERRUPTEUR (ADR-0017). Fournisseur absent ou désactivé dans `/admin`,
//    `WHATSAPP_ENABLED=false`, ou jeton signalé refusé : AUCUN envoi. Le webhook
//    continue, lui, d'enregistrer les « STOP » tant que les secrets sont résolus — un
//    retrait de consentement ne doit jamais être perdu.

import {
  WHATSAPP_CODE_MAX_ATTEMPTS,
  WHATSAPP_CODE_TTL_MINUTES,
  WHATSAPP_CODES_PER_HOUR,
  maskWhatsAppPhone,
  normalizeWhatsAppPhone,
  type WhatsAppUnavailableReason,
  type WhatsAppView,
} from '@lalanda/shared/work';
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { SecretsService } from '../integrations/secrets.service.js';
import {
  WhatsAppApi,
  WhatsAppApiError,
  whatsappErrorKind,
  type WhatsAppCredentials,
} from './whatsapp-api.js';
import {
  kinshasaMonth,
  whatsappApiVersion,
  whatsappEnabled,
  whatsappMonthlyLimit,
} from './whatsapp-config.js';
import {
  generateWhatsAppCode,
  hashWhatsAppCode,
  safeEqualText,
  verifyHubSignature,
  verifyWhatsAppCode,
} from './whatsapp-security.js';
import { codeTemplateMessage } from './whatsapp-templates.js';
import {
  WHATSAPP_MESSAGE_RETENTION_MS,
  WhatsAppMessage,
  WhatsAppRecipient,
  WhatsAppUsage,
  type WhatsAppMessageDocument,
  type WhatsAppMessageLean,
  type WhatsAppRecipientDocument,
  type WhatsAppRecipientLean,
  type WhatsAppUsageDocument,
  type WhatsAppUsageLean,
} from './whatsapp.schemas.js';

/** Fournisseur utilisable pour un envoi. */
export interface WhatsAppPlatform {
  creds: WhatsAppCredentials;
  monthlyLimit: number;
}

export interface WhatsAppActor {
  organizationId: string;
  userId: string;
  role: string;
}

/** Mots qui retirent le consentement (comparés sans accents, en majuscules). */
export const WHATSAPP_OPT_OUT_WORDS = ['STOP', 'ARRET', 'ARRETER'] as const;

const STATUS_RANK: Record<string, number> = { accepted: 0, sent: 1, delivered: 2, read: 3 };

function fail(status: HttpStatus, code: string, message: string, details?: unknown): never {
  throw new HttpException({ code, message, ...(details ? { details } : {}) }, status);
}

function authSecret(): string {
  return process.env['AUTH_SECRET'] ?? '';
}

/** Code d'une erreur, sans message libre (qui pourrait recopier un numéro). */
export function whatsappCodeOf(err: unknown): string {
  if (err instanceof WhatsAppApiError) return err.code;
  if (err instanceof Error) return err.name;
  return 'unknown';
}

/** Texte d'un message entrant réduit à sa forme de comparaison (« Arrêt ! » → « ARRET »). */
export function optOutWord(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z ]/g, '')
    .trim();
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger('WhatsApp');

  constructor(
    @InjectModel(WhatsAppRecipient.name)
    private readonly recipients: Model<WhatsAppRecipientDocument>,
    @InjectModel(WhatsAppMessage.name) private readonly messages: Model<WhatsAppMessageDocument>,
    @InjectModel(WhatsAppUsage.name) private readonly usage: Model<WhatsAppUsageDocument>,
    @Inject(SecretsService) private readonly secrets: SecretsService,
    @Inject(WhatsAppApi) private readonly api: WhatsAppApi,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ── Fournisseur de la plateforme ───────────────────────────────────────────

  /** Fournisseur utilisable, ou la raison pour laquelle rien ne doit partir. */
  async platform(): Promise<
    | { platform: WhatsAppPlatform; reason: null }
    | { platform: null; reason: WhatsAppUnavailableReason }
  > {
    const limitText = await this.secrets.configValue('whatsapp', 'monthlyLimitPerOrganization');
    if (!whatsappEnabled()) return { platform: null, reason: 'switched_off' };
    const [phoneNumberId, businessAccountId, apiVersion, accessToken, appSecret, verifyToken] =
      await Promise.all([
        this.secrets.configValue('whatsapp', 'phoneNumberId'),
        this.secrets.configValue('whatsapp', 'businessAccountId'),
        this.secrets.configValue('whatsapp', 'apiVersion'),
        this.secrets.resolve('whatsapp', 'accessToken'),
        this.secrets.resolve('whatsapp', 'appSecret'),
        this.secrets.resolve('whatsapp', 'verifyToken'),
      ]);
    if (!phoneNumberId || !businessAccountId || !accessToken || !appSecret || !verifyToken) {
      return { platform: null, reason: 'not_configured' };
    }
    if ((await this.secrets.lastTestStatus('whatsapp')) === 'failed') {
      return { platform: null, reason: 'provider_error' };
    }
    return {
      platform: {
        creds: {
          phoneNumberId,
          accessToken: accessToken.secret.expose(),
          apiVersion: whatsappApiVersion(apiVersion),
        },
        monthlyLimit: whatsappMonthlyLimit(limitText),
      },
      reason: null,
    };
  }

  /**
   * Secrets du webhook — SANS l'interrupteur `WHATSAPP_ENABLED` (un « STOP » doit
   * toujours être enregistré), mais avec celui de `/admin` (ADR-0017 : désactivé, rien).
   */
  private async webhookSecrets(): Promise<{
    appSecret: string;
    verifyToken: string;
    phoneNumberId: string;
  } | null> {
    const [phoneNumberId, appSecret, verifyToken] = await Promise.all([
      this.secrets.configValue('whatsapp', 'phoneNumberId'),
      this.secrets.resolve('whatsapp', 'appSecret'),
      this.secrets.resolve('whatsapp', 'verifyToken'),
    ]);
    if (!phoneNumberId || !appSecret || !verifyToken) return null;
    return {
      phoneNumberId,
      appSecret: appSecret.secret.expose(),
      verifyToken: verifyToken.secret.expose(),
    };
  }

  /**
   * Jeton refusé par Meta pendant un envoi : fournisseur signalé dans `/admin` (dernier
   * test en échec, code seul), envois suspendus jusqu'au prochain test réussi.
   */
  async flagProvider(code: string): Promise<void> {
    await this.secrets.reportRuntimeFailure(
      'whatsapp',
      `Envoi WhatsApp refusé par Meta (code ${code}) : jeton d’accès invalide, expiré ou sans ` +
        'les permissions whatsapp_business_messaging. Saisissez un nouveau jeton puis testez.',
    );
    this.logger.error(`Fournisseur WhatsApp signalé dans /admin : code Meta ${code}`);
  }

  // ── Quotas ─────────────────────────────────────────────────────────────────

  async quotaOf(organizationId: string, limit: number): Promise<WhatsAppView['quota']> {
    const month = kinshasaMonth();
    const doc = await this.usage
      .findOne({ organizationId, month })
      .lean<WhatsAppUsageLean>()
      .exec();
    const used = doc?.sent ?? 0;
    return { month, used, limit, reached: used >= limit };
  }

  /** Réserve un envoi sous le plafond (atomique) ; `false` = plafond atteint. */
  async reserve(organizationId: string, limit: number): Promise<boolean> {
    const month = kinshasaMonth();
    if (limit > 0) {
      try {
        await this.usage
          .findOneAndUpdate(
            { organizationId, month, sent: { $lt: limit } },
            { $inc: { sent: 1 } },
            { upsert: true, new: true },
          )
          .exec();
        return true;
      } catch (err) {
        // Document présent et plafond atteint : l'insertion d'un doublon échoue.
        if (!(err as { code?: number }).code || (err as { code?: number }).code !== 11000) {
          throw err;
        }
      }
    }
    await this.usage
      .updateOne({ organizationId, month }, { $inc: { blocked: 1 } }, { upsert: true })
      .exec();
    return false;
  }

  /** Rend un envoi réservé que Meta n'a pas accepté. */
  async release(organizationId: string): Promise<void> {
    await this.usage
      .updateOne(
        { organizationId, month: kinshasaMonth(), sent: { $gt: 0 } },
        { $inc: { sent: -1 } },
      )
      .exec();
  }

  // ── Journal des messages ───────────────────────────────────────────────────

  async recordMessage(
    organizationId: string,
    userId: string,
    wamid: string,
    template: string,
  ): Promise<void> {
    await this.messages.create({
      organizationId,
      userId,
      wamid,
      template,
      status: 'accepted',
      errorCode: null,
      statusAt: new Date(),
      expiresAt: new Date(Date.now() + WHATSAPP_MESSAGE_RETENTION_MS),
    });
  }

  /**
   * Erreur d'envoi : jeton refusé → fournisseur signalé ; destinataire injoignable →
   * numéro « à vérifier » ; le reste → journal (code seul). Jamais remonté au geste.
   */
  async onSendError(organizationId: string, userId: string, err: unknown): Promise<void> {
    const code = whatsappCodeOf(err);
    if (err instanceof WhatsAppApiError && err.kind === 'provider') {
      await this.flagProvider(code);
      return;
    }
    if (err instanceof WhatsAppApiError && err.kind === 'recipient') {
      await this.markToVerify(organizationId, userId, code);
      return;
    }
    this.logger.warn(`Envoi WhatsApp en échec (organisation ${organizationId}) : ${code}`);
  }

  private async markToVerify(organizationId: string, userId: string, code: string): Promise<void> {
    await this.recipients
      .updateOne(
        { organizationId, userId, status: 'verified' },
        { $set: { status: 'to_verify', statusReason: code } },
      )
      .exec();
    this.logger.warn(
      `Numéro WhatsApp à vérifier (organisation ${organizationId}, code Meta ${code})`,
    );
  }

  // ── Numéro de la personne ──────────────────────────────────────────────────

  async view(organizationId: string, userId: string): Promise<WhatsAppView> {
    const [state, doc] = await Promise.all([
      this.platform(),
      this.recipients.findOne({ organizationId, userId }).lean<WhatsAppRecipientLean>().exec(),
    ]);
    const limit =
      state.platform?.monthlyLimit ??
      whatsappMonthlyLimit(
        await this.secrets.configValue('whatsapp', 'monthlyLimitPerOrganization'),
      );
    const hourAgo = Date.now() - 3_600_000;
    const recent = (doc?.codeRequests ?? []).filter((d) => new Date(d).getTime() > hourAgo).length;
    const codePending =
      doc?.codeHash && doc.codeExpiresAt && doc.codeExpiresAt.getTime() > Date.now()
        ? {
            sentAt: (doc.codeSentAt ?? doc.updatedAt).toISOString(),
            expiresAt: doc.codeExpiresAt.toISOString(),
            attemptsLeft: Math.max(WHATSAPP_CODE_MAX_ATTEMPTS - (doc.codeAttempts ?? 0), 0),
          }
        : null;
    return {
      available: state.platform !== null,
      unavailableReason: state.reason,
      number:
        doc?.phone && doc.status
          ? {
              phone: doc.phone,
              phoneMasked: maskWhatsAppPhone(doc.phone),
              status: doc.status,
              verifiedAt: doc.verifiedAt ? doc.verifiedAt.toISOString() : null,
              code: codePending,
            }
          : null,
      codesLeftThisHour: Math.max(WHATSAPP_CODES_PER_HOUR - recent, 0),
      quota: await this.quotaOf(organizationId, limit),
    };
  }

  async isVerified(organizationId: string, userId: string): Promise<boolean> {
    return (
      (await this.recipients.countDocuments({
        organizationId,
        userId,
        status: 'verified',
        phone: { $ne: null },
      })) > 0
    );
  }

  /** Saisir (ou changer) son numéro : un code part sur WhatsApp. */
  async requestCode(actor: WhatsAppActor, rawPhone: string): Promise<WhatsAppView> {
    const { organizationId, userId } = actor;
    const state = await this.platform();
    if (!state.platform) {
      fail(
        HttpStatus.SERVICE_UNAVAILABLE,
        'WHATSAPP_NOT_AVAILABLE',
        'WhatsApp n’est pas disponible sur Lalanda pour le moment.',
        { reason: state.reason },
      );
    }
    const phone = normalizeWhatsAppPhone(rawPhone);
    if (!phone) {
      fail(
        HttpStatus.BAD_REQUEST,
        'WHATSAPP_PHONE_INVALID',
        'Numéro invalide : saisissez-le au format international, par exemple +243 81 234 5678.',
      );
    }
    const existing = await this.recipients
      .findOne({ organizationId, userId })
      .lean<WhatsAppRecipientLean>()
      .exec();
    if (existing?.phone === phone && existing.status === 'verified') {
      fail(HttpStatus.CONFLICT, 'WHATSAPP_ALREADY_VERIFIED', 'Ce numéro est déjà vérifié.');
    }

    // Limitation : 3 codes par heure glissante et par personne (même en changeant de
    // numéro — l'historique survit au retrait du numéro).
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 3_600_000);
    try {
      await this.recipients
        .updateOne(
          { organizationId, userId },
          {
            $setOnInsert: {
              phone: null,
              status: null,
              codeRequests: [],
              codeAttempts: 0,
              _schemaVersion: 1,
            },
          },
          { upsert: true },
        )
        .exec();
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
    }
    await this.recipients
      .updateOne({ organizationId, userId }, { $pull: { codeRequests: { $lt: hourAgo } } })
      .exec();
    const slot = await this.recipients
      .findOneAndUpdate(
        {
          organizationId,
          userId,
          [`codeRequests.${WHATSAPP_CODES_PER_HOUR - 1}`]: { $exists: false },
        },
        { $push: { codeRequests: now } },
        { new: true },
      )
      .lean<WhatsAppRecipientLean>()
      .exec();
    if (!slot) {
      const doc = await this.recipients
        .findOne({ organizationId, userId })
        .lean<WhatsAppRecipientLean>()
        .exec();
      const oldest = Math.min(...(doc?.codeRequests ?? [now]).map((d) => new Date(d).getTime()));
      fail(
        HttpStatus.TOO_MANY_REQUESTS,
        'WHATSAPP_CODE_RATE_LIMITED',
        `${WHATSAPP_CODES_PER_HOUR} codes au plus par heure : réessayez plus tard.`,
        { retryAt: new Date(oldest + 3_600_000).toISOString() },
      );
    }
    const releaseSlot = () =>
      this.recipients
        .updateOne({ organizationId, userId }, { $pull: { codeRequests: now } })
        .exec();

    if (!(await this.reserve(organizationId, state.platform.monthlyLimit))) {
      await releaseSlot();
      fail(
        HttpStatus.CONFLICT,
        'WHATSAPP_QUOTA_REACHED',
        'Le plafond mensuel d’envois WhatsApp de l’organisation est atteint.',
      );
    }

    const code = generateWhatsAppCode();
    let wamid: string;
    try {
      wamid = await this.api.sendTemplate(state.platform.creds, codeTemplateMessage(phone, code));
    } catch (err) {
      await this.release(organizationId);
      const kind = err instanceof WhatsAppApiError ? err.kind : 'other';
      this.logger.warn(
        `Code WhatsApp non envoyé à ${maskWhatsAppPhone(phone)} : ${whatsappCodeOf(err)}`,
      );
      if (kind === 'provider') {
        await this.flagProvider(whatsappCodeOf(err));
        fail(
          HttpStatus.SERVICE_UNAVAILABLE,
          'WHATSAPP_NOT_AVAILABLE',
          'WhatsApp n’est pas disponible sur Lalanda pour le moment.',
          { reason: 'provider_error' },
        );
      }
      if (kind === 'recipient') {
        fail(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'WHATSAPP_PHONE_UNREACHABLE',
          'WhatsApp ne peut pas joindre ce numéro. Vérifiez qu’il est bien inscrit sur WhatsApp.',
        );
      }
      fail(
        HttpStatus.BAD_GATEWAY,
        'WHATSAPP_SEND_FAILED',
        'WhatsApp n’a pas accepté l’envoi du code. Réessayez dans quelques instants.',
      );
    }

    await this.recipients
      .updateOne(
        { organizationId, userId },
        {
          $set: {
            phone,
            status: 'pending',
            statusReason: null,
            verifiedAt: null,
            codeHash: hashWhatsAppCode({ organizationId, userId, phone, code }, authSecret()),
            codeSentAt: now,
            codeExpiresAt: new Date(now.getTime() + WHATSAPP_CODE_TTL_MINUTES * 60_000),
            codeAttempts: 0,
          },
        },
      )
      .exec();
    await this.recordMessage(organizationId, userId, wamid, 'lalanda_code_verification');
    await this.audit.record({
      organizationId,
      actorUserId: userId,
      actorRole: actor.role,
      action: 'whatsapp.code_sent',
      targetType: 'user',
      targetId: userId,
    });
    return this.view(organizationId, userId);
  }

  private async clearCode(organizationId: string, userId: string): Promise<void> {
    await this.recipients
      .updateOne(
        { organizationId, userId },
        { $set: { codeHash: null, codeExpiresAt: null, codeAttempts: 0 } },
      )
      .exec();
  }

  /** Saisie du code reçu : numéro vérifié, ou refus motivé. */
  async verify(actor: WhatsAppActor, code: string): Promise<WhatsAppView> {
    const { organizationId, userId } = actor;
    const doc = await this.recipients
      .findOne({ organizationId, userId })
      .lean<WhatsAppRecipientLean>()
      .exec();
    if (!doc?.phone || !doc.codeHash || !doc.codeExpiresAt) {
      fail(
        HttpStatus.NOT_FOUND,
        'WHATSAPP_NO_PENDING_CODE',
        'Aucun code en attente : demandez un nouveau code.',
      );
    }
    if (doc.codeExpiresAt.getTime() <= Date.now()) {
      await this.clearCode(organizationId, userId);
      fail(HttpStatus.GONE, 'WHATSAPP_CODE_EXPIRED', 'Ce code a expiré : demandez-en un nouveau.');
    }
    const counted = await this.recipients
      .findOneAndUpdate(
        {
          organizationId,
          userId,
          codeHash: doc.codeHash,
          codeAttempts: { $lt: WHATSAPP_CODE_MAX_ATTEMPTS },
        },
        { $inc: { codeAttempts: 1 } },
        { new: true },
      )
      .lean<WhatsAppRecipientLean>()
      .exec();
    if (!counted) {
      await this.clearCode(organizationId, userId);
      fail(
        HttpStatus.TOO_MANY_REQUESTS,
        'WHATSAPP_CODE_TOO_MANY_ATTEMPTS',
        'Trop d’essais : demandez un nouveau code.',
      );
    }
    const ok = verifyWhatsAppCode(
      { organizationId, userId, phone: doc.phone, code },
      doc.codeHash,
      authSecret(),
    );
    if (!ok) {
      const attemptsLeft = Math.max(WHATSAPP_CODE_MAX_ATTEMPTS - counted.codeAttempts, 0);
      if (attemptsLeft === 0) await this.clearCode(organizationId, userId);
      fail(HttpStatus.BAD_REQUEST, 'WHATSAPP_CODE_INVALID', 'Code incorrect.', { attemptsLeft });
    }
    await this.recipients
      .updateOne(
        { organizationId, userId, codeHash: doc.codeHash },
        {
          $set: {
            status: 'verified',
            statusReason: null,
            verifiedAt: new Date(),
            optedOutAt: null,
            codeHash: null,
            codeExpiresAt: null,
            codeAttempts: 0,
          },
        },
      )
      .exec();
    await this.audit.record({
      organizationId,
      actorUserId: userId,
      actorRole: actor.role,
      action: 'whatsapp.number_verified',
      targetType: 'user',
      targetId: userId,
    });
    return this.view(organizationId, userId);
  }

  /**
   * Retirer son numéro. L'historique des demandes de code est gardé (sinon retirer puis
   * ressaisir contournerait la limite de 3 codes par heure) ; tout le reste est effacé.
   */
  async remove(actor: WhatsAppActor): Promise<WhatsAppView> {
    const { organizationId, userId } = actor;
    const res = await this.recipients
      .updateOne(
        { organizationId, userId, phone: { $ne: null } },
        {
          $set: {
            phone: null,
            status: null,
            statusReason: null,
            verifiedAt: null,
            optedOutAt: null,
            codeHash: null,
            codeSentAt: null,
            codeExpiresAt: null,
            codeAttempts: 0,
          },
        },
      )
      .exec();
    if (res.modifiedCount > 0) {
      await this.audit.record({
        organizationId,
        actorUserId: userId,
        actorRole: actor.role,
        action: 'whatsapp.number_removed',
        targetType: 'user',
        targetId: userId,
      });
    }
    return this.view(organizationId, userId);
  }

  // ── Webhook Meta ───────────────────────────────────────────────────────────

  /** Poignée de main `GET` : le `hub.challenge` à renvoyer, ou `null` (403). */
  async handshake(mode: unknown, token: unknown, challenge: unknown): Promise<string | null> {
    const hook = await this.webhookSecrets();
    if (!hook) return null;
    if (mode !== 'subscribe') return null;
    if (typeof token !== 'string' || !safeEqualText(token, hook.verifyToken)) return null;
    if (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(challenge)) return null;
    return challenge;
  }

  /** `POST` signé : statuts de livraison et « STOP ». `false` = signature refusée (401). */
  async handleWebhook(rawBody: Buffer | string, signature: string | undefined): Promise<boolean> {
    const hook = await this.webhookSecrets();
    if (!hook) return false;
    if (!verifyHubSignature({ appSecret: hook.appSecret, signature, rawBody })) return false;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString()) as Record<string, unknown>;
    } catch {
      return true;
    }
    if (payload['object'] !== 'whatsapp_business_account') return true;
    for (const entry of asArray(payload['entry'])) {
      for (const change of asArray(entry['changes'])) {
        if (change['field'] !== 'messages') continue;
        const value = (change['value'] ?? {}) as Record<string, unknown>;
        const metadata = (value['metadata'] ?? {}) as Record<string, unknown>;
        // Un autre numéro du même compte Meta : pas le nôtre, ignoré.
        if (metadata['phone_number_id'] !== hook.phoneNumberId) continue;
        for (const s of asArray(value['statuses'])) await this.applyStatus(s);
        for (const m of asArray(value['messages'])) await this.applyInbound(m);
      }
    }
    return true;
  }

  private async applyStatus(s: Record<string, unknown>): Promise<void> {
    const wamid = typeof s['id'] === 'string' ? s['id'] : null;
    const status = s['status'];
    if (
      !wamid ||
      (status !== 'sent' && status !== 'delivered' && status !== 'read' && status !== 'failed')
    ) {
      return;
    }
    const doc = await this.messages.findOne({ wamid }).lean<WhatsAppMessageLean>().exec();
    if (!doc) return;
    const errors = asArray(s['errors']);
    const errorCode =
      status === 'failed' && typeof errors[0]?.['code'] === 'number'
        ? String(errors[0]['code'])
        : null;
    // Les statuts arrivent dans le désordre : on ne recule jamais (lu > remis > envoyé).
    if (status === 'failed') {
      if (doc.status === 'read' || doc.status === 'failed') return;
    } else if (
      doc.status === 'failed' ||
      (STATUS_RANK[status] ?? 0) <= (STATUS_RANK[doc.status] ?? 0)
    ) {
      return;
    }
    await this.messages
      .updateOne({ _id: doc._id }, { $set: { status, errorCode, statusAt: new Date() } })
      .exec();
    // Échec annoncé après coup (numéro sans WhatsApp, typiquement 131026) : « à vérifier ».
    if (
      status === 'failed' &&
      errorCode &&
      whatsappErrorKind(Number(errorCode), 200) === 'recipient'
    ) {
      await this.markToVerify(doc.organizationId, doc.userId, errorCode);
    }
  }

  private async applyInbound(m: Record<string, unknown>): Promise<void> {
    const from = typeof m['from'] === 'string' ? m['from'] : '';
    if (!/^\d{8,15}$/.test(from)) return;
    let text = '';
    if (m['type'] === 'text') {
      text = String(((m['text'] ?? {}) as Record<string, unknown>)['body'] ?? '');
    } else if (m['type'] === 'button') {
      text = String(((m['button'] ?? {}) as Record<string, unknown>)['text'] ?? '');
    }
    if (!(WHATSAPP_OPT_OUT_WORDS as readonly string[]).includes(optOutWord(text))) return;
    const phone = `+${from}`;
    const docs = await this.recipients
      .find({ phone, status: { $in: ['verified', 'pending', 'to_verify'] } })
      .lean<WhatsAppRecipientLean[]>()
      .exec();
    const now = new Date();
    for (const doc of docs) {
      await this.recipients
        .updateOne(
          { _id: doc._id },
          {
            $set: {
              status: 'opted_out',
              statusReason: 'stop',
              optedOutAt: now,
              codeHash: null,
              codeExpiresAt: null,
              codeAttempts: 0,
            },
          },
        )
        .exec();
      await this.audit.record({
        organizationId: doc.organizationId,
        actorUserId: 'whatsapp',
        actorRole: 'system',
        action: 'whatsapp.opted_out',
        targetType: 'user',
        targetId: doc.userId,
      });
    }
    this.logger.log(`Retrait WhatsApp (STOP) reçu de ${maskWhatsAppPhone(phone)}`);
  }
}

function asArray(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v)
    ? (v.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>)
    : [];
}
