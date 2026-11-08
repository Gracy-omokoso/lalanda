// Client du lot 1 RH (ADR-0068) : réglage des matricules, référentiel des postes,
// compte Lalanda d'un collaborateur (invitation), correction du matricule, import du
// personnel, jours fériés de la RDC proposés. Fichier à part de `api-hr.ts` (partagé
// avec d'autres lots) : ajout pur. L'API reste juge des droits.

import type {
  CountryHolidaysLoadResult,
  CountryHolidaysProposalView,
  CreatePositionBody,
  EmployeeAccountView,
  EmployeeImportPreview,
  EmployeeImportResult,
  EmployeeInvitationResult,
  EmployeeInviteOutcome,
  EmployeeNumberingView,
  EmployeeView,
  HolidayView,
  ListPositionsQuery,
  PositionDetailView,
  PositionListView,
} from '@lalanda/shared/hr';

import { API_URL, jsonRequest, salesQuery } from './api';
import { employeeFromApi, type HrEmployeeView } from './api-hr';

export type {
  CountryHolidaysProposalView,
  EmployeeAccountView,
  EmployeeImportPreview,
  EmployeeImportResult,
  EmployeeInvitationResult,
  EmployeeInviteOutcome,
  EmployeeNumberingView,
  PositionDetailView,
  PositionListView,
};
export type { PositionView } from '@lalanda/shared/hr';

const id = encodeURIComponent;

/** Erreur d'un envoi de fichier, au même format que `jsonRequest`. */
async function erreur(res: Response): Promise<Error & { status: number; detail: unknown }> {
  const text = await res.text();
  let detail: unknown = text;
  try {
    detail = JSON.parse(text);
  } catch {
    /* texte brut */
  }
  const message =
    typeof detail === 'object' && detail !== null && 'message' in detail
      ? String((detail as { message: unknown }).message)
      : `HTTP ${res.status}`;
  const err = new Error(message) as Error & { status: number; detail: unknown };
  err.status = res.status;
  err.detail = detail;
  return err;
}

/** Fichier en CORPS BRUT (`application/octet-stream`), nom en `X-File-Name` (ADR-0062). */
async function envoyerFichier<T>(path: string, file: File): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!res.ok) throw await erreur(res);
  return (await res.json()) as T;
}

/** Libellé d'une issue d'invitation (écran de la fiche, résultat d'import). */
export const LIBELLES_INVITATION: Record<EmployeeInviteOutcome, string> = {
  not_requested: 'Pas d’invitation demandée',
  not_sent_no_email: 'Sans e-mail professionnel : rien n’est envoyé',
  not_sent_permission:
    'Invitation non envoyée : un administrateur qui peut inviter l’enverra depuis la fiche',
  already_linked: 'Déjà relié à un compte Lalanda',
  linked: 'Relié au compte du membre',
  member_already_linked: 'Ce membre est déjà relié à une autre fiche',
  invitation_sent: 'Invitation envoyée',
  invitation_pending: 'Invitation déjà en attente',
};

