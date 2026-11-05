// Client de l'import de fichier (ADR-0062) et de la construction par l'IA
// (ADR-0063). Fichier à part de `work-api.ts` (partagé avec d'autres lots) :
// ajout pur. Le fichier part en CORPS BRUT (`application/octet-stream`), son nom
// en en-tête `X-File-Name` encodé URI ; le serveur déduit le format du contenu.

import type {
  CreateProjectFromPlanBody,
  WorkAiPlanDraft,
  WorkAiPlanRequestBody,
  WorkImportPreview,
  WorkPlanApplyResult,
} from '@lalanda/shared/work';

import { API_URL, jsonRequest } from './api';

/** Paramètres du projet créé depuis un fichier. */
export interface ImportProjectParams {
  name: string;
  kind: 'client' | 'internal';
  ownerUserId?: string;
  startDate?: string;
  dueDate?: string;
  description?: string;
}

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

async function envoyer<T>(path: string, file: File): Promise<T> {
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

function requete(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const workPlanApi = {
  /** Modèle d'import (octets) : l'écran en fait un téléchargement local. */
  downloadTemplate: async (format: 'xlsx' | 'csv'): Promise<Blob> => {
    const res = await fetch(`${API_URL}/work/import/template.${format}`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) throw await erreur(res);
    return res.blob();
  },

  previewImport: (file: File, projectId?: string) =>
    envoyer<WorkImportPreview>(`/work/import/preview${requete({ projectId })}`, file),

  importNewProject: (file: File, p: ImportProjectParams, skipInvalid: boolean) =>
    envoyer<WorkPlanApplyResult>(
      `/work/import/projects${requete({
        name: p.name,
        kind: p.kind,
        ownerUserId: p.ownerUserId,
        startDate: p.startDate,
        dueDate: p.dueDate,
        description: p.description,
        skipInvalid: skipInvalid ? 'true' : undefined,
      })}`,
      file,
    ),

  importIntoProject: (projectId: string, file: File, skipInvalid: boolean) =>
    envoyer<WorkPlanApplyResult>(
      `/work/projects/${encodeURIComponent(projectId)}/import${requete({
        skipInvalid: skipInvalid ? 'true' : undefined,
      })}`,
      file,
    ),

  proposeAiPlan: (body: WorkAiPlanRequestBody) =>
    jsonRequest<WorkAiPlanDraft>('/work/ai/plan', { method: 'POST', body }),

  createFromPlan: (body: CreateProjectFromPlanBody) =>
    jsonRequest<WorkPlanApplyResult>('/work/plans/projects', { method: 'POST', body }),
};
