// Tests de configuration du rate limiting (S16a) — pas de test temporel :
// on vérifie les constantes, les métadonnées de décorateurs et le câblage du module,
// pas le comportement horloge-dépendant du throttler (couvert par la lib elle-même).

import 'reflect-metadata';

import { describe, expect, it } from 'vitest';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';

import { AI_THROTTLE, GLOBAL_THROTTLE } from './throttling.js';
import { ThrottlingModule } from './throttling.module.js';
import { UserThrottlerGuard } from './user-throttler.guard.js';

describe('rate limiting (S16a)', () => {
  it('limite globale : 100 req/min', () => {
    expect(GLOBAL_THROTTLE).toEqual({ ttl: 60_000, limit: 100 });
  });

  it('quota IA : 10 req/min (endpoint facturé OpenAI, ADR-0008)', () => {
    expect(AI_THROTTLE).toEqual({ ttl: 60_000, limit: 10 });
  });

  it('ThrottlingModule enregistre le ThrottlerGuard en guard global (APP_GUARD)', () => {
    const providers = Reflect.getMetadata('providers', ThrottlingModule) as unknown[];
    expect(providers).toContainEqual({ provide: APP_GUARD, useClass: ThrottlerGuard });
    expect(providers).toContain(UserThrottlerGuard);
  });

  it('ThrottlingModule est @Global (UserThrottlerGuard dispo partout, comme AuthGuard)', () => {
    expect(Reflect.getMetadata('__module:global__', ThrottlingModule)).toBe(true);
  });

  describe('UserThrottlerGuard — compteur indexé par utilisateur', () => {
    // getTracker n'utilise ni options ni storage : on peut instancier avec des stubs.
    const guard = new UserThrottlerGuard(
      { throttlers: [] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      new Reflector(),
    );
    // Accès à la méthode protégée pour le test.
    const getTracker = (req: Record<string, unknown>): Promise<string> =>
      (guard as unknown as { getTracker(r: Record<string, unknown>): Promise<string> }).getTracker(
        req,
      );

    it("trace par id utilisateur quand AuthGuard a posé req.user", async () => {
      await expect(
        getTracker({ user: { id: 'u42', email: 'a@b.c' }, ip: '10.0.0.1' }),
      ).resolves.toBe('user:u42');
    });

    it('fallback IP si pas de user (défense en profondeur)', async () => {
      await expect(getTracker({ ip: '10.0.0.1' })).resolves.toBe('ip:10.0.0.1');
    });
  });
});
