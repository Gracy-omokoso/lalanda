// Client de l'API des ressources humaines, deuxième partie — ADR-0045 § 3 (lot H7).
//
// Données sensibles (formes masquées, révélation journalisée, écriture par section),
// sortie et anonymisation, documents (envoi MULTIPART : le fichier et ses métadonnées
// voyagent dans le corps, jamais dans l'URL ni dans un en-tête), listes d'entrée et de
// sortie, échéances, rapports et registre CSV, réglages (types d'absence, jours
// fériés, circuit), feuille de temps hebdomadaire en lecture.
//
// AUCUN calcul ici : soldes, échéances, effectifs, taux et grille de temps viennent du
// moteur, par l'API. AUCUNE donnée sensible n'est mise en cache, en stockage local ni
// dans une URL : la réponse d'un `reveal` n'existe que dans l'état de l'écran qui l'a
// demandée.

import type {
  ChecklistItemView,
  ChecklistPage,
  ChecklistTemplateItemInput,
  ChecklistTemplatePage,
  ChecklistTemplateView,
  ChecklistView,
  CreateHolidayBody,
  CreateLeaveTypeBody,
  EmployeeExitCategory,
  EmployeeExitResult,
  EmployeePrivateRevealView,
  EmployeePrivateSummary,
  EmployeeView,
  HolidayListView,
  HolidayView,
  HrDeadlinesView,
  HrDocumentCategory,
  HrDocumentPage,
  HrDocumentView,
  HrPrivateField,
  HrPrivateSections,
  HrReportsView,
  HrSettingsView as ApiHrSettings,
  LeaveTypeListView,
  LeaveTypeView as ApiLeaveType,
  UpdateHrApprovalSettingsBody,
  UpdateHrSettingsBody,
  UpdateLeaveTypeBody,
} from '@lalanda/shared/hr';
import { HR_DOCUMENT_FILE_FIELD } from '@lalanda/shared/hr';
import type { WeeklyTimesheetView } from '@lalanda/shared/work';

import { API_URL, EVENEMENT_REFUS_API, jsonRequest, salesQuery } from './api';
import { employeeFromApi, type HrEmployeeView } from './api-hr';

export type {
  ChecklistItemView,
  ChecklistTemplateItemInput,
  ChecklistTemplateView,
  ChecklistView,
  EmployeePrivateRevealView,
  EmployeePrivateSummary,
  HolidayView,
  HrDeadlinesView,
  HrDocumentView,
  HrPrivateField,
  HrPrivateSections,
  HrReportsView,
  WeeklyTimesheetView,
};
export type HrSettingsFull = ApiHrSettings;
export type LeaveTypeFull = ApiLeaveType;

const id = encodeURIComponent;

type ErreurHttp = Error & { status: number; detail: unknown };

/** Erreur d'une réponse non JSON, à la forme de `jsonRequest` (statut, détail). */
async function erreurHttp(res: Response): Promise<ErreurHttp> {
  const text = await res.text();
  let detail: unknown = text;
  try {
    detail = JSON.parse(text);
  } catch {
    /* garde le texte brut */
  }
  const err = new Error(
    typeof detail === 'object' && detail !== null && 'message' in detail
      ? String((detail as { message: unknown }).message)
      : `HTTP ${res.status}`,
  ) as ErreurHttp;
  err.status = res.status;
  err.detail = detail;
  if (res.status === 403 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENEMENT_REFUS_API, { detail }));
  }
  return err;
}

/** Fichier reçu : octets et nom (en-tête lisible seulement si l'API l'expose). */
async function telecharger(path: string, nomParDefaut: string): Promise<FichierRecu> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'GET',
    credentials: 'include',
    // Rien n'est gardé par le navigateur : une pièce sensible ne reste pas en cache.
    cache: 'no-store',
  });
  if (!res.ok) throw await erreurHttp(res);
  const cd = res.headers.get('content-disposition') ?? '';
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  const simple = /filename="([^"]+)"/i.exec(cd);
  let nom = nomParDefaut;
  if (utf8?.[1]) {
    try {
      nom = decodeURIComponent(utf8[1]);
    } catch {
      nom = nomParDefaut;
    }
  } else if (simple?.[1]) {
    nom = simple[1];
  }
  return { blob: await res.blob(), nom };
}

export interface FichierRecu {
  blob: Blob;
  nom: string;
}

// ─── Documents (§ 2.8) ──────────────────────────────────────────────────────

/** Métadonnées d'un envoi : champs du FORMULAIRE multipart, jamais de l'URL. */
export interface EnvoiDocument {
  category: HrDocumentCategory;
  label: string;
  issuedOn?: string | null;
  expiresOn?: string | null;
  sensitive?: boolean;
  visibleToEmployee?: boolean;
}

