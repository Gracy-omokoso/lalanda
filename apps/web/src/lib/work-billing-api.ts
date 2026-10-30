// Client des branchements « argent » des projets du RUN (ADR-0039 § 4, lot L4a).
//
// Fichier séparé de `work-api.ts` (lot L3a) et de `api.ts` : les formes viennent
// des contrats partagés `@lalanda/shared/work`, jamais recopiées. Aucun montant
// n'est calculé ici ni dans les écrans : la marge vient de l'API (moteur).

import type {
  CreateProjectFromOpportunityBody,
  CreateProjectFromQuoteBody,
  PrepareInvoiceBody,
  ProjectMarginView,
  WorkInvoiceLinkView,
  WorkPage,
  WorkProjectSummary,
  WorkProjectView,
  WorkTaskView,
} from '@lalanda/shared/work';

import { jsonRequest } from './api';

/** Réponse de `POST /work/tasks/:taskId/prepare-invoice`. */
export interface PreparedInvoiceView {
  invoiceId: string;
  link: WorkInvoiceLinkView;
  task: WorkTaskView;
}

const id = encodeURIComponent;

export const workBillingApi = {
  /** Devis accepté → projet client (`work.manage` + `sales.read`). */
  createFromQuote: (body: CreateProjectFromQuoteBody) =>
    jsonRequest<WorkProjectView>('/work/projects/from-quote', { method: 'POST', body }),
  /** Projet créé depuis ce devis, ou `null` (`work.read` + `sales.read`). */
  projectForQuote: (quoteId: string) =>
    jsonRequest<{ projectId: string | null }>(`/work/quotes/${id(quoteId)}/project`, {
      method: 'GET',
    }),
  /** ADR-0040 — C7 : opportunité gagnée → projet (`work.manage` + `crm.read`). */
  createFromOpportunity: (body: CreateProjectFromOpportunityBody) =>
    jsonRequest<WorkProjectView>('/work/projects/from-opportunity', { method: 'POST', body }),
  /** ADR-0040 — C7 : projet issu de l'opportunité, ou `null` (`work.read` + `crm.read`). */
  projectForOpportunity: (opportunityId: string) =>
    jsonRequest<{ projectId: string | null }>(`/work/opportunities/${id(opportunityId)}/project`, {
      method: 'GET',
    }),
  listInvoices: (projectId: string) =>
    jsonRequest<{ items: WorkInvoiceLinkView[] }>(`/work/projects/${id(projectId)}/invoices`, {
      method: 'GET',
    }),
  linkInvoice: (projectId: string, invoiceId: string) =>
    jsonRequest<WorkInvoiceLinkView>(`/work/projects/${id(projectId)}/invoices`, {
      method: 'POST',
      body: { invoiceId },
    }),
  unlinkInvoice: (projectId: string, invoiceId: string) =>
    jsonRequest<void>(`/work/projects/${id(projectId)}/invoices/${id(invoiceId)}`, {
      method: 'DELETE',
    }),
  /** Brouillon `FV`, jamais émis (`work.read` + `sales.manage`). */
  prepareInvoice: (taskId: string, body: PrepareInvoiceBody) =>
    jsonRequest<PreparedInvoiceView>(`/work/tasks/${id(taskId)}/prepare-invoice`, {
      method: 'POST',
      body,
    }),
  /** Marge encaissée (`work.read` + `sales.read` + `treasury.read`). */
  margin: (projectId: string, period: { from?: string; to?: string } = {}) => {
    const qs = new URLSearchParams();
    if (period.from) qs.set('from', period.from);
    if (period.to) qs.set('to', period.to);
    const s = qs.toString();
    return jsonRequest<ProjectMarginView>(
      `/work/projects/${id(projectId)}/margin${s ? `?${s}` : ''}`,
      { method: 'GET' },
    );
  },
  /** Projets non archivés proposés au rattachement d'une dépense (`work.read`). */
  activeProjects: () =>
    jsonRequest<WorkPage<WorkProjectSummary>>('/work/projects?limit=100', {
      method: 'GET',
    }),
};

/** Code d'erreur métier d'une réponse de `jsonRequest`, ou `null`. */
export function workErrorCode(err: unknown): string | null {
  const detail = (err as { detail?: unknown } | null)?.detail;
  if (detail && typeof detail === 'object' && 'code' in detail) {
    const code = (detail as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/** Détails d'une erreur métier (`details`), ou `{}`. */
export function workErrorDetails(err: unknown): Record<string, unknown> {
  const detail = (err as { detail?: unknown } | null)?.detail;
  if (detail && typeof detail === 'object' && 'details' in detail) {
    const d = (detail as { details: unknown }).details;
    if (d && typeof d === 'object') return d as Record<string, unknown>;
  }
  return {};
}
