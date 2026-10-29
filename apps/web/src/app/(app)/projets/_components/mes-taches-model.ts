// « Mes tâches » transverse (ADR-0039 § 4 et § 8) : groupes en retard ·
// aujourd'hui · 7 jours · plus tard · sans date, tous projets non archivés.
//
// Le serveur rend les groupes (`MyTasksView`, calculés par `groupMyTasks`). Après
// un geste local (terminer une tâche), l'écran regroupe avec la MÊME fonction
// partagée, au même jour de Kinshasa (`asOf` du serveur) : l'écran et le serveur
// ne divergent pas.

import { groupMyTasks, type MyTaskItem, type MyTasksView } from '@lalanda/shared/work';

export type CleGroupe = 'overdue' | 'today' | 'next7Days' | 'later' | 'noDate';

export const GROUPES_MES_TACHES: readonly { cle: CleGroupe; titre: string; vide: string }[] = [
  { cle: 'overdue', titre: 'En retard', vide: 'Rien en retard.' },
  { cle: 'today', titre: 'Aujourd’hui', vide: 'Rien pour aujourd’hui.' },
  { cle: 'next7Days', titre: 'Dans les 7 jours', vide: 'Rien dans les 7 prochains jours.' },
  { cle: 'later', titre: 'Plus tard', vide: 'Rien de plus lointain.' },
  { cle: 'noDate', titre: 'Sans échéance', vide: 'Aucune tâche sans échéance.' },
];

/** Toutes les tâches de la vue, à plat. */
export function aPlat(v: MyTasksView): MyTaskItem[] {
  return [...v.overdue, ...v.today, ...v.next7Days, ...v.later, ...v.noDate];
}

export function totalMesTaches(v: MyTasksView): number {
  return aPlat(v).length;
}

/**
 * Regroupe après un geste local : les tâches terminées sortent, les autres
 * sont reclassées au jour `asOf` du serveur. `dueSoonDays` : réglage de
 * l'organisation (défaut 1).
 */
export function regrouper(
  v: MyTasksView,
  taches: readonly MyTaskItem[],
  dueSoonDays: number,
): MyTasksView {
  const g = groupMyTasks(taches, v.asOf, dueSoonDays);
  return { asOf: v.asOf, ...g };
}

/** Remplace une tâche (réponse du serveur) puis regroupe. */
export function appliquerTache(
  v: MyTasksView,
  tache: Omit<MyTaskItem, 'projectName'>,
  dueSoonDays: number,
): MyTasksView {
  const taches = aPlat(v).map((t) =>
    t.id === tache.id ? { ...tache, projectName: t.projectName } : t,
  );
  return regrouper(v, taches, dueSoonDays);
}