/**
 * Corps `multipart/form-data` d'un envoi (`UploadHrDocumentFields`) : les champs
 * d'abord, la pièce en dernier (partie `file`). Les booléens voyagent en `"true"` /
 * `"false"` ; un champ vide est omis.
 */
export function formulaireDocument(meta: EnvoiDocument, fichier: Blob, nom: string): FormData {
  const fd = new FormData();
  fd.append('category', meta.category);
  fd.append('label', meta.label);
  if (meta.issuedOn) fd.append('issuedOn', meta.issuedOn);
  if (meta.expiresOn) fd.append('expiresOn', meta.expiresOn);
  if (meta.sensitive !== undefined) fd.append('sensitive', meta.sensitive ? 'true' : 'false');
  if (meta.visibleToEmployee !== undefined) {
    fd.append('visibleToEmployee', meta.visibleToEmployee ? 'true' : 'false');
  }
  fd.append(HR_DOCUMENT_FILE_FIELD, fichier, nom);
  return fd;
}

// ─── Client ─────────────────────────────────────────────────────────────────

export const hrAdminApi = {
  // Données sensibles (§ 2.4) — formes masquées, révélation journalisée, écriture.
  getPrivateSummary: (employeeId: string) =>
    jsonRequest<EmployeePrivateSummary>(`/hr/employees/${id(employeeId)}/private`, {
      method: 'GET',
    }),
  revealPrivate: (employeeId: string, sections: HrPrivateField[]) =>
    jsonRequest<EmployeePrivateRevealView>(`/hr/employees/${id(employeeId)}/private/reveal`, {
      method: 'POST',
      body: { sections },
    }),
  writePrivateSection: <F extends HrPrivateField>(
    employeeId: string,
    section: F,
    data: HrPrivateSections[F] | null,
    expectedRevision: number,
  ) =>
    jsonRequest<EmployeePrivateSummary>(`/hr/employees/${id(employeeId)}/private/${id(section)}`, {
      method: 'PUT',
      body: { data, expectedRevision },
    }),

  // Sortie, réintégration, anonymisation (§ 3.1).
  exitEmployee: async (
    employeeId: string,
    body: { endDate: string; exitCategory: EmployeeExitCategory; expectedRevision: number },
  ): Promise<{ employee: HrEmployeeView; offboardingSuggested: boolean }> => {
    const r = await jsonRequest<EmployeeExitResult>(`/hr/employees/${id(employeeId)}/exit`, {
      method: 'POST',
      body,
    });
    return { employee: employeeFromApi(r.employee), offboardingSuggested: r.offboardingSuggested };
  },
  reinstateEmployee: async (employeeId: string, expectedRevision: number) =>
    employeeFromApi(
      await jsonRequest<EmployeeView>(`/hr/employees/${id(employeeId)}/reinstate`, {
        method: 'POST',
        body: { expectedRevision },
      }),
    ),
  anonymizeEmployee: async (employeeId: string, expectedRevision: number) =>
    employeeFromApi(
      await jsonRequest<EmployeeView>(`/hr/employees/${id(employeeId)}/anonymize`, {
        method: 'POST',
        body: { confirm: true, expectedRevision },
      }),
    ),

  // Documents (§ 2.8, § 3.3).
  listDocuments: (employeeId: string, category?: HrDocumentCategory) =>
    jsonRequest<HrDocumentPage>(
      `/hr/employees/${id(employeeId)}/documents${salesQuery({ category })}`,
      { method: 'GET' },
    ),
  /** Envoi multipart : le navigateur pose lui-même l'en-tête et sa frontière. */
  uploadDocument: async (
    employeeId: string,
    meta: EnvoiDocument,
    fichier: File,
  ): Promise<HrDocumentView> => {
    const res = await fetch(`${API_URL}/hr/employees/${id(employeeId)}/documents`, {
      method: 'POST',
      credentials: 'include',
      body: formulaireDocument(meta, fichier, fichier.name),
    });
    if (!res.ok) throw await erreurHttp(res);
    return (await res.json()) as HrDocumentView;
  },
  downloadDocument: (doc: Pick<HrDocumentView, 'id' | 'fileName'>) =>
    telecharger(`/hr/documents/${id(doc.id)}/file`, doc.fileName),
  deleteDocument: (documentId: string) =>
    jsonRequest<void>(`/hr/documents/${id(documentId)}`, { method: 'DELETE' }),

  // Listes d'entrée et de sortie (§ 2.9).
  listChecklistTemplates: () =>
    jsonRequest<ChecklistTemplatePage>('/hr/checklist-templates', { method: 'GET' }),
  createChecklistTemplate: (body: {
    kind: 'onboarding' | 'offboarding';
    label: string;
    items: ChecklistTemplateItemInput[];
  }) => jsonRequest<ChecklistTemplateView>('/hr/checklist-templates', { method: 'POST', body }),
  updateChecklistTemplate: (
    templateId: string,
    body: { expectedRevision: number; label?: string; items?: ChecklistTemplateItemInput[] },
  ) =>
    jsonRequest<ChecklistTemplateView>(`/hr/checklist-templates/${id(templateId)}`, {
      method: 'PUT',
      body,
    }),
  deleteChecklistTemplate: (templateId: string) =>
    jsonRequest<void>(`/hr/checklist-templates/${id(templateId)}`, { method: 'DELETE' }),
  listChecklists: (params: { employeeId?: string; open?: boolean } = {}) =>
    jsonRequest<ChecklistPage>(
      `/hr/checklists${salesQuery({
        employeeId: params.employeeId,
        open: params.open === undefined ? undefined : String(params.open),
      })}`,
      { method: 'GET' },
    ),
  instantiateChecklist: (employeeId: string, templateId: string) =>
    jsonRequest<ChecklistView>(`/hr/employees/${id(employeeId)}/checklists`, {
      method: 'POST',
      body: { templateId },
    }),
  setChecklistItemDone: (checklistId: string, itemId: string, done: boolean) =>
    jsonRequest<ChecklistItemView>(
      `/hr/checklists/${id(checklistId)}/items/${id(itemId)}/${done ? 'done' : 'undone'}`,
      { method: 'POST', body: {} },
    ),

  // Échéances (§ 6.4).
  getDeadlines: (within?: number) =>
    jsonRequest<HrDeadlinesView>(
      `/hr/deadlines${salesQuery({ within: within === undefined ? undefined : String(within) })}`,
      { method: 'GET' },
    ),

  // Rapports et registre (§ 3.3, § 7).
  getReports: (params: { from: string; to: string; departmentId?: string }) =>
    jsonRequest<HrReportsView>(`/hr/reports${salesQuery(params)}`, { method: 'GET' }),
  exportRegister: (departmentId?: string) =>
    telecharger(`/hr/reports/export.csv${salesQuery({ departmentId })}`, 'registre-personnel.csv'),

  // Réglages (§ 2.2) et référentiels des absences (§ 2.5, § 2.6).
  getSettings: () => jsonRequest<ApiHrSettings>('/hr/settings', { method: 'GET' }),
  updateSettings: (body: UpdateHrSettingsBody) =>
    jsonRequest<ApiHrSettings>('/hr/settings', { method: 'PUT', body }),
  updateApprovalSettings: (body: UpdateHrApprovalSettingsBody) =>
    jsonRequest<ApiHrSettings>('/hr/settings/approval', { method: 'PUT', body }),
  listLeaveTypes: (active: 'true' | 'false' | 'all' = 'all') =>
    jsonRequest<LeaveTypeListView>(`/hr/leave-types${salesQuery({ active })}`, { method: 'GET' }),
  createLeaveType: (body: Partial<CreateLeaveTypeBody> & { label: string }) =>
    jsonRequest<ApiLeaveType>('/hr/leave-types', { method: 'POST', body }),
  updateLeaveType: (typeId: string, body: UpdateLeaveTypeBody) =>
    jsonRequest<ApiLeaveType>(`/hr/leave-types/${id(typeId)}`, { method: 'PUT', body }),
  archiveLeaveType: (typeId: string, expectedRevision: number) =>
    jsonRequest<ApiLeaveType>(`/hr/leave-types/${id(typeId)}/archive`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  listHolidays: (year?: number) =>
    jsonRequest<HolidayListView>(
      `/hr/holidays${salesQuery({ year: year === undefined ? undefined : String(year) })}`,
      { method: 'GET' },
    ),
  createHoliday: (body: Partial<CreateHolidayBody> & { date: string; label: string }) =>
    jsonRequest<HolidayView>('/hr/holidays', { method: 'POST', body }),
  deleteHoliday: (holidayId: string) =>
    jsonRequest<void>(`/hr/holidays/${id(holidayId)}`, { method: 'DELETE' }),

  // Feuille de temps hebdomadaire, en lecture (§ 6.3).
  getTimesheet: (params: { userId?: string; week?: string } = {}) =>
    jsonRequest<WeeklyTimesheetView>(`/work/timesheets${salesQuery(params)}`, { method: 'GET' }),
};
