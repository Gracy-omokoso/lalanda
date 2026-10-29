// Logique pure de la carte « Mes tâches » de l'Accueil (ADR-0039 § 6.5).
//
// Alimentée par `GET /work/my-tasks` (groupes déjà calculés par l'API au jour
// de Kinshasa, `groupMyTasks`) : ce module ne regroupe rien, il CHOISIT ce que
// la carte montre — compteurs en retard et du jour, puis les cinq premières
// tâches (en retard d'abord, dans l'ordre rendu par l'API). La carte n'existe
// que si le rôle détient `work.read`.

import type { MyTaskItem, MyTasksView } from '@lalanda/shared/work';

import type { OrgAction } from '@/lib/api';

import { MES_TACHES_HREF, formatJour, hrefTache } from '../../projets/_components/projets-model';

export { MES_TACHES_HREF };

/** Tâches listées au plus sur la carte (ADR-0039 § 6.5 : « 5 premières »). */
export const MAX_TACHES_ACCUEIL = 5;

export interface LigneTache {
  id: string;
  titre: string;
  projet: string;
  /** « En retard · 28 oct. » ou « Aujourd’hui ». */
  echeance: string;
  enRetard: boolean;
  lien: string;
}

export interface CarteMesTaches {
  enRetard: number;
  aujourdhui: number;
  lignes: LigneTache[];
  /** Tâches en retard ou du jour non listées faute de place. */
  autres: number;
}

/** La carte ne s'affiche qu'avec `work.read` (sinon `GET /work/my-tasks` répond 403). */
export function carteVisible(actions: readonly OrgAction[] | null): boolean {
  return actions !== null && actions.includes('work.read');
}

function ligne(t: MyTaskItem, enRetard: boolean): LigneTache {
  return {
    id: t.id,
    titre: t.title,
    projet: t.projectName,
    echeance: enRetard ? `En retard · ${formatJour(t.dueDate, false)}` : 'Aujourd’hui',
    enRetard,
    lien: hrefTache(t.projectId, t.id),
  };
}

export function carteMesTaches(
  vue: Pick<MyTasksView, 'overdue' | 'today'>,
  max = MAX_TACHES_ACCUEIL,
): CarteMesTaches {
  const toutes = [
    ...vue.overdue.map((t) => ligne(t, true)),
    ...vue.today.map((t) => ligne(t, false)),
  ];
  return {
    enRetard: vue.overdue.length,
    aujourdhui: vue.today.length,
    lignes: toutes.slice(0, max),
    autres: Math.max(0, toutes.length - max),
  };
}
