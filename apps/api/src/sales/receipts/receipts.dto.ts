// Corps et paramètres des encaissements et des règlements — ADR-0031 § 1, § 2, § 4.
//
// Corps `.strict()`. Montants : chaînes décimales, un `number` JSON est refusé
// (`DECIMAL_MUST_BE_STRING`, docs/26). Aucune opération sur un montant ici :
// validation de forme et mise en forme canonique seulement ; les règles (somme
// des lettrages, plafond au reste à encaisser) appartiennent au moteur.

import { DOCUMENT_CURRENCIES, RECEIPT_METHODS, isCalendarDate } from '@lalanda/engine';
import { z } from 'zod';

import { parseDecimalInput } from '../sales.dto.js';
import { isObjectIdHex } from '../search.js';
import { fixedMessage } from '../../validation/zod-compat.js';

export const MAX_ALLOCATIONS = 20;

function issue(ctx: z.RefinementCtx, code: string, message: string): void {
  ctx.addIssue({ code: 'custom', message, params: { code } });
}

/** Montant décimal positif, deux décimales au plus → chaîne canonique `"150.00"`. */
const Amount = z.unknown().transform((value, ctx): string => {
  const parsed = parseDecimalInput(value, { maxIntegerDigits: 13, decimals: 2 });
  if (!parsed.ok) {
    if (parsed.reason === 'number') {
      issue(ctx, 'DECIMAL_MUST_BE_STRING', 'Montant en chaîne décimale (« 150.00 »).');
    } else if (parsed.reason === 'too_precise') {
      issue(ctx, 'AMOUNT_TOO_PRECISE', 'Deux décimales au plus.');
    } else {
      issue(ctx, 'AMOUNT_INVALID', 'Montant invalide.');
    }
    return z.NEVER;
  }
  if (parsed.isZero) {
    issue(ctx, 'AMOUNT_NOT_POSITIVE', 'Le montant doit être positif.');
    return z.NEVER;
  }
  return parsed.canonical;
});

const CalendarDay = z
  .string()
  .refine((v) => isCalendarDate(v), { error: 'Date attendue au format AAAA-MM-JJ.' });

const ObjectIdString = z.string().refine(isObjectIdHex, { error: 'Identifiant invalide.' });

const OptionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => {
      const t = v?.trim();
      return t ? t : null;
    });

export const ReceiptBodySchema = z
  .object({
    receivedOn: CalendarDay,
    amount: Amount,
    currency: z.enum(DOCUMENT_CURRENCIES),
    // Le moteur rend le refus détaillé de `CREDIT` ; ici, la seule forme.
    method: z.enum(RECEIPT_METHODS, {
      error: fixedMessage(
        'Moyen de règlement : espèces, virement, carte bancaire, mobile money, chèque ou autre.',
      ),
    }),
    reference: OptionalText(100),
    note: OptionalText(500),
    // ADR-0034 § 4 (intégré le 26 oct. 2026) : compte de trésorerie qui a reçu
    // l'argent, facultatif ; vérifié par le service (organisation, actif, devise,
    // ouverture).
    accountId: z
      .string()
      .regex(/^[0-9a-f]{24}$/i, { error: 'Identifiant de compte invalide.' })
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    allocations: z
      .array(z.object({ invoiceId: ObjectIdString, amount: Amount }).strict())
      .min(1)
      .max(MAX_ALLOCATIONS),
  })
  .strict();
export type ReceiptBody = z.infer<typeof ReceiptBodySchema>;

export const PutReceiptSchema = z
  .object({ receipt: ReceiptBodySchema, expectedRevision: z.number().int().positive() })
  .strict();

export const CancelReceiptSchema = z
  .object({
    reason: z.string().trim().min(3).max(500),
    expectedRevision: z.number().int().positive(),
  })
  .strict();

export const ListReceiptsQuerySchema = z
  .object({
    status: z.enum(['recorded', 'cancelled', 'all']).default('recorded'),
    invoiceId: ObjectIdString.optional(),
    from: CalendarDay.optional(),
    to: CalendarDay.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();
export type ListReceiptsQuery = z.infer<typeof ListReceiptsQuerySchema>;

export const SummaryQuerySchema = z
  .object({ from: CalendarDay.optional(), to: CalendarDay.optional() })
  .strict();

export const SettlementsQuerySchema = z
  .object({
    invoiceIds: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
      .pipe(z.array(ObjectIdString).max(100).optional()),
    open: z.enum(['true', 'false']).optional(),
    currency: z.enum(DOCUMENT_CURRENCIES).optional(),
  })
  .strict()
  .refine((q) => q.invoiceIds !== undefined || q.open === 'true', {
    error: 'Indiquez `invoiceIds` ou `open=true`.',
  });

export const DueDateBodySchema = z.object({ dueDate: CalendarDay.nullable() }).strict();
