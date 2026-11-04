// Client de l'aperçu d'un projet — ADR-0057 (`GET /work/projects/:id/overview`).
// Fichier à part de `work-api.ts` (partagé avec d'autres lots) : ajout pur.

import type { WorkProjectOverview } from '@lalanda/shared/work';

import { jsonRequest } from './api';

export const workOverviewApi = {
  getOverview: (projectId: string) =>
    jsonRequest<WorkProjectOverview>(`/work/projects/${encodeURIComponent(projectId)}/overview`, {
      method: 'GET',
    }),
};