export const hrLot1Api = {
  // Matricules (§ 2)
  getNumbering: () =>
    jsonRequest<EmployeeNumberingView>('/hr/settings/numbering', { method: 'GET' }),
  updateNumbering: (body: { expectedRevision: number; prefix: string | null; width: number }) =>
    jsonRequest<EmployeeNumberingView>('/hr/settings/numbering', { method: 'PUT', body }),
  changeEmployeeNumber: async (
    employeeId: string,
    body: { expectedRevision: number; employeeNumber: string; reason: string },
  ): Promise<HrEmployeeView> =>
    employeeFromApi(
      await jsonRequest<EmployeeView>(`/hr/employees/${id(employeeId)}/employee-number`, {
        method: 'PUT',
        body,
      }),
    ),
  assignEmployeeNumber: async (
    employeeId: string,
    expectedRevision: number,
  ): Promise<HrEmployeeView> =>
    employeeFromApi(
      await jsonRequest<EmployeeView>(`/hr/employees/${id(employeeId)}/employee-number/auto`, {
        method: 'POST',
        body: { expectedRevision },
      }),
    ),

  // Postes (§ 3)
  listPositions: (status: ListPositionsQuery['status'] = 'current') =>
    jsonRequest<PositionListView>(`/hr/positions${salesQuery({ status })}`, { method: 'GET' }),
  getPosition: (positionId: string) =>
    jsonRequest<PositionDetailView>(`/hr/positions/${id(positionId)}`, { method: 'GET' }),
  createPosition: (body: CreatePositionBody) =>
    jsonRequest<PositionDetailView>('/hr/positions', { method: 'POST', body }),
  updatePosition: (
    positionId: string,
    body: { expectedRevision: number; title?: string; departmentId?: string | null },
  ) => jsonRequest<PositionDetailView>(`/hr/positions/${id(positionId)}`, { method: 'PUT', body }),
  deletePosition: (positionId: string, expectedRevision: number) =>
    jsonRequest<PositionDetailView>(`/hr/positions/${id(positionId)}/delete`, {
      method: 'POST',
      body: { expectedRevision },
    }),

  // Changement de poste (amendement du 8 nov. 2026) : le matricule ne change jamais.
  changePosition: async (
    employeeId: string,
    body: {
      expectedRevision: number;
      position: { mode: 'new' } | { mode: 'replacement'; positionId: string };
      effectiveDate?: string;
      jobTitle?: string;
    },
  ): Promise<HrEmployeeView> =>
    employeeFromApi(
      await jsonRequest<EmployeeView>(`/hr/employees/${id(employeeId)}/position-change`, {
        method: 'POST',
        body,
      }),
    ),

  // Compte Lalanda d'un collaborateur (§ 1)
  getAccount: (employeeId: string) =>
    jsonRequest<EmployeeAccountView>(`/hr/employees/${id(employeeId)}/account`, { method: 'GET' }),
  invite: (employeeId: string) =>
    jsonRequest<EmployeeInvitationResult>(`/hr/employees/${id(employeeId)}/invitation`, {
      method: 'POST',
      body: {},
    }),
  resendInvitation: (employeeId: string) =>
    jsonRequest<EmployeeInvitationResult>(`/hr/employees/${id(employeeId)}/invitation/resend`, {
      method: 'POST',
      body: {},
    }),
  cancelInvitation: async (employeeId: string): Promise<void> => {
    const res = await fetch(`${API_URL}/hr/employees/${id(employeeId)}/invitation/cancel`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) throw await erreur(res);
  },

  // Import du personnel (§ 4)
  downloadImportTemplate: async (): Promise<Blob> => {
    const res = await fetch(`${API_URL}/hr/employees/import/template.csv`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) throw await erreur(res);
    return res.blob();
  },
  previewImport: (file: File) =>
    envoyerFichier<EmployeeImportPreview>('/hr/employees/import/preview', file),
  applyImport: (file: File, options: { invite: boolean; skipInvalid: boolean }) =>
    envoyerFichier<EmployeeImportResult>(
      `/hr/employees/import/apply${salesQuery({
        invite: String(options.invite),
        skipInvalid: String(options.skipInvalid),
      })}`,
      file,
    ),

  // Jours fériés de la RDC proposés (§ 5)
  rdcHolidaysProposal: (year: number) =>
    jsonRequest<CountryHolidaysProposalView>(`/hr/holidays/country/cd${salesQuery({ year })}`, {
      method: 'GET',
    }),
  loadRdcHolidays: (year: number) =>
    jsonRequest<CountryHolidaysLoadResult>(`/hr/holidays/country/cd${salesQuery({ year })}`, {
      method: 'POST',
      body: {},
    }),
  verifyHoliday: (holidayId: string) =>
    jsonRequest<HolidayView>(`/hr/holidays/${id(holidayId)}/verify`, { method: 'POST', body: {} }),
};
