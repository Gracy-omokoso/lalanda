// ADR-0053 — P0 : `PlatformAuthGuard` n'ouvre que les routes MARQUÉES de la console, ne
// résout aucune organisation et refuse un compte bloqué.

import 'reflect-metadata';

import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { Connection } from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';

import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import {
  AllowPlatformTwoFactorPending,
  PlatformConsoleRoute,
  RequirePermission,
} from './authz.decorators.js';
import { PlatformAuthGuard, type SessionReader } from './platform-auth.guard.js';

class Routes {
  @PlatformConsoleRoute()
  console(): void {}

  orgRoute(): void {}

  @PlatformConsoleRoute()
  @RequirePermission('organization.manage')
  mixed(): void {}

  // ADR-0053 — P8
  @PlatformConsoleRoute()
  @AllowPlatformTwoFactorPending('enrollment')
  enrolement(): void {}

  @PlatformConsoleRoute()
  @AllowPlatformTwoFactorPending('verification')
  reauth(): void {}
}

@PlatformConsoleRoute()
class ConsoleController {
  overview(): void {}
}

const USER_ID = '65a1b2c3d4e5f60718293a4b';

function contexte(
  handler: () => void,
  controller: new () => unknown,
  req: Partial<AuthenticatedRequest> = {},
): { ctx: ExecutionContext; req: AuthenticatedRequest } {
  const request = { headers: {}, ...req } as AuthenticatedRequest;
  const ctx = {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, req: request };
}

// ADR-0053 — P8 : la fausse base répond par collection (compte, rôles, double
// authentification, sessions vérifiées) ; par défaut, aucun rôle plateforme.
interface Etat2fa {
  operateur?: boolean;
  enrole?: boolean;
  sessionVerifiee?: boolean;
}
function guard(
  user: { disabledAt?: Date | null } | null = {},
  etat: Etat2fa = {},
): PlatformAuthGuard {
  const lignes: Record<string, unknown> = {
    user,
    platform_roles: etat.operateur ? { _id: 'r' } : null,
    platform_two_factor: etat.enrole ? { userId: USER_ID, status: 'active' } : null,
    platform_two_factor_sessions: etat.sessionVerifiee ? { userId: USER_ID } : null,
  };
  const connection = {
    db: {
      collection: (nom: string) => ({
        findOne: async () => lignes[nom] ?? null,
        updateOne: async () => ({ modifiedCount: 1 }),
      }),
    },
  } as unknown as Connection;
  return new PlatformAuthGuard(new Reflector(), connection);
}

const original = PlatformAuthGuard.readSession;
function session(value: Awaited<ReturnType<SessionReader>>): void {
  PlatformAuthGuard.readSession = async () => value;
}

afterEach(() => {
  PlatformAuthGuard.readSession = original;
});

