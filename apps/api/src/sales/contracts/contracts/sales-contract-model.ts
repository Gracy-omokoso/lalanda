// Règles pures des contrats et avenants — ADR-0050 § 2.3, § 2.5. ADR-0050 — V3.
//
// Aucune base, aucune horloge implicite, aucun montant calculé : les montants viennent de
// `InvoiceDraftsService.compose` (moteur `invoice-totals`), les dates du moteur
// `contracts` (`termsAt`, `contractTerms`, `noticeCheck`). Les libellés ne disent jamais
// qu'une clause est valable (critère 18).

import { createHash } from 'node:crypto';

import type { AmendmentInput, ContractBilling, ContractInput } from '@lalanda/engine';
import type {
  SalesContractAmendmentStatus,
  SalesContractStatus,
} from '@lalanda/shared/sales-contracts';
import { z } from 'zod';

import type { InvoiceDraftInput } from '../../invoices/invoices.dto.js';
import { invalidRequestOf, issuesOf } from '../../sales.errors.js';
import { parseEngagementDocument, type EngagementLine } from '../common/engagement-document.js';
import type {
  SalesContractContent,
  SalesContractLean,
  StoredContractBilling,
} from './sales-contract.schema.js';
import type {
  SalesContractAmendmentLean,
  StoredAmendmentChanges,
} from '../amendments/sales-contract-amendment.schema.js';

export const SALES_CONTRACT_STATUS_LABELS: Record<SalesContractStatus, string> = {
  draft: 'Brouillon',
  submitted: 'Soumis',
  approved: 'Approuvé',
  signed: 'Signé',
  terminated: 'Résilié',
  cancelled: 'Annulé',
};

/** Statuts dérivés d'un contrat signé (`contractTerms`). */
export const SALES_CONTRACT_DERIVED_LABELS: Record<string, string> = {
  upcoming: 'À venir',
  in_force: 'En vigueur',
  expiring: 'Fin de terme proche',
  ended: 'Terme échu',
};

export const SALES_CONTRACT_AMENDMENT_STATUS_LABELS: Record<SalesContractAmendmentStatus, string> =
  {
    draft: 'Brouillon',
    submitted: 'Soumis',
    approved: 'Approuvé',
    signed: 'Signé',
    cancelled: 'Annulé',
  };

/** Avenant n° `index` d'un contrat : `CT2611-000001-A1`. */
export function amendmentNumberOf(contractNumber: string, index: number): string {
  return `${contractNumber}-A${index}`;
}

// ── Contenu, empreinte, versions ────────────────────────────────────────────

/** Contenu versionné d'un contrat stocké (champs couverts par l'empreinte). */
export function contractContentOf(c: SalesContractContent): SalesContractContent {
  return {
    title: c.title,
    customerId: c.customerId,
    opportunityId: c.opportunityId ?? null,
    ownerUserId: c.ownerUserId,
    currency: c.currency,
    priceMode: c.priceMode,
    customer: c.customer,
    lines: c.lines,
    documentAmounts: c.documentAmounts,
    startDate: c.startDate,
    initialTermMonths: c.initialTermMonths ?? null,
    renewal: c.renewal,
    noticeDays: c.noticeDays,
    billing: c.billing,
    clauses: c.clauses ?? null,
  };
}

/** JSON aux clés triées : même contenu → même texte, quel que soit l'ordre stocké. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function sha256Of(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/** Empreinte d'un contrat au passage en `signed` (numéro, version et contenu). */
export function contractSha256(c: SalesContractLean): string {
  return sha256Of({ number: c.number, version: c.version, content: contractContentOf(c) });
}

/** Empreinte d'un avenant au passage en `signed`. */
export function amendmentSha256(a: SalesContractAmendmentLean): string {
  return sha256Of({
    contractId: a.contractId,
    index: a.index,
    effectiveDate: a.effectiveDate,
    purpose: a.purpose,
    changes: a.changes,
  });
}

// ── Entrées du moteur ───────────────────────────────────────────────────────

function engineBilling(b: StoredContractBilling): ContractBilling<EngagementLine> {
  if (b.kind === 'schedule') {
    return {
      kind: 'schedule',
      items: b.items.map((i) => ({
        itemRef: i.itemRef,
        dueDate: i.dueDate,
        label: i.label,
        lines: i.lines,
      })),
    };
  }
  return b;
}

