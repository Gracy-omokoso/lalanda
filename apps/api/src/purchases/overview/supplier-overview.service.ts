// Fiche fournisseur 360° — `GET /purchases/suppliers/:id/overview` (ADR-0044 § 3.1.1).
// ADR-0044 — P6.
//
// Ce service LIT et délègue tout calcul au moteur : totaux par devise
// (`sumAmountsByCurrency`), reste à recevoir (`orderReceptionStatus`), reste à payer
// (`payableSettlement`, via `settlementsOf`), ancienneté (`payablesAging`), doublons
// probables (`possibleDuplicateExpenses`, via le service des paiements).
//
// Isolation : la fiche est résolue dans l'organisation (404 sinon) ; toute lecture
// porte `organizationId`. Moindre privilège : une section sans droit n'est PAS lue
// (`hidden`, `data: null`) — paiements : `treasury.read` en plus ; dépenses
// directes : `treasury.read`. Les coordonnées de paiement restent masquées (fiche).

import {
  PURCHASES_VERSION,
  orderReceptionStatus,
  payablesAging,
  sumAmountsByCurrency,
  type PayableInput,
  type PurchaseOrderStatus as EngineOrderStatus,
} from '@lalanda/engine';
import type {
  PurchaseCurrency,
  PurchaseMatchingStatus,
  PurchaseOrderStatus,
  SupplierInvoiceStatus,
  SupplierOverviewCurrencyTotal,
  SupplierOverviewView,
  SupplierOverviewSection,
  SupplierOverviewToReceive,
} from '@lalanda/shared/purchases';
import { PURCHASE_ORDER_STATUSES } from '@lalanda/shared/purchases';
import { kinshasaDayOf } from '@lalanda/shared/work';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import { TreasuryExpensesService } from '../../treasury/treasury-expenses.service.js';
import { INVOICES, PAYMENTS, settlementsOf } from '../payments/payable-settlements.js';
import { SupplierPaymentsService } from '../payments/supplier-payments.service.js';
import { SuppliersService } from '../suppliers/suppliers.service.js';

const ORDERS = 'purchase_orders';
const RECEPTIONS = 'purchase_receptions';

/** Documents lus au plus par section : une fiche n'est pas un export. */
export const OVERVIEW_MAX_READ = 2000;
/** Éléments récents rendus par liste. */
export const OVERVIEW_RECENT = 20;

/** Commandes dont il reste à recevoir. */
const RECEIVING_STATUSES: readonly string[] = ['approved', 'sent', 'partially_received'];

export interface SupplierOverviewAccess {
  /** `treasury.read` (droits effectifs) : paiements et dépenses directes. */
  treasury: boolean;
}

interface OrderDoc {
  _id: unknown;
  phase: 'request' | 'order';
  status: PurchaseOrderStatus;
  requestNumber?: string | null;
  orderNumber?: string | null;
  title: string;
  currency: PurchaseCurrency;
  totals: { total: string };
  sentAt?: Date | null;
  updatedAt: Date;
  lines: {
    id: string;
    label?: string | null;
    unit?: string | null;
    quantity: string;
    receivable: boolean;
  }[];
}

interface InvoiceDoc {
  _id: unknown;
  kind: 'invoice' | 'credit_note';
  status: SupplierInvoiceStatus;
  internalNumber: string;
  supplierReference: string;
  currency: PurchaseCurrency;
  total: string;
  dueDate: string;
  disputed?: unknown;
  matching?: { status?: PurchaseMatchingStatus } | null;
}

const hidden = <T>(): SupplierOverviewSection<T> => ({ status: 'hidden', data: null });
const section = <T>(data: T, empty: boolean): SupplierOverviewSection<T> =>
  empty ? { status: 'empty', data: null } : { status: 'known', data };

const iso = (d: Date | string | null | undefined): string =>
  d ? new Date(d).toISOString() : new Date(0).toISOString();

/** Quantité nulle au format du moteur (« 0 », « 0.000 »). */
const isZero = (q: string): boolean => /^0+(\.0+)?$/.test(q);

