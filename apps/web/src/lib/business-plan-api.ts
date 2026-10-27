// Client du business plan narratif (ADR-0037).
//
// Fichier séparé de `api.ts` : domaine à part. Les formes recopient celles de
// `apps/api/src/business-plan/business-plan.controller.ts`. Aucun chiffre n'est
// jamais ENVOYÉ : le serveur relit le plan figé et le Canvas.

import { API_URL, jsonRequest } from './api';

export type SectionId =
  | 'resume'
  | 'probleme_solution'
  | 'marche_concurrence'
  | 'modele_economique'
  | 'strategie_commerciale'
  | 'organisation_equipe'
  | 'plan_financier'
  | 'besoins_financement'
  | 'risques';

export type SectionOrigin = 'user' | 'ai_accepted';

export interface AssembledRow {
  lineId: string;
  label: string;
  value: number;
  format: 'money' | 'number' | 'percent';
  display: string;
  seuil?: {
    valeur: number;
    direction: 'min' | 'max';
    statut: 'vert' | 'orange' | 'rouge';
    display: string;
  };
}

export interface AssembledTable {
  sheetId: string;
  title: string;
  rows: AssembledRow[];
}

export interface AssembledHypothesis {
  id: string;
  label: string;
  value: number;
  display: string;
  group: string | null;
}

export interface SectionView {
  id: SectionId;
  title: string;
  questions: string[];
  text: string;
  origin: SectionOrigin | null;
  empty: boolean;
  originNote: string | null;
  tables: AssembledTable[];
  hypotheses: AssembledHypothesis[] | null;
  proposal: { text: string; sources: string[]; generatedAt: string } | null;
  updatedAt: string | null;
  acceptedAt: string | null;
}

export interface PlanSourceView {
  status: 'frozen' | 'live';
  version: number | null;
  fingerprint: string | null;
  approvedAt: string | null;
  superseded: boolean;
  currency: string;
  label: string;
  error: string | null;
}

export interface PlanChoice {
  version: number;
  status: 'approved' | 'superseded';
  fingerprint: string;
  approvedAt: string;
}

export interface VersionSummary {
  version: number;
  approvedAt: string;
  approvedBy: string;
  soleApprover: boolean;
  plan: { version: number; fingerprint: string; approvedAt: string };
  contentSha256: string;
}

export interface BusinessPlanView {
  projectId: string;
  projectName: string;
  planVersion: number | null;
  plan: PlanSourceView;
  planChoices: PlanChoice[];
  sections: SectionView[];
  pendingProposals: SectionId[];
  versions: VersionSummary[];
  changedSinceLastVersion: boolean;
  blockers: { code: string; message: string }[];
  ai: {
    enabled: boolean;
    disabledBy: 'organization' | 'platform' | null;
    quota: {
      limit: number | null;
      used: number;
      remaining: number | null;
      unlimited: boolean;
      exceeded: boolean;
    } | null;
    mention: string;
  };
  permissions: { write: boolean; validate: boolean; export: boolean };
}

export type DraftReason =
  'desactivee_plateforme' | 'desactivee_organisation' | 'indisponible' | 'rejetee' | null;

export interface DraftResult {
  proposal: { text: string; sources: string[]; generatedAt: string } | null;
  source: 'llm' | 'fallback';
  reason: DraftReason;
  detail: string | null;
  mention: string;
}

export interface BusinessPlanOverviewItem {
  projectId: string;
  projectName: string;
  filledSections: number;
  totalSections: number;
  planVersion: number | null;
  lastValidated: { version: number; approvedAt: string } | null;
}

const base = (projectId: string): string =>
  `/projects/${encodeURIComponent(projectId)}/business-plan`;

export const businessPlanApi = {
  overview: () =>
    jsonRequest<{ projects: BusinessPlanOverviewItem[] }>('/business-plan', { method: 'GET' }),
  get: (projectId: string) => jsonRequest<BusinessPlanView>(base(projectId), { method: 'GET' }),
  setPlan: (projectId: string, planVersion: number | null) =>
    jsonRequest<BusinessPlanView>(`${base(projectId)}/plan`, {
      method: 'PUT',
      body: { planVersion },
    }),
  saveSection: (projectId: string, sectionId: SectionId, text: string) =>
    jsonRequest<BusinessPlanView>(`${base(projectId)}/sections/${sectionId}`, {
      method: 'PUT',
      body: { text },
    }),
  draft: (projectId: string, sectionId: SectionId, notes: string) =>
    jsonRequest<DraftResult>(`${base(projectId)}/sections/${sectionId}/draft`, {
      method: 'POST',
      body: notes.trim() === '' ? {} : { notes },
    }),
  accept: (projectId: string, sectionId: SectionId) =>
    jsonRequest<BusinessPlanView>(`${base(projectId)}/sections/${sectionId}/proposal/accept`, {
      method: 'POST',
    }),
  discard: (projectId: string, sectionId: SectionId) =>
    jsonRequest<BusinessPlanView>(`${base(projectId)}/sections/${sectionId}/proposal/discard`, {
      method: 'POST',
    }),
  validate: (projectId: string) =>
    jsonRequest<VersionSummary>(`${base(projectId)}/versions`, { method: 'POST' }),

  /** PDF du brouillon, ou d'une version validée. */
  async downloadPdf(
    projectId: string,
    version?: number,
  ): Promise<{ blob: Blob; filename: string }> {
    const query = version !== undefined ? `?version=${version}` : '';
    const res = await fetch(`${API_URL}${base(projectId)}/pdf${query}`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) {
      const text = await res.text();
      let message = `HTTP ${res.status}`;
      try {
        const detail = JSON.parse(text) as { message?: unknown };
        if (typeof detail.message === 'string') message = detail.message;
      } catch {
        /* texte brut */
      }
      throw Object.assign(new Error(message), { status: res.status });
    }
    const cd = res.headers.get('content-disposition') ?? '';
    const filename = cd.match(/filename="([^"]+)"/)?.[1] ?? 'business-plan.pdf';
    return { blob: await res.blob(), filename };
  },
};
