// Tableaux de bord des écrans Achats (ADR-0071) — LECTURE SEULE.
//
//   GET /purchases/invoices/stats   GET /purchases/payables/stats   GET /purchases/orders/stats
//
// Organisation active seulement ; rien n'est stocké. Tout chiffre vient du moteur
// (`computeSupplierInvoiceStats`, `computePayablesStats`, `computePurchaseOrderStats`),
// qui réutilise `payableSettlement` (lu par `settlementsOf`) et `payablesAging` :
// aucune arithmétique ici. Lecture bornée à `PURCHASE_STATS_MAX_READ` documents par
// collection ; au-delà, `truncated: true` (chiffres partiels, annoncés à l'écran).

import {
  computePayablesStats,
  EXPENSE_CATEGORIES,
  computePurchaseOrderStats,
  computeSupplierInvoiceStats,
} from '@lalanda/engine';
import {
  PURCHASE_STATS_DEFAULT_MONTHS,
  PURCHASE_STATS_MAX_READ,
  type PayablesStats,
  type PurchaseOrderStats,
  type SupplierInvoiceStats,
} from '@lalanda/shared/purchases';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import { kinshasaDayOf } from '../../sales/receipts/kinshasa-day.js';
import {
  INVOICES,
  PAYMENTS,
  readInvoices,
  settlementsOf,
  supplierNamesOf,
  type PayableInvoiceDoc,
} from '../payments/payable-settlements.js';
import { PurchaseSettingsService } from '../settings/purchase-settings.service.js';

const ORDERS = 'purchase_orders';
/** Libellés des catégories d'imputation (celles de la trésorerie, ADR-0044 § 2.5). */
const LABELS = new Map<string, string>(EXPENSE_CATEGORIES.map((c) => [c.code, c.label]));

