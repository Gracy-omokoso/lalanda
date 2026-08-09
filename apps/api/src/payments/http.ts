// Client HTTP injectable des fournisseurs de paiement (S22b).
//
// Pourquoi une abstraction plutôt que `fetch` global : les tests ne doivent
// JAMAIS pouvoir sortir sur le réseau, même par accident. Un `fetch` importé
// globalement se moque avec `vi.stubGlobal`, ce qui fuit d'un fichier de test à
// l'autre et laisse un vrai appel passer si un `afterEach` est oublié. Un
// paramètre de constructeur ne fuit nulle part : un fournisseur construit sans
// client HTTP ne compile pas.
//
// Aucun SDK fournisseur n'est installé (`stripe`, `@paypal/*`). Ce n'est pas de
// l'économie de dépendance : ces SDK encapsulent des appels réseau derrière des
// couches de retry et de configuration globale qu'il faudrait ensuite neutraliser
// pour tester. Les deux API utilisées ici sont du REST simple, et la seule partie
// délicate — la signature — est de la cryptographie standard qu'on veut voir
// écrite noir sur blanc plutôt que déléguée (voir `webhook-signature.ts`).

/** Réponse minimale exploitée par les fournisseurs. */
export interface HttpResponse {
  status: number;
  ok: boolean;
  text(): Promise<string>;
}

export interface HttpRequestInit {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

export type HttpClient = (url: string, init: HttpRequestInit) => Promise<HttpResponse>;

/** Jeton d'injection Nest. */
export const PAYMENT_HTTP = Symbol('PAYMENT_HTTP');

/** Délai au-delà duquel un appel fournisseur est abandonné. */
export const PAYMENT_HTTP_TIMEOUT_MS = 15_000;

/**
 * Client réel, adossé au `fetch` de Node 20.
 *
 * Le délai d'attente est explicite : sans lui, un fournisseur qui ne répond pas
 * garde une requête HTTP de Lalanda ouverte indéfiniment, et quelques dizaines
 * de clics sur « Payer » suffisent à épuiser le pool de connexions.
 */
export function nodeHttpClient(timeoutMs: number = PAYMENT_HTTP_TIMEOUT_MS): HttpClient {
  return async (url, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal: controller.signal,
      });
      return { status: res.status, ok: res.ok, text: () => res.text() };
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Client qui refuse tout appel — utilisé par défaut dans les tests unitaires.
 * Un appel réseau non intentionnel échoue avec un message qui dit où regarder,
 * au lieu de partir sur Internet.
 */
export const forbiddenHttpClient: HttpClient = async (url) => {
  throw new Error(
    `Appel réseau interdit dans ce contexte (${url}). ` +
      'Injectez un HttpClient de test — voir payments/http.ts.',
  );
};

/**
 * Encode un objet imbriqué au format `application/x-www-form-urlencoded` attendu
 * par Stripe : `line_items[0][price_data][currency]=usd`.
 *
 * Écrit à la main parce que `URLSearchParams` ne gère pas l'imbrication et que
 * la convention de crochets de Stripe n'est pas celle, plus courante, de PHP
 * (`a[]=1&a[]=2`) : les tableaux y sont INDEXÉS.
 */
export function encodeFormNested(input: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = [];

  const push = (key: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => push(`${key}[${index}]`, item));
      return;
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        push(`${key}[${k}]`, v);
      }
      return;
    }
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  };

  for (const [key, value] of Object.entries(input)) {
    push(prefix ? `${prefix}[${key}]` : key, value);
  }
  return parts.join('&');
}

/**
 * Lit une réponse JSON, ou lève une erreur ASSAINIE.
 *
 * Le corps d'erreur du fournisseur n'est jamais renvoyé tel quel au client :
 * ADR-0013 §4 impose l'assainissement des messages fournisseur, qui contiennent
 * régulièrement la clé d'API en écho. Seuls le statut et un extrait court
 * partent dans les logs serveur, et le client ne voit qu'un code générique.
 */
export async function readJson(res: HttpResponse, context: string): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${context} : réponse ${res.status} du fournisseur.`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${context} : réponse non-JSON du fournisseur (${res.status}).`);
  }
}
