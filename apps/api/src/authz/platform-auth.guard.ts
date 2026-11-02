// ─────────────────────────────────────────────────────────────────────────────
// `PlatformAuthGuard` — authentification de la CONSOLE LALANDA (ADR-0053 § 2.2, P0)
//
// Remplace `AuthGuard` sur les routes de la console, et sur elles seules. Il vérifie :
//   1. que la route est EXPLICITEMENT marquée `@PlatformConsoleRoute()` et ne déclare
//      aucune action d'organisation (`@RequirePermission`) — sinon 403
//      `PLATFORM_ROUTE_REQUIRED`, quel que soit l'appelant ;
//   2. une session better-auth valide — sinon 401 `NOT_AUTHENTICATED` ;
//   3. un compte non bloqué (`user.disabledAt`) — sinon 403 `ACCOUNT_BLOCKED`, message
//      générique (§ 6.1).
// Il ne résout AUCUNE organisation et ne pose pas `req.orgId` : un opérateur sans
// appartenance ouvre la console (corrige F2), et une route d'organisation câblée par
// erreur derrière lui ne peut pas « emprunter » une organisation — `PermissionsGuard`
// répondrait `403 NO_ORGANIZATION` (aucune organisation active), et le marqueur
// manquant la refuse avant même la session.
//
// Ce guard n'autorise rien de plus qu'`AuthGuard` : l'autorisation reste celle de
// `PermissionsGuard` (rôle ou action PLATEFORME exigés). L'ordre imposé est
// `@UseGuards(PlatformAuthGuard, PermissionsGuard)`.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectConnection } from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import type { Connection } from 'mongoose';

