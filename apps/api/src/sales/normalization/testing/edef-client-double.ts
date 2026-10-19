// Double de test des routes de FACTURATION du client e-MCF — ADR-0024 F2.
//
// POURQUOI UN DOUBLE : au moment où F2 est écrit, les corps des cinq méthodes
// de facturation d'`EdefClient` appartiennent au chantier F1 (non fusionné) et
// lèvent encore `F1`. Ce double remplace ces SEULES méthodes sur l'instance du
// client de l'application de test, en respectant leur contrat
// (`edef-invoice.types.ts`, ADR-0024 § 2 : jamais d'exception pour une
// défaillance distante, `EdefOutcome` typé). Au rebase sur F1, les e2e pourront
// basculer sur le faux serveur e-MCF enrichi ; les scénarios sont les mêmes.
//
// Il imite une DGI : demandes en attente qui EXPIRENT, refus d'un `rn` déjà en
// attente (erreur 63), confirmation d'une demande non en attente ambiguë
// (erreur 20), et il calcule ses totaux À PARTIR DU DOCUMENT FIGÉ (moteur) —
// donc identiques aux nôtres, sauf scénario d'écart. Il enregistre chaque appel.
// Valeurs FICTIVES : aucune ne fait autorité sur une règle fiscale.

import { toEdefTotals, decimalToJsonNumber } from '@lalanda/engine';
import type { Db } from 'mongodb';

import type { EdefClient } from '../../../edef/edef.client.js';
import type {
  EdefCancelled,
  EdefInvoiceCallContext,
  EdefInvoiceDetails,
  EdefInvoiceRequest,
  EdefInvoiceSubmitted,
  EdefPendingRequests,
  EdefSecurityElements,
} from '../../../edef/edef-invoice.types.js';
import type {
  EdefCallContext,
  EdefFailure,
  EdefFailureKind,
  EdefOutcome,
} from '../../../edef/edef.types.js';

export type SubmitScenario =
  | 'ok'
  | `totals_offset:${string}`
  | `business:${string}`
  | 'timeout_before_create'
  | 'timeout_after_create'
  | 'unauthorized'
  | 'server_error'
  | 'throw';
export type ConfirmScenario =
  | 'ok'
  | 'timeout_before_finalize'
  | 'timeout_after_finalize'
  | `business:${string}`
  | 'unauthorized';
export type CancelScenario = 'ok' | 'timeout';
export type ReadScenario = 'ok' | 'unreachable' | 'unauthorized' | 'without_security';

export interface DoubleCall {
  method: 'submit' | 'confirm' | 'cancel' | 'pending' | 'details';
  rn?: string;
  uid?: string;
  body?: EdefInvoiceRequest;
  amounts?: { total: number; vtotal: number };
  invoiceId?: string;
}

interface DgiRequest {
  uid: string;
  rn: string;
  nif: string;
  createdAt: number;
  state: 'pending' | 'finalized' | 'cancelled' | 'expired';
  raw: Record<string, unknown>;
  security: EdefSecurityElements | null;
}

const ok = <T>(data: T): EdefOutcome<T> => ({ ok: true, data, durationMs: 1 });
const ko = <T>(kind: EdefFailureKind, dgiErrorCode: string | null = null): EdefOutcome<T> => {
  const error: EdefFailure = {
    kind,
    httpStatus:
      kind === 'unauthorized' ? 401 : kind === 'server' ? 500 : kind === 'business' ? 200 : null,
    dgiErrorCode,
    message:
      kind === 'business'
        ? `La DGI a renvoyé l’erreur ${dgiErrorCode} : erreur simulée (double de test).`
        : `Défaillance simulée (${kind}).`,
  };
  return { ok: false, error, durationMs: 1 };
};

export class EdefClientDouble {
  readonly calls: DoubleCall[] = [];
  readonly requests = new Map<string, DgiRequest>();
  /** Files de scénarios, consommées appel par appel ; vides → `ok`. */
  readonly scenarios = {
    submit: [] as SubmitScenario[],
    confirm: [] as ConfirmScenario[],
    cancel: [] as CancelScenario[],
    details: [] as ReadScenario[],
    pending: [] as ReadScenario[],
  };
  /** Scénario permanent de lecture (prioritaire sur les files quand non nul). */
  readsAlways: ReadScenario | null = null;
  /** Appelé à la réception d'un `POST` (ex. : avancer l'horloge du normaliseur). */
  onSubmit: (() => void) | null = null;
  pendingTtlMs = 120_000;
  nim = 'XX01000001-1';
  now: () => number = () => Date.now();
  private seq = 0;

