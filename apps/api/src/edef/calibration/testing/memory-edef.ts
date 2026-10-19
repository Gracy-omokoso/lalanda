// Doublure en mémoire des routes e-MCF, pour les tests de l'outil d'étalonnage
// et des sondes (chantier F4, ADR-0024 § 7). AUCUN appel réseau.
//
// Comme le faux serveur du dépôt (`../../testing/fake-edef-server.ts`, enrichi
// par le chantier F1), elle calcule ses totaux avec le MOTEUR sous une politique
// choisie par le test — elle peut donc différer de la nôtre, ce qui est tout
// l'objet de l'étalonnage. Elle gère l'expiration des demandes en attente, le
// refus d'un `rn` en attente (63), l'annulation, la confirmation et le détail
// par `uid`, et enregistre chaque appel dans l'ordre.
//
// Les valeurs (NIF, NIM, éléments de sécurité) sont FICTIVES.

import {
  DGI_ROUNDING_POLICY,
  computeInvoiceTotals,
  decimalFromJsonNumber,
  toEdefTotals,
  usdCounterValue,
  type InvoiceLineInput,
  type RoundingPolicy,
  type TaxGroupLetter,
} from '@lalanda/engine';

import type {
  EdefInvoiceDetails,
  EdefInvoiceRequest,
  EdefSecurityElements,
} from '../../edef-invoice.types.js';
import type { EdefCallContext, EdefFailure, EdefOutcome } from '../../edef.types.js';
import type { ProbeEdef } from '../probe.js';

export type MemoryScenario =
  | 'unauthorized'
  | 'timeout'
  | 'cancel_timeout'
  | `business:${string}`
  /** Ajoute un centime au champ nommé dans la réponse du POST. */
  | `offset:${string}`;

export interface MemoryEdefOptions {
  token: string;
  nif?: string;
  policy?: RoundingPolicy;
  taxGroups?: Record<string, number>;
  usdRate?: { rate: number; date: string } | null;
  /** Scénario choisi par fragment du `rn` (le premier qui correspond). */
  scenarios?: Record<string, MemoryScenario>;
  pendingTtlMs?: number;
  clock?: () => number;
  detailsAfterConfirm?: 'with_security' | 'without_security';
}

export interface MemoryCall {
  op: 'status' | 'list' | 'submit' | 'cancel' | 'confirm' | 'details' | 'pending';
  rn: string | null;
  uid: string | null;
  ok: boolean;
}

type Stored = {
  uid: string;
  rn: string;
  createdAt: number;
  state: 'pending' | 'cancelled' | 'finalized';
  totals: Record<string, unknown>;
};

export const MEMORY_NIF = 'A1234567Z-FICTIF';

