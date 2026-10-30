// Règlement des factures fournisseurs (ADR-0044 § 2.6, moteur `payableSettlement`).
// ADR-0044 — P4.
//
// Classe à part, sans autre dépendance que les factures et la connexion : le port
// `SUPPLIER_PAYABLES_SOURCE` (lu par `SuppliersService`) s'en sert sans dépendre du
// service des factures, qui dépend lui-même de `SuppliersService` (pas de cycle).

import { payableSettlement, type PayableSettlement } from '@lalanda/engine';
import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import {
  SupplierInvoice,
  type SupplierInvoiceDocument,
  type SupplierInvoiceLean,
} from './supplier-invoice.schema.js';

/** Paiements fournisseurs (lot P5), lus par la connexion (champs de l'ADR § 2.6). */
const PAYMENTS = 'supplier_payments';

export type Settlement = Omit<PayableSettlement, 'version' | 'total'>;

/** Ce qui ne porte pas de dette : brouillon, avoir, facture annulée. */
export const NO_DEBT: Settlement = {
  status: 'unpaid',
  paid: '0.00',
  credited: '0.00',
  remaining: '0.00',
  overpaid: '0.00',
};

@Injectable()
export class SupplierInvoiceSettlements {
  constructor(
    @InjectModel(SupplierInvoice.name) private readonly invoices: Model<SupplierInvoiceDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async of(
    organizationId: string,
    docs: readonly Pick<SupplierInvoiceLean, '_id' | 'status' | 'kind' | 'total'>[],
  ): Promise<Map<string, Settlement>> {
    const out = new Map<string, Settlement>();
    const open = docs.filter((d) => d.status === 'validated' && d.kind === 'invoice');
    if (open.length === 0) return out;
    const ids = open.map((d) => String(d._id));
    const [payments, credits] = await Promise.all([
      this.connection
        .collection(PAYMENTS)
        .find(
          { organizationId, status: { $ne: 'cancelled' }, 'allocations.invoiceId': { $in: ids } },
          { projection: { allocations: 1 } },
        )
        .toArray(),
      this.invoices
        .find(
          {
            organizationId,
            kind: 'credit_note',
            status: 'validated',
            creditedInvoiceId: { $in: ids },
          },
          { creditedInvoiceId: 1, total: 1 },
        )
        .lean<{ creditedInvoiceId: string; total: string }[]>()
        .exec(),
    ]);
    const paidBy = new Map<string, string[]>();
    for (const p of payments) {
      for (const a of (p['allocations'] ?? []) as { invoiceId?: unknown; amount?: unknown }[]) {
        if (typeof a.invoiceId !== 'string' || typeof a.amount !== 'string') continue;
        paidBy.set(a.invoiceId, [...(paidBy.get(a.invoiceId) ?? []), a.amount]);
      }
    }
    const creditBy = new Map<string, string[]>();
    for (const c of credits) {
      creditBy.set(c.creditedInvoiceId, [...(creditBy.get(c.creditedInvoiceId) ?? []), c.total]);
    }
    for (const d of open) {
      const id = String(d._id);
      const s = payableSettlement({ total: d.total }, paidBy.get(id) ?? [], creditBy.get(id) ?? []);
      out.set(id, {
        status: s.status,
        paid: s.paid,
        credited: s.credited,
        remaining: s.remaining,
        overpaid: s.overpaid,
      });
    }
    return out;
  }
}
