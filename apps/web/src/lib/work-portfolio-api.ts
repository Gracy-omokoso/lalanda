// Accueil des projets (ADR-0058) : `GET /work/portfolio`. Fichier séparé de
// `work-api.ts` pour ne pas croiser les chantiers de l'intérieur d'un projet.

import type { WorkPortfolioScope, WorkPortfolioView } from '@lalanda/shared/work';

import { jsonRequest } from './api';

export const workPortfolioApi = {
  get: (scope: WorkPortfolioScope) =>
    jsonRequest<WorkPortfolioView>(`/work/portfolio?scope=${encodeURIComponent(scope)}`, {
      method: 'GET',
    }),
};