export function createMemoryEdef(opts: MemoryEdefOptions): ProbeEdef & {
  calls: MemoryCall[];
  invoices: Map<string, Stored>;
} {
  const policy = opts.policy ?? DGI_ROUNDING_POLICY;
  const taxGroups = opts.taxGroups ?? { a: 0, b: 16, c: 5, m: 0, n: 0, o: 1 };
  const usd =
    opts.usdRate === undefined ? { rate: 2262.32, date: '2026-10-19T00:00:00' } : opts.usdRate;
  const ttl = opts.pendingTtlMs ?? 120_000;
  const clock = opts.clock ?? (() => Date.now());
  const nif = opts.nif ?? MEMORY_NIF;
  const calls: MemoryCall[] = [];
  const invoices = new Map<string, Stored>();
  let counter = 0;

  const fail = <T>(kind: EdefFailure['kind'], code: string | null = null): EdefOutcome<T> => ({
    ok: false,
    durationMs: 1,
    error: {
      kind,
      httpStatus: kind === 'unauthorized' ? 401 : kind === 'business' ? 200 : null,
      dgiErrorCode: code,
      message: code ? `La DGI a renvoyé l’erreur ${code}.` : `Échec simulé (${kind}).`,
    },
  });
  const ok = <T>(data: T): EdefOutcome<T> => ({ ok: true, data, durationMs: 1 });
  const authorized = (ctx: EdefCallContext): boolean => ctx.token.expose() === opts.token;
  const scenarioOf = (rn: string | null): MemoryScenario | null => {
    if (!rn || !opts.scenarios) return null;
    for (const [fragment, s] of Object.entries(opts.scenarios)) if (rn.includes(fragment)) return s;
    return null;
  };
  const isPending = (inv: Stored): boolean =>
    inv.state === 'pending' && clock() - inv.createdAt < ttl;
  const record = (op: MemoryCall['op'], rn: string | null, uid: string | null, success: boolean) =>
    calls.push({ op, rn, uid, ok: success });

  const security = (uid: string): EdefSecurityElements => ({
    codeDefDgi: `DEF-FICTIF-${uid}`,
    nim: 'NIM-FICTIF',
    counters: '1/1 FV',
    dateTime: '19/10/2026 10:00:00',
    qrCode: `QR-FICTIF-${uid}`,
  });

  return {
    calls,
    invoices,

    async getStatus(ctx) {
      record('status', null, null, authorized(ctx));
      if (!authorized(ctx)) return fail('unauthorized');
      return ok({
        status: true,
        version: '2.0',
        nif,
        nim: 'NIM-FICTIF',
        tokenValid: '2027-01-01T00:00:00',
        serverDateTime: '2026-10-19T10:00:00',
        emcfList: [],
      });
    },

    async getReferenceList(list, ctx) {
      record('list', null, null, authorized(ctx));
      if (!authorized(ctx)) return fail('unauthorized');
      const data: Record<string, unknown> = {
        taxGroups,
        currencyRates: usd ? [{ type: 'USD', description: 'Dollar (fictif)', ...usd }] : [],
        clientTypes: [{ type: 'PP', description: 'Personne physique (fictif)' }],
        invoiceTypes: [],
        paymentTypes: [],
        referenceTypes: [],
        itemTypes: [],
      };
      return ok(data[list] as never);
    },

    async submitInvoice(body: EdefInvoiceRequest, ctx) {
      const scenario = scenarioOf(body.rn);
      if (!authorized(ctx) || scenario === 'unauthorized') {
        record('submit', body.rn, null, false);
        return fail('unauthorized');
      }
      if (scenario === 'timeout') {
        record('submit', body.rn, null, false);
        return fail('timeout');
      }
      if (scenario?.startsWith('business:')) {
        record('submit', body.rn, null, false);
        return fail('business', scenario.slice('business:'.length));
      }
      const existing = [...invoices.values()].find((i) => i.rn === body.rn && isPending(i));
      if (existing) {
        record('submit', body.rn, null, false);
        return fail('business', '63');
      }
      const lines: InvoiceLineInput[] = body.items.map((item) => ({
        unitPrice: decimalFromJsonNumber(item.price) ?? 'invalide',
        quantity: String(item.quantity),
        taxGroup: item.taxGroup as TaxGroupLetter,
        itemType: item.type,
        specificTax: item.taxSpecificValue
          ? item.taxSpecificValue.endsWith('%')
            ? { kind: 'percent', rate: item.taxSpecificValue.slice(0, -1) }
            : { kind: 'per_unit', amount: item.taxSpecificValue }
          : null,
      }));
      const rates: Partial<Record<TaxGroupLetter, string>> = {};
      for (const [k, v] of Object.entries(taxGroups)) {
        rates[k.toUpperCase() as TaxGroupLetter] = String(v);
      }
      const computed = computeInvoiceTotals({ priceMode: body.mode, lines, rates, policy });
      if (!computed.ok) {
        record('submit', body.rn, null, false);
        return fail('business', '99');
      }
      const raw: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(toEdefTotals(computed.totals, rates))) {
        if (v !== null) raw[k] = Number(v);
      }
      if (body.curRate !== undefined) {
        raw['curTotal'] = Number(usdCounterValue(computed.totals.total, String(body.curRate)));
      }
      if (scenario?.startsWith('offset:')) {
        const field = scenario.slice('offset:'.length);
        raw[field] = Math.round(((raw[field] as number | undefined) ?? 0) * 100 + 1) / 100;
      }
      counter += 1;
      const uid = `uid-${counter}`;
      raw['uid'] = uid;
      invoices.set(uid, { uid, rn: body.rn, createdAt: clock(), state: 'pending', totals: raw });
      record('submit', body.rn, uid, true);
      return ok({ uid, raw: Object.freeze({ ...raw }) });
    },

    async cancelInvoice(uid, ctx) {
      const inv = invoices.get(uid);
      const scenario = scenarioOf(inv?.rn ?? ctx.rn);
      if (!authorized(ctx)) {
        record('cancel', ctx.rn, uid, false);
        return fail('unauthorized');
      }
      if (scenario === 'cancel_timeout') {
        record('cancel', ctx.rn, uid, false);
        return fail('timeout');
      }
      if (!inv || !isPending(inv)) {
        record('cancel', ctx.rn, uid, false);
        return fail('business', '20');
      }
      inv.state = 'cancelled';
      record('cancel', ctx.rn, uid, true);
      return ok({ dateTime: '19/10/2026 10:00:01' });
    },

    async confirmInvoice(uid, _amounts, ctx) {
      const inv = invoices.get(uid);
      if (!authorized(ctx)) {
        record('confirm', ctx.rn, uid, false);
        return fail('unauthorized');
      }
      if (!inv || !isPending(inv)) {
        record('confirm', ctx.rn, uid, false);
        return fail('business', '20');
      }
      inv.state = 'finalized';
      record('confirm', ctx.rn, uid, true);
      return ok(security(uid));
    },

    async getInvoiceDetails(uid, ctx) {
      const inv = invoices.get(uid);
      if (!authorized(ctx)) {
        record('details', null, uid, false);
        return fail('unauthorized');
      }
      if (!inv || (inv.state !== 'finalized' && !isPending(inv))) {
        record('details', null, uid, false);
        return fail('business', '20');
      }
      record('details', inv.rn, uid, true);
      const details: EdefInvoiceDetails = {
        rn: inv.rn,
        nif,
        totals: inv.totals,
        security:
          inv.state === 'finalized' && opts.detailsAfterConfirm !== 'without_security'
            ? security(uid)
            : null,
      };
      return ok(details);
    },

    async getPendingRequests(ctx) {
      record('pending', null, null, authorized(ctx));
      if (!authorized(ctx)) return fail('unauthorized');
      const list = [...invoices.values()]
        .filter(isPending)
        .map((i) => ({ uid: i.uid, date: new Date(i.createdAt).toISOString() }));
      return ok({ count: list.length, list });
    },
  };
}
