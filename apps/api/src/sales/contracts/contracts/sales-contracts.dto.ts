// Corps de requête et paramètres des contrats — ADR-0050 § 2.3, § 2.4, § 3.
// ADR-0050 — V3.
//
// En-tête : briques de `@lalanda/shared/sales-contracts` (`SALES_CONTRACT_HEADER_FIELDS` :
// titre, responsable, début, durée, reconduction, préavis, échéancier, clauses — CLAUSES
// SAISIES, jamais jugées). Document (client, devise, mode de prix, lignes) : LE MÊME
// schéma que le brouillon de facture (`parseEngagementDocument`). Les lignes de chaque
// échéance d'un `schedule` passent par le même schéma. Corps `.strict()`.

import {
  SALES_CONTRACT_BILLING_KINDS,
  SALES_CONTRACT_HEADER_FIELDS,
  SALES_CONTRACT_STATUSES,
  SalesContractBillingSchema,
  SalesContractCalendarDay,
  SalesContractExpectedRevision,
  SalesContractId,
  SalesContractInitialTermMonths,
  SalesContractNoticeDays,
  SalesContractRenewalSchema,
  salesContractOptionalText,
  salesContractRequiredText,
  type SalesContractBilling,
  type SalesContractRenewal,
  SALES_CONTRACT_LIMITS as L,
} from '@lalanda/shared/sales-contracts';
import { z } from 'zod';

import type { InvoiceDraftInput } from '../../invoices/invoices.dto.js';
import { isObjectIdHex } from '../../search.js';
import {
  ENGAGEMENT_DOCUMENT_FIELDS,
  parseEngagementDocument,
} from '../common/engagement-document.js';

export interface SalesContractHeaderInput {
  title: string;
  opportunityId: string | null;
  /** `null` : le créateur. */
  ownerUserId: string | null;
  startDate: string;
  initialTermMonths: number | null;
  renewal: SalesContractRenewal;
  noticeDays: number;
  clauses: string | null;
}

/** Échéancier dont chaque échéance porte un brouillon de lignes à composer. */
export type SalesContractBillingInput =
  | { kind: 'none' }
  | {
      kind: 'schedule';
      items: { itemRef: string; dueDate: string; label: string; draft: InvoiceDraftInput }[];
    }
  | Extract<SalesContractBilling, { kind: 'recurring' }>;

export interface SalesContractInput {
  header: SalesContractHeaderInput;
  draft: InvoiceDraftInput;
  billing: SalesContractBillingInput;
}

type HeaderRaw = {
  title: string;
  opportunityId?: string | null;
  ownerUserId?: string | null;
  startDate: string;
  initialTermMonths: number | null;
  renewal: SalesContractRenewal;
  noticeDays: number;
  clauses?: string | null;
};

function headerOf(raw: HeaderRaw): SalesContractHeaderInput {
  return {
    title: raw.title,
    opportunityId: raw.opportunityId ?? null,
    ownerUserId: raw.ownerUserId ?? null,
    startDate: raw.startDate,
    initialTermMonths: raw.initialTermMonths,
    renewal: raw.renewal,
    noticeDays: raw.noticeDays,
    clauses: raw.clauses ?? null,
  };
}

/** Contexte dont les problèmes portent un préfixe de chemin (lignes d'une échéance). */
function prefixed(ctx: z.RefinementCtx, prefix: PropertyKey[]): z.RefinementCtx {
  const wrapped = Object.create(ctx) as z.RefinementCtx;
  wrapped.addIssue = (issue: Parameters<z.RefinementCtx['addIssue']>[0]) => {
    if (typeof issue === 'string') return ctx.addIssue(issue);
    const path = (issue as { path?: PropertyKey[] }).path ?? [];
    // Le client est celui du contrat : son absence est déjà signalée une fois.
    if (path[0] !== 'lines') return;
    ctx.addIssue({ ...issue, path: [...prefix, ...path] } as typeof issue);
  };
  return wrapped;
}

