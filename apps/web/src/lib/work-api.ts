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
  MyTaskItem,
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
  WorkMemberRef,
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

/** Liste bornée non paginée (tâches d'un projet, pièces d'une tâche, membres). */
export interface WorkItems<T> {
  items: T[];
}

/**
 * Membre de l'organisation détenant `work.read` (`GET /work/members`) : forme
 * de `WorkMemberView` dans `apps/api/src/work/work-members.service.ts`, qui ne
 * vit pas (encore) dans `@lalanda/shared/work`.
 */
export interface WorkMemberOption extends WorkMemberRef {
  /** Détient `work.update` : peut être responsable d'une tâche (§ 2.3). */
  canUpdate: boolean;
  /** Détient `work.manage` : peut gérer les projets. */
  canManage: boolean;
}

/** Nombre de pages lues au plus pour reconstituer une liste complète. */
export const PAGES_MAX = 100;

/**
 * Lit toutes les pages d'une liste par curseur, dans l'ordre servi (borné à
 * `PAGES_MAX` pages pour ne jamais boucler sur un curseur fautif).
 */
export async function toutesLesPages<T>(
  page: (cursor: string | null) => Promise<WorkPage<T>>,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < PAGES_MAX; i += 1) {
    const p = await page(cursor);
    out.push(...p.items);
    if (p.nextCursor === null || p.nextCursor === cursor) break;
    cursor = p.nextCursor;
  }
  return out;
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

/** Une page de commentaires (du plus ancien au plus récent). */
function listCommentsPage(
  taskId: string,
  query: { limit?: number; cursor?: string | null } = {},
): Promise<WorkPage<WorkCommentView>> {
  return jsonRequest<WorkPage<WorkCommentView>>(
    `/work/tasks/${id(taskId)}/comments${salesQuery(query)}`,
    { method: 'GET' },
  );
}

export const workApi = {
  // ─── Réglages ─────────────────────────────────────────────────────────────
  getSettings: () => jsonRequest<WorkSettingsView>('/work/settings', { method: 'GET' }),
  putSettings: (body: PutWorkSettingsBody) =>
    jsonRequest<WorkSettingsView>('/work/settings', { method: 'PUT', body }),

  /** Membres détenant `work.read` (responsables et mentions) ; enveloppe `{ items }`. */
  listMembers: () =>
    jsonRequest<WorkItems<WorkMemberOption>>('/work/members', { method: 'GET' }).then(
      (r) => r.items,
    ),

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
    jsonRequest<WorkItems<WorkTaskView>>(
      `/work/projects/${id(projectId)}/tasks${salesQuery(query)}`,
      { method: 'GET' },
    ).then((r) => r.items),
  createTask: (projectId: string, body: CreateWorkTaskBody) =>
    jsonRequest<WorkTaskWriteResult>(`/work/projects/${id(projectId)}/tasks`, {
      method: 'POST',
      body,
    }),
  /** Liste transverse (calendrier « Mes tâches », etc.), paginée par curseur, avec le nom du projet. */
  listTasks: (query: ListWorkTasksParams = {}) =>
    jsonRequest<WorkPage<MyTaskItem>>(`/work/tasks${salesQuery(query)}`, { method: 'GET' }),
  myTasks: () => jsonRequest<MyTasksView>('/work/my-tasks', { method: 'GET' }),
  getTask: (taskId: string) =>
    jsonRequest<WorkTaskDetail>(`/work/tasks/${id(taskId)}`, { method: 'GET' }),
  /** Historique d'une tâche (plus récent d'abord), paginé par curseur. */
  listTaskActivity: (taskId: string, query: { limit?: number; cursor?: string | null } = {}) =>
    jsonRequest<WorkPage<WorkActivityView>>(
      `/work/tasks/${id(taskId)}/activity${salesQuery(query)}`,
      { method: 'GET' },
    ),
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
  listCommentsPage,
  /** Tous les commentaires de la tâche, pages enchaînées (100 par page, le maximum). */
  listComments: (taskId: string) =>
    toutesLesPages((cursor) => listCommentsPage(taskId, { limit: 100, cursor })),
  createComment: (taskId: string, body: CreateWorkCommentBody) =>
    jsonRequest<WorkCommentView>(`/work/tasks/${id(taskId)}/comments`, { method: 'POST', body }),
  updateComment: (commentId: string, body: UpdateWorkCommentBody) =>
    jsonRequest<WorkCommentView>(`/work/comments/${id(commentId)}`, { method: 'PUT', body }),
  deleteComment: (commentId: string) =>
    jsonRequest<void>(`/work/comments/${id(commentId)}`, { method: 'DELETE' }),

  // ─── Pièces jointes ───────────────────────────────────────────────────────
  /** Toutes les pièces actives de la tâche (bornées, sans pagination). */
  listAttachments: (taskId: string) =>
    jsonRequest<WorkItems<WorkAttachmentView>>(`/work/tasks/${id(taskId)}/attachments`, {
      method: 'GET',
    }).then((r) => r.items),
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
