// Règles d'origine d'un avoir — ADR-0023 § S25e.5.
//
// Vérifiées à l'enregistrement du brouillon ET au gel (l'origine a pu changer
// entre-temps : mode de l'organisation, avoirs concurrents). Les contrôles de
// quantités et de montants relèvent du moteur (`checkCreditNote`).

import type { DgiEnvironment, EmissionMode, InvoiceType } from './invoice.contract.js';
import type { InvoiceLean } from './invoice.types.js';
import { invoiceConflict } from './invoices.errors.js';

/** Type d'avoir d'une origine : `FA` pour `FV`/`FT`, `EA` pour `EV`/`ET` ; `null` sinon. */
export function creditTypeFor(originType: InvoiceType): 'FA' | 'EA' | null {
  if (originType === 'FV' || originType === 'FT') return 'FA';
  if (originType === 'EV' || originType === 'ET') return 'EA';
  return null;
}

export function assertCreditableOrigin(
  origin: InvoiceLean,
  target: {
    type: InvoiceType;
    currency: string;
    priceMode: string;
    mode: EmissionMode;
    environment: DgiEnvironment;
  },
): void {
  const expected = creditTypeFor(origin.type);
  if (expected === null || expected !== target.type) {
    invoiceConflict(
      'CREDIT_NOTE_ORIGIN_TYPE',
      'Un avoir FA se rattache à une facture FV ou FT ; un avoir EA, à une facture EV ou ET.',
      { originType: origin.type },
    );
  }
  if (origin.status !== 'issued' && origin.status !== 'normalized') {
    invoiceConflict(
      'CREDIT_NOTE_ORIGIN_NOT_FINAL',
      'Un avoir ne se rattache qu’à une facture émise ou normalisée.',
      { originStatus: origin.status },
    );
  }
  if (origin.status === 'normalized' && !origin.normalization?.codeDefDgi) {
    // Par construction, une origine normalisée porte son code DEF/DGI (S25f).
    invoiceConflict(
      'CREDIT_NOTE_ORIGIN_NOT_FINAL',
      'La facture d’origine n’a pas encore de code DEF/DGI.',
      { originStatus: origin.status },
    );
  }
  if (
    origin.emissionMode !== target.mode ||
    (target.mode === 'normalized' && origin.environment !== target.environment)
  ) {
    invoiceConflict(
      'CREDIT_NOTE_ORIGIN_MODE_MISMATCH',
      'La facture d’origine a été émise dans un autre mode (ou un autre environnement DGI) : cet avoir est refusé tant que la DGI n’a pas répondu (décision ouverte n° 5).',
    );
  }
  if (origin.currency !== target.currency) {
    invoiceConflict(
      'CREDIT_NOTE_CURRENCY_MISMATCH',
      `L’avoir doit être dans la devise de la facture d’origine (${origin.currency}).`,
    );
  }
  if (origin.priceMode !== target.priceMode) {
    invoiceConflict(
      'CREDIT_NOTE_PRICE_MODE_MISMATCH',
      `L’avoir doit être dans le mode de prix de la facture d’origine (${origin.priceMode.toUpperCase()}).`,
    );
  }
}

/** Quantité nulle (`"0"`, `"0.000"`) — comparaison de chaîne, sans arithmétique. */
export function isZeroQuantity(value: string): boolean {
  return /^0+(\.0+)?$/.test(value);
}
