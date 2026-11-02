// Corps de requête et paramètres des commandes clients — ADR-0050 § 2.2, § 3.
// ADR-0050 — V2.
//
// En-tête : briques de `@lalanda/shared/sales-contracts` (`SALES_ORDER_HEADER_FIELDS`).
// Document (client, devise, mode de prix, lignes) : LE MÊME schéma que le brouillon de
// facture (`parseEngagementDocument`). Corps `.strict()`, quantités en chaînes.

import {
  SALES_ORDER_HEADER_FIELDS,
  SALES_ORDER_STATUSES,
  SalesContractCalendarDay,
  SalesContractExpectedRevision,
  salesContractFr,
  salesContractOptionalText,
  SALES_CONTRACT_LIMITS as L,
} from '@lalanda/shared/sales-contracts';
import { z } from 'zod';

import type { InvoiceDraftInput } from '../../invoices/invoices.dto.js';
import { isObjectIdHex } from '../../search.js';
import {
  ENGAGEMENT_DOCUMENT_FIELDS,
  parseEngagementDocument,
} from '../common/engagement-document.js';

export interface SalesOrderHeaderInput {
  customerReference: string | null;
  orderedOn: string;
  opportunityId: string | null;
  requestedDeliveryDate: string | null;
  notes: string | null;
}

export interface SalesOrderInput {
  header: SalesOrderHeaderInput;
  draft: InvoiceDraftInput;
}

type HeaderRaw = {
  customerReference?: string | null;
  orderedOn: string;
  opportunityId?: string | null;
  requestedDeliveryDate?: string | null;
  notes?: string | null;
};

function headerOf(raw: HeaderRaw): SalesOrderHeaderInput {
  return {
    customerReference: raw.customerReference ?? null,
    orderedOn: raw.orderedOn,
    opportunityId: raw.opportunityId ?? null,
    requestedDeliveryDate: raw.requestedDeliveryDate ?? null,
    notes: raw.notes ?? null,
  };
}

const OrderFields = { ...SALES_ORDER_HEADER_FIELDS, ...ENGAGEMENT_DOCUMENT_FIELDS };

/** `POST /sales/orders`. */
export const CreateSalesOrderSchema = z
  .object(OrderFields)
  .strict()
  .transform((raw, ctx): SalesOrderInput => ({
    header: headerOf(raw as HeaderRaw),
    draft: parseEngagementDocument(raw as Record<string, unknown>, ctx),
  }));

/** `PUT /sales/orders/:id` : corps COMPLET + révision attendue (brouillon seulement). */
export const PutSalesOrderSchema = z
  .object({ ...OrderFields, expectedRevision: SalesContractExpectedRevision })
  .strict()
  .transform((raw, ctx) => {
    const { expectedRevision, ...rest } = raw;
    return {
      expectedRevision,
      order: {
        header: headerOf(rest as HeaderRaw),
        draft: parseEngagementDocument(rest as Record<string, unknown>, ctx),
      } satisfies SalesOrderInput,
    };
  });

/** `POST /sales/quotes/:id/to-order` : en-tête facultatif ; lignes et prix du devis. */
export const QuoteToOrderSchema = z
  .object({
    orderedOn: SalesContractCalendarDay.optional(),
    customerReference: salesContractOptionalText(L.customerReferenceMax).optional(),
    requestedDeliveryDate: SalesContractCalendarDay.nullable().optional(),
    notes: salesContractOptionalText(L.notesMax).optional(),
  })
  .strict()
  .transform((b) => ({
    orderedOn: b.orderedOn ?? null,
    customerReference: b.customerReference ?? null,
    requestedDeliveryDate: b.requestedDeliveryDate ?? null,
    notes: b.notes ?? null,
  }));
export type QuoteToOrderInput = z.output<typeof QuoteToOrderSchema>;

const QUANTITY = /^\d{1,12}(?:\.\d{1,3})?$/;

/** Quantité strictement positive, au plus 3 décimales, en chaîne. */
const PositiveQuantity = z
  .string(salesContractFr('Quantité attendue (chaîne décimale).'))
  .refine((v) => QUANTITY.test(v) && !/^0+(?:\.0+)?$/.test(v), {
    message: 'Quantité strictement positive, 3 décimales au plus.',
    params: { code: 'QUANTITY_INVALID' },
  });

/**
 * `POST /sales/orders/:id/prepare-invoice` : type `FV` (défaut) ou `EV` ; sans
 * `lines`, tout le reste à préparer de chaque ligne.
 */
export const PrepareOrderInvoiceSchema = z
  .object({
    expectedRevision: SalesContractExpectedRevision,
    type: z.enum(['FV', 'EV'], salesContractFr('Type : FV ou EV.')).optional(),
    lines: z
      .array(
        z
          .object({
            lineRef: z
              .string(salesContractFr('Référence de ligne attendue.'))
              .regex(/^L[1-9]\d{0,3}$/, { message: 'Référence de ligne invalide.' }),
            quantity: PositiveQuantity,
          })
          .strict(),
        salesContractFr('Liste de lignes attendue.'),
      )
      .min(1, { message: 'Au moins une ligne.' })
      .max(500)
      .optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    const seen = new Set<string>();
    (b.lines ?? []).forEach((l, i) => {
      if (seen.has(l.lineRef)) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines', i, 'lineRef'],
          message: 'Ligne citée deux fois.',
          params: { code: 'DUPLICATE_LINE_REF' },
        });
      }
      seen.add(l.lineRef);
    });
  })
  .transform((b) => ({
    expectedRevision: b.expectedRevision,
    type: b.type ?? ('FV' as const),
    lines: b.lines ?? null,
  }));
export type PrepareOrderInvoiceInput = z.output<typeof PrepareOrderInvoiceSchema>;

export const SALES_ORDER_LIST_STATUSES = ['all', ...SALES_ORDER_STATUSES] as const;

export const ListSalesOrdersQuerySchema = z
  .object({
    status: z.enum(SALES_ORDER_LIST_STATUSES).default('all'),
    customerId: z.string().refine(isObjectIdHex, 'Identifiant de client invalide.').optional(),
    quoteId: z.string().refine(isObjectIdHex, 'Identifiant de devis invalide.').optional(),
    q: z.string().trim().min(1).max(100).optional(),
    limit: z
      .string()
      .regex(/^\d{1,3}$/, 'Limite : un entier de 1 à 100.')
      .transform((v) => Number.parseInt(v, 10))
      .pipe(z.number().int().min(1).max(100))
      .prefault('50'),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type ListSalesOrdersQuery = z.output<typeof ListSalesOrdersQuerySchema>;
