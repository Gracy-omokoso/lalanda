// Client e-MCF minimal — ADR-0021 §6 (chantier B).
//
// SEULEMENT `GET /api/info/status` et les sept listes `GET /api/info/*`. Aucun
// appel à `/api/invoice` dans ce lot (émission : lot S25f).
//
// Amendé par ADR-0024 (jalon F0) : signatures des cinq routes de facturation
// (§ 2). Leurs corps sont livrés par le chantier F1 ; d'ici là, elles lèvent.
//
// Règles de comportement :
//  - le client NE LÈVE JAMAIS pour une défaillance distante : il renvoie un
//    `EdefOutcome`. Il ne lève que pour une erreur de programmation ;
//  - `Authorization: Bearer <jeton>`, `Accept: application/json` ; TLS par
//    défaut, aucune désactivation de la vérification des certificats ;
//  - délai `AbortSignal.timeout(DGI_HTTP_TIMEOUT_MS)`, AUCUN réessai automatique
//    (le test de connexion est interactif : l'appelant décide) ;
//  - production fermée → `production_disabled` SANS appel réseau ;
//  - chaque appel réel est inscrit dans `edef_exchanges`, en échec comme en
//    succès, sans en-tête et avec le corps rédigé.
//
// Le jeton n'existe en clair qu'à UN endroit : la construction de l'en-tête,
// par `expose()`. Il n'entre dans aucun message, aucun journal, aucune erreur.

import { Inject, Injectable } from '@nestjs/common';

import { sanitizeProviderMessage } from '../integrations/redaction.js';
import {
  DGI_PLATFORM_CONFIG,
  type DgiPlatformConfig,
} from '../platform-config/dgi-platform.config.js';
import { EdefExchangeJournal, prepareEdefJournalBody } from './edef-exchange.journal.js';
import type {
  EdefCancelled,
  EdefInvoiceCallContext,
  EdefInvoiceDetails,
  EdefInvoiceRequest,
  EdefInvoiceSubmitted,
  EdefPendingRequests,
  EdefSecurityElements,
} from './edef-invoice.types.js';
import {
  InfoStatusSchema,
  REFERENCE_LIST_SCHEMAS,
  type EdefCallContext,
  type EdefFailure,
  type EdefFailureKind,
  type EdefInfoStatus,
  type EdefOutcome,
  type EdefReferenceData,
  type EdefReferenceList,
} from './edef.types.js';

/** Taille maximale d'une réponse acceptée (ADR-0021 §6) : au-delà, `invalid_response`. */
export const EDEF_MAX_RESPONSE_BYTES = 1024 * 1024;

/** Résultat brut d'un échange HTTP, avant interprétation. */
type RawExchange =
  | { kind: 'response'; status: number; body: string }
  | { kind: 'failure'; failure: EdefFailure; status: number | null; body: string | null };

@Injectable()
export class EdefClient {
  constructor(
    @Inject(DGI_PLATFORM_CONFIG) private readonly config: DgiPlatformConfig,
    @Inject(EdefExchangeJournal) private readonly journal: EdefExchangeJournal,
  ) {}

  getStatus(ctx: EdefCallContext): Promise<EdefOutcome<EdefInfoStatus>> {
    return this.get('/api/info/status', ctx, (json) => InfoStatusSchema.safeParse(json));
  }

  getReferenceList<L extends EdefReferenceList>(
    list: L,
    ctx: EdefCallContext,
  ): Promise<EdefOutcome<EdefReferenceData[L]>> {
    const schema = REFERENCE_LIST_SCHEMAS[list];
    if (!schema) throw new Error(`Liste e-MCF inconnue : ${String(list)}`);
    return this.get(`/api/info/${list}`, ctx, (json) => schema.safeParse(json));
  }

  // ── Routes de facturation — ADR-0024 § 2 (signatures F0, corps F1) ─────────

  /** `POST /api/invoice`. Aucun réessai. */
  submitInvoice(
    body: EdefInvoiceRequest,
    ctx: EdefInvoiceCallContext,
  ): Promise<EdefOutcome<EdefInvoiceSubmitted>> {
    throw new Error('F1');
  }

  /** `PUT /api/invoice/{uid}/confirm` avec NOS `total` et `vtotal`. Aucun réessai. */
  confirmInvoice(
    uid: string,
    amounts: { total: number; vtotal: number },
    ctx: EdefInvoiceCallContext,
  ): Promise<EdefOutcome<EdefSecurityElements>> {
    throw new Error('F1');
  }

  /** `PUT /api/invoice/{uid}/cancel`. Aucun réessai. */
  cancelInvoice(uid: string, ctx: EdefInvoiceCallContext): Promise<EdefOutcome<EdefCancelled>> {
    throw new Error('F1');
  }

  /** `GET /api/invoice` : demandes en attente de l'e-MCF. */
  getPendingRequests(ctx: EdefCallContext): Promise<EdefOutcome<EdefPendingRequests>> {
    throw new Error('F1');
  }

  /** `GET /api/invoice/{uid}`. */
  getInvoiceDetails(uid: string, ctx: EdefCallContext): Promise<EdefOutcome<EdefInvoiceDetails>> {
    throw new Error('F1');
  }

