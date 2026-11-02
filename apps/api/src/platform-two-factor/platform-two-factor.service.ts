// Double authentification des opérateurs de la console (ADR-0053 — P8).
//
// Ce service tient l'état (enrôlement, codes de secours, verrouillage, sessions vérifiées)
// et le journal ; il ne vérifie PAS le mot de passe : la preuve de présence appartient à
// `ReauthService`, qui l'appelle pour le second facteur. Ainsi un seul chemin ouvre la
// fenêtre de ré-authentification, et un seul chemin juge un code.
//
// Journal plateforme (§ 2.5) : `platform.two_factor.enrolled`, `.failed`, `.locked`,
// `.backup_code_used`, `.reset`. Jamais le secret, jamais un code, jamais un haché.

import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ObjectId, type Db } from 'mongodb';
import type { Connection } from 'mongoose';
import QRCode from 'qrcode';

import {
  PLATFORM_TWO_FACTOR,
  looksLikeBackupCode,
  type PlatformReasonCategory,
  type PlatformTwoFactorStatus,
} from '@lalanda/shared/platform';

import { MASTER_KEYRING } from '../integrations/keyring.provider.js';
import { PlatformAuditService } from '../integrations/platform-audit.service.js';
import type { EncryptedValue, MasterKeyring } from '../integrations/secrets-crypto.js';
import { openTotpSecret, sealTotpSecret } from './two-factor-crypto.js';
import { TWO_FACTOR_COLLECTION, TWO_FACTOR_SESSIONS_COLLECTION } from './two-factor.schema.js';
import { activeTwoFactorOf, isPlatformOperator, isSessionVerified } from './two-factor.store.js';
import {
  backupCodeMatches,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  newBackupCodeSalt,
  totpUri,
  verifyTotp,
} from './totp.js';

