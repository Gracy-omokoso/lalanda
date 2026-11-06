// Tableau de bord des encaissements — `GET /sales/receipts/stats` (ADR-0067).
//
// LECTURE SEULE. Lit, par le même chemin que le tableau des factures (ADR-0056),
// la devise de référence, les documents de vente, leurs échéances et les
// encaissements de l'organisation, puis délègue TOUT calcul au moteur
// (`computeReceiptStats`). Rien n'est stocké.

import { computeReceiptStats } from '@lalanda/engine';
import type { ReceiptStats } from '@lalanda/shared/sales-invoices';
import { RECEIPT_STATS_DEFAULT_MONTHS } from '@lalanda/shared/sales-invoices';
import { Inject, Injectable } from '@nestjs/common';

import { InvoiceStatsService } from '../invoices/invoice-stats.service.js';
import { SettlementsService } from './settlements.service.js';

@Injectable()
export class ReceiptStatsService {
  constructor(
    @Inject(InvoiceStatsService) private readonly invoiceStats: InvoiceStatsService,
    @Inject(SettlementsService) private readonly settlements: SettlementsService,
  ) {}

  async stats(organizationId: string, months?: number): Promise<ReceiptStats> {
    const { reference, documents, receipts, truncated } =
      await this.invoiceStats.inputs(organizationId);
    const result = computeReceiptStats({
      referenceCurrency: reference.currency,
      asOf: this.settlements.today(),
      months: months ?? RECEIPT_STATS_DEFAULT_MONTHS,
      documents,
      receipts,
    });
    return { ...result, currencySource: reference.source, truncated };
  }
}
