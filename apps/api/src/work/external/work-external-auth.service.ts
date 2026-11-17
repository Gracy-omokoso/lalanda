// Connexion à l'espace externe — ADR-0078 § 3.
//
// Un compte propre (adresse) + un code à usage unique envoyé par e-mail À CHAQUE
// connexion ; aucune mémorisation d'appareil, aucun mot de passe.
//
//   1. `requestCode(email)` : même réponse que l'adresse ait un compte actif ou non ; un
//      code (6 chiffres, 10 minutes) n'est créé ET envoyé que pour un compte actif dont la
//      fiche (client ou fournisseur) est active. Les codes précédents de l'adresse sont
//      invalidés. Le code est stocké HACHÉ.
//   2. `verify(email, code)` : défi le plus récent non consommé et non expiré ; au plus
//      5 essais (le 5ᵉ échec invalide le code) ; comparaison à temps constant ; le code
//      est consommé ATOMIQUEMENT à l'usage. Message unique pour adresse inconnue, code
//      faux, expiré ou épuisé. Plusieurs organisations : 409 avec la liste, le code reste
//      valable le temps du choix (il n'est pas compté comme un échec).
//   3. Session : jeton aléatoire de 32 octets en cookie `httpOnly`, seul son SHA-256 est
//      stocké ; durée absolue de 12 h ; révoquée à la déconnexion et à la fermeture de
//      l'accès. Elle n'est JAMAIS une session better-auth : `AuthGuard` ne la reconnaît pas,
//      aucune route de l'ERP ne lui répond.
//
// Débit : seaux par adresse et par IP (`work-external-throttler.guard.ts`), en plus du
// garde global. Audit : demande (sans dire si l'adresse existe : seulement pour un compte
// connu), connexion, échec de code, déconnexion — identifiants seulement.

import {
  WORK_EXTERNAL_AUTH,
  kinshasaDayOf,
  type PortalMeView,
  type PortalOrganizationChoice,
} from '@lalanda/shared/work';
import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { MailService } from '../../mail/mail.service.js';
import { badRequest, conflict } from '../work.common.js';
import { externalAuditRole, WorkExternalLifecycle } from './work-external-lifecycle.js';
import {
  hashExternalCode,
  hashSessionToken,
  newExternalCode,
  newSessionToken,
  sameHash,
} from './work-external-crypto.js';
import {
  WorkExternalAccount,
  WorkExternalChallenge,
  WorkExternalSession,
  type WorkExternalAccountDocument,
  type WorkExternalAccountLean,
  type WorkExternalChallengeDocument,
  type WorkExternalChallengeLean,
  type WorkExternalSessionDocument,
  type WorkExternalSessionLean,
} from './work-external.schemas.js';

/** Message unique d'un échec de code : il ne dit jamais si l'adresse existe. */
export const EXTERNAL_CODE_INVALID_MESSAGE =
  'Code invalide ou expiré. Vérifiez le dernier code reçu, ou demandez-en un nouveau.';

/** Contexte d'une requête de l'espace externe (posé par `ExternalAuthGuard`). */
export interface ExternalContext {
  sessionId: string;
  accountId: string;
  organizationId: string;
  kind: 'client' | 'consultant';
  name: string;
  email: string;
  /** Contact client : sa fiche client (seuls les projets de cette fiche lui sont ouverts). */
  customerId: string | null;
}

export function codeInvalid(): never {
  badRequest('EXTERNAL_CODE_INVALID', EXTERNAL_CODE_INVALID_MESSAGE);
}

export function sessionEnded(): never {
  throw new UnauthorizedException({
    code: 'EXTERNAL_SESSION_REQUIRED',
    message: 'Votre session est terminée : reconnectez-vous avec un nouveau code.',
  });
}

@Injectable()
export class WorkExternalAuthService {
  private readonly logger = new Logger('WorkExternalAuth');

  constructor(
    @InjectModel(WorkExternalAccount.name)
    private readonly accounts: Model<WorkExternalAccountDocument>,
    @InjectModel(WorkExternalChallenge.name)
    private readonly challenges: Model<WorkExternalChallengeDocument>,
    @InjectModel(WorkExternalSession.name)
    private readonly sessions: Model<WorkExternalSessionDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(WorkExternalLifecycle) private readonly lifecycle: WorkExternalLifecycle,
  ) {}