interface StoredTwoFactor {
  _id?: ObjectId;
  userId: string;
  status: 'pending' | 'active';
  secret: EncryptedValue;
  backupCodes: Array<{ hash: string; salt: string; usedAt: Date | null }>;
  lastUsedStep: number | null;
  failedAttempts: number;
  lockedUntil: Date | null;
  enrolledAt: Date | null;
  _schemaVersion: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface EnrollmentStart {
  /** URI `otpauth://` — aussi encodée dans le QR code. */
  otpauthUri: string;
  /** QR code en image PNG (`data:` URL) : aucune ressource externe. */
  qrCodeDataUrl: string;
  /** Clé à saisir à la main si la caméra n'est pas disponible (base32, groupes de 4). */
  manualKey: string;
}

/** Second facteur fourni : un code TOTP OU un code de secours. */
export interface SecondFactorInput {
  code?: string | undefined;
  backupCode?: string | undefined;
}

export type SecondFactorMethod = 'totp' | 'backup_code';

@Injectable()
export class PlatformTwoFactorService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(MASTER_KEYRING) private readonly keyring: MasterKeyring | null,
    @Inject(PlatformAuditService) private readonly audit: PlatformAuditService,
  ) {}

  private db(): Db {
    const db = this.connection.db;
    if (!db) throw new ServiceUnavailableException({ code: 'DATABASE_UNAVAILABLE' });
    return db;
  }

  private col() {
    return this.db().collection<StoredTwoFactor>(TWO_FACTOR_COLLECTION);
  }

  private requireKeyring(): MasterKeyring {
    if (!this.keyring) {
      throw new ServiceUnavailableException({
        code: 'SECRETS_UNAVAILABLE',
        message:
          'Coffre indisponible (SECRETS_MASTER_KEY absente) : la double authentification ne peut pas être enregistrée.',
      });
    }
    return this.keyring;
  }

  /** Rôles plateforme réellement détenus, pour le journal (jamais déduits de la route). */
  private async rolesOf(userId: string): Promise<string> {
    const now = new Date();
    const rows = await this.db()
      .collection<{ role: string }>('platform_roles')
      .find({ userId, revokedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] })
      .project<{ role: string }>({ role: 1 })
      .toArray();
    return rows.map((r) => r.role).join(',') || 'aucun';
  }

  private async record(
    actorUserId: string,
    action: string,
    targetId: string,
    metadata: Record<string, string | number | boolean | null> = {},
  ): Promise<void> {
    await this.audit.record({
      actorUserId,
      actorRole: await this.rolesOf(actorUserId),
      action,
      targetType: 'user',
      targetId,
      metadata,
    });
  }

  async isEnrolled(userId: string): Promise<boolean> {
    return (await activeTwoFactorOf(this.db(), userId)) !== null;
  }

  async status(userId: string, fingerprint: string | null): Promise<PlatformTwoFactorStatus> {
    const db = this.db();
    const [active, operator, verified] = await Promise.all([
      activeTwoFactorOf(db, userId),
      isPlatformOperator(db, userId),
      isSessionVerified(db, userId, fingerprint),
    ]);
    return {
      required: operator,
      enrolled: active !== null,
      sessionVerified: active !== null && verified,
      backupCodesRemaining: (active?.backupCodes ?? []).filter((c) => c.usedAt == null).length,
    };
  }

  // ── Enrôlement ──────────────────────────────────────────────────────────────

  /**
   * Remet un secret neuf (QR code + clé manuelle). Un enrôlement en attente est REMPLACÉ :
   * relancer l'enrôlement après avoir perdu l'écran ne bloque jamais. Un enrôlement actif,
   * lui, ne se remplace pas : `409` — seul un autre super-administrateur le réinitialise.
   */
  async startEnrollment(userId: string, accountLabel: string): Promise<EnrollmentStart> {
    const keyring = this.requireKeyring();
    if (await this.isEnrolled(userId)) {
      throw new ConflictException({
        code: 'TWO_FACTOR_ALREADY_ENROLLED',
        message: 'La double authentification est déjà active pour ce compte.',
      });
    }
    const secretBase32 = generateTotpSecret();
    const now = new Date();
    await this.col().updateOne(
      { userId },
      {
        $set: {
          status: 'pending',
          secret: sealTotpSecret({ userId, secretBase32, keyring }),
          backupCodes: [],
          lastUsedStep: null,
          failedAttempts: 0,
          lockedUntil: null,
          enrolledAt: null,
          _schemaVersion: 1,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );
    const otpauthUri = totpUri(secretBase32, accountLabel);
    return {
      otpauthUri,
      qrCodeDataUrl: await QRCode.toDataURL(otpauthUri, { margin: 1, width: 220 }),
      manualKey: secretBase32.match(/.{1,4}/g)?.join(' ') ?? secretBase32,
    };
  }

  /**
   * Termine l'enrôlement : le code TOTP doit être juste (même verrouillage que la
   * vérification). La présence (mot de passe) est prouvée par l'appelant AVANT. Rend les
   * 10 codes de secours, en clair UNE SEULE FOIS ; seuls leurs hachés sont conservés.
   */
  async confirmEnrollment(userId: string, code: string): Promise<{ backupCodes: string[] }> {
    const keyring = this.requireKeyring();
    const row = await this.col().findOne({ userId, status: 'pending' });
    if (!row) {
      throw new ConflictException({
        code: 'TWO_FACTOR_NOT_ENROLLED',
        message: 'Aucun enrôlement en cours : recommencez depuis le QR code.',
      });
    }
    this.assertNotLocked(row);
    const secretBase32 = openTotpSecret({ userId, record: row.secret, keyring });
    const step = verifyTotp({ secretBase32, code, nowMs: Date.now(), lastUsedStep: null });
    if (step === null) {
      await this.registerFailure(row, 'totp', 'enrollment');
      throw invalidCode();
    }
    const backupCodes = generateBackupCodes();
    const now = new Date();
    const res = await this.col().updateOne(
      { _id: row._id, status: 'pending' },
      {
        $set: {
          status: 'active',
          lastUsedStep: step,
          failedAttempts: 0,
          lockedUntil: null,
          enrolledAt: now,
          updatedAt: now,
          backupCodes: backupCodes.map((c) => {
            const salt = newBackupCodeSalt();
            return { hash: hashBackupCode(c, salt), salt, usedAt: null };
          }),
        },
      },
    );
    if (res.modifiedCount !== 1) {
      throw new ConflictException({ code: 'TWO_FACTOR_ALREADY_ENROLLED' });
    }
    await this.record(userId, 'platform.two_factor.enrolled', userId, {
      backupCodes: backupCodes.length,
    });
    return { backupCodes };
  }

  // ── Vérification ────────────────────────────────────────────────────────────

  /**
   * Juge le second facteur d'un opérateur enrôlé. Code TOTP (anti-rejeu) ou code de
   * secours (consommé). Après `maxFailedAttempts` échecs consécutifs : verrouillage de
   * `lockMinutes` (`429 TWO_FACTOR_LOCKED`). Chaque échec et chaque code de secours
   * utilisé sont journalisés.
   */
  async verifySecondFactor(userId: string, input: SecondFactorInput): Promise<SecondFactorMethod> {
    const keyring = this.requireKeyring();
    const code = input.code?.trim() ?? '';
    const backup = input.backupCode?.trim() ?? '';
    if (code === '' && backup === '') {
      throw new UnauthorizedException({
        code: 'TWO_FACTOR_CODE_REQUIRED',
        message: 'Saisissez le code de votre application d’authentification ou un code de secours.',
      });
    }
    const row = await this.col().findOne({ userId, status: 'active' });
    if (!row) {
      throw new HttpException(
        {
          code: 'PLATFORM_2FA_REQUIRED',
          message: 'Activez la double authentification pour ouvrir la console.',
        },
        HttpStatus.FORBIDDEN,
      );
    }
    this.assertNotLocked(row);

    if (backup !== '' || (code !== '' && looksLikeBackupCode(code))) {
      const candidate = backup !== '' ? backup : code;
      const index = row.backupCodes.findIndex(
        (c) => c.usedAt == null && backupCodeMatches(candidate, c.salt, c.hash),
      );
      if (index < 0) {
        await this.registerFailure(row, 'backup_code', 'verification');
        throw invalidCode();
      }
      const now = new Date();
      // Écriture conditionnée : deux requêtes simultanées avec le même code n'en
      // consomment qu'une.
      const res = await this.col().updateOne(
        { _id: row._id, [`backupCodes.${index}.usedAt`]: null },
        {
          $set: {
            [`backupCodes.${index}.usedAt`]: now,
            failedAttempts: 0,
            lockedUntil: null,
            updatedAt: now,
          },
        },
      );
      if (res.modifiedCount !== 1) throw invalidCode();
      const remaining = row.backupCodes.filter((c) => c.usedAt == null).length - 1;
      await this.record(userId, 'platform.two_factor.backup_code_used', userId, { remaining });
      return 'backup_code';
    }

    const secretBase32 = openTotpSecret({ userId, record: row.secret, keyring });
    const step = verifyTotp({
      secretBase32,
      code,
      nowMs: Date.now(),
      lastUsedStep: row.lastUsedStep,
    });
    if (step === null) {
      await this.registerFailure(row, 'totp', 'verification');
      throw invalidCode();
    }
    const res = await this.col().updateOne(
      {
        _id: row._id,
        $or: [{ lastUsedStep: null }, { lastUsedStep: { $lt: step } }],
      },
      { $set: { lastUsedStep: step, failedAttempts: 0, lockedUntil: null, updatedAt: new Date() } },
    );
    if (res.modifiedCount !== 1) throw invalidCode();
    return 'totp';
  }

  private assertNotLocked(row: StoredTwoFactor): void {
    if (row.lockedUntil && new Date(row.lockedUntil).getTime() > Date.now()) {
      throw new HttpException(
        {
          code: 'TWO_FACTOR_LOCKED',
          message: `Trop d’essais : la double authentification est verrouillée ${PLATFORM_TWO_FACTOR.lockMinutes} minutes.`,
          retryAt: new Date(row.lockedUntil).toISOString(),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async registerFailure(
    row: StoredTwoFactor,
    method: SecondFactorMethod,
    stage: 'enrollment' | 'verification',
  ): Promise<void> {
    // Un verrouillage échu repart de zéro.
    const expired = row.lockedUntil != null && new Date(row.lockedUntil).getTime() <= Date.now();
    const attempts = (expired ? 0 : (row.failedAttempts ?? 0)) + 1;
    const locks = attempts >= PLATFORM_TWO_FACTOR.maxFailedAttempts;
    const lockedUntil = locks
      ? new Date(Date.now() + PLATFORM_TWO_FACTOR.lockMinutes * 60_000)
      : null;
    await this.col().updateOne(
      { _id: row._id },
      {
        $set: {
          failedAttempts: locks ? 0 : attempts,
          lockedUntil,
          updatedAt: new Date(),
        },
      },
    );
    await this.record(row.userId, 'platform.two_factor.failed', row.userId, {
      method,
      stage,
      attempts,
    });
    if (locks) {
      await this.record(row.userId, 'platform.two_factor.locked', row.userId, {
        minutes: PLATFORM_TWO_FACTOR.lockMinutes,
      });
    }
  }

  // ── Sessions vérifiées ─────────────────────────────────────────────────────

  /** Marque CETTE session vérifiée pour la durée d'une session de console. */
  async markSessionVerified(userId: string, fingerprint: string): Promise<void> {
    const now = new Date();
    await this.db()
      .collection(TWO_FACTOR_SESSIONS_COLLECTION)
      .updateOne(
        { userId, sessionFingerprint: fingerprint },
        {
          $set: {
            verifiedAt: now,
            expiresAt: new Date(
              now.getTime() + PLATFORM_TWO_FACTOR.sessionVerificationHours * 3_600_000,
            ),
            updatedAt: now,
            _schemaVersion: 1,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true },
      );
  }

  // ── Réinitialisation (par un AUTRE super-administrateur) ───────────────────

  /**
   * Retire la double authentification d'un opérateur qui a perdu son téléphone et ses
   * codes. Deux personnes : la cible et un super-administrateur DISTINCT (`409
   * SELF_RESET_FORBIDDEN` sinon) ; motif obligatoire ; ré-authentification de la console
   * (mot de passe + code) exigée par la route. Effets : enrôlement supprimé, sessions
   * vérifiées et fenêtres de ré-authentification de la cible effacées, sessions de
   * connexion révoquées. À sa prochaine entrée, la cible est envoyée vers l'enrôlement.
   */
  async reset(
    targetUserId: string,
    input: { reasonCategory: PlatformReasonCategory; internalNote: string },
    actorUserId: string,
  ): Promise<{ reset: true; revokedSessions: number }> {
    if (targetUserId === actorUserId) {
      throw new ConflictException({
        code: 'SELF_RESET_FORBIDDEN',
        message:
          'Un opérateur ne réinitialise pas sa propre double authentification : utilisez un code de secours, ou demandez-le à un autre super-administrateur.',
      });
    }
    const db = this.db();
    const ids: Array<string | ObjectId> = [targetUserId];
    if (ObjectId.isValid(targetUserId)) ids.push(new ObjectId(targetUserId));
    const user = await db.collection('user').findOne({ _id: { $in: ids } } as never);
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND' });
    const del = await this.col().deleteOne({ userId: targetUserId });
    if (del.deletedCount !== 1) {
      throw new ConflictException({
        code: 'TWO_FACTOR_NOT_ENROLLED',
        message: 'Ce compte n’a pas de double authentification à réinitialiser.',
      });
    }
    await db.collection(TWO_FACTOR_SESSIONS_COLLECTION).deleteMany({ userId: targetUserId });
    await db.collection('platform_reauth').deleteMany({ userId: targetUserId });
    const sessions = await db.collection('session').deleteMany({ userId: { $in: ids } } as never);
    await this.record(actorUserId, 'platform.two_factor.reset', targetUserId, {
      reasonCategory: input.reasonCategory,
      internalNote: input.internalNote,
      revokedSessions: sessions.deletedCount,
    });
    return { reset: true, revokedSessions: sessions.deletedCount };
  }
}

function invalidCode(): UnauthorizedException {
  return new UnauthorizedException({
    code: 'INVALID_TWO_FACTOR_CODE',
    message: 'Code refusé.',
  });
}
