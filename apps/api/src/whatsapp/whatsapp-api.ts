// Client de l'API WhatsApp Business Cloud (Graph API de Meta) — ADR-0065 § 4.
//
// `fetch` natif, aucune dépendance (ADR-0013 § 10 : rien de plus dans le processus qui
// détient `SECRETS_MASTER_KEY`). Une seule méthode utile : envoyer un MODÈLE
// (`POST /<version>/<phoneNumberId>/messages`, `type: "template"`). Hors de la fenêtre
// de 24 h ouverte par un message de la personne, Meta n'accepte que des modèles
// approuvés : Lalanda n'envoie donc jamais de texte libre.
//
// ── Testable sans jamais joindre Meta ────────────────────────────────────────
//
// `http` et `sleep` sont publics et REMPLAÇABLES : les tests substituent un faux
// `fetch` qui enregistre l'adresse, les en-têtes et le corps, et un faux sommeil.
// Garde-fou : le `fetch` par défaut REFUSE de partir sous vitest — un test qui
// oublierait de simuler Meta échoue au lieu d'envoyer un vrai message.
//
// ── Erreurs ──────────────────────────────────────────────────────────────────
//
// Meta répond `{ error: { code, error_subcode, message } }` avec un statut HTTP 4xx/5xx.
// Les limites de débit (HTTP 429, codes 4, 80007, 130429, 131048, 131056) sont
// réessayées ici, deux fois au plus, attente bornée ; tout le reste devient une
// `WhatsAppApiError` portant le seul CODE Meta et sa CATÉGORIE — jamais le jeton,
// jamais le numéro, jamais le corps de la requête ni le message libre de Meta.

import { Injectable } from '@nestjs/common';

import { whatsappApiBase, whatsappApiVersion } from './whatsapp-config.js';

export type WhatsAppHttp = (url: string, init: RequestInit) => Promise<Response>;

/** Nouvelles tentatives après une limite de débit. */
export const WHATSAPP_RATE_LIMIT_RETRIES = 2;
/** Attentes successives (ms) avant chaque nouvelle tentative. */
export const WHATSAPP_RETRY_DELAYS_MS = [1_000, 4_000] as const;

/** Codes Meta de limite de débit (réessayés). */
export const WHATSAPP_RATE_LIMIT_CODES = [4, 80007, 130429, 131048, 131056] as const;
/**
 * Codes Meta qui disent « le jeton ou les droits de la plateforme ne valent plus » :
 * fournisseur signalé dans `/admin`, envois suspendus.
 */
export const WHATSAPP_PROVIDER_ERROR_CODES = [190, 10, 200, 131005] as const;
/**
 * Codes Meta qui disent « ce destinataire ne peut pas recevoir » (numéro invalide,
 * sans WhatsApp, hors liste de test) : numéro marqué « à vérifier ».
 */
export const WHATSAPP_RECIPIENT_ERROR_CODES = [131026, 131021, 131030] as const;

export type WhatsAppErrorKind = 'rate_limited' | 'provider' | 'recipient' | 'other';

export class WhatsAppApiError extends Error {
  constructor(
    /** Code Meta (`131026`), ou `http_<statut>`, ou `invalid_response`. */
    readonly code: string,
    readonly kind: WhatsAppErrorKind,
  ) {
    super(`WhatsApp : ${code}`);
    this.name = 'WhatsAppApiError';
  }
}

/** Catégorie d'un code Meta (ou d'un statut HTTP quand le corps est illisible). */
export function whatsappErrorKind(code: number | null, httpStatus: number): WhatsAppErrorKind {
  if (httpStatus === 429) return 'rate_limited';
  if (code !== null && (WHATSAPP_RATE_LIMIT_CODES as readonly number[]).includes(code)) {
    return 'rate_limited';
  }
  if (code !== null && (WHATSAPP_PROVIDER_ERROR_CODES as readonly number[]).includes(code)) {
    return 'provider';
  }
  if (httpStatus === 401) return 'provider';
  if (code !== null && (WHATSAPP_RECIPIENT_ERROR_CODES as readonly number[]).includes(code)) {
    return 'recipient';
  }
  return 'other';
}

/** `fetch` réel — refusé sous vitest (aucun appel réel à Meta dans les tests). */
export const realWhatsAppHttp: WhatsAppHttp = (url, init) => {
  if (process.env['VITEST']) {
    return Promise.reject(
      new Error('Appel réel à Meta refusé pendant les tests : simulez `WhatsAppApi.http`.'),
    );
  }
  return fetch(url, init);
};

export interface WhatsAppCredentials {
  phoneNumberId: string;
  accessToken: string;
  apiVersion: string;
}

/** Composant d'un modèle tel que l'attend Meta (`body`, `button`). */
export type WhatsAppTemplateComponent =
  | { type: 'body'; parameters: Array<{ type: 'text'; text: string }> }
  | {
      type: 'button';
      sub_type: 'url';
      index: string;
      parameters: Array<{ type: 'text'; text: string }>;
    };

export interface WhatsAppTemplateMessage {
  /** Destinataire E.164 (`+243…`) — Meta reçoit les chiffres sans « + ». */
  to: string;
  name: string;
  language: string;
  components: WhatsAppTemplateComponent[];
}

@Injectable()
export class WhatsAppApi {
  /** Remplaçable par les tests. */
  http: WhatsAppHttp = realWhatsAppHttp;
  /** Remplaçable par les tests (attente avant une nouvelle tentative). */
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms).unref?.());

  /** Envoie un modèle ; renvoie l'identifiant Meta du message (`wamid…`). */
  async sendTemplate(creds: WhatsAppCredentials, msg: WhatsAppTemplateMessage): Promise<string> {
    const url =
      `${whatsappApiBase()}/${whatsappApiVersion(creds.apiVersion)}/` +
      `${encodeURIComponent(creds.phoneNumberId)}/messages`;
    const body = JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: msg.to.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: msg.name,
        language: { code: msg.language },
        components: msg.components,
      },
    });
    for (let attempt = 0; ; attempt += 1) {
      const res = await this.http(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${creds.accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body,
      });
      let payload: Record<string, unknown> | null = null;
      try {
        payload = (await res.json()) as Record<string, unknown>;
      } catch {
        payload = null;
      }
      if (res.ok) {
        const messages = (payload?.['messages'] ?? []) as Array<Record<string, unknown>>;
        const id = messages[0]?.['id'];
        if (typeof id !== 'string' || id === '') {
          throw new WhatsAppApiError('invalid_response', 'other');
        }
        return id;
      }
      const err = (payload?.['error'] ?? {}) as Record<string, unknown>;
      const code = typeof err['code'] === 'number' ? err['code'] : null;
      const kind = whatsappErrorKind(code, res.status);
      if (kind === 'rate_limited' && attempt < WHATSAPP_RATE_LIMIT_RETRIES) {
        await this.sleep(WHATSAPP_RETRY_DELAYS_MS[attempt] ?? 4_000);
        continue;
      }
      throw new WhatsAppApiError(code !== null ? String(code) : `http_${res.status}`, kind);
    }
  }
}
