// Tests des bornes techniques des appels OpenAI (S22h).
//
// Cas limites couverts : absence totale de configuration (le déploiement doit
// rester borné), configuration valide, configuration invalide ou hors bornes
// (le défaut reprend la main, et l'écart est journalisé).

import { describe, expect, it, vi } from 'vitest';

import {
  AI_LIMITS_BOUNDS,
  AI_LIMITS_ENV,
  DEFAULT_AI_LIMITS,
  resolveAiLimits,
} from './ai-limits.js';

function spyLogger(): { warn: ReturnType<typeof vi.fn> } {
  return { warn: vi.fn() };
}

describe('resolveAiLimits', () => {
  it('sans aucune configuration → bornes par défaut, et elles sont FINIES', () => {
    const logger = spyLogger();
    const limits = resolveAiLimits({}, logger);

    expect(limits.maxOutputTokens).toBe(DEFAULT_AI_LIMITS.maxOutputTokens);
    expect(limits.requestTimeoutMs).toBe(DEFAULT_AI_LIMITS.requestTimeoutMs);
    // Le point du chantier : un déploiement non configuré est borné, pas illimité.
    expect(Number.isFinite(limits.maxOutputTokens)).toBe(true);
    expect(limits.maxOutputTokens).toBeGreaterThan(0);
    expect(Number.isFinite(limits.requestTimeoutMs)).toBe(true);
    expect(limits.requestTimeoutMs).toBeGreaterThan(0);
    // Cas nominal : aucun bruit dans les journaux.
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('valeurs valides → elles sont appliquées', () => {
    const logger = spyLogger();
    const limits = resolveAiLimits(
      {
        [AI_LIMITS_ENV.maxOutputTokens]: '512',
        [AI_LIMITS_ENV.requestTimeoutMs]: '4000',
      },
      logger,
    );
    expect(limits).toEqual({ maxOutputTokens: 512, requestTimeoutMs: 4000 });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('valeur non numérique → défaut appliqué ET avertissement journalisé', () => {
    const logger = spyLogger();
    const limits = resolveAiLimits({ [AI_LIMITS_ENV.maxOutputTokens]: 'beaucoup' }, logger);

    expect(limits.maxOutputTokens).toBe(DEFAULT_AI_LIMITS.maxOutputTokens);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain(AI_LIMITS_ENV.maxOutputTokens);
  });

  it('valeur au-dessus du plafond → défaut appliqué (pas de retour à l’illimité)', () => {
    const logger = spyLogger();
    const trop = AI_LIMITS_BOUNDS.maxOutputTokens.max + 1;
    const limits = resolveAiLimits({ [AI_LIMITS_ENV.maxOutputTokens]: String(trop) }, logger);

    expect(limits.maxOutputTokens).toBe(DEFAULT_AI_LIMITS.maxOutputTokens);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('valeur sous le plancher → défaut appliqué (pas de troncature systématique)', () => {
    const logger = spyLogger();
    const tropPeu = AI_LIMITS_BOUNDS.maxOutputTokens.min - 1;
    const limits = resolveAiLimits({ [AI_LIMITS_ENV.maxOutputTokens]: String(tropPeu) }, logger);

    expect(limits.maxOutputTokens).toBe(DEFAULT_AI_LIMITS.maxOutputTokens);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('délai hors bornes ou décimal → défaut appliqué et journalisé', () => {
    const logger = spyLogger();
    const limits = resolveAiLimits(
      {
        [AI_LIMITS_ENV.requestTimeoutMs]: '1.5',
      },
      logger,
    );
    expect(limits.requestTimeoutMs).toBe(DEFAULT_AI_LIMITS.requestTimeoutMs);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    const logger2 = spyLogger();
    const limits2 = resolveAiLimits(
      { [AI_LIMITS_ENV.requestTimeoutMs]: String(AI_LIMITS_BOUNDS.requestTimeoutMs.max + 1) },
      logger2,
    );
    expect(limits2.requestTimeoutMs).toBe(DEFAULT_AI_LIMITS.requestTimeoutMs);
    expect(logger2.warn).toHaveBeenCalledTimes(1);
  });

  it('chaîne vide → traitée comme une absence (défaut, sans avertissement)', () => {
    const logger = spyLogger();
    const limits = resolveAiLimits(
      { [AI_LIMITS_ENV.maxOutputTokens]: '', [AI_LIMITS_ENV.requestTimeoutMs]: '   ' },
      logger,
    );
    expect(limits.maxOutputTokens).toBe(DEFAULT_AI_LIMITS.maxOutputTokens);
    expect(limits.requestTimeoutMs).toBe(DEFAULT_AI_LIMITS.requestTimeoutMs);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('le défaut de jetons couvre largement la réponse légitime la plus longue', () => {
    // 4 actions (maximum autorisé par le schéma) × ~330 caractères ≈ 1 400
    // caractères ≈ ~470 jetons en français. Ce test verrouille la marge : si
    // quelqu'un abaisse le défaut sous ce seuil, il tronquera des réponses.
    expect(DEFAULT_AI_LIMITS.maxOutputTokens).toBeGreaterThanOrEqual(700);
  });
});
