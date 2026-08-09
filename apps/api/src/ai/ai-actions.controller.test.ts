// Test unitaire du contrôleur /ai/corrective-actions (S14a — agent D).
// Le service est mocké pour éviter toute dépendance à OpenAI.
// S16a : la protection (auth + quota) est vérifiée via les métadonnées de décorateurs
// (pas de test temporel — voir security/throttling.test.ts).

import 'reflect-metadata';

import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AiUsageService } from '../admin/ai-usage.service.js';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { AI_THROTTLE } from '../security/throttling.js';
import { UserThrottlerGuard } from '../security/user-throttler.guard.js';
import { AiActionsController } from './ai-actions.controller.js';
import { AiActionsService } from './ai-actions.service.js';

/**
 * S21b — le contrôleur compte désormais sa consommation (`AiUsageService`) pour
 * alimenter le tableau de bord `/admin`. Le compteur est mocké et RENVOYÉ au
 * test : c'est lui qui porte l'assertion « un fallback n'est pas compté comme un
 * appel facturé ».
 */
function makeController(svcOverrides: Partial<AiActionsService> = {}): {
  controller: AiActionsController;
  record: ReturnType<typeof vi.fn>;
} {
  const svc = {
    correctiveActions: vi.fn().mockResolvedValue({ actions: [], source: 'fallback' }),
    ...svcOverrides,
  } as unknown as AiActionsService;
  const record = vi.fn().mockResolvedValue(undefined);
  const usage = { record } as unknown as AiUsageService;
  return { controller: new AiActionsController(svc, usage), record };
}

/** Requête authentifiée minimale — le contrôleur n'en lit que `orgId` et `user.id`. */
function fakeRequest(): AuthenticatedRequest {
  return { orgId: 'org-1', user: { id: 'user-1' } } as unknown as AuthenticatedRequest;
}

describe('AiActionsController', () => {
  it('400 si le payload est invalide', async () => {
    const { controller } = makeController();
    await expect(
      controller.corrective(fakeRequest(), { templateSlug: '', lines: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("un payload invalide n'est pas compté : rien n'a été consommé", async () => {
    const { controller, record } = makeController();
    await expect(
      controller.corrective(fakeRequest(), { templateSlug: '', lines: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(record).not.toHaveBeenCalled();
  });

  it('délègue au service et retourne son résultat', async () => {
    const { controller } = makeController({
      correctiveActions: vi.fn().mockResolvedValue({
        actions: [
          {
            ratio: 'dscr',
            severity: 'rouge',
            suggestion: 's',
            expected_impact: 'i',
          },
        ],
        source: 'fallback',
      }),
    });
    const res = await controller.corrective(fakeRequest(), {
      templateSlug: 'x',
      drivers: {},
      lines: [
        {
          sheetId: 'ratios',
          lineId: 'dscr',
          label: 'DSCR',
          value: 0.9,
          format: 'number',
          seuil: { valeur: 1.25, direction: 'min', statut: 'rouge' },
        },
      ],
    });
    expect(res.actions).toHaveLength(1);
    expect(res.source).toBe('fallback');
  });

  it.each([
    ['fallback', 'fallback'],
    ['llm', 'llm'],
  ])('un appel de source « %s » est compté « %s » (S21b)', async (source, attendu) => {
    // Le tableau de bord `/admin` distingue les appels FACTURÉS des replis
    // déterministes. Compter un fallback comme un appel OpenAI ferait croire à
    // une consommation qui n'a jamais eu lieu — et inversement.
    const { controller, record } = makeController({
      correctiveActions: vi.fn().mockResolvedValue({ actions: [], source }),
    });
    await controller.corrective(fakeRequest(), {
      templateSlug: 'x',
      drivers: {},
      lines: [
        {
          sheetId: 'ratios',
          lineId: 'dscr',
          label: 'DSCR',
          value: 0.9,
          format: 'number',
          seuil: { valeur: 1.25, direction: 'min', statut: 'rouge' },
        },
      ],
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ai.corrective_actions', source: attendu }),
    );
  });

  // ─── S16a : durcissement sécurité ──────────────────────────────
  it('le contrôleur est protégé par AuthGuard (endpoint facturé)', () => {
    // '__guards__' = GUARDS_METADATA de @nestjs/common.
    const guards = Reflect.getMetadata('__guards__', AiActionsController) as unknown[];
    expect(guards).toContain(AuthGuard);
  });

  it('la route corrective porte le quota par utilisateur (UserThrottlerGuard)', () => {
    const routeGuards = Reflect.getMetadata(
      '__guards__',
      AiActionsController.prototype.corrective,
    ) as unknown[];
    expect(routeGuards).toContain(UserThrottlerGuard);
  });

  it('la route corrective est limitée à AI_THROTTLE (10 req/min)', () => {
    // Clés posées par @Throttle({ default: ... }) : THROTTLER:LIMIT/TTL + nom du throttler.
    const handler = AiActionsController.prototype.corrective;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(AI_THROTTLE.limit);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(AI_THROTTLE.ttl);
  });
});