  constructor(private readonly db: Db) {}

  /** Remplace les cinq méthodes de facturation de CETTE instance du client. */
  install(client: EdefClient): void {
    Object.assign(client, {
      submitInvoice: (b: EdefInvoiceRequest, c: EdefInvoiceCallContext) => this.submitInvoice(b, c),
      confirmInvoice: (
        u: string,
        a: { total: number; vtotal: number },
        c: EdefInvoiceCallContext,
      ) => this.confirmInvoice(u, a, c),
      cancelInvoice: (u: string, c: EdefInvoiceCallContext) => this.cancelInvoice(u, c),
      getPendingRequests: (c: EdefCallContext) => this.getPendingRequests(c),
      getInvoiceDetails: (u: string, c: EdefCallContext) => this.getInvoiceDetails(u, c),
    });
  }

  count(method: DoubleCall['method'], filter: Partial<DoubleCall> = {}): number {
    return this.calls.filter(
      (c) =>
        c.method === method &&
        Object.entries(filter).every(
          ([k, v]) => (c as unknown as Record<string, unknown>)[k] === v,
        ),
    ).length;
  }

  reset(): void {
    this.calls.length = 0;
    this.scenarios.submit.length = 0;
    this.scenarios.confirm.length = 0;
    this.scenarios.cancel.length = 0;
    this.scenarios.details.length = 0;
    this.scenarios.pending.length = 0;
    this.readsAlways = null;
    this.onSubmit = null;
  }

  /** Crée directement une demande en attente (simulation d'un arrêt après le `POST`). */
  async createPending(body: EdefInvoiceRequest, organizationId: string): Promise<string> {
    const req = await this.newRequest(body, null, organizationId);
    return req.uid;
  }

  /** Finalise directement une demande (simulation d'un `confirm` accepté sans réponse). */
  finalize(uid: string): void {
    const r = this.requests.get(uid);
    if (r) {
      r.state = 'finalized';
      r.security = this.securityOf(r);
    }
  }

  // ── Les cinq routes ───────────────────────────────────────────────────────

  async submitInvoice(
    body: EdefInvoiceRequest,
    ctx: EdefInvoiceCallContext,
  ): Promise<EdefOutcome<EdefInvoiceSubmitted>> {
    this.expire();
    if (ctx.environment === 'production') return ko('production_disabled');
    this.calls.push({ method: 'submit', rn: body.rn, body, invoiceId: ctx.invoiceId });
    this.onSubmit?.();
    const scenario = this.scenarios.submit.shift() ?? 'ok';
    if (scenario === 'throw') throw new Error('double : erreur interne simulée');
    if (scenario === 'unauthorized') return ko('unauthorized');
    if (scenario === 'server_error') return ko('server');
    if (scenario === 'timeout_before_create') return ko('timeout');
    if (scenario.startsWith('business:')) return ko('business', scenario.slice('business:'.length));
    // Règle DGI : une demande EN ATTENTE portant ce `rn` est refusée (erreur 63).
    if (
      [...this.requests.values()].some(
        (r) => r.rn === body.rn && r.nif === body.nif && r.state === 'pending',
      )
    ) {
      return ko('business', '63');
    }
    const offset = scenario.startsWith('totals_offset:')
      ? scenario.slice('totals_offset:'.length)
      : null;
    const req = await this.newRequest(body, offset, ctx.organizationId);
    if (scenario === 'timeout_after_create') return ko('timeout');
    return ok({ uid: req.uid, raw: Object.freeze({ uid: req.uid, ...req.raw }) });
  }

  async confirmInvoice(
    uid: string,
    amounts: { total: number; vtotal: number },
    ctx: EdefInvoiceCallContext,
  ): Promise<EdefOutcome<EdefSecurityElements>> {
    this.expire();
    this.calls.push({ method: 'confirm', uid, amounts, rn: ctx.rn, invoiceId: ctx.invoiceId });
    const scenario = this.scenarios.confirm.shift() ?? 'ok';
    if (scenario === 'unauthorized') return ko('unauthorized');
    if (scenario.startsWith('business:')) return ko('business', scenario.slice('business:'.length));
    if (scenario === 'timeout_before_finalize') return ko('timeout');
    const r = this.requests.get(uid);
    if (!r || r.state !== 'pending') return ko('business', '20');
    if (r.raw['total'] !== amounts.total || r.raw['vtotal'] !== amounts.vtotal) {
      return ko('business', r.raw['total'] !== amounts.total ? '50' : '51');
    }
    r.state = 'finalized';
    r.security = this.securityOf(r);
    if (scenario === 'timeout_after_finalize') return ko('timeout');
    return ok(r.security);
  }

