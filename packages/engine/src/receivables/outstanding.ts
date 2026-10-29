// ─────────────────────────────────────────────────────────────────────────────
// Solde dû d'un client, par devise (ADR-0040 § 3.1.2, lot C8)
//
// Additionne, PAR DEVISE, les restes à encaisser déjà calculés par
// `computeSettlement` pour chaque facture : aucune conversion entre devises,
// aucun arrondi (les restes sont au centime), aucune horloge (le retard est lu
// sur chaque règlement, calculé à la date fournie par l'appelant).
//
// Le crédit client (excédent d'avoir ou d'encaissement) est rendu à part et
// n'est JAMAIS compensé avec le reste dû (ADR-0031 § 2).
//
// Fonction ajoutée : aucune sortie existante du module n'est modifiée.
// ─────────────────────────────────────────────────────────────────────────────

import { formatPositive, trustedAmount, type Fixed } from './money.js';
import { RECEIVABLES_VERSION, type Settlement } from './types.js';

/** Une facture réglable et son règlement, tel que rendu par `computeSettlement`. */
export interface OutstandingInput {
  currency: string;
  settlement: Pick<Settlement, 'outstanding' | 'overdue' | 'creditBalance'>;
}

export interface CurrencyOutstanding {
  currency: string;
  /** Somme des restes à encaisser de la devise. */
  outstanding: string;
  /** Factures de la devise portant un reste non nul. */
  openCount: number;
  /** Part du reste portée par des factures échues. */
  overdueOutstanding: string;
  /** Factures échues de la devise (reste non nul, échéance dépassée). */
  overdueCount: number;
  /** Crédit client de la devise : jamais déduit de `outstanding`. */
  creditBalance: string;
  /** Factures prises en compte dans la devise (soldées comprises). */
  invoiceCount: number;
}

export interface OutstandingByCurrency {
  version: string;
  /** Une entrée par devise rencontrée, dans l'ordre alphabétique des devises. */
  byCurrency: CurrencyOutstanding[];
}

/**
 * Solde dû par devise. Un montant illisible lève une erreur : les règlements
 * viennent du moteur et sont déjà canoniques.
 */
export function sumOutstandingByCurrency(
  items: readonly OutstandingInput[],
): OutstandingByCurrency {
  interface Bucket {
    outstanding: Fixed;
    overdue: Fixed;
    credit: Fixed;
    openCount: number;
    overdueCount: number;
    invoiceCount: number;
  }
  const buckets = new Map<string, Bucket>();
  for (const item of items) {
    if (typeof item.currency !== 'string' || item.currency.length === 0) {
      throw new RangeError('Devise manquante.');
    }
    const outstanding = trustedAmount(item.settlement.outstanding, 'Reste à encaisser');
    const credit = trustedAmount(item.settlement.creditBalance, 'Crédit client');
    const bucket = buckets.get(item.currency) ?? {
      outstanding: 0n,
      overdue: 0n,
      credit: 0n,
      openCount: 0,
      overdueCount: 0,
      invoiceCount: 0,
    };
    bucket.invoiceCount += 1;
    bucket.credit += credit;
    if (outstanding > 0n) {
      bucket.outstanding += outstanding;
      bucket.openCount += 1;
      if (item.settlement.overdue) {
        bucket.overdue += outstanding;
        bucket.overdueCount += 1;
      }
    }
    buckets.set(item.currency, bucket);
  }
  return {
    version: RECEIVABLES_VERSION,
    byCurrency: [...buckets.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([currency, b]) => ({
        currency,
        outstanding: formatPositive(b.outstanding),
        openCount: b.openCount,
        overdueOutstanding: formatPositive(b.overdue),
        overdueCount: b.overdueCount,
        creditBalance: formatPositive(b.credit),
        invoiceCount: b.invoiceCount,
      })),
  };
}
