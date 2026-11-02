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
import { PLATFORM_CONSOLE_ROUTE_KEY, REQUIRED_PERMISSIONS_KEY } from './authz.decorators.js';

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
}
