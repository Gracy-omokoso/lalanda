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
  type PortalMeView,
  type PortalOrganizationChoice,
} from '@lalanda/shared/work';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
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

  /** Comptes UTILISABLES de l'adresse : actifs, fiche active, au moins un projet ouvert. */
  private async usableAccounts(email: string): Promise<WorkExternalAccountLean[]> {
    const docs = await this.accounts
      .find({ email, status: 'active' })
      .limit(20)
      .lean<WorkExternalAccountLean[]>()
      .exec();
    const out: WorkExternalAccountLean[] = [];
    for (const d of docs) {
      if (!(await this.lifecycle.ensureUsable(d))) continue;
      if ((await this.lifecycle.openProjectsOf(d.organizationId, String(d._id))).length === 0) {
        continue;
      }
      out.push(d);
    }
    return out;
  }

  /** `POST /portal/auth/request-code` — réponse identique dans tous les cas. */
  async requestCode(email: string, now = new Date()): Promise<{ sent: true }> {
    const accounts = await this.usableAccounts(email);
    // Les codes encore valables de l'adresse ne servent plus (un seul code vivant).
    await this.challenges
      .updateMany({ email, consumedAt: null }, { $set: { consumedAt: now } })
      .exec();
    if (accounts.length === 0) return { sent: true };
    const code = newExternalCode();
    const _id = new Types.ObjectId();
    await this.challenges.create({
      _id,
      email,
      accountIds: accounts.map((a) => String(a._id)),
      codeHash: hashExternalCode(String(_id), code),
      expiresAt: new Date(now.getTime() + WORK_EXTERNAL_AUTH.codeTtlMinutes * 60_000),
      attempts: 0,
      consumedAt: null,
      createdAt: now,
      _schemaVersion: 1,
    });
    // Envoi NON attendu : la durée de la réponse ne trahit pas l'existence d'un compte
    // (`MailService` ne lève jamais ; un échec d'envoi est journalisé par le transport).
    void this.mail.sendExternalAccessCode({
      to: email,
      code,
      name: accounts[0]!.name,
      expiresInMinutes: WORK_EXTERNAL_AUTH.codeTtlMinutes,
    });
    for (const a of accounts) {
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
    return { sent: true };
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
    const challenge = await this.challenges
      .findOne({ email, consumedAt: null, expiresAt: { $gt: now } })
      .sort({ createdAt: -1 })
      .lean<WorkExternalChallengeLean>()
      .exec();
    if (!challenge) {
      // Même coût qu'une vraie comparaison, même réponse.
      sameHash(hashExternalCode('0'.repeat(24), code), '00');
      codeInvalid();
    }
    const id = String(challenge._id);
    if (!sameHash(hashExternalCode(id, code), challenge.codeHash)) {
      const attempts = challenge.attempts + 1;
      await this.challenges
        .updateOne(
          { _id: challenge._id, consumedAt: null },
          {
            $inc: { attempts: 1 },
            ...(attempts >= WORK_EXTERNAL_AUTH.maxAttempts ? { $set: { consumedAt: now } } : {}),
          },
        )
        .exec();
      await this.auditForChallenge(challenge, 'work.external.code_failed', {
        challengeId: id,
        attempts,
        exhausted: attempts >= WORK_EXTERNAL_AUTH.maxAttempts,
      });
      codeInvalid();
    }
    // Code juste : comptes encore utilisables parmi ceux du défi.
    const accounts = (await this.usableAccounts(email)).filter((a) =>
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
    // Consommation ATOMIQUE : deux vérifications concurrentes n'ouvrent qu'une session.
    const consumed = await this.challenges
      .updateOne({ _id: challenge._id, consumedAt: null }, { $set: { consumedAt: now } })
      .exec();
    if (consumed.modifiedCount !== 1) codeInvalid();

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
      .updateOne({ _id: account._id }, { $set: { lastLoginAt: now } }, { timestamps: false })
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