  async cancelInvoice(
    uid: string,
    ctx: EdefInvoiceCallContext,
  ): Promise<EdefOutcome<EdefCancelled>> {
    this.expire();
    this.calls.push({ method: 'cancel', uid, rn: ctx.rn, invoiceId: ctx.invoiceId });
    const scenario = this.scenarios.cancel.shift() ?? 'ok';
    if (scenario === 'timeout') return ko('timeout');
    const r = this.requests.get(uid);
    if (!r || r.state !== 'pending') return ko('business', '20');
    r.state = 'cancelled';
    return ok({ dateTime: new Date(this.now()).toISOString() });
  }

  async getPendingRequests(_ctx: EdefCallContext): Promise<EdefOutcome<EdefPendingRequests>> {
    this.expire();
    this.calls.push({ method: 'pending' });
    const scenario = this.readsAlways ?? this.scenarios.pending.shift() ?? 'ok';
    if (scenario === 'unreachable') return ko('timeout');
    if (scenario === 'unauthorized') return ko('unauthorized');
    const list = [...this.requests.values()]
      .filter((r) => r.state === 'pending')
      .map((r) => ({ uid: r.uid, date: new Date(r.createdAt).toISOString() }));
    return ok({ count: list.length, list });
  }

  async getInvoiceDetails(
    uid: string,
    _ctx: EdefCallContext,
  ): Promise<EdefOutcome<EdefInvoiceDetails>> {
    this.expire();
    this.calls.push({ method: 'details', uid });
    const scenario = this.readsAlways ?? this.scenarios.details.shift() ?? 'ok';
    if (scenario === 'unreachable') return ko('timeout');
    if (scenario === 'unauthorized') return ko('unauthorized');
    const r = this.requests.get(uid);
    if (!r) return ko('business', '20');
    return ok({
      rn: r.rn,
      nif: r.nif,
      totals: Object.freeze({ ...r.raw }),
      security: scenario === 'without_security' ? null : r.security,
    });
  }

  // ── Internes ──────────────────────────────────────────────────────────────

  private expire(): void {
    const now = this.now();
    for (const r of this.requests.values()) {
      if (r.state === 'pending' && now - r.createdAt > this.pendingTtlMs) r.state = 'expired';
    }
  }

  private securityOf(r: DgiRequest): EdefSecurityElements {
    return {
      codeDefDgi: `TEST-DEF-${r.uid.slice(-8).toUpperCase()}`,
      nim: this.nim,
      counters: `${this.seq}/${this.seq} FV`,
      dateTime: '2026-10-19T10:00:00',
      qrCode: `https://verification.invalid/qr/${r.uid}`,
    };
  }

  /** Totaux de la DGI = ceux du moteur sur le document figé (+ écart éventuel). */
  private async newRequest(
    body: EdefInvoiceRequest,
    offset: string | null,
    organizationId: string | null,
  ): Promise<DgiRequest> {
    const doc = await this.db
      .collection('sales_invoices')
      .findOne({ organizationId, 'normalization.reservedNumber': body.rn });
    const raw: Record<string, unknown> = {};
    if (doc?.['normalizedAmounts']) {
      const totals = toEdefTotals(
        doc['normalizedAmounts'].calculation,
        doc['taxRates']?.rates ?? {},
      );
      for (const [k, v] of Object.entries(totals)) {
        raw[k] = v === null ? null : decimalToJsonNumber(v);
      }
      const usd = doc['normalizedAmounts'].counterValueUsd;
      if (usd) raw['curTotal'] = decimalToJsonNumber(usd.amount);
    }
    if (offset !== null) {
      const current = typeof raw[offset] === 'number' ? (raw[offset] as number) : 0;
      raw[offset] = Math.round((current + 0.01) * 100) / 100;
    }
    this.seq += 1;
    const uid = `uid-${this.seq.toString().padStart(6, '0')}-${Math.random().toString(36).slice(2, 10)}`;
    const req: DgiRequest = {
      uid,
      rn: body.rn,
      nif: body.nif,
      createdAt: this.now(),
      state: 'pending',
      raw,
      security: null,
    };
    this.requests.set(uid, req);
    return req;
  }
}
