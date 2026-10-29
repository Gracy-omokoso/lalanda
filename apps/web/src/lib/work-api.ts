// Client de l'API des projets et tâches du RUN — ADR-0039 § 4 (module `work`).
//
// Fichier voisin de `api.ts` (même `jsonRequest`, mêmes erreurs), propriété du
// lot L3a ; L3b (calendrier, chronologie) le LIT sans l'écrire et demande ses
// ajouts. Les corps et les réponses sont typés par les contrats partagés
// (`@lalanda/shared/work`) : le web ne recopie aucune forme à la main (O5).
//
// AUCUN montant n'est calculé ici ; ce lot n'en affiche d'ailleurs aucun.

import type {
  AddDependencyBody,
  CreateTimeEntryBody,
  CreateWorkCommentBody,
  CreateWorkProjectBody,
  CreateWorkTaskBody,
  MoveWorkTaskBody,
  MyTasksView,
  PatchWorkTaskBody,
  PutWorkSettingsBody,
  TimeEntryView,
  TimeSummaryView,
  UpdateTimeEntryBody,
  UpdateWorkCommentBody,
  UpdateWorkProjectBody,
  WorkActivityView,
  WorkAttachmentView,
  WorkCommentView,
  WorkPage,
  WorkProjectKind,
  WorkProjectStatus,
  WorkProjectSummary,
  WorkProjectView,
  WorkSettingsView,
  WorkTaskDetail,
  WorkTaskView,
  WorkTaskWriteResult,
} from '@lalanda/shared/work';

import { API_URL, jsonRequest, salesQuery } from './api';

/**
 * Liste rendue nue ou en page (`{ items }`). L'ADR § 3 pagine toutes les listes
 * par curseur SAUF les tâches d'un projet, sans fixer l'enveloppe de celle-ci ;
 * commentaires et pièces d'une tâche sont bornés (≤ 10 000 / tâche) mais leur
 * enveloppe n'est pas écrite non plus. HYPOTHÈSE à confronter à L1 : on
 * accepte les deux formes plutôt que de casser à la première réponse.
 */
export function itemsDe<T>(reponse: T[] | { items: T[] } | null | undefined): T[] {
  if (Array.isArray(reponse)) return reponse;
  if (reponse && Array.isArray(reponse.items)) return reponse.items;
  return [];
}

type Liste<T> = T[] | WorkPage<T>;

/** Membre proposé comme responsable ou pour une mention. */
export interface WorkMemberOption {
  userId: string;
  name: string;
  /** Détient `work.update` : peut être responsable d'une tâche (§ 2.3). */
  canUpdate: boolean;
}

export interface ListWorkProjectsParams {
  status?: WorkProjectStatus;
  kind?: WorkProjectKind;
  customerId?: string;
  opportunityId?: string;
  q?: string;
  limit?: number;
  cursor?: string | null;
}

export interface ListProjectTasksParams {
  assignee?: 'me' | string;
  label?: string;
  done?: boolean;
  dueFrom?: string;
  dueTo?: string;
}

export interface ListWorkTasksParams extends ListProjectTasksParams {
  projectId?: string;
  limit?: number;
  cursor?: string | null;
}

export interface ListTimeEntriesParams {
  projectId?: string;
  taskId?: string;
  userId?: 'me' | string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string | null;
}

const id = (v: string) => encodeURIComponent(v);

/** Erreur au format de `jsonRequest` (status, detail), pour les appels binaires. */
async function erreurHttp(res: Response): Promise<Error & { status: number; detail: unknown }> {
  const text = await res.text();
  let detail: unknown = text;
  try {
    detail = JSON.parse(text);
  } catch {
    /* garde le texte brut */
  }
  const err = new Error(`HTTP ${res.status}`) as Error & { status: number; detail: unknown };
  err.status = res.status;
  err.detail = detail;
  return err;
}

