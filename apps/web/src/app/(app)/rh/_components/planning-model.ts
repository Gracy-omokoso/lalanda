// Plannings — ADR-0051 § 2.4, § 3.6 et § 10 (lot H16). Logique pure.
//
// Une grille de créneaux saisie par le manager ou les ressources humaines, publiée.
// Les constats (chevauchement, créneau pendant une absence, seuil indicatif,
// sous-effectif) viennent du moteur : ce sont des signaux, jamais des refus ni des
// règles légales. Aucune affectation automatique.

import type { OrgAction } from '@/lib/api';
import type { ShiftFindingView, ShiftView, StaffingGapView } from '@/lib/api-rh-2';

type Actions = readonly OrgAction[] | null;

export const LIBELLES_CONSTAT_PLANNING: Record<string, string> = {
  SHIFT_OVERLAP: 'Deux créneaux de la même personne se chevauchent',
  SHIFT_DURING_LEAVE: 'Créneau pendant une absence accordée',
  SHIFT_ABOVE_INDICATIVE_LIMIT: 'Semaine au-delà du seuil indicatif saisi par l’organisation',
  UNDERSTAFFED_SLOT: 'Effectif planifié sous le minimum saisi',
};

export const libelleConstatPlanning = (code: string): string =>
  LIBELLES_CONSTAT_PLANNING[code] ?? code;

export const LIBELLES_STATUT_CRENEAU: Record<ShiftView['status'], string> = {
  draft: 'Brouillon',
  published: 'Publié',
  cancelled: 'Annulé',
};

/** Le planificateur : manager (son équipe, relation) ou `hr.manage`. */
export const peutPlanifier = (x: Actions, estManager: boolean): boolean =>
  estManager || (x !== null && x.includes('hr.manage'));

/** Portée de lecture par défaut : l'organisation pour `hr.read`, l'équipe pour un manager. */
export function porteeParDefaut(x: Actions, estManager: boolean): 'me' | 'team' | 'organization' {
  if (x !== null && x.includes('hr.read')) return 'organization';
  return estManager ? 'team' : 'me';
}

export interface LigneGrille {
  employeeId: string;
  nom: string;
  /** Créneaux non annulés, par jour de la semaine (même ordre que `jours`). */
  jours: ShiftView[][];
}

/** Grille de la semaine : une ligne par personne (ordre alphabétique), une colonne par jour. */
export function grille(creneaux: readonly ShiftView[], jours: readonly string[]): LigneGrille[] {
  const parPersonne = new Map<string, LigneGrille>();
  for (const c of creneaux) {
    if (c.status === 'cancelled') continue;
    const i = jours.indexOf(c.date);
    if (i < 0) continue;
    let ligne = parPersonne.get(c.employeeId);
    if (!ligne) {
      ligne = { employeeId: c.employeeId, nom: c.employeeName, jours: jours.map(() => []) };
      parPersonne.set(c.employeeId, ligne);
    }
    ligne.jours[i]!.push(c);
  }
  for (const ligne of parPersonne.values()) {
    for (const j of ligne.jours) j.sort((p, q) => p.start.localeCompare(q.start));
  }
  return [...parPersonne.values()].sort((p, q) => p.nom.localeCompare(q.nom, 'fr'));
}

/** Brouillons que l'appelant peut publier. */
export const brouillonsPublies = (creneaux: readonly ShiftView[]): string[] =>
  creneaux.filter((c) => c.status === 'draft' && c.canPlan).map((c) => c.id);

/** « 08:00 – 16:00 », « 22:00 – 06:00 (lendemain) ». */
export const horaire = (c: Pick<ShiftView, 'start' | 'end' | 'crossesMidnight'>): string =>
  `${c.start} – ${c.end}${c.crossesMidnight ? ' (lendemain)' : ''}`;

/** Les constats d'un créneau donné. */
export const constatsDe = (id: string, constats: readonly ShiftFindingView[]): string[] =>
  constats.filter((f) => f.shiftIds.includes(id)).map((f) => libelleConstatPlanning(f.code));

/** Phrase d'un sous-effectif : des nombres seulement, jamais un nom (§ 8). */
export function phraseSousEffectif(g: StaffingGapView): string {
  const ou = g.label ?? g.location ?? 'Besoin minimal';
  return `${ou} · ${g.start}–${g.end} : ${g.available} disponible${g.available > 1 ? 's' : ''} sur ${g.minStaff} demandé${g.minStaff > 1 ? 's' : ''} (${g.planned} planifié${g.planned > 1 ? 's' : ''}).`;
}
