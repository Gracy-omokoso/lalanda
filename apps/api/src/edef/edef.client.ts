// Client e-MCF — ADR-0021 §6 (chantier B), amendé par ADR-0024 § 2 et § 6
// (chantier F1 : routes de facturation).
//
// Routes : `GET /api/info/status`, les sept listes `GET /api/info/*`, et les
// cinq routes de facturation — `POST /api/invoice`, `PUT /api/invoice/{uid}/confirm`,
// `PUT /api/invoice/{uid}/cancel`, `GET /api/invoice` (demandes en attente) et
// `GET /api/invoice/{uid}`.
//
// Règles de comportement :
//  - le client NE LÈVE JAMAIS pour une défaillance distante : il renvoie un
//    `EdefOutcome`. Il ne lève que pour une erreur de programmation (corps non
//    conforme, `uid` vide…) et, pour les trois écritures, quand l'entrée
//    `request` du journal n'a pas pu être écrite (`EdefJournalWriteError` :
//    RIEN n'est alors parti vers la DGI) ;
//  - `Authorization: Bearer <jeton>`, `Accept: application/json` ; TLS par
//    défaut, aucune désactivation de la vérification des certificats ;
//  - délai `AbortSignal.timeout(DGI_HTTP_TIMEOUT_MS)` (15 s par défaut, ≥ 10 s
//    comme le recommande la DGI), AUCUN réessai automatique, sur AUCUNE route :
//    un second `POST` après une réponse perdue peut créer une seconde facture
//    normalisée (ADR-0024 O2) — l'appelant décide, après vérification ;
//  - au plus `EDEF_MAX_CONCURRENT_CALLS` appels simultanés par processus
//    (ADR-0024 § 6, « Débit ») ; le délai court à partir de l'envoi, pas de
//    l'attente d'une place ;
//  - production fermée → `production_disabled` SANS appel réseau, sans journal ;
//  - journal `edef_exchanges` version 2 : `POST`, `confirm`, `cancel` écrivent
//    une entrée `request` STRICTEMENT avant l'envoi, puis une entrée `response`
//    liée par `exchangeId` ; une lecture écrit une seule entrée `complete`, non
//    bloquante. Jamais d'en-tête ; corps rédigés.
//  - validation Zod des réponses (`edef-invoice.types.ts`) : un `errorCode` non
//    vide est `business` ; un `POST` sans `uid` est `invalid_response` ; un
//    `confirm` « réussi » sans les cinq éléments de sécurité est
//    `invalid_response` — JAMAIS une normalisation ;
//  - la réponse brute du `POST` est rendue telle quelle (nombres JSON) pour
//    `compareWithEdefResponse` : aucun arrondi, aucune reconversion.
//
// Le jeton n'existe en clair qu'à UN endroit : la construction de l'en-tête,
// par `expose()`. Il n'entre dans aucun message, aucun journal, aucune erreur.

import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { sanitizeProviderMessage } from '../integrations/redaction.js';
import {
  DGI_PLATFORM_CONFIG,
  type DgiPlatformConfig,
} from '../platform-config/dgi-platform.config.js';
import {
  EdefExchangeJournal,
  prepareEdefJournalBody,
  type EdefExchangeEntry,
} from './edef-exchange.journal.js';
import {
  EdefCancelledSchema,
  EdefInvoiceDetailsSchema,
  EdefInvoiceRequestSchema,
  EdefInvoiceSubmittedSchema,
  EdefPendingRequestsSchema,
  EdefSecurityElementsSchema,
  type EdefCancelled,
  type EdefInvoiceCallContext,
  type EdefInvoiceDetails,
  type EdefInvoiceRequest,
  type EdefInvoiceSubmitted,
  type EdefPendingRequests,
  type EdefSecurityElements,
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

/** Appels DGI simultanés au plus, par processus (ADR-0024 § 6). */
export const EDEF_MAX_CONCURRENT_CALLS = 4;

/**
 * L'entrée `request` du journal n'a pas pu être écrite : AUCUNE requête n'est
 * partie vers la DGI (ADR-0024 § 3, étape 3, et § 6). L'appelant peut conclure
 * en toute certitude que la DGI n'a rien reçu de cette tentative.
 */
export class EdefJournalWriteError extends Error {
  override readonly name = 'EdefJournalWriteError';
  constructor(
    readonly method: string,
    readonly path: string,
    cause: unknown,
  ) {
    super(`Journal des échanges indisponible : ${method} ${path} n’a pas été envoyé à la DGI.`, {
      cause,
    });
  }
}

/** Résultat brut d'un échange HTTP, avant interprétation. */
type RawExchange =
  | { kind: 'response'; status: number; body: string }
  | { kind: 'failure'; failure: EdefFailure; status: number | null; body: string | null };

type Parser<T> = (json: unknown) => { success: true; data: T } | { success: false };

interface CallSpec<T> {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  /** Corps sérialisé UNE fois, envoyé et journalisé tel quel ; `null` sans corps. */
  body: string | null;
  ctx: EdefCallContext;
  /** Présent pour `POST`, `confirm`, `cancel` : journal en deux entrées, `request` stricte. */
  invoice: { invoiceId: string; rn: string } | null;
  /** `uid` connu avant l'appel (`confirm`, `cancel`, détail). */
  uid: string | null;
  parse: Parser<T>;
  /** `uid` révélé par la réponse (`POST`). */
  uidOf?: (data: T) => string | null;
}

/** Sémaphore minimal : file d'attente FIFO, aucune dépendance. */
class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return;
    }
    // La place est transmise directement par `release` : `active` ne bouge pas.
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.active -= 1;
  }
}