export const workApi = {
  // ─── Réglages ─────────────────────────────────────────────────────────────
  getSettings: () => jsonRequest<WorkSettingsView>('/work/settings', { method: 'GET' }),
  putSettings: (body: PutWorkSettingsBody) =>
    jsonRequest<WorkSettingsView>('/work/settings', { method: 'PUT', body }),

  /**
   * HYPOTHÈSE à confronter à L1 : membres éligibles (`work.read`, avec
   * `canUpdate` pour `work.update`). L'ADR § 8 exige que « @ » propose les
   * membres détenant `work.read`, sans nommer la route ; `GET
   * /organizations/:id/members` exige `organization.manage`. En cas d'échec,
   * l'écran se replie sur les membres déjà cités par les réponses.
   */
  listMembers: () =>
    jsonRequest<{ members: WorkMemberOption[] }>('/work/members', { method: 'GET' }),

  // ─── Projets ──────────────────────────────────────────────────────────────
  listProjects: (query: ListWorkProjectsParams = {}) =>
    jsonRequest<WorkPage<WorkProjectSummary>>(`/work/projects${salesQuery(query)}`, {
      method: 'GET',
    }),
  getProject: (projectId: string) =>
    jsonRequest<WorkProjectView>(`/work/projects/${id(projectId)}`, { method: 'GET' }),
  createProject: (body: CreateWorkProjectBody) =>
    jsonRequest<WorkProjectView>('/work/projects', { method: 'POST', body }),
  updateProject: (projectId: string, body: UpdateWorkProjectBody) =>
    jsonRequest<WorkProjectView>(`/work/projects/${id(projectId)}`, { method: 'PUT', body }),
  archiveProject: (projectId: string, expectedRevision: number) =>
    jsonRequest<WorkProjectView>(`/work/projects/${id(projectId)}/archive`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  restoreProject: (projectId: string, expectedRevision: number) =>
    jsonRequest<WorkProjectView>(`/work/projects/${id(projectId)}/restore`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  deleteProject: (projectId: string) =>
    jsonRequest<void>(`/work/projects/${id(projectId)}`, { method: 'DELETE' }),
  listProjectActivity: (
    projectId: string,
    query: { limit?: number; cursor?: string | null } = {},
  ) =>
    jsonRequest<WorkPage<WorkActivityView>>(
      `/work/projects/${id(projectId)}/activity${salesQuery(query)}`,
      { method: 'GET' },
    ),

  // ─── Tâches ───────────────────────────────────────────────────────────────
  /** Tout le projet (≤ 5 000, projection allégée) : liste, Kanban, calendrier, Gantt. */
  listProjectTasks: (projectId: string, query: ListProjectTasksParams = {}) =>
    jsonRequest<Liste<WorkTaskView>>(`/work/projects/${id(projectId)}/tasks${salesQuery(query)}`, {
      method: 'GET',
    }).then(itemsDe),
  createTask: (projectId: string, body: CreateWorkTaskBody) =>
    jsonRequest<WorkTaskWriteResult>(`/work/projects/${id(projectId)}/tasks`, {
      method: 'POST',
      body,
    }),
  /** Liste transverse (calendrier « Mes tâches », etc.), paginée par curseur. */
  listTasks: (query: ListWorkTasksParams = {}) =>
    jsonRequest<WorkPage<WorkTaskView>>(`/work/tasks${salesQuery(query)}`, { method: 'GET' }),
  myTasks: () => jsonRequest<MyTasksView>('/work/my-tasks', { method: 'GET' }),
  getTask: (taskId: string) =>
    jsonRequest<WorkTaskDetail>(`/work/tasks/${id(taskId)}`, { method: 'GET' }),
  patchTask: (taskId: string, body: PatchWorkTaskBody) =>
    jsonRequest<WorkTaskWriteResult>(`/work/tasks/${id(taskId)}`, { method: 'PATCH', body }),
  moveTask: (taskId: string, body: MoveWorkTaskBody) =>
    jsonRequest<WorkTaskWriteResult>(`/work/tasks/${id(taskId)}/move`, { method: 'POST', body }),
  completeTask: (taskId: string, expectedRevision: number) =>
    jsonRequest<WorkTaskWriteResult>(`/work/tasks/${id(taskId)}/complete`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  reopenTask: (taskId: string, expectedRevision: number) =>
    jsonRequest<WorkTaskWriteResult>(`/work/tasks/${id(taskId)}/reopen`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  deleteTask: (taskId: string) =>
    jsonRequest<void>(`/work/tasks/${id(taskId)}`, { method: 'DELETE' }),
  addDependency: (taskId: string, body: AddDependencyBody) =>
    jsonRequest<WorkTaskWriteResult>(`/work/tasks/${id(taskId)}/dependencies`, {
      method: 'POST',
      body,
    }),
  removeDependency: (taskId: string, predecessorTaskId: string) =>
    jsonRequest<WorkTaskWriteResult>(
      `/work/tasks/${id(taskId)}/dependencies/${id(predecessorTaskId)}`,
      { method: 'DELETE' },
    ),

  // ─── Commentaires ─────────────────────────────────────────────────────────
  listComments: (taskId: string) =>
    jsonRequest<Liste<WorkCommentView>>(`/work/tasks/${id(taskId)}/comments?limit=100`, {
      method: 'GET',
    }).then(itemsDe),
  createComment: (taskId: string, body: CreateWorkCommentBody) =>
    jsonRequest<WorkCommentView>(`/work/tasks/${id(taskId)}/comments`, { method: 'POST', body }),
  updateComment: (commentId: string, body: UpdateWorkCommentBody) =>
    jsonRequest<WorkCommentView>(`/work/comments/${id(commentId)}`, { method: 'PUT', body }),
  deleteComment: (commentId: string) =>
    jsonRequest<void>(`/work/comments/${id(commentId)}`, { method: 'DELETE' }),

  // ─── Pièces jointes ───────────────────────────────────────────────────────
  listAttachments: (taskId: string) =>
    jsonRequest<Liste<WorkAttachmentView>>(`/work/tasks/${id(taskId)}/attachments?limit=100`, {
      method: 'GET',
    }).then(itemsDe),
  /** Corps binaire brut, nom en en-tête `X-File-Name` encodé URI (§ 2.5). */
  uploadAttachment: async (taskId: string, file: File): Promise<WorkAttachmentView> => {
    const res = await fetch(`${API_URL}/work/tasks/${id(taskId)}/attachments`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': file.type || 'application/octet-stream',
        'x-file-name': encodeURIComponent(file.name),
      },
      body: file,
    });
    if (!res.ok) throw await erreurHttp(res);
    return (await res.json()) as WorkAttachmentView;
  },
  /** Octets de la pièce (en-têtes inertes côté serveur) : le web en fait un lien local. */
  downloadAttachment: async (attachmentId: string): Promise<Blob> => {
    const res = await fetch(`${API_URL}/work/attachments/${id(attachmentId)}`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) throw await erreurHttp(res);
    return res.blob();
  },
  deleteAttachment: (attachmentId: string) =>
    jsonRequest<void>(`/work/attachments/${id(attachmentId)}`, { method: 'DELETE' }),

  // ─── Temps ────────────────────────────────────────────────────────────────
  listTimeEntries: (query: ListTimeEntriesParams = {}) =>
    jsonRequest<WorkPage<TimeEntryView>>(`/work/time-entries${salesQuery(query)}`, {
      method: 'GET',
    }),
  createTimeEntry: (taskId: string, body: CreateTimeEntryBody) =>
    jsonRequest<TimeEntryView>(`/work/tasks/${id(taskId)}/time-entries`, {
      method: 'POST',
      body,
    }),
  updateTimeEntry: (entryId: string, body: UpdateTimeEntryBody) =>
    jsonRequest<TimeEntryView>(`/work/time-entries/${id(entryId)}`, { method: 'PUT', body }),
  deleteTimeEntry: (entryId: string) =>
    jsonRequest<void>(`/work/time-entries/${id(entryId)}`, { method: 'DELETE' }),
  timeSummary: (projectId: string) =>
    jsonRequest<TimeSummaryView>(`/work/projects/${id(projectId)}/time-summary`, {
      method: 'GET',
    }),
};
