// Accueil des projets (ADR-0058) : mise en forme de `GET /work/portfolio`.
// Aucun calcul métier : santé, avancement et chiffres viennent de l'API.

import type {
  WorkPortfolioProject,
  WorkPortfolioScope,
  WorkPortfolioView,
  WorkProjectHealth,
} from '@lalanda/shared/work';
import type { StatusTone } from '@lalanda/ui';

import { formatJour } from './projets-model';

export const FILTRES_PORTEFEUILLE: readonly { cle: WorkPortfolioScope; libelle: string }[] = [
  { cle: 'mine', libelle: 'Mes projets' },
  { cle: 'all', libelle: 'Tous' },
  { cle: 'archived', libelle: 'Archivés' },
];

/** Statut affiché : la santé, sauf projet fermé (terminé ou archivé) ou en pause. */
export function statutAffiche(p: Pick<WorkPortfolioProject, 'health' | 'status'>): {
  libelle: string;
  ton: StatusTone;
} {
  if (p.health === 'closed') {
    return { libelle: p.status === 'archived' ? 'Archivé' : 'Terminé', ton: 'draft' };
  }
  const sante: Record<
    Exclude<WorkProjectHealth, 'closed'>,
    { libelle: string; ton: StatusTone }
  > = {
    on_track: { libelle: 'En bonne voie', ton: 'ok' },
    at_risk: { libelle: 'À risque', ton: 'wait' },
    late: { libelle: 'En retard', ton: 'late' },
  };
  const s = sante[p.health];
  return p.status === 'on_hold' ? { libelle: `${s.libelle} · en pause`, ton: s.ton } : s;
}

/** Explication écrite de la santé (infobulle et lecteurs d'écran). */
export function raisonSante(p: WorkPortfolioProject): string {
  switch (p.health) {
    case 'late':
      return `Échéance du projet dépassée (${formatJour(p.dueDate)}) avec des tâches ouvertes.`;
    case 'at_risk':
      return p.overdueMilestoneCount > 0
        ? `${p.overdueMilestoneCount} jalon${p.overdueMilestoneCount > 1 ? 's' : ''} en retard.`
        : `${p.overdueTaskCount} tâches en retard.`;
    case 'on_track':
      return 'Aucun jalon en retard, moins de 3 tâches en retard.';
    default:
      return 'Projet terminé ou archivé.';
  }
}

export function texteAvancement(p: WorkPortfolioProject): string {
  if (p.totalTaskCount === 0) return 'Aucune tâche';
  return `${p.doneTaskCount}/${p.totalTaskCount} · ${p.progressPercent} %`;
}

/** Recherche locale sur le nom et le client, sans accents ni casse. */
export function filtrerProjets(
  items: readonly WorkPortfolioProject[],
  recherche: string,
): WorkPortfolioProject[] {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = norm(recherche.trim());
  if (q === '') return [...items];
  return items.filter((p) => norm(`${p.name} ${p.customerName ?? ''}`).includes(q));
}

export interface CarteChiffre {
  id: 'actifs' | 'retard' | 'semaine';
  libelle: string;
  valeur: string;
  note: string;
  alerte: boolean;
}

export function cartesPortefeuille(v: WorkPortfolioView): CarteChiffre[] {
  const s = v.stats;
  return [
    {
      id: 'actifs',
      libelle: 'Projets actifs',
      valeur: String(s.activeProjects),
      note: 'dans l’organisation',
      alerte: false,
    },
    {
      id: 'retard',
      libelle: 'Tâches en retard',
      valeur: String(s.overdueTasks),
      note: s.overdueTasks === 0 ? 'rien en retard' : 'échéance dépassée',
      alerte: s.overdueTasks > 0,
    },
    {
      id: 'semaine',
      libelle: 'Terminées cette semaine',
      valeur: String(s.completedThisWeek),
      note: `depuis lundi ${formatJour(s.weekStart, false)}`,
      alerte: false,
    },
  ];
}

/** Message d'état vide selon le filtre et la recherche. */
export function etatVide(
  scope: WorkPortfolioScope,
  recherche: string,
  gerer: boolean,
): { titre: string; texte: string; creer: boolean } {
  if (recherche.trim() !== '') {
    return {
      titre: 'Aucun projet ne correspond',
      texte: 'Essayez un autre mot : la recherche porte sur le nom du projet et du client.',
      creer: false,
    };
  }
  if (scope === 'archived') {
    return {
      titre: 'Aucun projet archivé',
      texte: 'Un projet archivé sort des listes et de Mes tâches ; il se restaure à tout moment.',
      creer: false,
    };
  }
  if (scope === 'mine') {
    return {
      titre: 'Vous n’êtes sur aucun projet',
      texte:
        'Un projet apparaît ici quand vous en êtes responsable, ou qu’une de ses tâches vous est assignée ou suivie.',
      creer: gerer,
    };
  }
  return {
    titre: 'Aucun projet pour l’instant',
    texte: gerer
      ? 'Créez un premier projet, client ou interne, puis ajoutez-y les tâches de l’équipe.'
      : 'Un Propriétaire, un Administrateur ou un Directeur financier peut créer le premier projet.',
    creer: gerer,
  };
}
