// Tableaux de bord des écrans Trésorerie (ADR-0071) :
//   GET /treasury/expenses/stats?month=   GET /treasury/accounts/stats
//
// Contrats partagés de l'API et des écrans. Le calcul est celui du moteur
// (`computeExpenseStats`, `computeAccountStats`) ; l'écran n'additionne rien.
// Montants PAR DEVISE, jamais convertis (ADR-0034). Les soldes sont ceux des
// comptes RÉELS : la trésorerie mensuelle des plans BUILD est une vue simplifiée.

import { z } from 'zod';

export const TREASURY_STATS_DEFAULT_MONTHS = 12;
export const TREASURY_STATS_MAX_MONTHS = 24;
/** Documents lus au plus par collection : au-delà, `truncated` (ADR-0071 § 2). */
export const TREASURY_STATS_MAX_READ = 20_000;

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const ExpenseStatsQuerySchema = z
  .object({
    months: z.coerce.number().int().min(1).max(TREASURY_STATS_MAX_MONTHS).optional(),
    /** Mois affiché par la liste (compteurs des onglets) ; défaut : mois en cours. */
    month: month.optional(),
  })
  .strict();
export type ExpenseStatsQuery = z.infer<typeof ExpenseStatsQuerySchema>;

export const AccountStatsQuerySchema = z
  .object({
    months: z.coerce.number().int().min(1).max(TREASURY_STATS_MAX_MONTHS).optional(),
  })
  .strict();
export type AccountStatsQuery = z.infer<typeof AccountStatsQuerySchema>;

const positive = z.string().regex(/^\d+\.\d{2}$/);
const signed = z.string().regex(/^-?\d+\.\d{2}$/);
const currency = z.enum(['CDF', 'USD']);
const count = z.number().int().nonnegative();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const amountCount = z.object({ amount: positive, count }).strict();

export const ExpenseStatsSchema = z
  .object({
    asOf: day,
    from: month,
    to: month,
    listMonth: month,
    statusCounts: z.object({ recorded: count, cancelled: count, all: count }).strict(),
    byCurrency: z.array(
      z
        .object({
          currency,
          months: z.array(z.object({ month, amount: positive, count }).strict()),
          thisMonth: amountCount,
          previousMonth: z.object({ month, amount: positive, count }).strict(),
          changePercent: z.number().int().nullable(),
          monthlyAverage: positive.nullable(),
          byCategoryThisMonth: z.array(
            z.object({ category: z.string(), label: z.string(), amount: positive, count }).strict(),
          ),
          withoutAttachmentThisMonth: amountCount,
        })
        .strict(),
    ),
    truncated: z.boolean(),
    version: z.string(),
  })
  .strict();
export type ExpenseStats = z.infer<typeof ExpenseStatsSchema>;

export const AccountStatsSchema = z
  .object({
    asOf: day,
    from: month,
    to: month,
    byCurrency: z.array(
      z
        .object({
          currency,
          balance: signed,
          activeAccounts: count,
          overdrawn: count,
          months: z.array(
            z
              .object({ month, inflows: positive, outflows: positive, closingBalance: signed })
              .strict(),
          ),
          thisMonth: z.object({ inflows: positive, outflows: positive, net: signed }).strict(),
          accounts: z.array(
            z.object({ accountId: z.string(), name: z.string(), balance: signed }).strict(),
          ),
        })
        .strict(),
    ),
    truncated: z.boolean(),
    version: z.string(),
  })
  .strict();
export type AccountStats = z.infer<typeof AccountStatsSchema>;