@Injectable()
export class EdefClient {
  private readonly slots = new Semaphore(EDEF_MAX_CONCURRENT_CALLS);

  constructor(
    @Inject(DGI_PLATFORM_CONFIG) private readonly config: DgiPlatformConfig,
    @Inject(EdefExchangeJournal) private readonly journal: EdefExchangeJournal,
  ) {}

  getStatus(ctx: EdefCallContext): Promise<EdefOutcome<EdefInfoStatus>> {
    return this.call({
      method: 'GET',
      path: '/api/info/status',
      body: null,
      ctx,
      invoice: null,
      uid: null,
      parse: (json) => InfoStatusSchema.safeParse(json),
    });
  }

  getReferenceList<L extends EdefReferenceList>(
    list: L,
    ctx: EdefCallContext,
  ): Promise<EdefOutcome<EdefReferenceData[L]>> {
    const schema = REFERENCE_LIST_SCHEMAS[list];
    if (!schema) throw new Error(`Liste e-MCF inconnue : ${String(list)}`);
    return this.call({
      method: 'GET',
      path: `/api/info/${list}`,
      body: null,
      ctx,
      invoice: null,
      uid: null,
      parse: (json) => schema.safeParse(json),
    });
  }

  // ── Routes de facturation — ADR-0024 § 2 ──────────────────────────────────

  /**
   * `POST /api/invoice`. Aucun réessai.
   *
   * Le corps envoyé est EXACTEMENT `JSON.stringify(body)` (ordre des clés de
   * l'objet reçu) : un même objet donne un même corps, donc une même empreinte
   * (ADR-0024 § 1). Un corps non conforme à `EdefInvoiceRequestSchema`, ou un
   * `ctx.rn` différent de `body.rn`, est une erreur de programmation : le client
   * lève, rien n'est envoyé.
   */
  submitInvoice(
    body: EdefInvoiceRequest,
    ctx: EdefInvoiceCallContext,
  ): Promise<EdefOutcome<EdefInvoiceSubmitted>> {
    const checked = EdefInvoiceRequestSchema.safeParse(body);
    if (!checked.success) {
      // Les chemins seulement : les valeurs peuvent contenir des données du client.
      const paths = checked.error.issues.map((i) => i.path.join('.') || '(racine)').join(', ');
      throw new Error(`Corps e-MCF non conforme (erreur de programmation) : ${paths}.`);
    }
    if (body.rn !== ctx.rn) {
      throw new Error('Le numéro `rn` du corps diffère de celui du contexte d’appel.');
    }
    const invoice = invoiceOf(ctx);
    return this.call({
      method: 'POST',
      path: '/api/invoice',
      body: JSON.stringify(body),
      ctx,
      invoice,
      uid: null,
      parse: (json) => EdefInvoiceSubmittedSchema.safeParse(json),
      uidOf: (data) => data.uid,
    });
  }

