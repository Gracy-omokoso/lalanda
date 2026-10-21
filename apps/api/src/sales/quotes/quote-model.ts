// Règles pures du devis — ADR-0035 § 1. Aucune base, aucune horloge implicite.

import { fiscalYearOf, periodInYear, type NumberingPeriod } from '../invoices/invoice-numbering.js';
import type { QuoteStatus, QuoteStoredStatus } from './quote.schema.js';

/** Validité par défaut d'un devis (ADR-0035, décision ouverte n° 4). */
export const DEFAULT_QUOTE_VALIDITY_DAYS = 30;

/** Statut lu : un devis envoyé dont la validité est passée (Kinshasa) est expiré. */
export function quoteStatusOf(
  status: QuoteStoredStatus,
  validUntil: string,
  today: string,
): QuoteStatus {
  return status === 'sent' && validUntil < today ? 'expired' : status;
}

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Brouillon',
  sent: 'Envoyé',
  accepted: 'Accepté',
  refused: 'Refusé',
  expired: 'Expiré',
};

/** Actions possibles selon le statut lu (l'interface et l'API partagent cette table). */
export function quoteActionsOf(
  status: QuoteStatus,
  convertedInvoiceAlive: boolean,
): {
  edit: boolean;
  delete: boolean;
  send: boolean;
  accept: boolean;
  refuse: boolean;
  newVersion: boolean;
  convert: boolean;
} {
  return {
    edit: status === 'draft',
    delete: status === 'draft',
    send: status === 'draft',
    accept: status === 'sent',
    refuse: status === 'sent',
    newVersion: status === 'sent' || status === 'refused' || status === 'expired',
    convert: status === 'accepted' && !convertedInvoiceAlive,
  };
}

/** `DV{AA}{MM}-NNNNNN` (alignée sur ADR-0027) ; le rang s'allonge au-delà de 999 999. */
export function formatQuoteNumber(period: NumberingPeriod, seq: number): string {
  const yy = String(period.year % 100).padStart(2, '0');
  const mm = String(period.month).padStart(2, '0');
  return `DV${yy}${mm}-${String(seq).padStart(6, '0')}`;
}

/** Année du compteur et période imprimée d'un devis créé à l'instant `at`. */
export function quoteNumberingOf(at: Date): { year: number; period: NumberingPeriod } {
  const year = fiscalYearOf(at);
  return { year, period: periodInYear(year, at) };
}