/** Échéancier validé : lignes de chaque échéance au schéma du brouillon de facture. */
export function billingInputOf(
  billing: SalesContractBilling,
  doc: Record<string, unknown>,
  ctx: z.RefinementCtx,
  path: PropertyKey[] = ['billing'],
): SalesContractBillingInput {
  if (billing.kind !== 'schedule') return billing;
  return {
    kind: 'schedule',
    items: billing.items.map((item, i) => ({
      itemRef: item.itemRef,
      dueDate: item.dueDate,
      label: item.label,
      draft: parseEngagementDocument(
        {
          currency: doc['currency'],
          priceMode: doc['priceMode'],
          customer: doc['customer'],
          lines: item.lines,
        },
        prefixed(ctx, [...path, 'items', i]),
      ),
    })),
  };
}

const ContractFields = { ...SALES_CONTRACT_HEADER_FIELDS, ...ENGAGEMENT_DOCUMENT_FIELDS };

function inputOf(raw: Record<string, unknown>, ctx: z.RefinementCtx): SalesContractInput {
  const draft = parseEngagementDocument(raw, ctx);
  return {
    header: headerOf(raw as unknown as HeaderRaw),
    draft,
    billing: billingInputOf(raw['billing'] as SalesContractBilling, raw, ctx),
  };
}

/** `POST /sales/contracts`. */
export const CreateSalesContractSchema = z
  .object(ContractFields)
  .strict()
  .transform((raw, ctx): SalesContractInput => inputOf(raw as Record<string, unknown>, ctx));

/** `PUT /sales/contracts/:id` : corps COMPLET + révision attendue (brouillon seulement). */
export const PutSalesContractSchema = z
  .object({ ...ContractFields, expectedRevision: SalesContractExpectedRevision })
  .strict()
  .transform((raw, ctx) => {
    const { expectedRevision, ...rest } = raw;
    return { expectedRevision, contract: inputOf(rest as Record<string, unknown>, ctx) };
  });

/**
 * `POST /sales/quotes/:id/to-contract` : lignes, client et prix du devis (FIXÉS) ; les
 * clauses (début, durée, reconduction, préavis, échéancier) sont SAISIES ici. Les lignes
 * d'un échéancier `schedule` suivent la devise et le client du devis.
 */
export const QuoteToContractSchema = z
  .object({
    title: salesContractRequiredText(L.titleMax, 'Titre du contrat').optional(),
    ownerUserId: SalesContractId.nullable().optional(),
    startDate: SalesContractCalendarDay,
    initialTermMonths: SalesContractInitialTermMonths,
    renewal: SalesContractRenewalSchema,
    noticeDays: SalesContractNoticeDays,
    billing: SalesContractBillingSchema,
    clauses: salesContractOptionalText(L.clausesMax).optional(),
  })
  .strict()
  .transform((b) => ({
    title: b.title ?? null,
    ownerUserId: b.ownerUserId ?? null,
    startDate: b.startDate,
    initialTermMonths: b.initialTermMonths,
    renewal: b.renewal,
    noticeDays: b.noticeDays,
    billing: b.billing,
    clauses: b.clauses ?? null,
  }));
export type QuoteToContractInput = z.output<typeof QuoteToContractSchema>;

/** `POST …/files` : nature et avenant passés en paramètres (le corps est le PDF). */
export const SalesContractFileQuerySchema = z
  .object({
    kind: z.enum(['draft_copy', 'signed_copy'], {
      error: () => 'Nature attendue : draft_copy ou signed_copy.',
    }),
    amendmentId: z.string().refine(isObjectIdHex, 'Identifiant d’avenant invalide.').optional(),
  })
  .strict()
  .transform((q) => ({ kind: q.kind, amendmentId: q.amendmentId?.toLowerCase() ?? null }));
export type SalesContractFileQuery = z.output<typeof SalesContractFileQuerySchema>;

export const SALES_CONTRACT_LIST_STATUSES = ['all', ...SALES_CONTRACT_STATUSES] as const;

export const ListSalesContractsQuerySchema = z
  .object({
    status: z.enum(SALES_CONTRACT_LIST_STATUSES).default('all'),
    /** `recurring` : les abonnements (§ 9, filtre « récurrents »). */
    billingKind: z.enum(SALES_CONTRACT_BILLING_KINDS).optional(),
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
export type ListSalesContractsQuery = z.output<typeof ListSalesContractsQuerySchema>;