  /** `PUT /api/invoice/{uid}/confirm` avec NOS `total` et `vtotal`. Aucun réessai. */
  confirmInvoice(
    uid: string,
    amounts: { total: number; vtotal: number },
    ctx: EdefInvoiceCallContext,
  ): Promise<EdefOutcome<EdefSecurityElements>> {
    assertUid(uid);
    for (const [name, value] of Object.entries({ total: amounts.total, vtotal: amounts.vtotal })) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error(`Montant de confirmation invalide (${name}) : erreur de programmation.`);
      }
    }
    const invoice = invoiceOf(ctx);
    return this.call({
      method: 'PUT',
      path: `/api/invoice/${encodeURIComponent(uid)}/confirm`,
      // `FinalizeInvoiceRequestDataDto` : exactement ces deux champs.
      body: JSON.stringify({ total: amounts.total, vtotal: amounts.vtotal }),
      ctx,
      invoice,
      uid,
      parse: (json) => EdefSecurityElementsSchema.safeParse(json),
    });
  }

  /** `PUT /api/invoice/{uid}/cancel` (sans corps). Aucun réessai. */
  cancelInvoice(uid: string, ctx: EdefInvoiceCallContext): Promise<EdefOutcome<EdefCancelled>> {
    assertUid(uid);
    const invoice = invoiceOf(ctx);
    return this.call({
      method: 'PUT',
      path: `/api/invoice/${encodeURIComponent(uid)}/cancel`,
      body: null,
      ctx,
      invoice,
      uid,
      parse: (json) => EdefCancelledSchema.safeParse(json),
    });
  }

  /** `GET /api/invoice` : demandes en attente de l'e-MCF. */
  getPendingRequests(ctx: EdefCallContext): Promise<EdefOutcome<EdefPendingRequests>> {
    return this.call({
      method: 'GET',
      path: '/api/invoice',
      body: null,
      ctx,
      invoice: null,
      uid: null,
      parse: (json) => EdefPendingRequestsSchema.safeParse(json),
    });
  }

  /**
   * `GET /api/invoice/{uid}`. `security` est `null` si `secElements` est absent
   * ou incomplet — ce qui, d'après la documentation, NE PROUVE PAS qu'aucune
   * facture n'a été normalisée (ADR-0024 § 4.2, question DGI n° 1).
   */
  getInvoiceDetails(uid: string, ctx: EdefCallContext): Promise<EdefOutcome<EdefInvoiceDetails>> {
    assertUid(uid);
    return this.call({
      method: 'GET',
      path: `/api/invoice/${encodeURIComponent(uid)}`,
      body: null,
      ctx,
      invoice: null,
      uid,
      parse: (json) => EdefInvoiceDetailsSchema.safeParse(json),
    });
  }

  // ── Mécanique commune ──────────────────────────────────────────────────────

  private async call<T>(spec: CallSpec<T>): Promise<EdefOutcome<T>> {
    const { ctx } = spec;
    if (ctx.environment === 'production' && !this.config.productionEnabled) {
      // Aucun appel, donc aucun échange à journaliser : la DGI n'a rien reçu.
      return {
        ok: false,
        durationMs: 0,
        error: {
          kind: 'production_disabled',
          httpStatus: null,
          dgiErrorCode: null,
          dgiErrorDesc: null,
          message:
            'La production DGI n’est pas ouverte : elle le sera après l’homologation de Lalanda.',
        },
      };
    }

    const token = ctx.token.expose();
    const secrets = [token];
    const exchangeId = randomUUID();
    const base = {
      exchangeId,
      organizationId: ctx.organizationId,
      pointOfSaleId: ctx.pointOfSaleId,
      invoiceId: spec.invoice?.invoiceId ?? null,
      rn: spec.invoice?.rn ?? null,
      environment: ctx.environment,
      method: spec.method,
      path: spec.path,
    } satisfies Partial<EdefExchangeEntry>;

    if (spec.invoice) {
      // Journal STRICT : pas de trace, pas d'envoi (ADR-0024 O4).
      try {
        await this.journal.appendStrict({
          ...base,
          at: new Date(),
          entry: 'request',
          uid: spec.uid,
          httpStatus: null,
          durationMs: null,
          outcome: null,
          dgiErrorCode: null,
          requestBody: prepareEdefJournalBody(spec.body, secrets),
          responseBody: null,
        });
      } catch (err) {
        throw new EdefJournalWriteError(spec.method, spec.path, err);
      }
    }

    await this.slots.acquire();
    let raw: RawExchange;
    let started: number;
    let durationMs: number;
    try {
      started = Date.now();
      raw = await this.exchange(
        `${this.config.baseUrl[ctx.environment]}${spec.path}`,
        spec.method,
        spec.body,
        token,
      );
      durationMs = Date.now() - started;
    } finally {
      this.slots.release();
    }

    const outcome = interpret(raw, spec.parse, secrets);
    const revealedUid = outcome.ok && spec.uidOf ? spec.uidOf(outcome.data) : null;
    await this.journal.append({
      ...base,
      at: new Date(started),
      entry: spec.invoice ? 'response' : 'complete',
      uid: spec.uid ?? revealedUid,
      httpStatus: raw.status,
      durationMs,
      outcome: outcome.ok ? 'ok' : outcome.error.kind,
      dgiErrorCode: outcome.ok ? null : outcome.error.dgiErrorCode,
      // Le corps envoyé est dans l'entrée `request` ; une lecture n'en a pas.
      requestBody: null,
      responseBody: prepareEdefJournalBody(raw.body, secrets),
    });

    return outcome.ok
      ? { ok: true, data: outcome.data, durationMs }
      : { ok: false, error: outcome.error, durationMs };
  }

  /** Un aller-retour HTTP. Ne lève jamais : toute défaillance devient un `RawExchange`. */
  private async exchange(
    url: string,
    method: CallSpec<unknown>['method'],
    body: string | null,
    token: string,
  ): Promise<RawExchange> {
    const signal = AbortSignal.timeout(this.config.httpTimeoutMs);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };
    if (body !== null) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        ...(body !== null ? { body } : {}),
        signal,
        redirect: 'error',
      });
    } catch (err) {
      return { kind: 'failure', status: null, body: null, failure: transportFailure(err, token) };
    }

    let text: string;
    try {
      text = await readLimited(response, EDEF_MAX_RESPONSE_BYTES);
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
            dgiErrorDesc: null,
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
    return { kind: 'response', status: response.status, body: text };
  }
}