@Injectable()
export class SupplierOverviewService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(SuppliersService) private readonly suppliers: SuppliersService,
    @Inject(SupplierPaymentsService) private readonly payments: SupplierPaymentsService,
    @Inject(TreasuryExpensesService) private readonly expenses: TreasuryExpensesService,
  ) {}

  async overview(
    organizationId: string,
    supplierId: string,
    access: SupplierOverviewAccess,
    now: Date = new Date(),
  ): Promise<SupplierOverviewView> {
    // 404 pour une fiche d'une autre organisation (ou inconnue), avant toute lecture.
    const supplier = await this.suppliers.get(organizationId, supplierId);
    const asOf = kinshasaDayOf(now);
    const [orders, invoices, payments, directExpenses] = await Promise.all([
      this.readOrders(organizationId, supplierId),
      this.readInvoices(organizationId, supplierId),
      access.treasury ? this.paymentsSection(organizationId, supplierId) : hidden<never>(),
      access.treasury ? this.expensesSection(organizationId, supplierId) : hidden<never>(),
    ]);
    const receptions = await this.receptionsSection(organizationId, orders.docs);
    const { invoicesSection, balance } = await this.invoiceSections(organizationId, invoices, asOf);
    return {
      version: PURCHASES_VERSION,
      asOf,
      supplier,
      sections: {
        orders: this.ordersSection(orders.docs, orders.truncated),
        receptions,
        invoices: invoicesSection,
        balance,
        payments,
        directExpenses,
      },
    };
  }

  // ── Demandes et commandes ────────────────────────────────────────────────

  private async readOrders(
    organizationId: string,
    supplierId: string,
  ): Promise<{ docs: OrderDoc[]; truncated: boolean }> {
    const docs = (await this.connection
      .collection(ORDERS)
      .find(
        { organizationId, supplierId },
        {
          projection: {
            phase: 1,
            status: 1,
            requestNumber: 1,
            orderNumber: 1,
            title: 1,
            currency: 1,
            'totals.total': 1,
            sentAt: 1,
            updatedAt: 1,
            lines: 1,
          },
        },
      )
      .sort({ updatedAt: -1, _id: -1 })
      .limit(OVERVIEW_MAX_READ + 1)
      .toArray()) as unknown as OrderDoc[];
    return {
      docs: docs.slice(0, OVERVIEW_MAX_READ),
      truncated: docs.length > OVERVIEW_MAX_READ,
    };
  }

  private ordersSection(
    docs: readonly OrderDoc[],
    truncated: boolean,
  ): SupplierOverviewView['sections']['orders'] {
    const totals = (list: readonly OrderDoc[]): SupplierOverviewCurrencyTotal[] =>
      sumAmountsByCurrency(
        list.map((o) => ({ currency: o.currency, amount: o.totals.total })),
      ) as SupplierOverviewCurrencyTotal[];
    // Engagé : commandes approuvées (phase `order`), hors annulées.
    const engaged = docs.filter((o) => o.phase === 'order' && o.status !== 'cancelled');
    const byStatus = PURCHASE_ORDER_STATUSES.flatMap((status) => {
      const list = docs.filter((o) => o.status === status);
      return list.length === 0
        ? []
        : [{ status, count: list.length, totalsByCurrency: totals(list) }];
    });
    return section(
      {
        totalsByCurrency: totals(engaged),
        byStatus,
        recent: docs.slice(0, OVERVIEW_RECENT).map((o) => ({
          id: String(o._id),
          number: o.orderNumber ?? o.requestNumber ?? null,
          title: o.title,
          status: o.status,
          currency: o.currency,
          total: o.totals.total,
          updatedAt: iso(o.updatedAt),
        })),
        truncated,
      },
      docs.length === 0,
    );
  }

  // ── Réceptions ───────────────────────────────────────────────────────────

  private async receptionsSection(
    organizationId: string,
    orders: readonly OrderDoc[],
  ): Promise<SupplierOverviewView['sections']['receptions']> {
    const receiving = orders.filter(
      (o) => o.phase === 'order' && RECEIVING_STATUSES.includes(o.status),
    );
    if (receiving.length === 0) return section({ toReceive: [] }, true);
    const rows = await this.connection
      .collection(RECEPTIONS)
      .find(
        { organizationId, orderId: { $in: receiving.map((o) => String(o._id)) } },
        { projection: { orderId: 1, status: 1, lines: 1 } },
      )
      .toArray();
    const byOrder = new Map<
      string,
      { status: 'recorded' | 'cancelled'; lines: { orderLineId: string; quantity: string }[] }[]
    >();
    for (const r of rows) {
      const key = String(r['orderId']);
      byOrder.set(key, [
        ...(byOrder.get(key) ?? []),
        {
          status: r['status'] as 'recorded' | 'cancelled',
          lines: ((r['lines'] ?? []) as { orderLineId: string; quantity: string }[]).map((l) => ({
            orderLineId: l.orderLineId,
            quantity: l.quantity,
          })),
        },
      ]);
    }
    const toReceive: SupplierOverviewToReceive[] = [];
    for (const o of receiving) {
      const status = orderReceptionStatus(
        {
          status: o.status as EngineOrderStatus,
          sent: o.sentAt !== null && o.sentAt !== undefined,
          lines: o.lines.map((l) => ({ id: l.id, quantity: l.quantity, receivable: l.receivable })),
        },
        byOrder.get(String(o._id)) ?? [],
      );
      const labels = new Map(o.lines.map((l) => [l.id, l]));
      const lines = status.lines
        .filter((l) => l.receivable && !isZero(l.remaining))
        .map((l) => ({
          orderLineId: l.orderLineId,
          label: labels.get(l.orderLineId)?.label ?? null,
          unit: labels.get(l.orderLineId)?.unit ?? null,
          ordered: l.ordered,
          received: l.received,
          remaining: l.remaining,
        }));
      if (lines.length === 0) continue;
      toReceive.push({
        orderId: String(o._id),
        orderNumber: o.orderNumber ?? null,
        title: o.title,
        status: status.status as PurchaseOrderStatus,
        lines,
      });
    }
    return section({ toReceive }, toReceive.length === 0);
  }

  // ── Factures, solde dû et ancienneté ─────────────────────────────────────

  private async readInvoices(
    organizationId: string,
    supplierId: string,
  ): Promise<{ docs: InvoiceDoc[]; truncated: boolean }> {
    const docs = (await this.connection
      .collection(INVOICES)
      .find(
        { organizationId, supplierId },
        {
          projection: {
            kind: 1,
            status: 1,
            internalNumber: 1,
            supplierReference: 1,
            currency: 1,
            total: 1,
            dueDate: 1,
            disputed: 1,
            'matching.status': 1,
          },
        },
      )
      .sort({ invoiceDate: -1, _id: -1 })
      .limit(OVERVIEW_MAX_READ + 1)
      .toArray()) as unknown as InvoiceDoc[];
    return {
      docs: docs.slice(0, OVERVIEW_MAX_READ),
      truncated: docs.length > OVERVIEW_MAX_READ,
    };
  }

  private async invoiceSections(
    organizationId: string,
    invoices: { docs: InvoiceDoc[]; truncated: boolean },
    asOf: string,
  ): Promise<{
    invoicesSection: SupplierOverviewView['sections']['invoices'];
    balance: SupplierOverviewView['sections']['balance'];
  }> {
    const docs = invoices.docs;
    const settlements = await settlementsOf(
      this.connection,
      organizationId,
      docs.map((d) => ({
        _id: d._id as never,
        status: d.status,
        kind: d.kind,
        total: d.total,
      })),
    );
    const remainingOf = (d: InvoiceDoc): string =>
      settlements.get(String(d._id))?.remaining ?? '0.00';
    const isDisputed = (d: InvoiceDoc): boolean => d.disputed !== null && d.disputed !== undefined;

    const open: PayableInput[] = docs
      .filter((d) => d.status === 'validated' && d.kind === 'invoice' && remainingOf(d) !== '0.00')
      .map((d) => ({
        id: String(d._id),
        currency: d.currency,
        dueDate: d.dueDate,
        remaining: remainingOf(d),
        disputed: isDisputed(d),
      }));
    const aging = payablesAging(open, asOf);
    return {
      invoicesSection: section(
        {
          recent: docs.slice(0, OVERVIEW_RECENT).map((d) => ({
            id: String(d._id),
            kind: d.kind,
            internalNumber: d.internalNumber,
            supplierReference: d.supplierReference,
            status: d.status,
            matchingStatus: (d.matching?.status ?? 'none') as PurchaseMatchingStatus,
            currency: d.currency,
            total: d.total,
            remaining: remainingOf(d),
            dueDate: d.dueDate,
            disputed: isDisputed(d),
          })),
          truncated: invoices.truncated,
        },
        docs.length === 0,
      ),
      balance: section(
        {
          byCurrency: aging.byCurrency.map((c) => ({
            currency: c.currency as PurchaseCurrency,
            remaining: c.open.amount,
            notDue: c.notDue.amount,
            days1to30: c.days1To30.amount,
            days31to60: c.days31To60.amount,
            days61to90: c.days61To90.amount,
            over90: c.over90.amount,
            disputed: c.disputed.amount,
          })),
        },
        aging.byCurrency.length === 0,
      ),
    };
  }

  // ── Paiements et dépenses directes (`treasury.read`) ────────────────────

  private async paymentsSection(
    organizationId: string,
    supplierId: string,
  ): Promise<SupplierOverviewView['sections']['payments']> {
    const rows = await this.connection
      .collection(PAYMENTS)
      .find(
        { organizationId, supplierId },
        { projection: { number: 1, paidOn: 1, currency: 1, amount: 1, status: 1 } },
      )
      .sort({ paidOn: -1, _id: -1 })
      .limit(OVERVIEW_RECENT)
      .toArray();
    return section(
      {
        recent: rows.map((p) => ({
          id: String(p._id),
          number: String(p['number']),
          paidOn: String(p['paidOn']),
          currency: p['currency'] as PurchaseCurrency,
          amount: String(p['amount']),
          status: p['status'] as 'recorded' | 'cancelled',
        })),
      },
      rows.length === 0,
    );
  }

  private async expensesSection(
    organizationId: string,
    supplierId: string,
  ): Promise<SupplierOverviewView['sections']['directExpenses']> {
    const [expenses, duplicates] = await Promise.all([
      this.expenses.directSupplierExpenses(organizationId, [supplierId]),
      this.payments.duplicates(organizationId, { supplierId }),
    ]);
    const flagged = new Set(duplicates.duplicates.map((d) => d.expenseId));
    const recent = [...expenses]
      .sort((a, b) =>
        a.spentOn === b.spentOn
          ? String(b._id).localeCompare(String(a._id))
          : a.spentOn < b.spentOn
            ? 1
            : -1,
      )
      .slice(0, OVERVIEW_RECENT)
      .map((e) => ({
        id: String(e._id),
        spentOn: e.spentOn,
        label: e.label,
        currency: e.currency as PurchaseCurrency,
        amount: e.amount,
        possibleDuplicate: flagged.has(String(e._id)),
      }));
    return section({ recent, duplicateCount: flagged.size }, expenses.length === 0);
  }
}