  private async get<T>(
    path: string,
    ctx: EdefCallContext,
    parse: (json: unknown) => { success: true; data: T } | { success: false },
  ): Promise<EdefOutcome<T>> {
    if (ctx.environment === 'production' && !this.config.productionEnabled) {
      // Aucun appel, donc aucun échange à journaliser : la DGI n'a rien reçu.
      return {
        ok: false,
        durationMs: 0,
        error: {
          kind: 'production_disabled',
          httpStatus: null,
          dgiErrorCode: null,
          message:
            'La production DGI n’est pas ouverte : elle le sera après l’homologation de Lalanda.',
        },
      };
    }

    const token = ctx.token.expose();
    const secrets = [token];
    const started = Date.now();
    const raw = await this.exchange(`${this.config.baseUrl[ctx.environment]}${path}`, token);
    const durationMs = Date.now() - started;

    const outcome = interpret(raw, parse, secrets);
    await this.journal.append({
      at: new Date(started),
      organizationId: ctx.organizationId,
      pointOfSaleId: ctx.pointOfSaleId,
      environment: ctx.environment,
      method: 'GET',
      path,
      httpStatus: raw.status,
      durationMs,
      outcome: outcome.ok ? 'ok' : outcome.error.kind,
      dgiErrorCode: outcome.ok ? null : outcome.error.dgiErrorCode,
      requestBody: null,
      responseBody: prepareEdefJournalBody(raw.body, secrets),
    });

    return outcome.ok
      ? { ok: true, data: outcome.data, durationMs }
      : { ok: false, error: outcome.error, durationMs };
  }

  /** Un aller-retour HTTP. Ne lève jamais : toute défaillance devient un `RawExchange`. */
  private async exchange(url: string, token: string): Promise<RawExchange> {
    const signal = AbortSignal.timeout(this.config.httpTimeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal,
        redirect: 'error',
      });
    } catch (err) {
      return { kind: 'failure', status: null, body: null, failure: transportFailure(err, token) };
    }

    let body: string;
    try {
      body = await readLimited(response, EDEF_MAX_RESPONSE_BYTES);
    } catch (err) {
      if (err instanceof ResponseTooLargeError) {
        return {
          kind: 'failure',
          status: response.status,
          body: null,
          failure: {
            kind: 'invalid_response',
            httpStatus: response.status,
            dgiErrorCode: null,
            message: 'Réponse de la DGI trop volumineuse (plus de 1 Mio) : refusée.',
          },
        };
      }
      return {
        kind: 'failure',
        status: response.status,
        body: null,
        failure: transportFailure(err, token),
      };
    }
    return { kind: 'response', status: response.status, body };
  }
}

class ResponseTooLargeError extends Error {}

/** Lit le corps en flux et s'arrête dès que la limite est dépassée. */
async function readLimited(response: Response, limit: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new ResponseTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function transportFailure(err: unknown, token: string): EdefFailure {
  const name = err instanceof Error ? err.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return {
      kind: 'timeout',
      httpStatus: null,
      dgiErrorCode: null,
      message: 'La DGI n’a pas répondu dans le délai imparti.',
    };
  }
  const cause =
    err instanceof Error && err.cause instanceof Error ? err.cause.message : String(err);
  return {
    kind: 'network',
    httpStatus: null,
    dgiErrorCode: null,
    message: `Serveur de la DGI injoignable (${sanitizeProviderMessage(cause, [token])}).`,
  };
}

/** Code et libellé d'erreur métier DGI dans un corps JSON (`errorCode`, `errorDesc`). */
function businessErrorOf(json: unknown): { code: string; desc: string | null } | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
  const record = json as Record<string, unknown>;
  const code = record['errorCode'];
  if (code === null || code === undefined || code === '') return null;
  const desc = record['errorDesc'];
  return {
    code: String(code),
    desc: typeof desc === 'string' ? desc : null,
  };
}

function failure(
  kind: EdefFailureKind,
  httpStatus: number | null,
  message: string,
  dgiErrorCode: string | null = null,
): { ok: false; error: EdefFailure } {
  return { ok: false, error: { kind, httpStatus, dgiErrorCode, message } };
}

function interpret<T>(
  raw: RawExchange,
  parse: (json: unknown) => { success: true; data: T } | { success: false },
  secrets: readonly string[],
): { ok: true; data: T } | { ok: false; error: EdefFailure } {
  if (raw.kind === 'failure') return { ok: false, error: raw.failure };
  const { status, body } = raw;

  let json: unknown = undefined;
  let jsonOk = false;
  try {
    json = JSON.parse(body);
    jsonOk = true;
  } catch {
    jsonOk = false;
  }

  if (status === 401) {
    return failure(
      'unauthorized',
      401,
      'La DGI a refusé le jeton (HTTP 401) : invalide ou expiré.',
    );
  }
  if (status >= 500) {
    return failure('server', status, `Erreur du serveur de la DGI (HTTP ${status}).`);
  }
  const business = jsonOk ? businessErrorOf(json) : null;
  if (business || (status >= 400 && status < 500)) {
    const desc = business?.desc ? sanitizeProviderMessage(business.desc, secrets) : null;
    return failure(
      'business',
      status,
      business
        ? `La DGI a renvoyé l’erreur ${business.code}${desc ? ` : ${desc}` : ''}.`
        : `La DGI a refusé la demande (HTTP ${status}).`,
      business?.code ?? null,
    );
  }
  if (status < 200 || status >= 300) {
    return failure('invalid_response', status, `Réponse inattendue de la DGI (HTTP ${status}).`);
  }
  if (!jsonOk) {
    return failure('invalid_response', status, 'Réponse de la DGI illisible (JSON invalide).');
  }
  const parsed = parse(json);
  if (!parsed.success) {
    return failure(
      'invalid_response',
      status,
      'Réponse de la DGI non conforme à la spécification publiée.',
    );
  }
  return { ok: true, data: parsed.data };
}