describe('PlatformAuthGuard (ADR-0053 § 2.2)', () => {
  const connecte = { user: { id: USER_ID, email: 'op@lalanda.test', name: 'Op' } };

  it('route marquée : session valide → passe, sans aucune organisation', async () => {
    session(connecte);
    const { ctx, req } = contexte(Routes.prototype.console, Routes, {
      orgId: 'fuite',
      targetOrgId: 'fuite',
    });
    await expect(guard().canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toEqual({ id: USER_ID, email: 'op@lalanda.test', name: 'Op' });
    expect(req.orgId).toBeUndefined();
    expect(req.targetOrgId).toBeUndefined();
  });

  it('marqueur posé sur le contrôleur : vaut pour ses routes', async () => {
    session(connecte);
    const { ctx } = contexte(ConsoleController.prototype.overview, ConsoleController);
    await expect(guard().canActivate(ctx)).resolves.toBe(true);
  });

  it('route NON marquée → 403 PLATFORM_ROUTE_REQUIRED, avant toute lecture de session', async () => {
    let lu = false;
    PlatformAuthGuard.readSession = async () => {
      lu = true;
      return connecte;
    };
    const { ctx } = contexte(Routes.prototype.orgRoute, Routes);
    await expect(guard().canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'PLATFORM_ROUTE_REQUIRED' },
      status: 403,
    });
    expect(lu).toBe(false);
  });

  it('route marquée mais déclarant une action d’organisation → 403 PLATFORM_ROUTE_REQUIRED', async () => {
    session(connecte);
    const { ctx } = contexte(Routes.prototype.mixed, Routes);
    await expect(guard().canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'PLATFORM_ROUTE_REQUIRED' },
    });
  });

  it('sans session → 401 NOT_AUTHENTICATED', async () => {
    session(null);
    const { ctx } = contexte(Routes.prototype.console, Routes);
    await expect(guard().canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'NOT_AUTHENTICATED' },
      status: 401,
    });
  });

  it('compte bloqué → 403 ACCOUNT_BLOCKED, message générique', async () => {
    session(connecte);
    const { ctx } = contexte(Routes.prototype.console, Routes);
    await expect(guard({ disabledAt: new Date() }).canActivate(ctx)).rejects.toMatchObject({
      response: {
        code: 'ACCOUNT_BLOCKED',
        message: 'Votre compte est bloqué. Contactez le support.',
      },
      status: 403,
    });
  });

  it('base injoignable → refus, jamais une console ouverte', async () => {
    session(connecte);
    const { ctx } = contexte(Routes.prototype.console, Routes);
    const sansBase = new PlatformAuthGuard(new Reflector(), {} as Connection);
    await expect(sansBase.canActivate(ctx)).rejects.toMatchObject({ status: 503 });
  });
});

// ── ADR-0053 — P8 : double authentification exigée de tout opérateur ─────────────
describe('PlatformAuthGuard — double authentification (ADR-0053 P8)', () => {
  const connecte = { user: { id: USER_ID, email: 'op@lalanda.test', name: 'Op' } };
  const cookie = { headers: { cookie: 'better-auth.session_token=jeton.signature' } };

  it('compte sans rôle plateforme : pas jugé ici (PermissionsGuard refusera)', async () => {
    session(connecte);
    const { ctx } = contexte(Routes.prototype.console, Routes, cookie);
    await expect(guard({}, {}).canActivate(ctx)).resolves.toBe(true);
  });

  it('opérateur non enrôlé → 403 PLATFORM_2FA_REQUIRED', async () => {
    session(connecte);
    const { ctx } = contexte(Routes.prototype.console, Routes, cookie);
    await expect(guard({}, { operateur: true }).canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'PLATFORM_2FA_REQUIRED' },
      status: 403,
    });
  });

  it('opérateur non enrôlé : les routes d’enrôlement restent ouvertes (aucun verrouillage)', async () => {
    session(connecte);
    const { ctx } = contexte(Routes.prototype.enrolement, Routes, cookie);
    await expect(guard({}, { operateur: true }).canActivate(ctx)).resolves.toBe(true);
  });

  it('opérateur non enrôlé : la ré-authentification ne lui est pas ouverte', async () => {
    session(connecte);
    const { ctx } = contexte(Routes.prototype.reauth, Routes, cookie);
    await expect(guard({}, { operateur: true }).canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'PLATFORM_2FA_REQUIRED' },
    });
  });

  it('enrôlé, session non vérifiée → 401 PLATFORM_2FA_VERIFICATION_REQUIRED, sauf ré-auth', async () => {
    session(connecte);
    const etat = { operateur: true, enrole: true };
    const { ctx } = contexte(Routes.prototype.console, Routes, cookie);
    await expect(guard({}, etat).canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'PLATFORM_2FA_VERIFICATION_REQUIRED' },
      status: 401,
    });
    const reauth = contexte(Routes.prototype.reauth, Routes, cookie);
    await expect(guard({}, etat).canActivate(reauth.ctx)).resolves.toBe(true);
  });

  it('enrôlé et session vérifiée → passe', async () => {
    session(connecte);
    const { ctx } = contexte(Routes.prototype.console, Routes, cookie);
    await expect(
      guard({}, { operateur: true, enrole: true, sessionVerifiee: true }).canActivate(ctx),
    ).resolves.toBe(true);
  });
});
