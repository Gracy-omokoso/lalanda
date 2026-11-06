// Tableau de bord des devis — `GET /sales/quotes/stats` (ADR-0067).
//
// Contrat partagé de l'API et de l'écran RUN › Ventes › Devis : requête et réponse
// (zod et type). Le calcul est celui du moteur (`computeQuoteStats`) ; l'écran
// n'additionne rien. Montants : chaînes décimales à deux décimales dans la devise
// de référence de la réponse (`currency`) ; les devis d'une autre devise n'ont
// aucun taux figé : ils sont comptés à part, total dans leur devise.

import { z } from 'zod';

import { INVOICE_STATS_CURRENCY_SOURCES } from './stats.js';

export const QUOTE_STATS_DEFAULT_MONTHS = 12;
export const QUOTE_STATS_MAX_MONTHS = 24;

export const QuoteStatsQuerySchema = z
  .object({
    months: z.coerce.number().int().min(1).max(QUOTE_STATS_MAX_MONTHS).optional(),
  })
  .strict();
export type QuoteStatsQuery = z.infer<typeof QuoteStatsQuerySchema>;

export const QUOTE_STATS_STATUSES = ['draft', 'sent', 'accepted', 'refused', 'expired'] as const;
export type QuoteStatsStatus = (typeof QUOTE_STATS_STATUSES)[number];

export const QUOTE_STATS_STATUS_LABELS: Readonly<Record<QuoteStatsStatus, string>> = Object.freeze({
  draft: 'Brouillons',
  sent: 'Envoyés',
  accepted: 'Acceptés',
  refused: 'Refusés',
  expired: 'Expirés',
});

const positive = z.string().regex(/^\d+\.\d{2}$/);
const currency = z.enum(['CDF', 'USD']);
const count = z.number().int().nonnegative();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-\d{2}$/);

const notConvertible = z.array(z.object({ currency, count, total: positive }).strict());
const amount = z.object({ count, amount: positive, notConvertible }).strict();

export const QuoteStatsSchema = z
  .object({
    currency,
    currencySource: z.enum(INVOICE_STATS_CURRENCY_SOURCES),
    asOf: day,
    from: month,
    to: month,
    months: z.array(
      z.object({ month, sent: count, accepted: count, acceptedAmount: positive }).strict(),
    ),
    open: amount,
    acceptedThisMonth: amount,
    expiringSoon: amount.extend({ until: day, withinDays: count }),
    conversion: z
      .object({
        windowDays: count,
        since: day,
        sent: count,
        accepted: count,
        ratePercent: z.number().int().min(0).max(100).nullable(),
      })
      .strict(),
    statusCounts: z
      .object({
        all: count,
        draft: count,
        sent: count,
        accepted: count,
        refused: count,
        expired: count,
      })
      .strict(),
    converted: count,
    excluded: z.object({ withoutAmount: count, notConvertible }).strict(),
    /** Plus de devis que la borne de lecture : chiffres partiels, dit à l'écran. */
    truncated: z.boolean(),
    version: z.string(),
  })
  .strict();
export type QuoteStats = z.infer<typeof QuoteStatsSchema>;
