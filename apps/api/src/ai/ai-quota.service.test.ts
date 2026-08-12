// Garde de quota IA — le branchement de la règle sur la base et sur HTTP.
//
// La RÈGLE est testée à part (`billing/ai-quota.test.ts`, sans dépendance). Ici
// on teste ce que le service ajoute, et qui est précisément là où un quota se
// perd en pratique :
//
//   · l'ordre des opérations (refuser AVANT d'appeler, compter APRÈS);
//   · le fait qu'un repli déterministe n'entame pas le quota;
//   · le fait qu'une offre illimitée ne lise même pas le compteur;
//   · le fait que l'antériorité d'un abonné soit respectée par le quota aussi.

import { PLAN_ENTITLEMENTS } from '@lalanda/shared/pricing';
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AiUsageService } from '../admin/ai-usage.service.js';
import { AI_QUOTA_ERROR_CODE } from '../billing/ai-quota.js';
import type { BillingService } from '../billing/billing.service.js';
import type { Entitlements, Plan } from '../billing/entitlements.js';
import { AiQuotaService } from './ai-quota.service.js';

const MI_AOUT = new Date('2026-08-12T10:00:00.000Z');

function makeService(options: {
  plan: Plan;
  entitlements?: Entitlements;
  /** Messages FACTURÉS déjà consommés dans le mois. */
  used?: number;
}): {
  service: AiQuotaService;
  record: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
} {
  const billing = {
    getPlanEntitlements: vi.fn().mockResolvedValue({
      plan: options.plan,
      entitlements: options.entitlements ?? PLAN_ENTITLEMENTS[options.plan],
    }),
  } as unknown as BillingService;

  const count = vi.fn().mockResolvedValue(options.used ?? 0);
  const record = vi.fn().mockResolvedValue(undefined);
  const usage = {
    countBilledForOrganizationSince: count,
    record,
  } as unknown as AiUsageService;

  return { service: new AiQuotaService(billing, usage), record, count };
}

const CONTEXT = { organizationId: 'org-1', userId: 'user-1', action: 'ai.lala_chat' };

describe('lecture du quota', () => {
  it('rend la consommation, le reste et la date de réinitialisation', async () => {
    const { service } = makeService({ plan: 'pro', used: 120 });
    const status = await service.status('org-1', MI_AOUT);
    expect(status.plan).toBe('pro');
    expect(status.limit).toBe(500);
    expect(status.used).toBe(120);
    expect(status.remaining).toBe(380);
    expect(status.resetAt.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('compte depuis le 1er du mois courant, jamais depuis 30 jours en arrière', async () => {
    // Une fenêtre glissante serait inexplicable (« votre quota repart quand ? »)
    // et ferait dépendre le reste de l'heure exacte du premier appel du mois.
    const { service, count } = makeService({ plan: 'pro' });
    await service.status('org-1', MI_AOUT);
    expect(count).toHaveBeenCalledWith('org-1', new Date('2026-08-01T00:00:00.000Z'));
  });

  it('ne compte même pas sur une offre illimitée', async () => {
    // Le décompte est sur le chemin chaud de chaque message : le lire pour
    // ignorer son résultat serait une requête par message, pour rien.
    const { service, count } = makeService({ plan: 'expert' });
    const status = await service.status('org-1', MI_AOUT);
    expect(status.unlimited).toBe(true);
    expect(status.remaining).toBeNull();
    expect(count).not.toHaveBeenCalled();
  });

  it("respecte l'antériorité : le quota lit les entitlements SERVIS, pas la grille", async () => {
    // Un abonné historique est servi par `resolveEntitlements` via
    // `getPlanEntitlements`. Si le quota relisait `PLAN_ENTITLEMENTS[plan]` de
    // son côté, il opposerait une limite que l'abonnement ne porte pas.
    const negocie: Entitlements = { ...PLAN_ENTITLEMENTS.pro, aiMessagesPerMonth: 5_000 };
    const { service } = makeService({ plan: 'pro', entitlements: negocie, used: 900 });
    const status = await service.status('org-1', MI_AOUT);
    expect(status.limit).toBe(5_000);
    expect(status.exceeded).toBe(false);
  });
});

describe('garde de quota', () => {
  it('laisse passer tant que le quota n’est pas épuisé', async () => {
    const { service } = makeService({ plan: 'free', used: 19 });
    await expect(service.assertWithinQuota('org-1', MI_AOUT)).resolves.toMatchObject({
      remaining: 1,
    });
  });

  it('refuse en 403 dès la limite atteinte, en disant laquelle et quand', async () => {
    const { service } = makeService({ plan: 'free', used: 20 });
    const erreur = await service.assertWithinQuota('org-1', MI_AOUT).catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(ForbiddenException);
    const corps = (erreur as ForbiddenException).getResponse() as Record<string, unknown>;
    // Pas un « 403 » nu : l'utilisateur doit savoir ce qui est bloqué et
    // jusqu'à quand.
    expect(corps['code']).toBe(AI_QUOTA_ERROR_CODE);
    expect(corps['quota']).toBe('ai_messages');
    expect(corps['limit']).toBe(20);
    expect(corps['resetAt']).toBe('2026-09-01T00:00:00.000Z');
    expect(String(corps['message'])).toContain('1er du mois prochain');
  });

  it('n’oppose jamais de refus à une offre illimitée', async () => {
    const { service } = makeService({ plan: 'expert', used: 10_000 });
    await expect(service.assertWithinQuota('org-1', MI_AOUT)).resolves.toMatchObject({
      unlimited: true,
    });
  });
});

describe('comptage', () => {
  it('trace un appel au modèle', async () => {
    const { service, record } = makeService({ plan: 'pro' });
    await service.record(CONTEXT, 'llm');
    expect(record).toHaveBeenCalledWith({
      organizationId: 'org-1',
      userId: 'user-1',
      action: 'ai.lala_chat',
      source: 'llm',
    });
  });

  it('trace un repli SANS le compter comme appel au modèle', async () => {
    // La trace reste écrite : le tableau de bord doit voir les replis, sinon une
    // clé expirée passe inaperçue. Mais elle porte `source: 'fallback'`, et
    // c'est ce filtre qui exclut la ligne du quota.
    const { service, record } = makeService({ plan: 'pro' });
    await service.record(CONTEXT, 'fallback');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ source: 'fallback' }));
  });
});

