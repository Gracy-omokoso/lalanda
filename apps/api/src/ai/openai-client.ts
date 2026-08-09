// Adaptateur minimal autour du SDK OpenAI officiel (S14a — agent D).
//
// - Import DIFFÉRÉ du package `openai` pour ne pas bloquer le boot Nest si la
//   dépendance n'est pas installée (CI ou environnements minimaux).
// - Force `response_format: { type: 'json_object' }` pour garantir un JSON parsable.
// - Ne conserve AUCUNE trace de la clé côté service : elle reste dans le SDK.
// - S22h : chaque appel est BORNÉ — plafond de jetons en sortie et délai
//   maximal. Un dépassement lève une erreur typée, que `AiActionsService`
//   rattrape pour retomber sur son repli déterministe.

import type { OpenAIChatClient } from './ai-actions.service.js';
import { resolveAiLimits, type AiLimits } from './ai-limits.js';

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
interface OpenAIChatChoice {
  message?: { content?: string | null };
  /** `'length'` signale une réponse coupée par `max_tokens` (donc JSON incomplet). */
  finish_reason?: string | null;
}
interface OpenAIChatResponse {
  choices: OpenAIChatChoice[];
}
interface OpenAIChatCompletionsAPI {
  create(
    args: {
      model: string;
      messages: OpenAIChatMessage[];
      response_format?: { type: 'json_object' };
      temperature?: number;
      /** Plafond de jetons EN SORTIE — voir `AiLimits.maxOutputTokens`. */
      max_tokens?: number;
    },
    options?: { signal?: AbortSignal; timeout?: number },
  ): Promise<OpenAIChatResponse>;
}
interface OpenAIInstance {
  chat: { completions: OpenAIChatCompletionsAPI };
}
type OpenAIConstructor = new (opts: { apiKey: string }) => OpenAIInstance;

/**
 * Résout la clé à utiliser. Injecté par le module (S21b) pour aller chercher la
 * valeur chiffrée en base, avec l'environnement en secours (ADR-0013 option C).
 * Retourne `null` quand aucune source ne fournit de clé.
 */
export type ApiKeyResolver = () => Promise<string | null>;

/** Résolution historique : l'environnement seul. Conservée pour les appelants directs. */
const envResolver: ApiKeyResolver = async () => process.env['OPENAI_API_KEY'] ?? null;

/**
 * Erreur levée quand aucune clé n'est disponible AU MOMENT de l'appel.
 *
 * `AiActionsService` rattrape toute erreur de `chatJson` et retombe sur son
 * fallback déterministe : c'est ce qui permet au client paresseux de se
 * comporter exactement comme l'ancien `null` sans que le service ait à changer.
 */
export class OpenAIKeyUnavailableError extends Error {
  constructor() {
    super("Aucune clé OpenAI disponible (ni en base, ni dans l'environnement).");
    this.name = 'OpenAIKeyUnavailableError';
  }
}

/**
 * Erreur levée quand l'appel dépasse le délai maximal (S22h).
 *
 * Le délai est mesuré en temps réel côté appelant, ce qui inclut les éventuels
 * réessais internes du SDK : c'est la seule mesure qui garantit que la requête
 * HTTP de l'utilisateur ne pend pas plus longtemps que la borne annoncée.
 */
