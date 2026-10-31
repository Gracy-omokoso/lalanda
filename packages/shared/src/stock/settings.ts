// Contrats des réglages des stocks (ADR-0046 § 2.8). ADR-0046 — S3.
//
// Un document par organisation, créé à l'activation (premier accès) avec l'emplacement
// par défaut « Magasin principal ». `defaultCostCurrency` remplace la « devise par
// défaut de l'organisation » de § 2.1, qui n'existe pas dans le dépôt (défaut `CDF`).
// `dormantDays` règle le constat `DORMANT_ITEM` (`null` : pas de constat).

import { z } from 'zod';

import {
  StockCurrencySchema,
  StockExpectedRevision,
  stockIssue,
  stockRequiredText,
} from './common.js';
import {
  STOCK_ALERT_RECIPIENTS,
  STOCK_LIMITS,
  STOCK_SALES_ISSUE_MODES,
  type StockAlertRecipients,
  type StockCurrency,
  type StockSalesIssueMode,
} from './constants.js';

export const STOCK_DORMANT_DAYS_MAX = 3650;

export const StockAdjustmentReasonSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{1,40}$/, { message: 'Clé : minuscules, chiffres et « _ », 40 au plus.' }),
    label: stockRequiredText(STOCK_LIMITS.adjustmentReasonLabel, 'Libellé'),
  })
  .strict();

export const UpdateStockSettingsBody = z
  .object({
    salesIssueMode: z.enum(STOCK_SALES_ISSUE_MODES).optional(),
    allowNegativeManualMoves: z.boolean().optional(),
    adjustmentReasons: z
      .array(StockAdjustmentReasonSchema)
      .min(1, { message: 'Au moins un motif.' })
      .max(STOCK_LIMITS.adjustmentReasons)
      .superRefine((list, ctx) => {
        const seen = new Set<string>();
        list.forEach((r, i) => {
          if (seen.has(r.key)) stockIssue(ctx, 'DUPLICATE_KEY', 'Clé en double.', [i, 'key']);
          seen.add(r.key);
        });
      })
      .optional(),
    countReminderDays: z.number().int().min(0).max(STOCK_LIMITS.countReminderDaysMax).optional(),
    alertRecipients: z.enum(STOCK_ALERT_RECIPIENTS).optional(),
    defaultCostCurrency: StockCurrencySchema.optional(),
    dormantDays: z.number().int().min(1).max(STOCK_DORMANT_DAYS_MAX).nullable().optional(),
    expectedRevision: StockExpectedRevision,
  })
  .strict();
export type UpdateStockSettingsBody = z.output<typeof UpdateStockSettingsBody>;

export interface StockSettingsView {
  salesIssueMode: StockSalesIssueMode;
  allowNegativeManualMoves: boolean;
  adjustmentReasons: { key: string; label: string }[];
  countReminderDays: number;
  alertRecipients: StockAlertRecipients;
  defaultCostCurrency: StockCurrency;
  dormantDays: number | null;
  defaultLocationId: string;
  revision: number;
  updatedAt: string;
}
