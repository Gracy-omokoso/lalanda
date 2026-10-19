// Appels au moteur pour un document de vente — ADR-0023 § S25e.2, § S25e.6.
//
// L'API NE CALCULE RIEN : ce fichier ne fait que préparer les entrées des
// fonctions du moteur (`computeInvoiceTotals`, `checkPayments`) et lire les taux
// de l'instantané DGI. Aucune opération arithmétique sur un montant.

import {
  DEFAULT_TAX_GROUPS,
  checkPayments,
  computeInvoiceTotals,
  type PaymentInput,
  type PaymentsCheck,
  type PriceMode,
  type TaxGroupLetter,
} from '@lalanda/engine';
import { Inject, Injectable } from '@nestjs/common';

import { EdefReferenceSnapshotsService } from '../../edef/edef-reference-snapshots.service.js';
import { rateFromSnapshot } from '../tax-groups.service.js';
import type { DgiEnvironment } from './invoice.contract.js';
import type { StoredCalculation, StoredLine, StoredTaxRates } from './invoice.types.js';

@Injectable()
export class InvoiceTaxRatesReader {
  constructor(
    @Inject(EdefReferenceSnapshotsService)
    private readonly snapshots: EdefReferenceSnapshotsService,
  ) {}

  /**
   * Taux du dernier instantané `taxGroups` de l'environnement, limités aux
   * lettres A à P (même filtre que `GET /sales/tax-groups`) : les groupes Q, R,
   * S renvoyés par la DGI ne sont ni proposés ni figés. `null` sans instantané.
   */
  async latest(environment: DgiEnvironment): Promise<StoredTaxRates | null> {
    const snapshot = await this.snapshots.latest(environment, 'taxGroups');
    if (snapshot === null || snapshot.payload === null || typeof snapshot.payload !== 'object') {
      return null;
    }
    const payload = snapshot.payload as Record<string, unknown>;
    const rates: Partial<Record<TaxGroupLetter, string>> = {};
    for (const def of DEFAULT_TAX_GROUPS) {
      const rate = rateFromSnapshot(payload[def.letter.toLowerCase()]);
      if (rate !== null) rates[def.letter] = rate;
    }
    return {
      source: 'dgi_snapshot',
      environment,
      fetchedAt: snapshot.fetchedAt.toISOString(),
      sha256: snapshot.sha256,
      rates,
    };
  }
}

/** Lignes du document → entrées du moteur (prix dans la devise donnée). */
export function engineLines(
  lines: readonly Pick<StoredLine, 'unitPrice' | 'quantity' | 'taxGroup' | 'itemType' | 'specificTax'>[],
) {
  return lines.map((l) => ({
    unitPrice: l.unitPrice,
    quantity: l.quantity,
    taxGroup: l.taxGroup,
    itemType: l.itemType,
    specificTax: l.specificTax,
  }));
}

/** Totaux par le moteur ; sans taux, un calcul vide (`ok: false`, aucun problème). */
export function calculate(
  priceMode: PriceMode,
  lines: readonly StoredLine[],
  taxRates: StoredTaxRates | null,
): StoredCalculation {
  if (taxRates === null) return { ok: false, issues: [], totals: null };
  const result = computeInvoiceTotals({ priceMode, lines: engineLines(lines), rates: taxRates.rates });
  return result.ok
    ? { ok: true, issues: [], totals: result.totals }
    : { ok: false, issues: result.issues, totals: null };
}

/** Contrôle des paiements par le moteur, quand les totaux existent. */
export function paymentsCheckOf(
  calculation: StoredCalculation,
  payments: readonly PaymentInput[],
): PaymentsCheck | null {
  return calculation.totals === null ? null : checkPayments(calculation.totals.total, payments);
}
