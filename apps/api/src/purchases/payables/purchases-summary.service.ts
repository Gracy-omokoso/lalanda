// Résumé des achats — `GET /purchases/summary` (ADR-0044 § 3.6, § 7). ADR-0044 — P6.
//
// LECTURE SEULE, organisation seulement ; tout montant vient du moteur
// (`purchasesSummary`, qui s'appuie sur `orderRemainingToInvoice`, `splitAllocation`
// et le règlement `payableSettlement` lu par `settlementsOf`).
//
// Deux passages du moteur, sans aucune arithmétique ici :
//   1. ENGAGÉ, à date : commandes approuvées non closes, contre TOUTES les factures
//      validées qui les visent (sinon le reste à facturer serait faux) ;
//   2. FACTURÉ, AVOIRS, PAYÉ, RESTE : factures validées de la période.
// Le résultat recopie `committed` du premier et les autres chiffres du second, ligne
// à ligne (même devise, même fournisseur ou même catégorie).

import {
  PURCHASES_VERSION,
  purchasesSummary,
  type PurchasesSummary,
  type SummaryInvoiceInput,
  type SummaryOrderInput,
} from '@lalanda/engine';
import type {
  PurchaseCurrency,
  PurchasesSummaryFiguresView,
  PurchasesSummaryQuery,
  PurchasesSummaryView,
} from '@lalanda/shared/purchases';
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import { INVOICES, settlementsOf, supplierNamesOf } from '../payments/payable-settlements.js';

const ORDERS = 'purchase_orders';
const OPEN_ORDER_STATUSES = ['approved', 'sent', 'partially_received', 'received'];
/** Documents lus au plus par passage : un résumé n'est pas un export. */
export const SUMMARY_MAX_READ = 5000;

interface InvoiceDoc {
  _id: unknown;
  kind: 'invoice' | 'credit_note';
  status: 'draft' | 'validated' | 'cancelled';
  supplierId: string;
  currency: PurchaseCurrency;
  total: string;
  invoiceDate: string;
  orderIds?: string[];
  lines?: { orderLineId?: string | null; quantity: string }[];
  costAllocations: { category: string; workProjectId?: string | null; amount: string }[];
}

const ZERO = '0.00';
const EMPTY: PurchasesSummaryFiguresView = {
  committed: ZERO,
  invoiced: ZERO,
  credited: ZERO,
  paid: ZERO,
  remaining: ZERO,
};

type Row = PurchasesSummaryFiguresView & { currency: PurchaseCurrency };

/** Ligne fusionnée : `committed` du passage 1, le reste du passage 2. */
function merge<T extends Row>(
  engaged: readonly T[],
  billed: readonly T[],
  keyOf: (r: T) => string,
  base: (r: T) => Omit<T, keyof PurchasesSummaryFiguresView>,
): T[] {
  const out = new Map<string, T>();
  for (const r of billed) {
    out.set(keyOf(r), { ...base(r), ...EMPTY, ...pick(r), committed: ZERO } as T);
  }
  for (const r of engaged) {
    const k = keyOf(r);
    const cur = out.get(k) ?? ({ ...base(r), ...EMPTY } as T);
    out.set(k, { ...cur, committed: r.committed });
  }
  return [...out.values()]
    .filter((r) => Object.values(pick(r)).some((v) => v !== ZERO))
    .sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));
}

function pick(r: PurchasesSummaryFiguresView): PurchasesSummaryFiguresView {
  return {
    committed: r.committed,
    invoiced: r.invoiced,
    credited: r.credited,
    paid: r.paid,
    remaining: r.remaining,
  };
}

