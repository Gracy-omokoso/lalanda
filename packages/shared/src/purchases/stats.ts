// Tableaux de bord des écrans Achats (ADR-0071) :
//   GET /purchases/invoices/stats   GET /purchases/payables/stats   GET /purchases/orders/stats
//
// Contrats partagés de l'API et des écrans. Le calcul est celui du moteur
// (`computeSupplierInvoiceStats`, `computePayablesStats`, `computePurchaseOrderStats`) ;
// l'écran n'additionne rien. Montants : chaînes décimales à deux décimales, PAR
// DEVISE (`byCurrency`), jamais additionnés ni convertis (ADR-0044 § 7).

import { z } from 'zod';

export const PURCHASE_STATS_DEFAULT_MONTHS = 12;
export const PURCHASE_STATS_MAX_MONTHS = 24;
/** Documents lus au plus par collection : au-delà, `truncated` (ADR-0071 § 2). */
export const PURCHASE_STATS_MAX_READ = 20_000;

export const PurchaseStatsQuerySchema = z
  .object({
    months: z.coerce.number().int().min(1).max(PURCHASE_STATS_MAX_MONTHS).optional(),
  })
  .strict();
export type PurchaseStatsQuery = z.infer<typeof PurchaseStatsQuerySchema>;

const positive = z.string().regex(/^\d+\.\d{2}$/);
const currency = z.enum(['CDF', 'USD']);
const count = z.number().int().nonnegative();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-\d{2}$/);
const amountCount = z.object({ amount: positive, count }).strict();
const monthPoint = z.object({ month, amount: positive, count }).strict();
const delay = z
  .object({
    windowDays: count,
    since: day,
    days: z.number().int().nonnegative().nullable(),
  })
  .strict();

const series = {
  months: z.array(monthPoint),
  thisMonth: amountCount,
  previousMonth: monthPoint,
  changePercent: z.number().int().nullable(),
};

export const SupplierInvoiceStatsSchema = z
  .object({
    asOf: day,
    from: month,
    to: month,
    statusCounts: z
      .object({
        all: count,
        draft: count,
        variance: count,
        validated: count,
        overdue: count,
        disputed: count,
      })
      .strict(),
    byCurrency: z.array(
      z
        .object({
          currency,
          ...series,
          outstanding: amountCount,
          overdue: amountCount,
          disputed: amountCount,
          drafts: amountCount,
          variances: amountCount,
          byCategory: z.array(
            z.object({ category: z.string(), label: z.string(), amount: positive, count }).strict(),
          ),
        })
        .strict(),
    ),
    truncated: z.boolean(),
    version: z.string(),
  })
  .strict();
export type SupplierInvoiceStats = z.infer<typeof SupplierInvoiceStatsSchema>;

export const PayablesStatsSchema = z
  .object({
    asOf: day,
    from: month,
    to: month,
    dueSoonDays: count,
    dueSoonUntil: day,
    groupCounts: z.object({ overdue: count, soon: count, later: count, disputed: count }).strict(),
    byCurrency: z.array(
      z
        .object({
          currency,
          due: amountCount,
          overdue: amountCount,
          dueWithin7: amountCount,
          dueWithin30: amountCount,
          disputed: amountCount,
          ...series,
          averageDelay: delay.extend({ allocations: count }).strict(),
          aging: z
            .object({
              notDue: amountCount,
              days1To30: amountCount,
              days31To60: amountCount,
              days61To90: amountCount,
              over90: amountCount,
              open: amountCount,
              disputed: amountCount,
            })
            .strict(),
          topSuppliers: z.array(
            z
              .object({
                supplierId: z.string(),
                supplierName: z.string().nullable(),
                amount: positive,
                count,
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    truncated: z.boolean(),
    version: z.string(),
  })
  .strict();
export type PayablesStats = z.infer<typeof PayablesStatsSchema>;

export const PurchaseOrderStatsSchema = z
  .object({
    asOf: day,
    from: month,
    to: month,
    statusCounts: z
      .object({ all: count, mine: count, draft: count, submitted: count, order: count })
      .strict(),
    byStatus: z.array(z.object({ status: z.string(), count }).strict()),
    byCurrency: z.array(
      z
        .object({
          currency,
          ...series,
          open: amountCount,
          pendingApproval: amountCount,
          averageApprovalDelay: delay.extend({ approvals: count }).strict(),
        })
        .strict(),
    ),
    truncated: z.boolean(),
    version: z.string(),
  })
  .strict();
export type PurchaseOrderStats = z.infer<typeof PurchaseOrderStatsSchema>;