/** Premier jour du mois qui précède la fenêtre (le « mois précédent » de la 1ʳᵉ carte). */
function readFrom(asOf: string, months: number): string {
  const y = Number(asOf.slice(0, 4));
  const m = Number(asOf.slice(5, 7)) - 1 - months;
  const year = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${String(year).padStart(4, '0')}-${String(mm + 1).padStart(2, '0')}-01`;
}

function bounded<T>(docs: T[]): { kept: T[]; truncated: boolean } {
  return {
    kept: docs.slice(0, PURCHASE_STATS_MAX_READ),
    truncated: docs.length > PURCHASE_STATS_MAX_READ,
  };
}

interface InvoiceStatsDoc extends PayableInvoiceDoc {
  matching?: { status?: string } | null;
}

@Injectable()
export class PurchasesStatsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(PurchaseSettingsService) private readonly settings: PurchaseSettingsService,
  ) {}

  async invoices(
    organizationId: string,
    months = PURCHASE_STATS_DEFAULT_MONTHS,
    now = new Date(),
  ): Promise<SupplierInvoiceStats> {
    const asOf = kinshasaDayOf(now);
    const read = (await this.connection
      .collection(INVOICES)
      .find(
        { organizationId },
        {
          projection: {
            kind: 1,
            status: 1,
            currency: 1,
            invoiceDate: 1,
            dueDate: 1,
            total: 1,
            costAllocations: 1,
            disputed: 1,
            'matching.status': 1,
          },
        },
      )
      .sort({ invoiceDate: -1, _id: -1 })
      .limit(PURCHASE_STATS_MAX_READ + 1)
      .toArray()) as unknown as InvoiceStatsDoc[];
    const { kept, truncated } = bounded(read);
    const settlements = await settlementsOf(this.connection, organizationId, kept);
    const stats = computeSupplierInvoiceStats({
      asOf,
      months,
      invoices: kept.map((d) => ({
        id: String(d._id),
        kind: d.kind,
        status: d.status,
        currency: d.currency,
        invoiceDate: d.invoiceDate,
        dueDate: d.dueDate,
        total: d.total,
        matchingStatus: d.matching?.status ?? 'not_applicable',
        disputed: d.disputed !== null && d.disputed !== undefined,
        remaining: settlements.get(String(d._id))?.remaining ?? '0.00',
        costAllocations: (d.costAllocations ?? []).map((a) => ({
          category: a.category,
          amount: a.amount,
        })),
      })),
    });
    return {
      ...stats,
      byCurrency: stats.byCurrency.map((c) => ({
        ...c,
        byCategory: c.byCategory.map((x) => ({
          ...x,
          label: LABELS.get(x.category) ?? x.category,
        })),
      })),
      truncated,
    };
  }

  async payables(
    organizationId: string,
    months = PURCHASE_STATS_DEFAULT_MONTHS,
    now = new Date(),
  ): Promise<PayablesStats> {
    const asOf = kinshasaDayOf(now);
    const effective = await this.settings.effective(organizationId);
    const [invoiceRead, paymentRead] = await Promise.all([
      this.connection
        .collection(INVOICES)
        .find(
          { organizationId, status: 'validated', kind: 'invoice' },
          {
            projection: {
              supplierId: 1,
              kind: 1,
              status: 1,
              currency: 1,
              invoiceDate: 1,
              dueDate: 1,
              total: 1,
              disputed: 1,
            },
          },
        )
        .sort({ dueDate: 1, _id: 1 })
        .limit(PURCHASE_STATS_MAX_READ + 1)
        .toArray() as unknown as Promise<PayableInvoiceDoc[]>,
      this.connection
        .collection(PAYMENTS)
        .find(
          {
            organizationId,
            status: { $ne: 'cancelled' },
            paidOn: { $gte: readFrom(asOf, months), $lte: asOf },
          },
          { projection: { status: 1, currency: 1, paidOn: 1, amount: 1, allocations: 1 } },
        )
        .sort({ paidOn: -1, _id: -1 })
        .limit(PURCHASE_STATS_MAX_READ + 1)
        .toArray(),
    ]);
    const inv = bounded(invoiceRead);
    const pay = bounded(paymentRead);
    const settlements = await settlementsOf(this.connection, organizationId, inv.kept);
    const allocated = pay.kept.flatMap((p) =>
      ((p['allocations'] ?? []) as { invoiceId?: unknown }[])
        .map((a) => a.invoiceId)
        .filter((id): id is string => typeof id === 'string'),
    );
    const known = new Map(inv.kept.map((d) => [String(d._id), d.invoiceDate]));
    const missing = allocated.filter((id) => !known.has(id));
    for (const d of await readInvoices(this.connection, organizationId, missing)) {
      known.set(String(d._id), d.invoiceDate);
    }
    const open = inv.kept
      .map((d) => ({ d, remaining: settlements.get(String(d._id))?.remaining ?? '0.00' }))
      .filter((x) => x.remaining !== '0.00');
    const stats = computePayablesStats({
      asOf,
      months,
      dueSoonDays: effective.dueSoonDays,
      invoices: open.map(({ d, remaining }) => ({
        id: String(d._id),
        supplierId: d.supplierId,
        currency: d.currency,
        invoiceDate: d.invoiceDate,
        dueDate: d.dueDate,
        remaining,
        disputed: d.disputed !== null && d.disputed !== undefined,
      })),
      payments: pay.kept.map((p) => ({
        id: String(p._id),
        status: String(p['status']),
        currency: p['currency'] as 'CDF' | 'USD',
        paidOn: String(p['paidOn']),
        amount: String(p['amount']),
        allocations: ((p['allocations'] ?? []) as { invoiceId?: unknown }[])
          .filter((a): a is { invoiceId: string } => typeof a.invoiceId === 'string')
          .map((a) => ({ invoiceId: a.invoiceId, invoiceDate: known.get(a.invoiceId) ?? null })),
      })),
    });
    const names = await supplierNamesOf(
      this.connection,
      organizationId,
      stats.byCurrency.flatMap((c) => c.topSuppliers.map((s) => s.supplierId)),
    );
    return {
      ...stats,
      byCurrency: stats.byCurrency.map((c) => ({
        ...c,
        topSuppliers: c.topSuppliers.map((s) => ({
          ...s,
          supplierName: names.get(s.supplierId) ?? null,
        })),
      })),
      truncated: inv.truncated || pay.truncated,
    };
  }

  async orders(
    organizationId: string,
    me: string,
    months = PURCHASE_STATS_DEFAULT_MONTHS,
    now = new Date(),
  ): Promise<PurchaseOrderStats> {
    const asOf = kinshasaDayOf(now);
    const read = await this.connection
      .collection(ORDERS)
      .find(
        { organizationId },
        {
          projection: {
            phase: 1,
            status: 1,
            currency: 1,
            requestedBy: 1,
            'totals.total': 1,
            submittedOn: 1,
            submittedAt: 1,
            approvedAt: 1,
          },
        },
      )
      .sort({ updatedAt: -1, _id: -1 })
      .limit(PURCHASE_STATS_MAX_READ + 1)
      .toArray();
    const { kept, truncated } = bounded(read);
    const dayOf = (v: unknown): string | null => (v instanceof Date ? kinshasaDayOf(v) : null);
    const stats = computePurchaseOrderStats({
      asOf,
      months,
      me,
      orders: kept.map((o) => ({
        id: String(o._id),
        phase: o['phase'] as 'request' | 'order',
        status: String(o['status']),
        currency: o['currency'] as 'CDF' | 'USD',
        requestedBy: String(o['requestedBy']),
        total: String((o['totals'] as { total?: string } | undefined)?.total ?? '0.00'),
        submittedOn:
          typeof o['submittedOn'] === 'string' ? o['submittedOn'] : dayOf(o['submittedAt']),
        approvedOn: dayOf(o['approvedAt']),
      })),
    });
    return { ...stats, truncated };
  }
}
