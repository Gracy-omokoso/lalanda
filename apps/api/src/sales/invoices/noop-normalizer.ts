// Implémentation par défaut du port de normalisation — ADR-0023 § S25e.10.
//
// Dans S25e, aucune connexion à la DGI : le document reste
// `pending_normalization` (pro forma, « normalisation en cours »). S25f
// remplace ce fournisseur dans `SalesModule` sans toucher au reste.

import { Injectable } from '@nestjs/common';

import type { NormalizeNowOutcome, SalesInvoiceNormalizer } from './normalization.port.js';

@Injectable()
export class NoopSalesInvoiceNormalizer implements SalesInvoiceNormalizer {
  async normalizeNow(_organizationId: string, _invoiceId: string): Promise<NormalizeNowOutcome> {
    return 'deferred';
  }
}