export class OpenAITimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Appel OpenAI abandonné après ${timeoutMs} ms (délai maximal dépassé).`);
    this.name = 'OpenAITimeoutError';
  }
}

/**
 * Erreur levée quand la réponse a été coupée par le plafond de jetons (S22h).
 *
 * On la lève AVANT toute tentative de parsing : un JSON tronqué produirait
 * sinon une erreur de syntaxe opaque, qui masquerait la cause réelle dans les
 * journaux (« Unexpected end of JSON input » ne dit pas que la borne a mordu).
 */
export class OpenAITruncatedResponseError extends Error {
  constructor(public readonly maxOutputTokens: number) {
    super(
      `Réponse OpenAI tronquée par le plafond de ${maxOutputTokens} jetons en sortie ` +
        `(finish_reason="length").`,
    );
    this.name = 'OpenAITruncatedResponseError';
  }
}

/**
 * Exécute `fn` sous un délai maximal en temps réel.
 *
 * L'`AbortSignal` est transmis au SDK pour qu'il coupe réellement la connexion
 * (sans quoi la requête continuerait en arrière-plan), MAIS la promesse de
 * délai fait autorité : même un client qui ignorerait le signal ne peut pas
 * faire dépasser la borne. Le `Promise.race` observe les deux promesses, donc
 * un rejet tardif de `fn` reste géré et ne remonte pas en rejet non traité.
 */
export async function runWithDeadline<T>(
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new OpenAITimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fn(controller.signal), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Fabrique le client OpenAI.
 *
 * ── Pourquoi la clé est résolue À CHAQUE APPEL et non au démarrage (S21b) ─────
 *
 * Depuis ADR-0013, la clé peut être saisie ou remplacée dans `/admin` pendant
 * que le processus tourne. Un client construit une fois au boot avec la valeur
 * d'alors continuerait d'utiliser une clé révoquée jusqu'au prochain
 * redéploiement — c'est-à-dire exactement le problème que l'ADR existe pour
 * supprimer (« changer une clé impose un redéploiement »). Le coût est nul :
 * `SecretsService` met en cache 60 s, et le SDK est instancié à la demande.
 *
 * Retourne `null` UNIQUEMENT si le SDK `openai` n'est pas installable. L'absence
 * de clé n'est plus une décision de boot : elle se constate à l'appel, où elle
 * lève `OpenAIKeyUnavailableError` et déclenche le fallback déterministe
 * existant, inchangé.
 *
 * ── Bornes (S22h) ────────────────────────────────────────────────────────────
 *
 * Les bornes sont résolues UNE FOIS ici : l'environnement ne change pas en
 * cours de processus, et les résoudre au boot fait apparaître un éventuel
 * avertissement de configuration au démarrage plutôt qu'au premier appel.
 */
export async function createOpenAIClient(
  resolveApiKey: ApiKeyResolver = envResolver,
  limits: AiLimits = resolveAiLimits(),
): Promise<OpenAIChatClient | null> {
  let mod: { default: OpenAIConstructor } | { OpenAI: OpenAIConstructor };
  try {
    mod = (await import('openai')) as unknown as
      | { default: OpenAIConstructor }
      | { OpenAI: OpenAIConstructor };
  } catch {
    // SDK non installé → on retourne null, le service tombera en fallback.
    return null;
  }
  const OpenAICtor: OpenAIConstructor = 'default' in mod ? mod.default : mod.OpenAI;

  return {
    async chatJson({ system, user, model }) {
      const apiKey = await resolveApiKey();
      if (!apiKey) throw new OpenAIKeyUnavailableError();

      // Le SDK est instancié ici et jeté ensuite : il ne conserve donc aucune
      // clé entre deux appels, et une clé remplacée dans /admin prend effet dès
      // l'expiration du cache de 60 s.
      const client: OpenAIInstance = new OpenAICtor({ apiKey });
      const res = await runWithDeadline(limits.requestTimeoutMs, (signal) =>
        client.chat.completions.create(
          {
            model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.2,
            max_tokens: limits.maxOutputTokens,
          },
          // `timeout` borne aussi le SDK lui-même; `signal` libère la connexion
          // dès que notre propre délai a mordu.
          { signal, timeout: limits.requestTimeoutMs },
        ),
      );

      const choice = res.choices[0];
      if (choice?.finish_reason === 'length') {
        throw new OpenAITruncatedResponseError(limits.maxOutputTokens);
      }
      const content = choice?.message?.content;
      if (!content) throw new Error('Réponse OpenAI vide');
      return content;
    },
  };
}
