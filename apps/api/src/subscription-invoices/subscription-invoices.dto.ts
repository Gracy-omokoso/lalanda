// Corps des routes des factures d'abonnement (ADR-0047). Validation stricte.

import { z } from 'zod';

const REASON_MIN = 10;

function codedText(min: number, max: number, code: string, message: string) {
  return z
    .string({ error: message })
    .trim()
    .max(max)
    .superRefine((v, ctx) => {
      if (v.length < min) ctx.addIssue({ code: 'custom', message, params: { code } });
    });
}

const reason = codedText(
  REASON_MIN,
  500,
  'REASON_REQUIRED',
  `Motif obligatoire : ${REASON_MIN} caractères au moins.`,
);

/** Fiche de facturation : raison sociale obligatoire, NIF et adresse facultatifs. */
export const BillingProfileInputSchema = z
  .object({
    legalName: codedText(1, 200, 'LEGAL_NAME_REQUIRED', 'La raison sociale est obligatoire.'),
    nif: z.string().trim().max(40).nullable().optional(),
    address: z.string().trim().max(255).nullable().optional(),
  })
  .strict()
  .transform((v) => ({
    legalName: v.legalName,
    nif: v.nif ? v.nif : null,
    address: v.address ? v.address : null,
  }));

/** Émission depuis la console d'une facture d'un paiement passé. */
export const EmitSubscriptionInvoiceInputSchema = z
  .object({
    provider: z.enum(['manual', 'stripe', 'paypal']),
    eventId: z.string().trim().min(1).max(200),
    reason,
  })
  .strict();

export const DesignateSellerInputSchema = z
  .object({ organizationId: z.string().trim().min(1).max(64), reason })
  .strict();

export const CreditNoteRequestInputSchema = z.object({ reason }).strict();
