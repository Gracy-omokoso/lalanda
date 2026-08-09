// Tests de l'adaptateur OpenAI (S22h — bornes techniques).
//
// Le SDK `openai` est intégralement mocké : aucun appel réseau, aucune clé
// réelle. Ces tests vérifient que CHAQUE appel part borné et que les deux
// dépassements possibles (jetons, délai) lèvent une erreur typée — condition
// pour que `AiActionsService` puisse retomber sur son repli déterministe en le
// journalisant.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const createMock = vi.fn();

vi.mock('openai', () => {
  class FakeOpenAI {
    chat = { completions: { create: createMock } };
    constructor(public opts: { apiKey: string }) {}
  }
  return { default: FakeOpenAI };
});

const {
  createOpenAIClient,
  runWithDeadline,
  OpenAIKeyUnavailableError,
  OpenAITimeoutError,
  OpenAITruncatedResponseError,
} = await import('./openai-client.js');
const { DEFAULT_AI_LIMITS } = await import('./ai-limits.js');

/** Réponse SDK bien formée. */
function okResponse(content: string, finishReason = 'stop'): unknown {
  return { choices: [{ message: { content }, finish_reason: finishReason }] };
}

const PROMPT = { system: 'sys', user: 'usr', model: 'gpt-4o-mini' };
const keyOk = async (): Promise<string> => 'sk-test';

beforeEach(() => {
  createMock.mockReset();
});

describe('createOpenAIClient — borne de jetons en sortie', () => {
  it('envoie max_tokens sur CHAQUE appel, avec le défaut sûr', async () => {
    createMock.mockResolvedValue(okResponse('{"actions":[]}'));
    const client = await createOpenAIClient(keyOk);
    expect(client).not.toBeNull();

    await client?.chatJson(PROMPT);

    expect(createMock).toHaveBeenCalledTimes(1);
    const body = createMock.mock.calls[0]?.[0] as { max_tokens?: number };
    // Sans le correctif, `max_tokens` est absent : l'appel n'a aucun plafond.
    expect(body.max_tokens).toBe(DEFAULT_AI_LIMITS.maxOutputTokens);
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  it('respecte une borne de jetons configurée', async () => {
    createMock.mockResolvedValue(okResponse('{"actions":[]}'));
    const client = await createOpenAIClient(keyOk, {
      maxOutputTokens: 777,
      requestTimeoutMs: 5_000,
    });
    await client?.chatJson(PROMPT);
    const body = createMock.mock.calls[0]?.[0] as { max_tokens?: number };
    expect(body.max_tokens).toBe(777);
  });

  it('réponse tronquée (finish_reason="length") → erreur typée, pas de JSON incomplet renvoyé', async () => {
    // Le modèle a été coupé en plein JSON : le contenu est syntaxiquement faux.
    createMock.mockResolvedValue(okResponse('{"actions":[{"ratio":"dscr","sugg', 'length'));
    const client = await createOpenAIClient(keyOk, {
      maxOutputTokens: 300,
      requestTimeoutMs: 5_000,
    });

    await expect(client?.chatJson(PROMPT)).rejects.toBeInstanceOf(OpenAITruncatedResponseError);
    await expect(client?.chatJson(PROMPT)).rejects.toThrow(/tronquée/);
  });

  it('réponse complète → contenu renvoyé tel quel', async () => {
    createMock.mockResolvedValue(okResponse('{"actions":[]}'));
    const client = await createOpenAIClient(keyOk);
    await expect(client?.chatJson(PROMPT)).resolves.toBe('{"actions":[]}');
  });
});

describe('createOpenAIClient — délai maximal', () => {
  it('un appel qui ne répond jamais est abandonné après le délai', async () => {
    createMock.mockImplementation(() => new Promise(() => {})); // ne se résout jamais
    const client = await createOpenAIClient(keyOk, {
      maxOutputTokens: 1_024,
      requestTimeoutMs: 20,
    });

    // Sans le correctif, cette promesse pend indéfiniment et le test expire.
    await expect(client?.chatJson(PROMPT)).rejects.toBeInstanceOf(OpenAITimeoutError);
  });

  it('le délai transmet un AbortSignal et l’abandonne réellement', async () => {
    let captured: AbortSignal | undefined;
    createMock.mockImplementation((_body: unknown, opts: { signal?: AbortSignal }) => {
      captured = opts.signal;
      return new Promise(() => {});
    });
    const client = await createOpenAIClient(keyOk, {
      maxOutputTokens: 1_024,
      requestTimeoutMs: 20,
    });

    await expect(client?.chatJson(PROMPT)).rejects.toBeInstanceOf(OpenAITimeoutError);
    expect(captured).toBeInstanceOf(AbortSignal);
    // La connexion est coupée, pas seulement ignorée.
    expect(captured?.aborted).toBe(true);
  });

  it('le délai est aussi transmis au SDK', async () => {
    createMock.mockResolvedValue(okResponse('{}'));
    const client = await createOpenAIClient(keyOk, {
      maxOutputTokens: 1_024,
      requestTimeoutMs: 9_000,
    });
    await client?.chatJson(PROMPT);
    const opts = createMock.mock.calls[0]?.[1] as { timeout?: number };
    expect(opts.timeout).toBe(9_000);
  });

  it('un appel rapide n’est pas affecté par la borne', async () => {
    createMock.mockResolvedValue(okResponse('{"ok":true}'));
    const client = await createOpenAIClient(keyOk, {
      maxOutputTokens: 1_024,
      requestTimeoutMs: 1_000,
    });
    await expect(client?.chatJson(PROMPT)).resolves.toBe('{"ok":true}');
  });
});

describe('runWithDeadline', () => {
  it('rend le résultat quand la fonction répond à temps', async () => {
    await expect(runWithDeadline(1_000, async () => 42)).resolves.toBe(42);
  });

  it('propage l’erreur de la fonction sans la transformer en délai', async () => {
    await expect(
      runWithDeadline(1_000, () => Promise.reject(new Error('ECONNRESET'))),
    ).rejects.toThrow('ECONNRESET');
  });

  it('un rejet tardif après le délai ne produit pas de rejet non traité', async () => {
    const onUnhandled = vi.fn();
    process.on('unhandledRejection', onUnhandled);
    try {
      await expect(
        runWithDeadline(
          10,
          () =>
            new Promise((_r, reject) => {
              setTimeout(() => reject(new Error('trop tard')), 40);
            }),
        ),
      ).rejects.toBeInstanceOf(OpenAITimeoutError);
      await new Promise((r) => setTimeout(r, 80));
      expect(onUnhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('createOpenAIClient — comportements préexistants préservés', () => {
  it('aucune clé disponible → OpenAIKeyUnavailableError, sans appel réseau', async () => {
    const client = await createOpenAIClient(async () => null);
    await expect(client?.chatJson(PROMPT)).rejects.toBeInstanceOf(OpenAIKeyUnavailableError);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('réponse vide → erreur explicite', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: '' }, finish_reason: 'stop' }],
    });
    const client = await createOpenAIClient(keyOk);
    await expect(client?.chatJson(PROMPT)).rejects.toThrow(/vide/);
  });
});
