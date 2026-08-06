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
 * Fabrique le client à partir de `process.env.OPENAI_API_KEY`.
 * Retourne `null` si la clé est absente OU si le SDK n'est pas installable.
 * Aucun appel réseau n'est fait ici — uniquement au moment du chat.
 */
export async function createOpenAIClient(): Promise<OpenAIChatClient | null> {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) return null;

  let mod: { default: OpenAIConstructor } | { OpenAI: OpenAIConstructor };
  try {
    mod = (await import('openai')) as unknown as
      { default: OpenAIConstructor } | { OpenAI: OpenAIConstructor };
  } catch {
    // SDK non installé → on retourne null, le service tombera en fallback.
    return null;
  }
  const OpenAICtor: OpenAIConstructor = 'default' in mod ? mod.default : mod.OpenAI;
  const client: OpenAIInstance = new OpenAICtor({ apiKey });

  return {
    async chatJson({ system, user, model }) {
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