import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { getAuth } from '../auth/auth.js';
import {
  CONSOLE_IDLE_EXEMPT_KEY,
  PLATFORM_CONSOLE_ROUTE_KEY,
  // ADR-0053 — P8
  PLATFORM_TWO_FACTOR_EXEMPT_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from './authz.decorators.js';
// ADR-0053 — P8
import { twoFactorGateOf } from '../platform-two-factor/two-factor.store.js';
// ADR-0053 — P2
import { PLATFORM_LIMITS } from '@lalanda/shared/platform';
import { sessionFingerprint } from '../integrations/reauth.service.js';

/** Message générique d'un compte bloqué : ne dit ni qui, ni pourquoi (§ 6.1). */
export const ACCOUNT_BLOCKED_MESSAGE = 'Votre compte est bloqué. Contactez le support.';

/** Lecture de session, isolée pour les tests unitaires du guard. */
export type SessionReader = (
  headers: Headers,
) => Promise<{ user?: { id: unknown; email: string; name?: string | null } } | null>;

const readSessionFromBetterAuth: SessionReader = async (headers) =>
  (await getAuth().api.getSession({ headers })) as Awaited<ReturnType<SessionReader>>;

@Injectable()
export class PlatformAuthGuard implements CanActivate {
  /** Remplaçable par les tests unitaires ; better-auth en production. */
  static readSession: SessionReader = readSessionFromBetterAuth;

  // @Inject explicites — vitest n'émet pas `emitDecoratorMetadata`.
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isConsoleRoute =
      this.reflector.getAllAndOverride<boolean | undefined>(PLATFORM_CONSOLE_ROUTE_KEY, targets) ===
      true;
    const orgActions = this.reflector.getAllAndOverride<string[] | undefined>(
      REQUIRED_PERMISSIONS_KEY,
      targets,
    );
    if (!isConsoleRoute || (orgActions?.length ?? 0) > 0) {
      // Erreur de câblage, jamais une décision sur l'appelant : refus avant toute lecture.
      throw new ForbiddenException({
        code: 'PLATFORM_ROUTE_REQUIRED',
        message: 'Route réservée à la console Lalanda.',
      });
    }

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const session = await PlatformAuthGuard.readSession(
      new Headers(req.headers as Record<string, string>),
    );
    if (!session?.user) throw new UnauthorizedException({ code: 'NOT_AUTHENTICATED' });

    const userId = String(session.user.id);
    if (await this.isBlocked(userId)) {
      throw new ForbiddenException({ code: 'ACCOUNT_BLOCKED', message: ACCOUNT_BLOCKED_MESSAGE });
    }

    // ADR-0053 — P8 : double authentification exigée de tout opérateur (décision n° 2).
    await this.assertTwoFactor(userId, req.headers.cookie, targets);

    // ADR-0053 — P2 : session de console de 12 heures d'inactivité (§ 2.4).
    const idleExempt =
      this.reflector.getAllAndOverride<boolean | undefined>(CONSOLE_IDLE_EXEMPT_KEY, targets) ===
      true;
    await this.touchConsoleSession(userId, req.headers.cookie, idleExempt);

    req.user = { id: userId, email: session.user.email, name: session.user.name ?? null };
    // Délibérément AUCUNE organisation : ni `orgId`, ni `targetOrgId`.
    delete req.orgId;
    delete req.targetOrgId;
    return true;
  }

  /** `user.disabledAt` posé (champ hors schéma better-auth, ADR-0053 § 4). */
  private async isBlocked(userId: string): Promise<boolean> {
    const db = this.connection.db;
    // Base injoignable : refus (jamais une console ouverte faute d'avoir pu lire le blocage).
    if (!db) throw new ServiceUnavailableException({ code: 'DATABASE_UNAVAILABLE' });
    const _id = ObjectId.isValid(userId) ? new ObjectId(userId) : userId;
    const user = await db
      .collection<{ _id: ObjectId | string; disabledAt?: Date | null }>('user')
      .findOne({ _id }, { projection: { disabledAt: 1 } });
    return user?.disabledAt != null;
  }

  // ── ADR-0053 — P8 : double authentification des opérateurs ───────────────────
  //
  // Tout détenteur d'un rôle plateforme actif doit (1) être enrôlé — sinon
  // `403 PLATFORM_2FA_REQUIRED`, et seules les routes d'enrôlement lui restent ouvertes :
  // aucun opérateur n'est enfermé dehors — et (2) avoir vérifié CETTE session par un code
  // depuis moins de 12 heures — sinon `401 PLATFORM_2FA_VERIFICATION_REQUIRED`, et seule
  // `/admin/reauth` (mot de passe + code) lui reste ouverte. Un compte sans rôle plateforme
  // n'est pas jugé ici : `PermissionsGuard` le refuse de toute façon (403).
  private async assertTwoFactor(
    userId: string,
    cookieHeader: string | undefined,
    targets: Parameters<Reflector['getAllAndOverride']>[1],
  ): Promise<void> {
    const exempt = this.reflector.getAllAndOverride<'enrollment' | 'verification' | undefined>(
      PLATFORM_TWO_FACTOR_EXEMPT_KEY,
      targets,
    );
    if (exempt === 'enrollment') return;
    const db = this.connection.db;
    if (!db) throw new ServiceUnavailableException({ code: 'DATABASE_UNAVAILABLE' });
    const gate = await twoFactorGateOf(db, userId, sessionFingerprint(cookieHeader));
    if (gate === 'enrollment_required') {
      throw new ForbiddenException({
        code: 'PLATFORM_2FA_REQUIRED',
        message:
          'La console Lalanda exige la double authentification : activez-la depuis la console.',
      });
    }
    if (gate === 'verification_required' && exempt !== 'verification') {
      throw new UnauthorizedException({
        code: 'PLATFORM_2FA_VERIFICATION_REQUIRED',
        message: 'Confirmez votre mot de passe et le code de votre application d’authentification.',
      });
    }
  }

  // ── ADR-0053 — P2 : session de console de 12 heures d'inactivité (§ 2.4) ──────
  //
  // La session better-auth dure plusieurs jours et sert aussi l'espace organisation ;
  // la console, elle, se referme après 12 heures sans y être revenu. L'activité est
  // suivie PAR SESSION (empreinte SHA-256 du cookie, jamais le jeton) dans
  // `platform_console_activity`. Au-delà de 12 heures : `401 CONSOLE_SESSION_EXPIRED`,
  // sauf si une ré-authentification de CETTE session a eu lieu depuis la dernière
  // activité (`platform_reauth.confirmedAt`) — c'est ainsi que la console se rouvre,
  // par `POST /admin/reauth` (exempté) ou `POST /me/reauth`. Une première visite, ou une
  // requête sans cookie de session (tests unitaires), n'est jamais refusée par ce
  // contrôle ; l'espace organisation n'est jamais touché.
  private async touchConsoleSession(
    userId: string,
    cookieHeader: string | undefined,
    idleExempt: boolean,
  ): Promise<void> {
    const fingerprint = sessionFingerprint(cookieHeader);
    const db = this.connection.db;
    if (!fingerprint || !db) return;
    const now = Date.now();
    const activity = db.collection<{
      userId: string;
      sessionFingerprint: string;
      lastSeenAt: Date;
    }>(CONSOLE_ACTIVITY_COLLECTION);
    const row = await activity.findOne({ userId, sessionFingerprint: fingerprint });
    const last = row ? new Date(row.lastSeenAt).getTime() : null;
    if (last !== null && now - last > CONSOLE_IDLE_MS && !idleExempt) {
      const reauth = await db.collection('platform_reauth').findOne({
        userId,
        sessionFingerprint: fingerprint,
        confirmedAt: { $gt: new Date(last) },
        // ADR-0053 — P8 : seule une ré-authentification avec le code rouvre la console.
        secondFactor: true,
      });
      if (!reauth) {
        throw new UnauthorizedException({
          code: 'CONSOLE_SESSION_EXPIRED',
          message:
            'Session de console expirée après 12 heures d’inactivité : ré-authentifiez-vous.',
        });
      }
    }
    // Une écriture par minute au plus : l'inactivité se mesure en heures.
    if (idleExempt && last !== null && now - last > CONSOLE_IDLE_MS) return;
    if (last === null || now - last > 60_000) {
      await activity.updateOne(
        { userId, sessionFingerprint: fingerprint },
        { $set: { lastSeenAt: new Date(now) } },
        { upsert: true },
      );
    }
  }
}

/** Collection de l'activité de console, par session (ADR-0053 — P2). */
export const CONSOLE_ACTIVITY_COLLECTION = 'platform_console_activity';
const CONSOLE_IDLE_MS = PLATFORM_LIMITS.consoleSessionIdleHours * 3_600_000;
