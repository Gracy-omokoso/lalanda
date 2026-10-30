// Fournisseur réel du port `TREASURY_PAYABLES_SOURCE` (ADR-0044 § 6.3). ADR-0044 — P5.
//
// Fourni par le module de la TRÉSORERIE (lecture seule par la connexion, sans
// dépendre du module des achats, qui dépend lui-même de la trésorerie) :
//
//   - échéances : reste à payer (`payableSettlement`) de chaque facture VALIDÉE au
//     reste non nul, à sa `dueDate`, litige signalé (la prévision l'exclut) ;
//   - commandes approuvées non facturées : reste à facturer HT
//     (`orderRemainingToInvoice`), signalé par la prévision, jamais prévu.
//
// Aucun montant n'est calculé ici : tout vient du moteur.

import {
  orderRemainingToInvoice,
  type InvoicedLinesInput,
  type OrderNotInvoicedInput,
  type PayableForecastInput,
} from '@lalanda/engine';
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import type { TreasuryPayablesSource } from '../../treasury/treasury-sources.js';
import {
  INVOICES,
  readValidatedInvoices,
  settlementsOf,
  supplierNamesOf,
} from '../payments/payable-settlements.js';

const ORDERS = 'purchase_orders';

/** Commandes engagées : approuvées, envoyées, reçues en partie ou en totalité. */
const OPEN_ORDER_STATUSES = ['approved', 'sent', 'partially_received', 'received'];

@Injectable()
export class PurchasesPayablesSource implements TreasuryPayablesSource {
  readonly integrated = true;

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async openPayables(organizationId: string): Promise<PayableForecastInput[]> {
    const invoices = await readValidatedInvoices(this.connection, organizationId);
    if (invoices.length === 0) return [];
    const [settlements, names] = await Promise.all([
      settlementsOf(this.connection, organizationId, invoices),
      supplierNamesOf(
        this.connection,
        organizationId,
        invoices.map((i) => i.supplierId),
      ),
    ]);
    const out: PayableForecastInput[] = [];
    for (const inv of invoices) {
      const s = settlements.get(String(inv._id));
      if (!s || s.remaining === '0.00') continue;
      const name = names.get(inv.supplierId);
      out.push({
        id: String(inv._id),
        label: `Facture fournisseur ${inv.internalNumber}${name ? ` — ${name}` : ''}`,
        currency: inv.currency,
        remaining: s.remaining,
        dueDate: inv.dueDate,
        disputed: inv.disputed !== null && inv.disputed !== undefined,
        supplierId: inv.supplierId,
      });
    }
    return out;
  }

  async ordersNotInvoiced(organizationId: string): Promise<OrderNotInvoicedInput[]> {
    const orders = await this.connection
      .collection(ORDERS)
      .find(
        { organizationId, phase: 'order', status: { $in: OPEN_ORDER_STATUSES } },
        { projection: { currency: 1, lines: 1 } },
      )
      .toArray();
    if (orders.length === 0) return [];
    const ids = orders.map((o) => String(o._id));
    const invoices = await this.connection
      .collection(INVOICES)
      .find(
        { organizationId, status: 'validated', orderIds: { $in: ids } },
        { projection: { kind: 1, status: 1, lines: 1, orderIds: 1 } },
      )
      .toArray();
    const byOrder = new Map<string, InvoicedLinesInput[]>();
    for (const inv of invoices) {
      const input: InvoicedLinesInput = {
        id: String(inv._id),
        kind: inv['kind'] as InvoicedLinesInput['kind'],
        status: inv['status'] as InvoicedLinesInput['status'],
        lines: ((inv['lines'] ?? []) as { orderLineId?: string | null; quantity: string }[]).map(
          (l) => ({ orderLineId: l.orderLineId ?? null, quantity: l.quantity }),
        ),
      };
      for (const orderId of (inv['orderIds'] ?? []) as string[]) {
        byOrder.set(orderId, [...(byOrder.get(orderId) ?? []), input]);
      }
    }
    const out: OrderNotInvoicedInput[] = [];
    for (const o of orders) {
      const id = String(o._id);
      const rest = orderRemainingToInvoice(
        {
          currency: o['currency'] as 'CDF' | 'USD',
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
        },
        byOrder.get(id) ?? [],
      );
      if (rest.remainingAmount !== '0.00') {
        out.push({ id, currency: rest.currency, amount: rest.remainingAmount });
      }
    }
    return out;
  }
}