describe('runGuarded — l’ordre des opérations', () => {
  it('refuse AVANT d’exécuter quoi que ce soit de payant', async () => {
    const { service, record } = makeService({ plan: 'free', used: 20 });
    const run = vi.fn();

    await expect(service.runGuarded(CONTEXT, run)).rejects.toBeInstanceOf(ForbiddenException);
    // Le point entier de la garde : l'appel payant n'a pas eu lieu.
    expect(run).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('exécute puis compte, à partir de la source RÉELLE de la réponse', async () => {
    const { service, record } = makeService({ plan: 'pro', used: 10 });
    const valeur = await service.runGuarded(CONTEXT, async () => ({
      value: { reponse: 'ok' },
      source: 'llm' as const,
    }));
    expect(valeur).toEqual({ reponse: 'ok' });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ source: 'llm' }));
  });

  it('un repli n’entame pas le quota', async () => {
    // EXIGENCE DE FOND : facturer un repli déterministe reviendrait à faire payer
    // une panne de configuration. Vérifié ici de bout en bout, pas seulement sur
    // la fonction pure.
    const { service, record } = makeService({ plan: 'free', used: 19 });
    await service.runGuarded(CONTEXT, async () => ({
      value: 'repli',
      source: 'fallback' as const,
    }));

    expect(record).toHaveBeenCalledWith(expect.objectContaining({ source: 'fallback' }));
    // La ligne écrite porte `fallback` : `countBilledForOrganizationSince` filtre
    // sur `llm`, donc le quota reste à 19 et le message suivant passe.
    const { service: suivant } = makeService({ plan: 'free', used: 19 });
    await expect(suivant.assertWithinQuota('org-1', MI_AOUT)).resolves.toMatchObject({
      remaining: 1,
    });
  });

  it('vingt replis d’affilée ne ferment pas un quota gratuit', async () => {
    // Scénario réel : la clé OpenAI n'est pas configurée. Tous les appels
    // basculent en repli. Un comptage naïf viderait les 20 messages du plan
    // gratuit sans qu'aucun modèle n'ait été appelé.
    const { service, record } = makeService({ plan: 'free', used: 0 });
    for (let i = 0; i < 20; i += 1) {
      await service.runGuarded(CONTEXT, async () => ({ value: i, source: 'fallback' as const }));
    }
    expect(record).toHaveBeenCalledTimes(20);
    for (const appel of record.mock.calls) {
      expect((appel[0] as { source: string }).source).toBe('fallback');
    }
  });

  it('ne compte rien quand l’exécution échoue', async () => {
    // Une requête qui n'a produit aucune réponse n'a rien consommé du point de
    // vue de l'utilisateur, quoi qu'elle ait coûté en interne. Le choix est en
    // sa faveur, délibérément.
    const { service, record } = makeService({ plan: 'pro', used: 10 });
    await expect(
      service.runGuarded(CONTEXT, async () => {
        throw new Error('modèle indisponible');
      }),
    ).rejects.toThrow('modèle indisponible');
    expect(record).not.toHaveBeenCalled();
  });

  it('transmet l’état du quota à l’appelable', async () => {
    // Permet à un assistant d'adapter sa réponse (« il vous reste 2 messages »)
    // sans refaire la lecture qui vient d'être faite.
    const { service } = makeService({ plan: 'pro', used: 498 });
    await service.runGuarded(CONTEXT, async (status) => {
      expect(status.remaining).toBe(2);
      return { value: null, source: 'llm' as const };
    });
  });
});
