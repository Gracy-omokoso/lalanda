// Tableau de bord des encaissements — `GET /sales/receipts/stats` (ADR-0067).
//
// Contrat partagé de l'API et de l'écran RUN › Ventes › Encaissements. Le calcul
// est celui du moteur (`computeReceiptStats`) ; l'écran n'additionne rien.
// Montants : chaînes décimales à deux décimales dans la devise de référence de la
// réponse, chaque lettrage converti au taux figé sur sa facture (ADR-0056).

import { z } from 'zod';

import { INVOICE_STATS_CURRENCY_SOURCES } from './stats.js';

export const RECEIPT_STATS_DEFAULT_MONTHS = 12;
export const RECEIPT_STATS_MAX_MONTHS = 24;

export const ReceiptStatsQuerySchema = z
  .object({
    months: z.coerce.number().int().min(1).max(RECEIPT_STATS_MAX_MONTHS).optional(),
  })
  .strict();
export type ReceiptStatsQuery = z.infer<typeof ReceiptStatsQuerySchema>;

/** Les six moyens de règlement d'un encaissement (ADR-0031). */
export const RECEIPT_STATS_METHODS = [
  'ESPECES',
  'VIREMENT',
  'CARTEBANCAIRE',
  'MOBILEMONEY',
  'CHEQUES',
  'AUTRE',
] as const;
export type ReceiptStatsMethod = (typeof RECEIPT_STATS_METHODS)[number];

export const RECEIPT_STATS_METHOD_LABELS: Readonly<Record<ReceiptStatsMethod, string>> =
  Object.freeze({
    ESPECES: 'Espèces',
    VIREMENT: 'Virement',
    CARTEBANCAIRE: 'Carte bancaire',
    MOBILEMONEY: 'Mobile Money',
    CHEQUES: 'Chèque',
    AUTRE: 'Autre',
  });

const positive = z.string().regex(/^\d+\.\d{2}$/);
const currency = z.enum(['CDF', 'USD']);
const count = z.number().int().nonnegative();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-\d{2}$/);

export const ReceiptStatsSchema = z
  .object({
    currency,
    currencySource: z.enum(INVOICE_STATS_CURRENCY_SOURCES),
    asOf: day,
    from: month,
    to: month,
    months: z.array(z.object({ month, collected: positive, count }).strict()),
    totals: z.object({ collected: positive, count }).strict(),
    thisMonth: z.object({ amount: positive, count }).strict(),
    previousMonth: z.object({ month, amount: positive, count }).strict(),
    changePercent: z.number().int().nullable(),
    averageDelay: z
      .object({
        windowDays: count,
        since: day,
        days: z.number().int().nonnegative().nullable(),
        allocations: count,
      })
      .strict(),
    outstanding: z.object({ amount: positive, count }).strict(),
    overdue: z.object({ amount: positive, count }).strict(),
    byMethod: z.array(
      z.object({ method: z.enum(RECEIPT_STATS_METHODS), amount: positive, count }).strict(),
    ),
    statusCounts: z.object({ all: count, recorded: count, cancelled: count }).strict(),
    excluded: z
      .object({
        notConvertible: z.array(z.object({ currency, count, total: positive }).strict()),
      })
      .strict(),
    /** Plus de documents que la borne de lecture : chiffres partiels, dit à l'écran. */
    truncated: z.boolean(),
    version: z.string(),
  })
  .strict();
export type ReceiptStats = z.infer<typeof ReceiptStatsSchema>;
