// « Mes tâches » transverse (ADR-0039 § 4 et § 8) : groupes en retard ·
// aujourd'hui · 7 jours · plus tard · sans date, tous projets non archivés.
//
// Le serveur rend les groupes (`MyTasksView`, calculés par `groupMyTasks`). Après
// un geste local (terminer une tâche), l'écran regroupe avec la MÊME fonction
// partagée, au même jour de Kinshasa (`asOf` du serveur) : l'écran et le serveur
// ne divergent pas.
//
// ADR-0040 — C4 § 5 : la liste est MIXTE. Un élément `source: 'crm'` est une
// relance du CRM (activité assignée, à échéance) : il se coche par la route du
// CRM, s'ouvre sur l'opportunité, le compte ou le contact (`href`), et porte la
// pastille « Relance » (forme et libellé, pas seulement une couleur).

import type { CrmMyTaskItem } from '@lalanda/shared/crm';
import {
  groupMyTasks,
  type MyTaskEntry,
  type MyTaskItem,
  type MyTasksView,
  type WorkMyTaskItem,
} from '@lalanda/shared/work';

import type { OrgAction } from '@/lib/api';

export type CleGroupe = 'overdue' | 'today' | 'next7Days' | 'later' | 'noDate';

export const GROUPES_MES_TACHES: readonly { cle: CleGroupe; titre: string; vide: string }[] = [
  { cle: 'overdue', titre: 'En retard', vide: 'Rien en retard.' },
  { cle: 'today', titre: 'Aujourd’hui', vide: 'Rien pour aujourd’hui.' },
  { cle: 'next7Days', titre: 'Dans les 7 jours', vide: 'Rien dans les 7 prochains jours.' },
  { cle: 'later', titre: 'Plus tard', vide: 'Rien de plus lointain.' },
  { cle: 'noDate', titre: 'Sans échéance', vide: 'Aucune tâche sans échéance.' },
];

/** Pastille des relances du CRM (§ 8.2). */
export const PASTILLE_RELANCE = 'Relance';

/** Tous les éléments de la vue, à plat. */
export function aPlat(v: MyTasksView): MyTaskEntry[] {
  return [...v.overdue, ...v.today, ...v.next7Days, ...v.later, ...v.noDate];
}

export function totalMesTaches(v: MyTasksView): number {
  return aPlat(v).length;
}

export function estRelance(e: MyTaskEntry): e is CrmMyTaskItem {
  return e.source === 'crm';
}

export function estTache(e: MyTaskEntry): e is WorkMyTaskItem {
  return e.source === 'work';
}

/**
 * Regroupe après un geste local : les éléments terminés sortent, les autres
 * sont reclassés au jour `asOf` du serveur. `dueSoonDays` : réglage de
 * l'organisation (défaut 1), le même pour les deux sources.
 */
export function regrouper(
  v: MyTasksView,
  elements: readonly MyTaskEntry[],
  dueSoonDays: number,
): MyTasksView {
  const g = groupMyTasks(elements, v.asOf, dueSoonDays);
  return { asOf: v.asOf, ...g, truncated: v.truncated };
}

/** Remplace une tâche (réponse du serveur) puis regroupe. */
export function appliquerTache(
  v: MyTasksView,
  tache: Omit<MyTaskItem, 'projectName'>,
  dueSoonDays: number,
): MyTasksView {
  const elements = aPlat(v).map((t) =>
    estTache(t) && t.id === tache.id
      ? { ...tache, projectName: t.projectName, source: 'work' as const }
      : t,
  );
  return regrouper(v, elements, dueSoonDays);
}

/** Relance cochée (le CRM l'a marquée faite) : elle sort de la liste. */
export function retirerElement(v: MyTasksView, id: string, dueSoonDays: number): MyTasksView {
  return regrouper(
    v,
    aPlat(v).filter((e) => e.id !== id),
    dueSoonDays,
  );
}

/** Relance déplacée : nouveau jour, nouvel instant, nouvelle révision. */
export function appliquerRelance(
  v: MyTasksView,
  id: string,
  maj: { dueDate: string; dueAt: string; revision: number },
  dueSoonDays: number,
): MyTasksView {
  return regrouper(
    v,
    aPlat(v).map((e) => (estRelance(e) && e.id === id ? { ...e, ...maj, rank: maj.dueAt } : e)),
    dueSoonDays,
  );
}

/** Cocher une relance exige `crm.manage` (route du CRM, § 5.3). */
export function peutCocherRelance(actions: readonly OrgAction[] | null): boolean {
  return actions !== null && actions.includes('crm.manage');
}

/** Ligne secondaire d'une relance : le compte, sinon l'opportunité, sinon le contact. */
export function sousTitreRelance(e: CrmMyTaskItem): string {
  return e.accountName ?? e.opportunityTitle ?? e.contactName ?? 'Relance client';
}

const HEURE_MS = 3_600_000;

/**
 * Nouvel instant d'échéance d'une relance posée sur le jour `jour`
 * (`AAAA-MM-JJ`, Kinshasa) : l'HEURE de Kinshasa est conservée (§ 5.2).
 */
export function instantDeplace(dueAt: string, jour: string): string {
  const t = Date.parse(dueAt);
  if (!Number.isFinite(t) || !/^\d{4}-\d{2}-\d{2}$/.test(jour)) {
    throw new RangeError(`Déplacement invalide : ${dueAt} → ${jour}`);
  }
  const heure = new Date(t + HEURE_MS).toISOString().slice(11, 19);
  return new Date(`${jour}T${heure}+01:00`).toISOString();
}
