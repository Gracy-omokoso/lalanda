// Client des membres externes (contact client, consultant) côté ERP — ADR-0078.
//
// Routes `/work/...` de `WorkExternalController` ; formes typées par
// `@lalanda/shared/work`. Aucun montant n'est calculé ici : le récapitulatif temps ×
// taux est rendu par le serveur (moteur `consultantTimeRecap`).

import type {
  ConsultantRecapView,
  ConvertGuestBody,
  InviteExternalMemberBody,
  PutTaskExternalSettingsBody,
  SetConsultantRateBody,
  SupplierConsultantsView,
  UpdateExternalAccountBody,
  WorkCommentView,
  WorkExternalAccountView,
  WorkExternalMemberView,
  WorkExternalMembersView,
  WorkMemberRateView,
  WorkTaskExternalView,
} from '@lalanda/shared/work';

import { API_URL, jsonRequest } from './api';

const e = encodeURIComponent;

/** Paramètres de période d'un récapitulatif (`AAAA-MM-JJ`). */
export interface PeriodeRecap {
  from?: string;
  to?: string;
}

function periode(p: PeriodeRecap): string {
  const q = new URLSearchParams();
  if (p.from) q.set('from', p.from);
  if (p.to) q.set('to', p.to);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const workExternalApi = {
  listProjectExternals: (projectId: string) =>
    jsonRequest<WorkExternalMembersView>(`/work/projects/${e(projectId)}/external-members`),
  invite: (projectId: string, body: InviteExternalMemberBody) =>
    jsonRequest<WorkExternalMemberView>(`/work/projects/${e(projectId)}/external-members`, {
      method: 'POST',
      body,
    }),
  setCanOpenProject: (projectId: string, accountId: string, canOpenProject: boolean) =>
    jsonRequest<WorkExternalMemberView>(
      `/work/projects/${e(projectId)}/external-members/${e(accountId)}`,
      { method: 'PUT', body: { canOpenProject } },
    ),
  removeExternal: (projectId: string, accountId: string) =>
    jsonRequest<void>(`/work/projects/${e(projectId)}/external-members/${e(accountId)}`, {
      method: 'DELETE',
    }),

  listAccounts: () => jsonRequest<{ items: WorkExternalAccountView[] }>('/work/external-accounts'),
  updateAccount: (accountId: string, body: UpdateExternalAccountBody) =>
    jsonRequest<WorkExternalAccountView>(`/work/external-accounts/${e(accountId)}`, {
      method: 'PUT',
      body,
    }),
  closeAccount: (accountId: string) =>
    jsonRequest<WorkExternalAccountView>(`/work/external-accounts/${e(accountId)}/close`, {
      method: 'POST',
      body: {},
    }),

  listRates: (accountId: string) =>
    jsonRequest<{ items: WorkMemberRateView[] }>(`/work/external-accounts/${e(accountId)}/rates`),
  setRate: (accountId: string, body: SetConsultantRateBody) =>
    jsonRequest<WorkMemberRateView>(`/work/external-accounts/${e(accountId)}/rates`, {
      method: 'POST',
      body,
    }),
  removeRate: (accountId: string, rateId: string) =>
    jsonRequest<void>(`/work/external-accounts/${e(accountId)}/rates/${e(rateId)}`, {
      method: 'DELETE',
    }),
  recap: (accountId: string, p: PeriodeRecap = {}) =>
    jsonRequest<ConsultantRecapView>(
      `/work/external-accounts/${e(accountId)}/time-recap${periode(p)}`,
    ),
  /** URL du récapitulatif CSV (téléchargement direct, cookies de session). */
  recapCsvUrl: (accountId: string, p: PeriodeRecap = {}) =>
    `${API_URL}/work/external-accounts/${e(accountId)}/time-recap.csv${periode(p)}`,
  supplierConsultants: (supplierId: string, p: PeriodeRecap = {}) =>
    jsonRequest<SupplierConsultantsView>(
      `/work/suppliers/${e(supplierId)}/consultants${periode(p)}`,
    ),

  taskExternal: (taskId: string) =>
    jsonRequest<WorkTaskExternalView>(`/work/tasks/${e(taskId)}/external`),
  putTaskExternal: (taskId: string, body: PutTaskExternalSettingsBody) =>
    jsonRequest<WorkTaskExternalView>(`/work/tasks/${e(taskId)}/client-settings`, {
      method: 'PUT',
      body,
    }),
  resetClientApproval: (taskId: string, expectedRevision: number) =>
    jsonRequest<WorkTaskExternalView>(`/work/tasks/${e(taskId)}/client-approval/reset`, {
      method: 'POST',
      body: { expectedRevision },
    }),

  setCommentVisibility: (
    commentId: string,
    visibility: 'internal' | 'shared',
    expectedRevision: number,
  ) =>
    jsonRequest<WorkCommentView>(`/work/comments/${e(commentId)}/visibility`, {
      method: 'PUT',
      body: { visibility, expectedRevision },
    }),

  guestProjects: (userId: string) =>
    jsonRequest<{
      items: { projectId: string; name: string; kind: string; customerId: string | null }[];
    }>(`/work/guests/${e(userId)}/projects`),
  convertGuest: (userId: string, body: ConvertGuestBody) =>
    jsonRequest<WorkExternalAccountView>(`/work/guests/${e(userId)}/convert`, {
      method: 'POST',
      body,
    }),
};