  /** Travaux de demande de code en cours (après la réponse, B1) ; attendus par les tests. */
  private readonly background = new Set<Promise<void>>();

  /** Attend la fin des demandes de code traitées en arrière-plan (tests, arrêt propre). */
  async settled(): Promise<void> {
    await Promise.allSettled([...this.background]);
  }

  /** Compte en pause (trop de codes faux, B2) ? */
  private paused(account: WorkExternalAccountLean, now: Date): boolean {
    return !!account.pausedUntil && new Date(account.pausedUntil).getTime() > now.getTime();
  }

  /**
   * Comptes UTILISABLES de l'adresse : actifs, fiche active, au moins un projet ouvert, hors
   * pause.
   */
  private async usableAccounts(
    email: string,
    now = new Date(),
  ): Promise<WorkExternalAccountLean[]> {
    const docs = await this.accounts
      .find({ email, status: 'active' })
      .limit(20)
      .lean<WorkExternalAccountLean[]>()
      .exec();
    const out: WorkExternalAccountLean[] = [];
    for (const d of docs) {
      if (this.paused(d, now)) continue;
      if (!(await this.lifecycle.ensureUsable(d))) continue;
      if ((await this.lifecycle.openProjectsOf(d.organizationId, String(d._id))).length === 0) {
        continue;
      }
      out.push(d);
    }
    return out;
  }

