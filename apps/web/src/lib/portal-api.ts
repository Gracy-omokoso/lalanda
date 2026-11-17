// Client de l'espace externe (contact client, consultant) — ADR-0078.
//
// Routes `/portal/...` : la session est un cookie `httpOnly` propre à l'espace externe,
// posé par `POST /portal/auth/verify` ; il n'ouvre aucune route de l'ERP. Aucun montant
// ne transite par ces routes.

import type {
  ExternalNotificationPreferenceValue,
  PortalNotificationPreferenceView,
  PortalClientDecisionBody,
  PortalCommentView,
  PortalMeView,
  PortalOrganizationChoice,
  PortalProjectSummary,
  PortalProjectView,
  PortalTaskView,
  PortalTimeEntryView,
  PortalTimesheetView,
} from '@lalanda/shared/work';

import { jsonRequest } from './api';

const e = encodeURIComponent;

/** Détail d'erreur de l'API (`{ code, message, details }`), ou `null`. */
export function detailPortail(err: unknown): {
  code: string | null;
  message: string | null;
  status: number | null;
  details: Record<string, unknown> | null;
} {
  const e2 = err as { status?: unknown; detail?: unknown } | null;
  const d = (e2?.detail ?? null) as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  } | null;
  return {
    code: typeof d?.code === 'string' ? d.code : null,
    message: typeof d?.message === 'string' ? d.message : null,
    status: typeof e2?.status === 'number' ? e2.status : null,
    details:
      d?.details && typeof d.details === 'object' ? (d.details as Record<string, unknown>) : null,
  };
}

/** Organisations proposées quand une adresse en ouvre plusieurs (409 du serveur). */
export function choixOrganisations(err: unknown): PortalOrganizationChoice[] | null {
  const d = detailPortail(err);
  if (d.code !== 'EXTERNAL_ORGANIZATION_REQUIRED') return null;
  const list = d.details?.['organizations'];
  return Array.isArray(list) ? (list as PortalOrganizationChoice[]) : null;
}

/** La session externe est absente ou terminée (401). */
export function sessionTerminee(err: unknown): boolean {
  return detailPortail(err).status === 401;
}

export const portalApi = {
  requestCode: (email: string) =>
    jsonRequest<{ sent: true }>('/portal/auth/request-code', { method: 'POST', body: { email } }),
  verify: (email: string, code: string, organizationId?: string) =>
    jsonRequest<{ me: PortalMeView }>('/portal/auth/verify', {
      method: 'POST',
      body: { email, code, ...(organizationId ? { organizationId } : {}) },
    }),
  logout: () => jsonRequest<void>('/portal/auth/logout', { method: 'POST', body: {} }),
  me: () => jsonRequest<PortalMeView>('/portal/me'),
  projects: () => jsonRequest<{ items: PortalProjectSummary[] }>('/portal/projects'),
  project: (projectId: string) =>
    jsonRequest<PortalProjectView>(`/portal/projects/${e(projectId)}`),
  task: (taskId: string) => jsonRequest<PortalTaskView>(`/portal/tasks/${e(taskId)}`),
  comment: (taskId: string, body: string) =>
    jsonRequest<PortalCommentView>(`/portal/tasks/${e(taskId)}/comments`, {
      method: 'POST',
      body: { body },
    }),
  decide: (taskId: string, body: PortalClientDecisionBody) =>
    jsonRequest<PortalTaskView>(`/portal/tasks/${e(taskId)}/client-decision`, {
      method: 'POST',
      body,
    }),
  logTime: (taskId: string, body: { workedOn: string; minutes: number; note?: string | null }) =>
    jsonRequest<PortalTimeEntryView>(`/portal/tasks/${e(taskId)}/time-entries`, {
      method: 'POST',
      body,
    }),
  removeTime: (entryId: string) =>
    jsonRequest<void>(`/portal/time-entries/${e(entryId)}`, { method: 'DELETE' }),
  timesheet: (week?: string) =>
    jsonRequest<PortalTimesheetView>(`/portal/timesheet${week ? `?week=${e(week)}` : ''}`),
  submitTimesheet: (week: string, expectedRevision: number) =>
    jsonRequest<PortalTimesheetView>('/portal/timesheet/submit', {
      method: 'POST',
      body: { week, expectedRevision },
    }),
  // ADR-0079 § 9 : e-mails de l'espace externe — par la session, ou par le lien signé.
  myNotifications: () =>
    jsonRequest<PortalNotificationPreferenceView>('/portal/me/notifications', { method: 'GET' }),
  putMyNotifications: (preference: ExternalNotificationPreferenceValue) =>
    jsonRequest<PortalNotificationPreferenceView>('/portal/me/notifications', {
      method: 'PUT',
      body: { preference },
    }),
  preferenceByToken: (jeton: string) =>
    jsonRequest<PortalNotificationPreferenceView>(
      `/portal/notifications/preference?jeton=${e(jeton)}`,
      { method: 'GET' },
    ),
  putPreferenceByToken: (jeton: string, preference: ExternalNotificationPreferenceValue) =>
    jsonRequest<PortalNotificationPreferenceView>('/portal/notifications/preference', {
      method: 'PUT',
      body: { jeton, preference },
    }),
};
