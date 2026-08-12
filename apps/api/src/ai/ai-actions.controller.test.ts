// Test unitaire du contrôleur /ai/corrective-actions (S14a — agent D).
// Le service est mocké pour éviter toute dépendance à OpenAI.
// S16a : la protection (auth + quota) est vérifiée via les métadonnées de décorateurs
// (pas de test temporel — voir security/throttling.test.ts).

import 'reflect-metadata';

import { PLAN_ENTITLEMENTS } from '@lalanda/shared/pricing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AiUsageService } from '../admin/ai-usage.service.js';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import type { BillingService } from '../billing/billing.service.js';
import type { Plan } from '../billing/entitlements.js';
import { AI_THROTTLE } from '../security/throttling.js';
import { UserThrottlerGuard } from '../security/user-throttler.guard.js';
import { AiActionsController } from './ai-actions.controller.js';
import { AiActionsService } from './ai-actions.service.js';
import { AiQuotaService } from './ai-quota.service.js';

/**
 * Le contrôleur passe par `AiQuotaService` (garde de quota + comptage).
 *
 * Le garde est monté RÉELLEMENT, avec seulement la base mockée : c'est lui qui
 * porte les règles qu'on veut vérifier ici (« un repli n'est pas compté comme un
 * appel facturé », « un quota épuisé refuse avant l'appel »). Le mocker
 * remplacerait le sujet du test par une doublure qui dit toujours oui.
 */
function makeController(
  svcOverrides: Partial<AiActionsService> = {},
  quotaOptions: { plan?: Plan; used?: number } = {},
): {
  controller: AiActionsController;
  record: ReturnType<typeof vi.fn>;
  correctiveActions: ReturnType<typeof vi.fn>;
} {
  const correctiveActions =
    (svcOverrides.correctiveActions as ReturnType<typeof vi.fn> | undefined) ??
    vi.fn().mockResolvedValue({ actions: [], source: 'fallback' });
  const svc = { ...svcOverrides, correctiveActions } as unknown as AiActionsService;

  const plan: Plan = quotaOptions.plan ?? 'business';
  const billing = {
    getPlanEntitlements: vi.fn().mockResolvedValue({ plan, entitlements: PLAN_ENTITLEMENTS[plan] }),
  } as unknown as BillingService;

  const record = vi.fn().mockResolvedValue(undefined);
  const usage = {
    record,
    countBilledForOrganizationSince: vi.fn().mockResolvedValue(quotaOptions.used ?? 0),
  } as unknown as AiUsageService;

  const quota = new AiQuotaService(billing, usage);
  return { controller: new AiActionsController(svc, quota), record, correctiveActions };
}

/** Requête authentifiée minimale — le contrôleur n'en lit que `orgId` et `user.id`. */
function fakeRequest(): AuthenticatedRequest {
  return { orgId: 'org-1', user: { id: 'user-1' } } as unknown as AuthenticatedRequest;
}

/** Corps accepté par le schéma — un ratio en zone rouge, le minimum utile. */
function payloadValide(): unknown {
  return {
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
  };
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

  // ─── Quota IA appliqué par l'API ───────────────────────────────
  it('refuse un quota épuisé AVANT tout appel au modèle', async () => {
    // Le quota gratuit est de 20 messages ; l'organisation en a déjà consommé 20.
    // L'appel ne doit pas atteindre le service : c'est tout l'objet de la garde.
    const { controller, correctiveActions, record } = makeController(
      {},
      { plan: 'free', used: 20 },
    );
    const erreur = await controller.corrective(fakeRequest(), payloadValide()).catch((e) => e);

    expect(erreur).toBeInstanceOf(ForbiddenException);
    const corps = (erreur as ForbiddenException).getResponse() as Record<string, unknown>;
    expect(corps['code']).toBe('PLAN_LIMIT_AI_MESSAGES');
    // Le refus dit laquelle et quand — pas un 403 nu.
    expect(corps['quota']).toBe('ai_messages');
    expect(corps['resetAt']).toBeTruthy();

    expect(correctiveActions).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('laisse passer une offre illimitée quelle que soit la consommation', async () => {
    const { controller, correctiveActions } = makeController({}, { plan: 'expert', used: 99_999 });
    await controller.corrective(fakeRequest(), payloadValide());
    expect(correctiveActions).toHaveBeenCalled();
  });

  it('un repli déterministe ne rapproche pas de la limite', async () => {
    // 19 messages consommés sur 20 : la réponse vient du repli, donc la ligne
    // écrite porte `fallback` et le décompte des appels facturés reste à 19.
    const { controller, record } = makeController(
      { correctiveActions: vi.fn().mockResolvedValue({ actions: [], source: 'fallback' }) },
      { plan: 'free', used: 19 },
    );
    await controller.corrective(fakeRequest(), payloadValide());
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ source: 'fallback' }));
  });

  it('GET /ai/quota rend la consommation sans rien consommer', async () => {
    const { controller, record } = makeController({}, { plan: 'pro', used: 42 });
    const vue = await controller.quotaStatus(fakeRequest());
    expect(vue).toMatchObject({ plan: 'pro', limit: 500, used: 42, remaining: 458 });
    expect(vue.resetAt).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    // Lire un quota n'en consomme pas.
    expect(record).not.toHaveBeenCalled();
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
