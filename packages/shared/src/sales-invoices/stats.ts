// Tableau de bord des factures — `GET /sales/invoices/stats` (ADR-0056).
//
// Contrat partagé de l'API et de l'écran RUN › Ventes › Factures : la requête
// (zod), la réponse (zod et type) et les libellés des catégories. Le calcul est
// celui du moteur (`computeInvoiceStats`) ; l'écran n'additionne rien.
//
// Montants : chaînes décimales signées à deux décimales (`"-300.00"`), dans la
// devise de référence de la réponse (`currency`). Jamais de `number` pour un
// montant (docs/26) ; les seuls nombres sont des comptes et un pourcentage arrondi.

import { z } from 'zod';

/** Fenêtre des graphiques mensuels, en mois civils, le mois en cours compris. */
export const INVOICE_STATS_DEFAULT_MONTHS = 12;
export const INVOICE_STATS_MAX_MONTHS = 24;

export const InvoiceStatsQuerySchema = z
  .object({
    months: z.coerce.number().int().min(1).max(INVOICE_STATS_MAX_MONTHS).optional(),
  })
  .strict();
export type InvoiceStatsQuery = z.infer<typeof InvoiceStatsQuerySchema>;

/** Catégories exclusives du graphique « Documents par statut ». */
export const INVOICE_STATS_CATEGORIES = [
  'paid',
  'to_collect',
  'overdue',
  'draft',
  'pending_normalization',
  'normalization_failed',
  'credit_note',
  'other_final',
] as const;
export type InvoiceStatsCategory = (typeof INVOICE_STATS_CATEGORIES)[number];

export const INVOICE_STATS_CATEGORY_LABELS: Readonly<Record<InvoiceStatsCategory, string>> =
  Object.freeze({
    paid: 'Payées',
    to_collect: 'À encaisser',
    overdue: 'En retard',
    draft: 'Brouillons',
    pending_normalization: 'En attente DGI',
    normalization_failed: 'Normalisation refusée',
    credit_note: 'Avoirs',
    other_final: 'Autres émises',
  });

/**
 * D'où vient la devise de référence : la monnaie de tenue de la comptabilité
 * (ADR-0049 § 5) si elle est choisie, sinon le franc congolais, monnaie légale et
 * devise des montants normalisés (ADR-0056).
 */
export const INVOICE_STATS_CURRENCY_SOURCES = ['accounting_book', 'default_cdf'] as const;
export type InvoiceStatsCurrencySource = (typeof INVOICE_STATS_CURRENCY_SOURCES)[number];

const signed = z.string().regex(/^-?\d+\.\d{2}$/);
const positive = z.string().regex(/^\d+\.\d{2}$/);
const currency = z.enum(['CDF', 'USD']);

export const InvoiceStatsSchema = z
  .object({
    currency,
    currencySource: z.enum(INVOICE_STATS_CURRENCY_SOURCES),
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    from: z.string().regex(/^\d{4}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}$/),
    months: z.array(
      z
        .object({
          month: z.string().regex(/^\d{4}-\d{2}$/),
          billed: signed,
          collected: signed,
          outstanding: positive,
          overdue: positive,
        })
        .strict(),
    ),
    totals: z
      .object({
        billed: signed,
        collected: signed,
        collectedRatePercent: z.number().int().nullable(),
        invoiceCount: z.number().int().nonnegative(),
        creditNoteCount: z.number().int().nonnegative(),
      })
      .strict(),
    outstanding: z.object({ amount: positive, count: z.number().int().nonnegative() }).strict(),
    overdue: z.object({ amount: positive, count: z.number().int().nonnegative() }).strict(),
    categories: z.array(
      z
        .object({
          category: z.enum(INVOICE_STATS_CATEGORIES),
          count: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    statusCounts: z
      .object({
        all: z.number().int().nonnegative(),
        draft: z.number().int().nonnegative(),
        issued: z.number().int().nonnegative(),
        pending_normalization: z.number().int().nonnegative(),
        normalized: z.number().int().nonnegative(),
        normalization_failed: z.number().int().nonnegative(),
        final: z.number().int().nonnegative(),
      })
      .strict(),
    topCustomers: z.array(z.object({ key: z.string(), name: z.string(), billed: signed }).strict()),
    excluded: z
      .object({
        deposits: z.number().int().nonnegative(),
        testSeries: z.number().int().nonnegative(),
        notConvertible: z.array(
          z.object({ currency, count: z.number().int().nonnegative(), total: positive }).strict(),
        ),
      })
      .strict(),
    /** Plus de documents que la borne de lecture : chiffres partiels, dit à l'écran. */
    truncated: z.boolean(),
    version: z.string(),
  })
  .strict();
export type InvoiceStats = z.infer<typeof InvoiceStatsSchema>;