function invoiceOf(ctx: EdefInvoiceCallContext): { invoiceId: string; rn: string } {
  if (typeof ctx.invoiceId !== 'string' || ctx.invoiceId.length === 0) {
    throw new Error('Appel de facturation sans identifiant de document : erreur de programmation.');
  }
  if (typeof ctx.rn !== 'string' || ctx.rn.length === 0) {
    throw new Error('Appel de facturation sans numéro `rn` : erreur de programmation.');
  }
  return { invoiceId: ctx.invoiceId, rn: ctx.rn };
}

function assertUid(uid: string): void {
  if (typeof uid !== 'string' || uid.trim().length === 0) {
    throw new Error('`uid` DGI vide : erreur de programmation.');
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
      dgiErrorDesc: null,
      message: 'La DGI n’a pas répondu dans le délai imparti.',
    };
  }
  const cause =
    err instanceof Error && err.cause instanceof Error ? err.cause.message : String(err);
  return {
    kind: 'network',
    httpStatus: null,
    dgiErrorCode: null,
    dgiErrorDesc: null,
    message: `Serveur de la DGI injoignable (${sanitizeProviderMessage(cause, [token])}).`,
  };
}

/** Code et libellé d'erreur métier DGI dans un corps JSON (`errorCode`, `errorDesc`). */
function businessErrorOf(json: unknown): { code: string; desc: string | null } | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
  const record = json as Record<string, unknown>;
  const code = record['errorCode'];
  if (code === null || code === undefined) return null;
  const text = String(code).trim();
  if (text === '') return null;
  const desc = record['errorDesc'];
  return {
    code: text,
    desc: typeof desc === 'string' ? desc : null,
  };
}

function failure(
  kind: EdefFailureKind,
  httpStatus: number | null,
  message: string,
  dgiErrorCode: string | null = null,
  dgiErrorDesc: string | null = null,
): { ok: false; error: EdefFailure } {
  return { ok: false, error: { kind, httpStatus, dgiErrorCode, dgiErrorDesc, message } };
}

function interpret<T>(
  raw: RawExchange,
  parse: Parser<T>,
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
      desc,
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
