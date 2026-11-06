// Tableau de bord des devis — `GET /sales/quotes/stats` (ADR-0067).
//
// LECTURE SEULE. Lit les devis de l'organisation (version courante et dates
// d'envoi des versions précédentes) et la devise de référence du tableau des
// factures (ADR-0056), puis délègue TOUT calcul au moteur (`computeQuoteStats`).
// Le jour du calcul est celui de la liste (`kinshasaDay`) : le statut « expiré »
// et les compteurs des onglets concordent avec `GET /sales/quotes`.

import { computeQuoteStats, type QuoteStatsQuote } from '@lalanda/engine';
import type { QuoteStats } from '@lalanda/shared/sales-invoices';
import { QUOTE_STATS_DEFAULT_MONTHS } from '@lalanda/shared/sales-invoices';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { kinshasaDay } from '../../crm/crm-model.js';
import { InvoiceStatsService } from '../invoices/invoice-stats.service.js';
import { kinshasaDayOf } from '../receipts/kinshasa-day.js';
import { SalesQuote, type QuoteLean, type SalesQuoteDocument } from './quote.schema.js';

/** Même borne explicite que le tableau des factures (`truncated: true`, affiché). */
export const QUOTE_STATS_MAX_DOCUMENTS = 20_000;

type StatsQuote = Pick<
  QuoteLean,
  | '_id'
  | 'status'
  | 'validUntil'
  | 'currency'
  | 'documentAmounts'
  | 'sentAt'
  | 'acceptedAt'
  | 'conversion'
  | 'previousVersions'
>;

/** Premier envoi, toutes versions confondues. */
function firstSentAt(q: StatsQuote): Date | null {
  const dates = [q.sentAt, ...(q.previousVersions ?? []).map((v) => v.sentAt)]
    .filter((d): d is Date => d !== null && d !== undefined)
    .map((d) => new Date(d));
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => (b.getTime() < a.getTime() ? b : a));
}

@Injectable()
export class QuoteStatsService {
  constructor(
    @InjectModel(SalesQuote.name) private readonly quotes: Model<SalesQuoteDocument>,
    @Inject(InvoiceStatsService) private readonly invoiceStats: InvoiceStatsService,
  ) {}

  async stats(organizationId: string, months?: number): Promise<QuoteStats> {
    const [reference, docs] = await Promise.all([
      this.invoiceStats.referenceCurrency(organizationId),
      this.quotes
        .find(
          { organizationId },
          {
            status: 1,
            validUntil: 1,
            currency: 1,
            'documentAmounts.calculation.totals.total': 1,
            sentAt: 1,
            acceptedAt: 1,
            conversion: 1,
            'previousVersions.sentAt': 1,
          },
        )
        .sort({ createdAt: -1, _id: -1 })
        .limit(QUOTE_STATS_MAX_DOCUMENTS + 1)
        .lean()
        .exec() as unknown as Promise<StatsQuote[]>,
    ]);
    const truncated = docs.length > QUOTE_STATS_MAX_DOCUMENTS;
    const kept = truncated ? docs.slice(0, QUOTE_STATS_MAX_DOCUMENTS) : docs;
    const quotes: QuoteStatsQuote[] = kept.map((q) => {
      const sent = firstSentAt(q);
      return {
        id: String(q._id),
        status: q.status,
        validUntil: q.validUntil,
        currency: q.currency,
        total: q.documentAmounts?.calculation?.totals?.total ?? null,
        firstSentOn: sent ? kinshasaDayOf(sent) : null,
        acceptedOn: q.acceptedAt ? kinshasaDayOf(new Date(q.acceptedAt)) : null,
        converted: q.conversion !== null && q.conversion !== undefined,
      };
    });
    const result = computeQuoteStats({
      referenceCurrency: reference.currency,
      asOf: kinshasaDay(new Date()),
      months: months ?? QUOTE_STATS_DEFAULT_MONTHS,
      quotes,
    });
    return { ...result, currencySource: reference.source, truncated };
  }
}
