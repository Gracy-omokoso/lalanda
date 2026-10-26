// Corps de requête et paramètres des devis — ADR-0035 § 1 et § 4.
//
// Client, devise, mode de prix et lignes sont validés par LE MÊME schéma que le
// brouillon de facture (`CreateInvoiceSchema`, type `FV`) : un devis accepte
// exactement les lignes qu'une facture accepterait, et rien d'autre. Seules les
// lignes « catalogue » et « libre » sont admises (une ligne « origine » n'existe
// que pour un avoir).

import { z } from 'zod';

import { isCalendarDay } from '../../crm/crm-model.js';
import { isObjectIdHex } from '../search.js';
import { CreateInvoiceSchema, type InvoiceDraftInput } from '../invoices/invoices.dto.js';
import type { QuoteStatus } from './quote.schema.js';

export interface QuoteInput {
  opportunityId: string | null;
  title: string | null;
  notes: string | null;
  /** `null` : validité par défaut. */
  validUntil: string | null;
  draft: InvoiceDraftInput;
}

const QuoteFields = {
  opportunityId: z.unknown().optional(),
  title: z.unknown().optional(),
  notes: z.unknown().optional(),
  validUntil: z.unknown().optional(),
  currency: z.unknown(),
  priceMode: z.unknown(),
  customer: z.unknown(),
  lines: z.unknown().optional(),
};

type Ctx = z.RefinementCtx;

function issue(ctx: Ctx, path: (string | number)[], code: string, message: string): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message, params: { code } });
}

function text(ctx: Ctx, path: string, raw: unknown, max: number): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') {
    issue(ctx, [path], 'INVALID_TYPE', 'Texte attendu.');
    return null;
  }
  const t = raw.trim();
  if (t === '') return null;
  if (t.length > max) issue(ctx, [path], 'TEXT_TOO_LONG', `${max} caractères au plus.`);
  return t;
}

function normalizeQuote(raw: Record<string, unknown>, ctx: Ctx): QuoteInput {
  let opportunityId: string | null = null;
  const opp = raw['opportunityId'];
  if (opp !== null && opp !== undefined) {
    if (typeof opp !== 'string' || !isObjectIdHex(opp)) {
      issue(ctx, ['opportunityId'], 'OPPORTUNITY_INVALID', 'Identifiant d’opportunité invalide.');
    } else opportunityId = opp.toLowerCase();
  }
  let validUntil: string | null = null;
  const v = raw['validUntil'];
  if (v !== null && v !== undefined) {
    if (typeof v !== 'string' || !isCalendarDay(v)) {
      issue(ctx, ['validUntil'], 'VALID_UNTIL_INVALID', 'Validité : AAAA-MM-JJ.');
    } else validUntil = v;
  }
  if (Array.isArray(raw['lines'])) {
    (raw['lines'] as unknown[]).forEach((l, i) => {
      if (l !== null && typeof l === 'object' && (l as { source?: unknown }).source === 'origin') {
        issue(
          ctx,
          ['lines', i, 'source'],
          'LINE_SOURCE_INVALID',
          'Un devis porte des lignes du catalogue ou des lignes libres.',
        );
      }
    });
  }
  const parsed = CreateInvoiceSchema.safeParse({
    type: 'FV',
    currency: raw['currency'],
    priceMode: raw['priceMode'],
    customer: raw['customer'],
    lines: raw['lines'],
  });
  if (!parsed.success) {
    for (const i of parsed.error.issues) ctx.addIssue({ ...i } as z.IssueData);
  }
  return {
    opportunityId,
    title: text(ctx, 'title', raw['title'], 200),
    notes: text(ctx, 'notes', raw['notes'], 1000),
    validUntil,
    draft: parsed.success
      ? parsed.data
      : ({
          type: 'FV',
          currency: 'CDF',
          priceMode: 'ttc',
          customer: { customerId: null, walkInName: null },
          pointOfSaleId: null,
          lines: [],
          payments: [],
          comments: { A: null, C: null },
          creditNote: null,
          showUsdCounterValue: false,
        } satisfies InvoiceDraftInput),
  };
}

/** `POST /sales/quotes`. */
export const CreateQuoteSchema = z
  .object(QuoteFields)
  .strict()
  .transform((raw, ctx) => normalizeQuote(raw, ctx));

const expectedRevision = z
  .number({
    required_error: 'Révision attendue obligatoire.',
    invalid_type_error: 'Révision attendue : un entier.',
  })
  .int()
  .min(1);

/** `PUT /sales/quotes/:quoteId` : corps COMPLET + révision attendue. */
export const PutQuoteSchema = z
  .object({ ...QuoteFields, expectedRevision })
  .strict()
  .transform((raw, ctx) => {
    const { expectedRevision: rev, ...rest } = raw;
    return { expectedRevision: rev, quote: normalizeQuote(rest, ctx) };
  });

export const QuoteRevisionSchema = z.object({ expectedRevision }).strict();

export const RefuseQuoteSchema = z
  .object({ expectedRevision, reason: z.string().trim().max(500).nullable().optional() })
  .strict()
  .transform((raw) => ({
    expectedRevision: raw.expectedRevision,
    reason: raw.reason ? raw.reason : null,
  }));

export const QUOTE_LIST_STATUSES = [
  'all',
  'draft',
  'sent',
  'accepted',
  'refused',
  'expired',
] as const satisfies readonly (QuoteStatus | 'all')[];

export const ListQuotesQuerySchema = z
  .object({
    status: z.enum(QUOTE_LIST_STATUSES).default('all'),
    customerId: z.string().refine(isObjectIdHex, 'Identifiant de client invalide.').optional(),
    opportunityId: z
      .string()
      .refine(isObjectIdHex, 'Identifiant d’opportunité invalide.')
      .optional(),
    q: z.string().trim().min(1).max(100).optional(),
    limit: z
      .string()
      .regex(/^\d{1,3}$/, 'Limite : un entier de 1 à 100.')
      .transform((v) => Number.parseInt(v, 10))
      .pipe(z.number().int().min(1).max(100))
      .default('50'),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type ListQuotesQuery = z.output<typeof ListQuotesQuerySchema>;