/** Contrat → entrée du moteur (`termsAt`, `contractTerms`). */
export function engineContractOf(c: SalesContractLean): ContractInput<EngagementLine> {
  return {
    startDate: c.startDate,
    status: c.status,
    lines: c.lines,
    billing: engineBilling(c.billing),
    initialTermMonths: c.initialTermMonths ?? null,
    renewal: c.renewal,
    noticeDays: c.noticeDays,
    clauses: c.clauses ?? null,
  };
}

/** Avenant → entrée du moteur ; seuls les champs fournis changent. */
export function engineAmendmentOf(a: {
  index: number;
  effectiveDate: string;
  status: SalesContractAmendmentStatus;
  changes: StoredAmendmentChanges;
}): AmendmentInput<EngagementLine> {
  const ch = a.changes;
  const changes: AmendmentInput<EngagementLine>['changes'] = {};
  if (ch.lines !== undefined) changes.lines = ch.lines;
  if (ch.billing !== undefined) changes.billing = engineBilling(ch.billing);
  if (ch.initialTermMonths !== undefined) changes.initialTermMonths = ch.initialTermMonths;
  if (ch.renewal !== undefined) changes.renewal = ch.renewal;
  if (ch.noticeDays !== undefined) changes.noticeDays = ch.noticeDays;
  if (ch.clauses !== undefined) changes.clauses = ch.clauses;
  return { index: a.index, effectiveDate: a.effectiveDate, status: a.status, changes };
}

// ── Lignes d'un document lié au contrat (échéances, avenants) ───────────────

export interface ContractDocumentBase {
  currency: 'CDF' | 'USD';
  priceMode: 'ttc' | 'ht';
  customerId: string;
  printContactDetails: boolean;
}

const LinesOnly = z.unknown();

/**
 * Valide des lignes brutes par LE schéma du brouillon de facture, avec la devise, le mode
 * de prix et le client du contrat ; `400 INVALID_REQUEST` (chemins préfixés) sinon.
 */
export function draftInputForLines(
  base: ContractDocumentBase,
  rawLines: unknown,
  pathPrefix: string,
): InvoiceDraftInput {
  const parsed = LinesOnly.transform((raw, ctx) =>
    parseEngagementDocument(
      {
        currency: base.currency,
        priceMode: base.priceMode,
        customer: { customerId: base.customerId, printContactDetails: base.printContactDetails },
        lines: raw,
      },
      ctx,
    ),
  ).safeParse(rawLines);
  if (!parsed.success) {
    invalidRequestOf(
      issuesOf(parsed.error).map((i) => ({
        ...i,
        path: i.path.startsWith('lines') ? `${pathPrefix}${i.path.slice('lines'.length)}` : i.path,
      })),
    );
  }
  return parsed.data;
}

// ── Actions proposées ───────────────────────────────────────────────────────

export interface SalesContractActions {
  edit: boolean;
  delete: boolean;
  submit: boolean;
  newVersion: boolean;
  cancel: boolean;
  approve: boolean;
  reject: boolean;
  declareSignature: boolean;
  addFile: boolean;
  terminate: boolean;
  recordRenewal: boolean;
  addAmendment: boolean;
}

/** Vrai si le contrat n'a jamais été soumis (version 1, aucune soumission ni décision). */
export function neverSubmitted(c: {
  version: number;
  submittedAt: Date | null;
  approvals: readonly unknown[];
  previousVersions: readonly unknown[];
}): boolean {
  return (
    c.version === 1 &&
    c.submittedAt === null &&
    c.approvals.length === 0 &&
    c.previousVersions.length === 0
  );
}

/** Actions selon le statut stocké (la permission reste vérifiée par les guards). */
export function salesContractActionsOf(
  c: SalesContractLean,
  renewalRecordable: boolean,
): SalesContractActions {
  const s = c.status;
  const rejected = s === 'draft' && c.approvals.some((a) => a.decision === 'rejected');
  return {
    edit: s === 'draft',
    delete: s === 'draft' && neverSubmitted(c),
    submit: s === 'draft',
    newVersion: s === 'submitted' || s === 'approved' || rejected,
    cancel: s === 'draft' || s === 'submitted' || s === 'approved',
    approve: s === 'submitted',
    reject: s === 'submitted',
    declareSignature: s === 'approved',
    addFile: s !== 'cancelled',
    terminate: s === 'signed',
    recordRenewal: s === 'signed' && renewalRecordable,
    addAmendment: s === 'signed',
  };
}
