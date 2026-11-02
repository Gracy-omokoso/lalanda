// ADR-0053 — P0 : `PlatformAuthGuard` n'ouvre que les routes MARQUÉES de la console, ne
// résout aucune organisation et refuse un compte bloqué.

import 'reflect-metadata';

import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { Connection } from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';

import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { PlatformConsoleRoute, RequirePermission } from './authz.decorators.js';
import { PlatformAuthGuard, type SessionReader } from './platform-auth.guard.js';

class Routes {
  @PlatformConsoleRoute()
  console(): void {}

  orgRoute(): void {}

  @PlatformConsoleRoute()
  @RequirePermission('organization.manage')
  mixed(): void {}
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

function guard(user: { disabledAt?: Date | null } | null = {}): PlatformAuthGuard {
  const connection = {
    db: { collection: () => ({ findOne: async () => user }) },
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
