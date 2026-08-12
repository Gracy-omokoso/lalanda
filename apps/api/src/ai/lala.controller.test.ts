// Tests du contrôleur Lala (S24a). Le service est mocké : aucune dépendance IA.
//
// Comme pour `/ai/corrective-actions` (S16a), la protection est vérifiée via les
// MÉTADONNÉES des décorateurs — pas par un test temporel, qui appartient à
// `security/throttling.test.ts`. Ce fichier vérifie aussi la couture laissée au
// chantier offres : des noms d'action stables, et un comptage qui distingue un
// appel facturé d'un repli.

import 'reflect-metadata';

import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AccountService } from '../account/account.service.js';
import { AiUsageService } from '../admin/ai-usage.service.js';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { REQUIRED_PERMISSIONS_KEY } from '../authz/authz.decorators.js';
import { AI_THROTTLE } from '../security/throttling.js';
import { UserThrottlerGuard } from '../security/user-throttler.guard.js';
import { ACTION_CHAT, ACTION_INTERPRETATIONS, LalaController } from './lala.controller.js';
import { LalaService } from './lala.service.js';
import type { ChatResponse, InterpretationsResponse } from './lala.dto.js';

const REPONSE_INTERPRETATIONS: InterpretationsResponse = {
  sheetId: 'ratios',
  interpretations: [{ lineId: 'dscr', texte: 'Votre DSCR ressort à 0,82.', source: 'llm' }],
  source: 'llm',
  avertissementFeuille: null,
  mention: 'mention',
};

const REPONSE_CHAT: ChatResponse = {
  reply: 'Le feu est rouge.',
  source: 'fallback',
  avertissementFeuille: null,
  mention: 'mention',
};

function makeController(
  over: {
    interpretations?: InterpretationsResponse;
    chat?: ChatResponse;
    locale?: string;
    getPreferences?: () => Promise<unknown>;
  } = {},
): {
  controller: LalaController;
  record: ReturnType<typeof vi.fn>;
  interpretations: ReturnType<typeof vi.fn>;
  chat: ReturnType<typeof vi.fn>;
} {
  const interpretations = vi.fn().mockResolvedValue(over.interpretations ?? REPONSE_INTERPRETATIONS);
  const chat = vi.fn().mockResolvedValue(over.chat ?? REPONSE_CHAT);
  const svc = { interpretations, chat } as unknown as LalaService;

  const record = vi.fn().mockResolvedValue(undefined);
  const usage = { record } as unknown as AiUsageService;

  const getPreferences =
    over.getPreferences ?? vi.fn().mockResolvedValue({ locale: over.locale ?? 'fr' });
  const account = { getPreferences } as unknown as AccountService;

  return { controller: new LalaController(svc, usage, account), record, interpretations, chat };
}

function fakeRequest(): AuthenticatedRequest {
  return { orgId: 'org-1', user: { id: 'user-1' } } as unknown as AuthenticatedRequest;
}

const CORPS_INTERPRETATIONS = {
  templateSlug: 'commerce-detail',
  sheetId: 'ratios',
  lines: [
    {
      sheetId: 'ratios',
      lineId: 'dscr',
      label: 'DSCR',
      value: 0.82,
      format: 'number' as const,
    },
  ],
  lineIds: ['dscr'],
};

const CORPS_CHAT = {
  ...CORPS_INTERPRETATIONS,
  lineId: 'dscr',
  messages: [{ role: 'user' as const, content: 'Pourquoi ?' }],
};

describe('LalaController — validation', () => {
  it('400 sur un payload d’interprétation invalide, sans rien consommer', async () => {
    const { controller, record, interpretations } = makeController();
    await expect(controller.interpretations(fakeRequest(), { sheetId: 'ratios' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(interpretations).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('400 si le dernier message n’est pas celui de l’utilisateur', async () => {
    const { controller, chat } = makeController();
    await expect(
      controller.chat(fakeRequest(), {
        ...CORPS_CHAT,
        messages: [
          { role: 'user', content: 'Pourquoi ?' },
          { role: 'assistant', content: 'Parce que.' },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(chat).not.toHaveBeenCalled();
  });

  it('400 si la ligne d’origine ne figure pas dans les lignes fournies', async () => {
    const { controller } = makeController();
    await expect(
      controller.chat(fakeRequest(), { ...CORPS_CHAT, lineId: 'ligne_absente' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('LalaController — langue', () => {
  it('lit la langue dans les préférences de l’utilisateur, pas dans la requête', async () => {
    const getPreferences = vi.fn().mockResolvedValue({ locale: 'fr' });
    const { controller, interpretations } = makeController({ getPreferences });

    await controller.interpretations(fakeRequest(), CORPS_INTERPRETATIONS);

    expect(getPreferences).toHaveBeenCalledWith('user-1');
    expect(interpretations).toHaveBeenCalledWith(expect.anything(), 'fr');
  });

  it('une lecture de préférences en échec ne fait pas échouer la réponse', async () => {
    const getPreferences = vi.fn().mockRejectedValue(new Error('mongo indisponible'));
    const { controller, interpretations } = makeController({ getPreferences });

    const res = await controller.interpretations(fakeRequest(), CORPS_INTERPRETATIONS);

    expect(res).toEqual(REPONSE_INTERPRETATIONS);
    expect(interpretations).toHaveBeenCalledWith(expect.anything(), undefined);
  });
});

describe('LalaController — comptage (couture du quota d’offre)', () => {
  it('les noms d’action sont stables et distincts', () => {
    expect(ACTION_INTERPRETATIONS).toBe('ai.interpretations');
    expect(ACTION_CHAT).toBe('ai.lala_chat');
  });

  it('un appel servi par le LLM est compté comme facturé', async () => {
    const { controller, record } = makeController();
    await controller.interpretations(fakeRequest(), CORPS_INTERPRETATIONS);
    expect(record).toHaveBeenCalledWith({
      organizationId: 'org-1',
      userId: 'user-1',
      action: ACTION_INTERPRETATIONS,
      source: 'llm',
    });
  });

  it('un repli déterministe n’est PAS compté comme un appel facturé', async () => {
    const { controller, record } = makeController();
    await controller.chat(fakeRequest(), CORPS_CHAT);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: ACTION_CHAT, source: 'fallback' }));
  });
});

describe('LalaController — protection', () => {
  it('les deux routes exigent l’authentification et le quota technique', () => {
    for (const methode of ['interpretations', 'chat'] as const) {
      const guardsControleur: unknown[] = Reflect.getMetadata('__guards__', LalaController) ?? [];
      const guardsMethode: unknown[] =
        Reflect.getMetadata('__guards__', LalaController.prototype[methode]) ?? [];

      expect(guardsControleur).toContain(AuthGuard);
      expect(guardsMethode).toContain(UserThrottlerGuard);

      // Clés posées par @Throttle({ default: ... }) — mêmes bornes que S16a.
      const handler = LalaController.prototype[methode];
      expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(AI_THROTTLE.limit);
      expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(AI_THROTTLE.ttl);
    }
  });

  it('les deux routes exigent la permission analytics.read', () => {
    for (const methode of ['interpretations', 'chat'] as const) {
      const permissions = Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        LalaController.prototype[methode],
      ) as unknown;
      expect(permissions).toEqual(['analytics.read']);
    }
  });
});
