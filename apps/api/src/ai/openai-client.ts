// Adaptateur minimal autour du SDK OpenAI officiel (S14a — agent D).
//
// - Import DIFFÉRÉ du package `openai` pour ne pas bloquer le boot Nest si la
//   dépendance n'est pas installée (CI ou environnements minimaux).
// - Force `response_format: { type: 'json_object' }` pour garantir un JSON parsable.
// - Ne conserve AUCUNE trace de la clé côté service : elle reste dans le SDK.

import type { OpenAIChatClient } from './ai-actions.service.js';

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
interface OpenAIChatResponse {
  choices: Array<{ message?: { content?: string | null } }>;
}
interface OpenAIChatCompletionsAPI {
  create(args: {
    model: string;
    messages: OpenAIChatMessage[];
    response_format?: { type: 'json_object' };
    temperature?: number;
  }): Promise<OpenAIChatResponse>;
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
 */
export async function createOpenAIClient(
  resolveApiKey: ApiKeyResolver = envResolver,
): Promise<OpenAIChatClient | null> {
  let mod: { default: OpenAIConstructor } | { OpenAI: OpenAIConstructor };
  try {
    mod = (await import('openai')) as unknown as
      { default: OpenAIConstructor } | { OpenAI: OpenAIConstructor };
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
      const res = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      });
      const content = res.choices[0]?.message?.content;
      if (!content) throw new Error('Réponse OpenAI vide');
      return content;
    },
  };
}