@Injectable()
export class PurchasesSummaryService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async summary(
    organizationId: string,
    query: PurchasesSummaryQuery,
  ): Promise<PurchasesSummaryView> {
    const from = query.from ?? null;
    const to = query.to ?? null;
    const orders = await this.connection
      .collection(ORDERS)
      .find(
        { organizationId, phase: 'order', status: { $in: OPEN_ORDER_STATUSES } },
        { projection: { currency: 1, supplierId: 1, lines: 1 } },
      )
      .limit(SUMMARY_MAX_READ + 1)
      .toArray();
    const orderIds = orders.slice(0, SUMMARY_MAX_READ).map((o) => String(o._id));
    const projection = {
      kind: 1,
      status: 1,
      supplierId: 1,
      currency: 1,
      total: 1,
      invoiceDate: 1,
      orderIds: 1,
      lines: 1,
      costAllocations: 1,
    };
    const dates: Record<string, string> = {};
    if (from) dates['$gte'] = from;
    if (to) dates['$lte'] = to;
    const [linked, billed] = await Promise.all([
      orderIds.length === 0
        ? Promise.resolve([] as InvoiceDoc[])
        : (this.connection
            .collection(INVOICES)
            .find(
              { organizationId, status: 'validated', orderIds: { $in: orderIds } },
              { projection },
            )
            .limit(SUMMARY_MAX_READ + 1)
            .toArray() as unknown as Promise<InvoiceDoc[]>),
      this.connection
        .collection(INVOICES)
        .find(
          {
            organizationId,
            status: 'validated',
            kind: 'invoice',
            ...(from || to ? { invoiceDate: dates } : {}),
          },
          { projection },
        )
        .limit(SUMMARY_MAX_READ + 1)
        .toArray() as unknown as Promise<InvoiceDoc[]>,
    ]);
    const truncated =
      orders.length > SUMMARY_MAX_READ ||
      linked.length > SUMMARY_MAX_READ ||
      billed.length > SUMMARY_MAX_READ;
    const linkedKept = linked.slice(0, SUMMARY_MAX_READ);
    const billedKept = billed.slice(0, SUMMARY_MAX_READ);
    const all = new Map<string, InvoiceDoc>();
    for (const d of [...linkedKept, ...billedKept]) all.set(String(d._id), d);
    const settlements = await settlementsOf(this.connection, organizationId, [
      ...all.values(),
    ] as never);

    const input = (d: InvoiceDoc): SummaryInvoiceInput => {
      const s = settlements.get(String(d._id));
      return {
        id: String(d._id),
        kind: d.kind,
        status: d.status,
        supplierId: d.supplierId,
        currency: d.currency,
        total: d.total,
        lines: (d.lines ?? []).map((l) => ({
          orderLineId: l.orderLineId ?? null,
          quantity: l.quantity,
        })),
        costAllocations: d.costAllocations,
        settlement: {
          paid: s?.paid ?? ZERO,
          credited: s?.credited ?? ZERO,
          remaining: s?.remaining ?? ZERO,
        },
      };
    };
    const orderInputs: SummaryOrderInput[] = orders.slice(0, SUMMARY_MAX_READ).map((o) => ({
      id: String(o._id),
      supplierId: String(o['supplierId']),
      currency: o['currency'] as PurchaseCurrency,
      lines: (
        (o['lines'] ?? []) as {
          id: string;
          quantity: string;
          unitPrice: string;
          discountPercent?: string | null;
          receivable: boolean;
          category?: string | null;
          workProjectId?: string | null;
        }[]
      ).map((l) => ({
        id: l.id,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent ?? null,
        receivable: l.receivable,
        category: l.category ?? null,
        workProjectId: l.workProjectId ?? null,
      })),
    }));

    const engaged: PurchasesSummary = purchasesSummary({
      orders: orderInputs,
      invoices: linkedKept.map(input),
    });
    const period: PurchasesSummary = purchasesSummary({
      orders: [],
      invoices: billedKept.map(input),
    });

    const bySupplier = merge(
      engaged.bySupplier as (Row & { supplierId: string })[],
      period.bySupplier as (Row & { supplierId: string })[],
      (r) => `${r.currency}\u0000${r.supplierId}`,
      (r) => ({ supplierId: r.supplierId, currency: r.currency }),
    );
    const names = await supplierNamesOf(
      this.connection,
      organizationId,
      bySupplier.map((r) => r.supplierId),
    );
    return {
      version: PURCHASES_VERSION,
      from,
      to,
      byCurrency: merge(
        engaged.byCurrency as Row[],
        period.byCurrency as Row[],
        (r) => r.currency,
        (r) => ({ currency: r.currency }),
      ),
      bySupplier: bySupplier.map((r) => ({
        ...r,
        supplierName: names.get(r.supplierId) ?? null,
      })),
      byCategory: merge(
        engaged.byCategory as (Row & { category: string })[],
        period.byCategory as (Row & { category: string })[],
        (r) => `${r.currency}\u0000${r.category}`,
        (r) => ({ category: r.category, currency: r.currency }),
      ),
      truncated,
    };
  }
}
