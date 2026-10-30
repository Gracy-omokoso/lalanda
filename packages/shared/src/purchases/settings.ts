// Réglages des achats — corps et vue (ADR-0044 § 2.2, § 3.7). ADR-0044 — P3.
//
// Un document par organisation (`purchase_settings`) ; tant qu'il n'existe pas,
// l'API sert `PURCHASE_SETTINGS_DEFAULTS` (révision 0). Lecture : `purchase.read` ;
// écriture : `purchase.manage` ET `purchase.approve` (changer les paliers, c'est
// changer qui approuve). La cohérence des paliers (premier à 0, strictement
// croissants) est vérifiée par le moteur (`checkApprovalTiers`) dans le service.

import { z } from 'zod';

import { PurchaseAmount, purchaseIssue } from './common.js';
import {
  PURCHASE_APPROVAL_COUNTS,
  PURCHASE_LIMITS,
  type PurchaseApprovalCount,
  type PurchaseCurrency,
} from './constants.js';

const L = PURCHASE_LIMITS;

/** Palier : à partir de `from` (TTC, inclus), `approvals` approbations distinctes. */
export const PurchaseApprovalTierBody = z
  .object({
    from: PurchaseAmount,
    approvals: z
      .number()
      .int()
      .refine((v) => (PURCHASE_APPROVAL_COUNTS as readonly number[]).includes(v), {
        message: 'Un palier exige 0, 1 ou 2 approbations.',
        params: { code: 'APPROVAL_TIER_APPROVALS_INVALID' },
      }),
  })
  .strict();
export type PurchaseApprovalTierBody = z.infer<typeof PurchaseApprovalTierBody>;

const tiers = z
  .array(PurchaseApprovalTierBody)
  .min(1, { message: 'Indiquez au moins un palier, à partir de 0.' })
  .max(L.tiersMaxPerCurrency);

const PERCENT = /^(\d{1,2})(?:\.(\d{1,2}))?$/;

/** Tolérance de prix en pourcentage, `'0'` à `'10'`. */
export const PurchasePricePercent = z.string().transform((raw, ctx): string => {
  const v = raw.trim();
  if (!PERCENT.test(v) || Number(v) > L.pricePercentMax) {
    purchaseIssue(ctx, 'PRICE_PERCENT_INVALID', 'Tolérance de prix : 0 à 10 %.');
    return z.NEVER;
  }
  return v;
});

/** `PUT /purchases/settings` — champs absents inchangés. */
export const UpdatePurchaseSettingsBody = z
  .object({
    approvalTiers: z.object({ CDF: tiers, USD: tiers }).strict().optional(),
    allowSoleApprover: z.boolean().optional(),
    matchingTolerances: z
      .object({
        pricePercent: PurchasePricePercent,
        amountAbsolute: z.object({ CDF: PurchaseAmount, USD: PurchaseAmount }).strict(),
      })
      .strict()
      .optional(),
    dueSoonDays: z.number().int().min(L.dueSoonDaysMin).max(L.dueSoonDaysMax).optional(),
    requireOrderForInvoice: z.boolean().optional(),
    paymentDetailsAlertDays: z.number().int().min(0).max(L.paymentDetailsAlertDaysMax).optional(),
    /** Révision lue (0 tant que les valeurs par défaut s'appliquent). */
    expectedRevision: z.number().int().min(0),
  })
  .strict();
export type UpdatePurchaseSettingsBody = z.infer<typeof UpdatePurchaseSettingsBody>;

export interface PurchaseApprovalTierView {
  from: string;
  approvals: PurchaseApprovalCount;
}

export interface PurchaseSettingsView {
  approvalTiers: Record<PurchaseCurrency, PurchaseApprovalTierView[]>;
  allowSoleApprover: boolean;
  matchingTolerances: {
    pricePercent: string;
    amountAbsolute: Record<PurchaseCurrency, string>;
  };
  dueSoonDays: number;
  requireOrderForInvoice: boolean;
  paymentDetailsAlertDays: number;
  /** 0 : valeurs par défaut, rien d'enregistré. */
  revision: number;
  updatedAt: string | null;
}
