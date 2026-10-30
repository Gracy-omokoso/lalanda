// Fournisseur réel du port `WORK_PURCHASES_SOURCE` de la marge — ADR-0044 § 6.1.
// ADR-0044 — P6.
//
// LECTURE SEULE par la connexion, dans l'organisation seulement :
//   - factures fournisseurs VALIDÉES (type `invoice`) dont une imputation vise le
//     projet, avec leur reste à payer (moteur `payableSettlement`, via
//     `settlementsOf`) ;
//   - commandes approuvées non closes (`approved`, `sent`, `partially_received`,
//     `received`) dont une ligne vise le projet, avec les factures VALIDÉES qui les
//     visent.
// Aucun montant n'est calculé ici : `computeProjectMargin` répartit et additionne.
// Fourni par le module de la facturation des projets, sans dépendre du module des
// achats (pas de cycle d'injection).

import type {
  InvoicedLinesInput,
  WorkMarginOrderInput,
  WorkMarginPayableInput,
} from '@lalanda/engine';
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import type {
  WorkPurchasesRead,
  WorkPurchasesSource,
} from '../../work/margin/work-purchases.port.js';
import {
  INVOICES,
  settlementsOf,
  type PayableInvoiceDoc,
} from '../payments/payable-settlements.js';

const ORDERS = 'purchase_orders';

/** Commandes engagées : approuvées, envoyées, reçues en partie ou en totalité. */
const OPEN_ORDER_STATUSES = ['approved', 'sent', 'partially_received', 'received'];

/** Lecture bornée : un projet n'a pas des milliers d'achats ouverts. */
const MAX_READ = 2000;

interface OrderLineDoc {
  id: string;
  quantity: string;
  unitPrice: string;
  discountPercent?: string | null;
  receivable: boolean;
  category?: string | null;
  workProjectId?: string | null;
}

@Injectable()
export class PurchasesMarginSource implements WorkPurchasesSource {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async purchasesOf(organizationId: string, projectId: string): Promise<WorkPurchasesRead> {
    const [invoices, orders] = await Promise.all([
      this.connection
        .collection(INVOICES)
        .find(
          {
            organizationId,
            status: 'validated',
            kind: 'invoice',
            'costAllocations.workProjectId': projectId,
          },
          { projection: { status: 1, kind: 1, total: 1, currency: 1, costAllocations: 1 } },
        )
        .limit(MAX_READ)
        .toArray() as unknown as Promise<PayableInvoiceDoc[]>,
      this.connection
        .collection(ORDERS)
        .find(
          {
            organizationId,
            phase: 'order',
            status: { $in: OPEN_ORDER_STATUSES },
            'lines.workProjectId': projectId,
          },
          { projection: { currency: 1, lines: 1 } },
        )
        .limit(MAX_READ)
        .toArray(),
    ]);

    const settlements = await settlementsOf(this.connection, organizationId, invoices);
    const payables: WorkMarginPayableInput[] = invoices.map((inv) => ({
      id: String(inv._id),
      currency: inv.currency,
      remaining: settlements.get(String(inv._id))?.remaining ?? '0.00',
      costAllocations: (inv.costAllocations ?? []).map((a) => ({
        amount: a.amount,
        workProjectId: a.workProjectId ?? null,
      })),
    }));

    const orderIds = orders.map((o) => String(o._id));
    const billed =
      orderIds.length === 0
        ? []
        : await this.connection
            .collection(INVOICES)
            .find(
              { organizationId, status: 'validated', orderIds: { $in: orderIds } },
              { projection: { kind: 1, status: 1, lines: 1, orderIds: 1 } },
            )
            .toArray();
    const byOrder = new Map<string, InvoicedLinesInput[]>();
    for (const inv of billed) {
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
    const orderInputs: WorkMarginOrderInput[] = orders.map((o) => ({
      id: String(o._id),
      currency: o['currency'] as 'CDF' | 'USD',
      lines: ((o['lines'] ?? []) as OrderLineDoc[]).map((l) => ({
        id: l.id,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent ?? null,
        receivable: l.receivable,
        category: l.category ?? null,
        workProjectId: l.workProjectId ?? null,
      })),
      invoices: byOrder.get(String(o._id)) ?? [],
    }));
    return { payables, orders: orderInputs };
  }
}
