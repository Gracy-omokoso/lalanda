// Test unitaire du contrôleur /ai/corrective-actions (S14a — agent D).
// Le service est mocké pour éviter toute dépendance à OpenAI.
// S16a : la protection (auth + quota) est vérifiée via les métadonnées de décorateurs
// (pas de test temporel — voir security/throttling.test.ts).

import 'reflect-metadata';

import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AuthGuard } from '../auth/auth.guard.js';
import { AI_THROTTLE } from '../security/throttling.js';
import { UserThrottlerGuard } from '../security/user-throttler.guard.js';
import { AiActionsController } from './ai-actions.controller.js';
import { AiActionsService } from './ai-actions.service.js';

function makeController(svcOverrides: Partial<AiActionsService> = {}): AiActionsController {
  const svc = {
    correctiveActions: vi.fn().mockResolvedValue({ actions: [], source: 'fallback' }),
    ...svcOverrides,
  } as unknown as AiActionsService;
  return new AiActionsController(svc);
}

describe('AiActionsController', () => {
  it('400 si le payload est invalide', async () => {
    const controller = makeController();
    await expect(controller.corrective({ templateSlug: '', lines: [] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('délègue au service et retourne son résultat', async () => {
    const controller = makeController({
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
    const res = await controller.corrective({
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