  /**
   * `POST /portal/auth/request-code` — réponse identique dans tous les cas, rendue AVANT tout
   * accès à la base (revue B1) : le travail (comptes, défi, e-mail, audit) se fait ensuite,
   * en arrière-plan ; la durée de la réponse ne dit rien de l'existence d'un compte.
   */
  requestCode(email: string, now = new Date()): { sent: true } {
    const work = this.processCodeRequest(email, now)
      .catch((err: unknown) => {
        this.logger.error(
          `Demande de code de l'espace externe en échec : ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => this.background.delete(work));
    this.background.add(work);
    return { sent: true };
  }

  private async processCodeRequest(email: string, now: Date): Promise<void> {
    const accounts = await this.usableAccounts(email, now);
    if (accounts.length === 0) return;
    // M2 : une nouvelle demande ne tue plus le code vivant. Délai minimal entre deux codes
    // (60 s) : dans ce délai, rien n'est créé ni envoyé (même réponse au demandeur).
    const latest = await this.challenges
      .findOne({ email, consumedAt: null, expiresAt: { $gt: now } })
      .sort({ createdAt: -1 })
      .lean<WorkExternalChallengeLean>()
      .exec();
    if (
      latest &&
      now.getTime() - new Date(latest.createdAt).getTime() <
        WORK_EXTERNAL_AUTH.minRequestIntervalSeconds * 1000
    ) {
      return;
    }
    // Plafond par compte et par jour, tenu en base (au-dessus des seaux par adresse et IP).
    const day = kinshasaDayOf(now);
    const allowed: WorkExternalAccountLean[] = [];
    for (const a of accounts) {
      const count = a.codeRequestDay === day ? (a.codeRequestCount ?? 0) : 0;
      await this.accounts
        .updateOne(
          { _id: a._id },
          { $set: { codeRequestDay: day, codeRequestCount: count + 1 } },
          { timestamps: false },
        )
        .exec();
      if (count + 1 > WORK_EXTERNAL_AUTH.codeRequestsPerDayMax) {
        if (count === WORK_EXTERNAL_AUTH.codeRequestsPerDayMax) {
          await this.audit.record({
            organizationId: a.organizationId,
            actorUserId: String(a._id),
            actorRole: externalAuditRole(a.kind),
            action: 'work.external.code_requests_capped',
            targetType: 'work_external_account',
            targetId: String(a._id),
            metadata: { day, max: WORK_EXTERNAL_AUTH.codeRequestsPerDayMax },
          });
        }
        continue;
      }
      allowed.push(a);
    }
    if (allowed.length === 0) return;
    const code = newExternalCode();
    const _id = new Types.ObjectId();
    await this.challenges.create({
      _id,
      email,
      accountIds: allowed.map((a) => String(a._id)),
      codeHash: hashExternalCode(String(_id), code),
      expiresAt: new Date(now.getTime() + WORK_EXTERNAL_AUTH.codeTtlMinutes * 60_000),
      attempts: 0,
      consumedAt: null,
      createdAt: now,
      _schemaVersion: 1,
    });
    // Au plus deux codes vivants : les plus anciens ne servent plus.
    const live = await this.challenges
      .find({ email, consumedAt: null }, { _id: 1 })
      .sort({ createdAt: -1, _id: -1 })
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    const stale = live.slice(WORK_EXTERNAL_AUTH.liveChallengesMax).map((c) => c._id);
    if (stale.length > 0) {
      await this.challenges
        .updateMany({ _id: { $in: stale }, consumedAt: null }, { $set: { consumedAt: now } })
        .exec();
    }
    await this.mail.sendExternalAccessCode({
      to: email,
      code,
      name: allowed[0]!.name,
      expiresInMinutes: WORK_EXTERNAL_AUTH.codeTtlMinutes,
    });
    for (const a of allowed) {
      await this.audit.record({
        organizationId: a.organizationId,
        actorUserId: String(a._id),
        actorRole: externalAuditRole(a.kind),
        action: 'work.external.code_requested',
        targetType: 'work_external_account',
        targetId: String(a._id),
        metadata: { challengeId: String(_id) },
      });
    }
  }

  /**
   * B2 (révisé) : un échec de code compte pour chaque compte du défi. Tous les 20 codes faux
   * du jour : codes vivants invalidés et PAUSE des demandes, croissante le même jour (15 min,
   * 1 h, puis 4 h au plus) ; audit, et e-mail d'avertissement une fois par palier. Aucun
   * verrou long : un tiers qui connaît l'adresse ne bloque pas le titulaire une journée, et
   * `work.manage` lève tout par `POST /work/external-accounts/:id/unlock`.
   */
  private async recordFailure(challenge: WorkExternalChallengeLean, now: Date): Promise<void> {
    const ids = challenge.accountIds.filter((i) => /^[0-9a-f]{24}$/i.test(i));
    if (ids.length === 0) return;
    const day = kinshasaDayOf(now);
    const accounts = await this.accounts
      .find({ _id: { $in: ids.map((i) => new Types.ObjectId(i)) } })
      .lean<WorkExternalAccountLean[]>()
      .exec();
    for (const a of accounts) {
      const count = (a.authFailureDay === day ? (a.authFailureCount ?? 0) : 0) + 1;
      const pause = count % WORK_EXTERNAL_AUTH.failuresPerPause === 0;
      const paliers = WORK_EXTERNAL_AUTH.pauseMinutes;
      const level = pause ? (a.pauseDay === day ? (a.pauseLevel ?? 0) : 0) + 1 : 0;
      const minutes = paliers[Math.min(level, paliers.length) - 1] ?? 0;
      const pausedUntil = new Date(now.getTime() + minutes * 60_000);
      await this.accounts
        .updateOne(
          { _id: a._id },
          {
            $set: {
              authFailureDay: day,
              authFailureCount: count,
              ...(pause ? { pausedUntil, pauseDay: day, pauseLevel: level } : {}),
            },
          },
          { timestamps: false },
        )
        .exec();
      if (!pause) continue;
      await this.audit.record({
        organizationId: a.organizationId,
        actorUserId: String(a._id),
        actorRole: externalAuditRole(a.kind),
        action: 'work.external.paused',
        targetType: 'work_external_account',
        targetId: String(a._id),
        metadata: { failures: count, level, minutes, pausedUntil: pausedUntil.toISOString() },
      });
      // Les codes encore vivants de l'adresse tombent avec la pause.
      await this.challenges
        .updateMany({ email: challenge.email, consumedAt: null }, { $set: { consumedAt: now } })
        .exec();
      // Un avertissement par palier (15 min, 1 h, 4 h), pas à chaque pause de 4 h suivante.
      if (level <= paliers.length) {
        await this.mail.sendExternalLockWarning({
          to: a.email,
          name: a.name,
          pausedUntil,
          minutes,
        });
      }
    }
  }

  /**
   * `POST /portal/auth/verify` — rend le jeton de session (posé en cookie par le contrôleur)
   * et le compte ouvert.
   */
  async verify(
    email: string,
    code: string,
    organizationId: string | undefined,
    now = new Date(),
  ): Promise<{ token: string; expiresAt: Date; me: PortalMeView }> {
    // Au plus deux codes vivants (M2), essais restants seulement (B3).
    const candidates = await this.challenges
      .find({
        email,
        consumedAt: null,
        expiresAt: { $gt: now },
        attempts: { $lt: WORK_EXTERNAL_AUTH.maxAttempts },
      })
      .sort({ createdAt: -1, _id: -1 })
      .limit(WORK_EXTERNAL_AUTH.liveChallengesMax)
      .lean<WorkExternalChallengeLean[]>()
      .exec();
    if (candidates.length === 0) {
      // Même coût qu'une vraie comparaison, même réponse.
      sameHash(hashExternalCode('0'.repeat(24), code), '00');
      codeInvalid();
    }
    // Toutes les empreintes sont comparées (temps constant, pas d'arrêt au premier égal).
    let challenge: WorkExternalChallengeLean | undefined;
    for (const c of candidates) {
      if (sameHash(hashExternalCode(String(c._id), code), c.codeHash) && !challenge) challenge = c;
    }
    if (!challenge) {
      const latest = candidates[0]!;
      const attempts = latest.attempts + 1;
      await this.challenges
        .updateOne(
          { _id: latest._id, consumedAt: null },
          {
            $inc: { attempts: 1 },
            ...(attempts >= WORK_EXTERNAL_AUTH.maxAttempts ? { $set: { consumedAt: now } } : {}),
          },
        )
        .exec();
      await this.auditForChallenge(latest, 'work.external.code_failed', {
        challengeId: String(latest._id),
        attempts,
        exhausted: attempts >= WORK_EXTERNAL_AUTH.maxAttempts,
      });
      await this.recordFailure(latest, now);
      codeInvalid();
    }
    const id = String(challenge._id);
    // Code juste : comptes encore utilisables (et non verrouillés) parmi ceux du défi.
    const accounts = (await this.usableAccounts(email, now)).filter((a) =>
      challenge.accountIds.includes(String(a._id)),
    );
    if (accounts.length === 0) {
      await this.challenges.updateOne({ _id: challenge._id }, { $set: { consumedAt: now } }).exec();
      codeInvalid();
    }
    let account: WorkExternalAccountLean | undefined;
    if (accounts.length === 1 && !organizationId) account = accounts[0];
    else if (organizationId) account = accounts.find((a) => a.organizationId === organizationId);
    if (!account) {
      if (organizationId) codeInvalid();
      const choices: PortalOrganizationChoice[] = [];
      for (const a of accounts) {
        choices.push({
          organizationId: a.organizationId,
          organizationName: await this.organizationName(a.organizationId),
        });
      }
      conflict(
        'EXTERNAL_ORGANIZATION_REQUIRED',
        'Cette adresse ouvre plusieurs organisations : choisissez celle à ouvrir.',
        { organizations: choices },
      );
    }
    // Consommation ATOMIQUE : deux vérifications concurrentes n'ouvrent qu'une session ; le
    // code jumeau éventuel tombe aussi (un code juste consomme les codes vivants).
    const consumed = await this.challenges
      .updateOne({ _id: challenge._id, consumedAt: null }, { $set: { consumedAt: now } })
      .exec();
    if (consumed.modifiedCount !== 1) codeInvalid();
    await this.challenges
      .updateMany({ email, consumedAt: null }, { $set: { consumedAt: now } })
      .exec();

    const token = newSessionToken();
    const expiresAt = new Date(now.getTime() + WORK_EXTERNAL_AUTH.sessionHours * 3_600_000);
    const session = await this.sessions.create({
      organizationId: account.organizationId,
      accountId: String(account._id),
      tokenHash: hashSessionToken(token),
      createdAt: now,
      expiresAt,
      revokedAt: null,
      revokedReason: null,
      _schemaVersion: 1,
    });
    await this.accounts
      .updateOne(
        { _id: account._id },
        { $set: { lastLoginAt: now, authFailureCount: 0 } },
        { timestamps: false },
      )
      .exec();
    await this.audit.record({
      organizationId: account.organizationId,
      actorUserId: String(account._id),
      actorRole: externalAuditRole(account.kind),
      action: 'work.external.signed_in',
      targetType: 'work_external_session',
      targetId: String(session._id),
      metadata: { accountId: String(account._id), challengeId: id },
    });
    return {
      token,
      expiresAt,
      me: {
        accountId: String(account._id),
        kind: account.kind,
        name: account.name,
        email: account.email,
        organizationName: await this.organizationName(account.organizationId),
      },
    };
  }

  private async auditForChallenge(
    challenge: WorkExternalChallengeLean,
    action: string,
    metadata: Record<string, string | number | boolean>,
  ): Promise<void> {
    const ids = challenge.accountIds.filter((i) => /^[0-9a-f]{24}$/i.test(i));
    if (ids.length === 0) return;
    const accounts = await this.accounts
      .find({ _id: { $in: ids.map((i) => new Types.ObjectId(i)) } }, { organizationId: 1, kind: 1 })
      .lean<{ _id: Types.ObjectId; organizationId: string; kind: 'client' | 'consultant' }[]>()
      .exec();
    for (const a of accounts) {
      await this.audit.record({
        organizationId: a.organizationId,
        actorUserId: String(a._id),
        actorRole: externalAuditRole(a.kind),
        action,
        targetType: 'work_external_account',
        targetId: String(a._id),
        metadata,
      });
    }
  }

  async organizationName(organizationId: string): Promise<string> {
    if (!/^[0-9a-f]{24}$/i.test(organizationId)) return '';
    const doc = await this.connection
      .collection('organizations')
      .findOne({ _id: new Types.ObjectId(organizationId) }, { projection: { name: 1 } });
    return String(doc?.['name'] ?? '');
  }

  /**
   * Session d'un jeton : non révoquée, non expirée, compte actif à fiche active, au moins
   * un accès ouvert. Sinon 401 (et, pour une fiche désactivée ou plus aucun accès, la
   * fermeture est appliquée et tracée).
   */
  async resolve(token: string | undefined, now = new Date()): Promise<ExternalContext> {
    if (!token || token.length > 200) sessionEnded();
    const session = await this.sessions
      .findOne({ tokenHash: hashSessionToken(token), revokedAt: null, expiresAt: { $gt: now } })
      .lean<WorkExternalSessionLean>()
      .exec();
    if (!session) sessionEnded();
    const account = await this.accounts
      .findOne({
        _id: new Types.ObjectId(session.accountId),
        organizationId: session.organizationId,
      })
      .lean<WorkExternalAccountLean>()
      .exec();
    if (!account || !(await this.lifecycle.ensureUsable(account))) {
      await this.sessions
        .updateOne({ _id: session._id }, { $set: { revokedAt: now, revokedReason: 'closed' } })
        .exec();
      sessionEnded();
    }
    const role = { userId: String(account._id), role: externalAuditRole(account.kind) };
    if (
      (await this.lifecycle.openProjectsOf(account.organizationId, String(account._id))).length ===
      0
    ) {
      await this.lifecycle.revokeSessions(
        account.organizationId,
        String(account._id),
        'no_access',
        role,
      );
      sessionEnded();
    }
    return {
      sessionId: String(session._id),
      accountId: String(account._id),
      organizationId: account.organizationId,
      kind: account.kind,
      name: account.name,
      email: account.email,
      customerId: account.customerId ?? null,
    };
  }

  /** `POST /portal/auth/logout` — révoque la session du cookie (sans erreur si absente). */
  async logout(token: string | undefined, now = new Date()): Promise<void> {
    if (!token || token.length > 200) return;
    const session = await this.sessions
      .findOneAndUpdate(
        { tokenHash: hashSessionToken(token), revokedAt: null },
        { $set: { revokedAt: now, revokedReason: 'logout' } },
      )
      .lean<WorkExternalSessionLean>()
      .exec();
    if (!session) return;
    const account = await this.accounts
      .findOne({ _id: new Types.ObjectId(session.accountId) }, { kind: 1 })
      .lean<{ kind: 'client' | 'consultant' }>()
      .exec();
    await this.audit.record({
      organizationId: session.organizationId,
      actorUserId: session.accountId,
      actorRole: externalAuditRole(account?.kind ?? 'client'),
      action: 'work.external.signed_out',
      targetType: 'work_external_session',
      targetId: String(session._id),
      metadata: { accountId: session.accountId },
    });
  }

  async me(ctx: ExternalContext): Promise<PortalMeView> {
    return {
      accountId: ctx.accountId,
      kind: ctx.kind,
      name: ctx.name,
      email: ctx.email,
      organizationName: await this.organizationName(ctx.organizationId),
    };
  }
}
