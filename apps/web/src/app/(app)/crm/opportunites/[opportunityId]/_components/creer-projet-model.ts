// Modèle de l'encadré « Créer le projet » d'une opportunité gagnée — ADR-0040 — C7
// § 6.4 (D4 : proposé, jamais automatique).
//
// Ce que décide ce modèle, sans React :
//   - l'encadré n'existe que sur une opportunité `won` ;
//   - détenteur de `work.manage` (le droit qui crée un projet, ADR-0039 § 4) :
//     « Créer le projet » tant qu'aucun projet n'existe, « Ouvrir le projet » sinon ;
//   - sans `work.manage` (Commercial, Comptable…) : « Ouvrir le projet » s'il existe
//     et qu'il le voit (`work.read`), sinon la phrase « Un responsable des projets
//     peut créer le projet ».
// Les droits viennent de la coquille (`GET /me/permissions`), jamais du nom du rôle.

import type { OrgAction } from '@/lib/api';

export type EtatCreerProjet =
  | { genre: 'cache' }
  | { genre: 'chargement' }
  | { genre: 'creer' }
  | { genre: 'ouvrir'; projectId: string }
  | { genre: 'demander' };

/** Le projet est-il lisible (`GET /work/opportunities/:id/project`) ? */
export function peutLireProjet(actions: readonly OrgAction[] | null): boolean {
  return actions !== null && actions.includes('work.read') && actions.includes('crm.read');
}

/** Créer un projet : `work.manage` (+ `crm.read`, déjà exigé par la fiche). */
export function peutCreerProjet(actions: readonly OrgAction[] | null): boolean {
  return actions !== null && actions.includes('work.manage') && actions.includes('crm.read');
}

/**
 * `projectId` : `undefined` tant que la lecture n'a pas répondu (ou n'est pas
 * permise), `null` si aucun projet n'existe.
 */
export function etatCreerProjet(entree: {
  status: string;
  actions: readonly OrgAction[] | null;
  projectId: string | null | undefined;
}): EtatCreerProjet {
  const { status, actions, projectId } = entree;
  if (status !== 'won' || actions === null) return { genre: 'cache' };
  const creer = peutCreerProjet(actions);
  if (!peutLireProjet(actions)) return creer ? { genre: 'creer' } : { genre: 'demander' };
  if (projectId === undefined) return { genre: 'chargement' };
  if (projectId !== null) return { genre: 'ouvrir', projectId };
  return creer ? { genre: 'creer' } : { genre: 'demander' };
}

/** Chemin de la page d'un projet du RUN (ADR-0039 § 8). */
export function lienProjet(projectId: string): string {
  return `/projets/${encodeURIComponent(projectId)}`;
}

/** Suite d'un refus de création : ouvrir le projet existant, ou un message. */
export function suiteRefus(
  code: string | null,
  details: Record<string, unknown>,
): { projectId: string } | { message: string } {
  const existant = details['projectId'];
  if (
    (code === 'WORK_PROJECT_EXISTS_FOR_OPPORTUNITY' || code === 'WORK_PROJECT_EXISTS_FOR_QUOTE') &&
    typeof existant === 'string'
  ) {
    return { projectId: existant };
  }
  switch (code) {
    case 'WORK_OPPORTUNITY_NOT_WON':
      return { message: 'L’opportunité n’est plus gagnée : rechargez la fiche.' };
    case 'WORK_OPPORTUNITY_QUOTE_REQUIRED':
      return {
        message:
          'Plusieurs devis de cette opportunité sont acceptés : créez le projet depuis la fiche du devis qu’il doit suivre.',
      };
    case 'WORK_PROJECT_LIMIT':
      return { message: 'Trop de projets en cours : archivez-en un avant d’en créer un autre.' };
    default:
      return { message: 'Le projet n’a pas pu être créé.' };
  }
}
