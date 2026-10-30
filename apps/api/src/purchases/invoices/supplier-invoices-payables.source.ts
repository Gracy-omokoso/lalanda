// Fournisseur réel du port « reste dû par fournisseur » (ADR-0044 § 3.1, port
// `SUPPLIER_PAYABLES_SOURCE` posé par P2). ADR-0044 — P4.
//
// Reste à payer des factures VALIDÉES de chaque fiche, par devise (jamais additionné
// entre devises) : règlement de chaque facture par `payableSettlement` (paiements non
// annulés du lot P5, avoirs validés), puis regroupement par devise par
// `payablesAging` — aucun montant n'est calculé ici. Les litiges comptent : une
// facture contestée reste due tant qu'elle n'est pas annulée ou réglée.

import { payablesAging } from '@lalanda/engine';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import type {
  RemainingByCurrency,
  SupplierPayablesSource,
} from '../suppliers/supplier-payables.port.js';
import { todayInKinshasa } from './purchase-p4.common.js';
import {
  SupplierInvoice,
  type SupplierInvoiceDocument,
  type SupplierInvoiceLean,
} from './supplier-invoice.schema.js';
import { SupplierInvoiceSettlements } from './supplier-invoice-settlements.js';

@Injectable()
export class SupplierInvoicesPayablesSource implements SupplierPayablesSource {
  constructor(
    @InjectModel(SupplierInvoice.name) private readonly invoices: Model<SupplierInvoiceDocument>,
    @Inject(SupplierInvoiceSettlements) private readonly settlements: SupplierInvoiceSettlements,
  ) {}

  async remainingBySupplier(
    organizationId: string,
    supplierIds: readonly string[],
  ): Promise<Map<string, RemainingByCurrency>> {
    const out = new Map<string, RemainingByCurrency>();
    if (supplierIds.length === 0) return out;
    const docs = await this.invoices
      .find({
        organizationId,
        supplierId: { $in: [...supplierIds] },
        status: 'validated',
        kind: 'invoice',
      })
      .lean<SupplierInvoiceLean[]>()
      .exec();
    if (docs.length === 0) return out;
    const settlements = await this.settlements.of(organizationId, docs);
    const today = todayInKinshasa();
    const bySupplier = new Map<string, SupplierInvoiceLean[]>();
    for (const d of docs) bySupplier.set(d.supplierId, [...(bySupplier.get(d.supplierId) ?? []), d]);
    for (const [supplierId, list] of bySupplier) {
      const aging = payablesAging(
        list.map((d) => ({
          id: String(d._id),
          currency: d.currency,
          dueDate: d.dueDate,
          remaining: settlements.get(String(d._id))?.remaining ?? d.total,
          // Tout le reste dû compte ici : une seule tranche « ouverte » par devise.
          disputed: false,
        })),
        today,
      );
      const remaining: RemainingByCurrency = {};
      for (const c of aging.byCurrency) {
        if (c.open.count > 0) remaining[c.currency] = c.open.amount;
      }
      if (Object.keys(remaining).length > 0) out.set(supplierId, remaining);
    }
    return out;
  }
}
