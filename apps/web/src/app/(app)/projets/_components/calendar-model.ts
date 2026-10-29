// Logique pure du Calendrier (ADR-0039 § 8, lot L3b) : périodes (mois,
// semaine), grille des semaines, placement des tâches (échéance seule, ou
// étendue de la date de début à l'échéance), vue agenda du téléphone, et
// déplacement d'une échéance (glisser-déposer ET menu clavier).
//
// Dates civiles `AAAA-MM-JJ` au jour de Kinshasa (ADR-0027), sans jamais passer
// par le fuseau du navigateur : toute l'arithmétique est en UTC sur des jours
// entiers (`addDays` partagé). « Aujourd'hui » est fourni par l'appelant.
// Semaine : du lundi au dimanche (usage en RDC et en France).

import { addDays, isCalendarDay, type PatchWorkTaskBody } from '@lalanda/shared/work';

import { formatJour } from './projets-model';

// ─── Jours ──────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

function utc(day: string): number {
  if (!isCalendarDay(day)) throw new RangeError(`Date invalide : ${day}`);
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
}

/** Nombre de jours de `a` à `b` (négatif si `b` précède `a`). */
export function ecartJours(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / MS_PER_DAY);
}

/** Rang du jour dans la semaine : 0 = lundi … 6 = dimanche. */
export function jourSemaine(day: string): number {
  return (new Date(utc(day)).getUTCDay() + 6) % 7;
}

/** Lundi de la semaine qui contient `day`. */
export function lundiDe(day: string): string {
  return addDays(day, -jourSemaine(day));
}

/** Premier jour du mois qui contient `day`. */
export function premierDuMois(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/** Dernier jour du mois qui contient `day`. */
export function dernierDuMois(day: string): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${day.slice(0, 7)}-${String(n).padStart(2, '0')}`;
}

export const JOURS_COURTS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'] as const;
export const JOURS_LONGS = [
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
  'dimanche',
] as const;
const MOIS_LONGS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const;

/** « novembre 2026 ». */
export function libelleMois(day: string): string {
  return `${MOIS_LONGS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
}

/** « mardi 3 nov. 2026 » — libellé complet d'un jour (lecteurs d'écran, agenda). */
export function libelleJour(day: string, avecAnnee = true): string {
  return `${JOURS_LONGS[jourSemaine(day)]} ${formatJour(day, avecAnnee)}`;
}

// ─── Périodes ───────────────────────────────────────────────────────────────

export type VueCalendrier = 'mois' | 'semaine';

export interface Periode {
  vue: VueCalendrier;
  /** Premier et dernier jour AFFICHÉS (semaines complètes, du lundi au dimanche). */
  debut: string;
  fin: string;
  /** Semaines affichées, chacune de 7 jours. */
  semaines: string[][];
  /** Mois de référence (`AAAA-MM`) : les jours hors de ce mois sont estompés. */
  mois: string;
  titre: string;
}

/** Période affichée autour d'un jour d'ancrage. */
export function periode(vue: VueCalendrier, ancre: string): Periode {
  const debut = vue === 'mois' ? lundiDe(premierDuMois(ancre)) : lundiDe(ancre);
  const finBrute = vue === 'mois' ? dernierDuMois(ancre) : debut;
  const fin = addDays(lundiDe(finBrute), 6);
  const semaines: string[][] = [];
  for (let lundi = debut; lundi <= fin; lundi = addDays(lundi, 7)) {
    semaines.push(Array.from({ length: 7 }, (_, i) => addDays(lundi, i)));
  }
  const titre =
    vue === 'mois'
      ? libelleMois(ancre)
      : `Semaine du ${formatJour(debut, debut.slice(0, 4) !== fin.slice(0, 4))} au ${formatJour(fin)}`;
  return { vue, debut, fin, semaines, mois: ancre.slice(0, 7), titre };
}

/** Ancre de la période précédente (`-1`) ou suivante (`+1`). */
export function decaler(vue: VueCalendrier, ancre: string, sens: -1 | 1): string {
  if (vue === 'semaine') return addDays(ancre, 7 * sens);
  const y = Number(ancre.slice(0, 4));
  const m = Number(ancre.slice(5, 7)) - 1 + sens;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 10);
}

// ─── Placement ──────────────────────────────────────────────────────────────

/** Ce que le calendrier lit d'une tâche. */
export interface TacheCalendrier {
  id: string;
  startDate: string | null;
  dueDate: string | null;
  isMilestone: boolean;
  done: boolean;
  rank: string;
}

/** Intervalle affiché d'une tâche, ou `null` si elle n'a pas d'échéance. */
export function etendue(t: TacheCalendrier): { debut: string; fin: string } | null {
  if (t.dueDate === null) return null;
  if (t.isMilestone || t.startDate === null || t.startDate > t.dueDate) {
    return { debut: t.dueDate, fin: t.dueDate };
  }
  return { debut: t.startDate, fin: t.dueDate };
}

/** Morceau d'une tâche dans une semaine de la grille. */
export interface Segment {
  taskId: string;
  /** Colonnes 0 (lundi) à 6 (dimanche), bornes incluses. */
  colDebut: number;
  colFin: number;
  /** Ligne d'empilement dans la semaine (0 = la plus haute). */
  ligne: number;
  /** La tâche commence avant cette semaine / finit après (bord coupé). */
  continueAvant: boolean;
  continueApres: boolean;
  /** Ce morceau porte l'échéance (dernier jour de la tâche). */
  porteEcheance: boolean;
  forme: 'tache' | 'jalon';
}

export interface SemainePlacee {
  jours: string[];
  /** Morceaux visibles (ligne < `lignesMax`). */
  segments: Segment[];
  /** Nombre de lignes occupées par les morceaux visibles. */
  lignes: number;
  /** Par colonne : nombre de tâches masquées faute de place (« +N »). */
  masquees: number[];
}

function comparerPlacement(
  a: { debut: string; fin: string; t: TacheCalendrier },
  b: { debut: string; fin: string; t: TacheCalendrier },
): number {
  if (a.debut !== b.debut) return a.debut < b.debut ? -1 : 1;
  // Les plus longues d'abord : elles forment des bandes continues en haut.
  if (a.fin !== b.fin) return a.fin > b.fin ? -1 : 1;
  if (a.t.isMilestone !== b.t.isMilestone) return a.t.isMilestone ? -1 : 1;
  if (a.t.rank !== b.t.rank) return a.t.rank < b.t.rank ? -1 : 1;
  return a.t.id < b.t.id ? -1 : a.t.id > b.t.id ? 1 : 0;
}

/**
 * Place les tâches à échéance dans les semaines d'une période : une tâche avec
 * une date de début s'étend du début à l'échéance (un morceau par semaine
 * traversée) ; sans date de début, ou jalon, elle occupe le jour de son
 * échéance. Empilement glouton par semaine ; au-delà de `lignesMax` lignes, les
 * tâches sont comptées par jour (« +N »), jamais perdues.
 */
export function placerSemaines(
  tasks: readonly TacheCalendrier[],
  semaines: readonly string[][],
  lignesMax = Number.POSITIVE_INFINITY,
): SemainePlacee[] {
  const datees = tasks
    .map((t) => {
      const e = etendue(t);
      return e === null ? null : { ...e, t };
    })
    .filter((x): x is { debut: string; fin: string; t: TacheCalendrier } => x !== null)
    .sort(comparerPlacement);

  return semaines.map((jours) => {
    const lundi = jours[0]!;
    const dimanche = jours[jours.length - 1]!;
    const occupees: boolean[][] = [];
    const segments: Segment[] = [];
    const masquees = jours.map(() => 0);
    let lignes = 0;
    for (const x of datees) {
      if (x.fin < lundi || x.debut > dimanche) continue;
      const colDebut = x.debut < lundi ? 0 : ecartJours(lundi, x.debut);
      const colFin = x.fin > dimanche ? jours.length - 1 : ecartJours(lundi, x.fin);
      let ligne = 0;
      for (;;) {
        const l = (occupees[ligne] ??= jours.map(() => false));
        let libre = true;
        for (let c = colDebut; c <= colFin; c += 1) if (l[c]) libre = false;
        if (libre) break;
        ligne += 1;
      }
      if (ligne >= lignesMax) {
        for (let c = colDebut; c <= colFin; c += 1) masquees[c]! += 1;
        continue;
      }
      for (let c = colDebut; c <= colFin; c += 1) occupees[ligne]![c] = true;
      lignes = Math.max(lignes, ligne + 1);
      segments.push({
        taskId: x.t.id,
        colDebut,
        colFin,
        ligne,
        continueAvant: x.debut < lundi,
        continueApres: x.fin > dimanche,
        porteEcheance: x.fin <= dimanche,
        forme: x.t.isMilestone ? 'jalon' : 'tache',
      });
    }
    return { jours, segments, lignes, masquees };
  });
}

/** Tâches sans échéance (non posées sur le calendrier). */
export function sansEcheance<T extends TacheCalendrier>(tasks: readonly T[]): T[] {
  return tasks.filter((t) => t.dueDate === null);
}

// ─── Agenda (téléphone) ─────────────────────────────────────────────────────

export interface JourAgenda<T> {
  jour: string;
  taches: T[];
}

/**
 * Vue agenda : une liste par jour, chaque tâche rangée au jour de son
 * ÉCHÉANCE (la date de début est écrite dans la ligne). Seuls les jours de
 * [debut, fin] qui portent au moins une échéance sont rendus. Dans un jour :
 * jalons d'abord, puis tâches non terminées, puis rang.
 */
export function agenda<T extends TacheCalendrier>(
  tasks: readonly T[],
  debut: string,
  fin: string,
): JourAgenda<T>[] {
  const parJour = new Map<string, T[]>();
  for (const t of tasks) {
    if (t.dueDate === null || t.dueDate < debut || t.dueDate > fin) continue;
    const l = parJour.get(t.dueDate) ?? [];
    l.push(t);
    parJour.set(t.dueDate, l);
  }
  return [...parJour.keys()].sort().map((jour) => ({
    jour,
    taches: parJour.get(jour)!.sort((a, b) => {
      if (a.isMilestone !== b.isMilestone) return a.isMilestone ? -1 : 1;
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    }),
  }));
}

// ─── Déplacer une échéance ──────────────────────────────────────────────────

export interface TacheDeplacable extends TacheCalendrier {
  revision: number;
}

/**
 * Corps du `PATCH /work/tasks/:id` qui pose l'échéance au jour `cible`. Une
 * tâche avec une date de début glisse EN BLOC (même durée) : l'échéance ne
 * passe jamais avant le début (`WORK_DATES_INVERTED`). Un jalon ne reçoit
 * jamais de date de début. `null` : rien à changer (même jour, pas d'échéance).
 */
export function corpsDeplacement(
  t: TacheDeplacable,
  cible: string,
): (PatchWorkTaskBody & { expectedRevision: number }) | null {
  if (t.dueDate === null || !isCalendarDay(cible) || cible === t.dueDate) return null;
  const corps: PatchWorkTaskBody & { expectedRevision: number } = {
    dueDate: cible,
    expectedRevision: t.revision,
  };
  if (!t.isMilestone && t.startDate !== null) {
    corps.startDate = addDays(t.startDate, ecartJours(t.dueDate, cible));
  }
  return corps;
}

/** Copie locale de la tâche après le déplacement (affichage optimiste). */
export function appliquerCorps<T extends TacheCalendrier>(
  t: T,
  corps: { startDate?: string | null; dueDate?: string | null },
): T {
  return {
    ...t,
    ...(corps.startDate !== undefined ? { startDate: corps.startDate } : {}),
    ...(corps.dueDate !== undefined ? { dueDate: corps.dueDate } : {}),
  };
}

export interface OptionEcheance {
  id: string;
  label: string;
  jour: string;
}

/**
 * Menu « Déplacer l'échéance… » (équivalent clavier et tactile du
 * glisser-déposer) : veille, lendemain, semaine précédente, suivante, et
 * aujourd'hui si aucune autre option n'y mène déjà.
 */
export function optionsEcheance(t: TacheCalendrier, today: string): OptionEcheance[] {
  if (t.dueDate === null) return [];
  const d = t.dueDate;
  const out: OptionEcheance[] = [
    { id: 'j-1', label: `La veille (${formatJour(addDays(d, -1), false)})`, jour: addDays(d, -1) },
    { id: 'j+1', label: `Le lendemain (${formatJour(addDays(d, 1), false)})`, jour: addDays(d, 1) },
    {
      id: 'j-7',
      label: `Une semaine plus tôt (${formatJour(addDays(d, -7), false)})`,
      jour: addDays(d, -7),
    },
    {
      id: 'j+7',
      label: `Une semaine plus tard (${formatJour(addDays(d, 7), false)})`,
      jour: addDays(d, 7),
    },
  ];
  if (today !== d && !out.some((o) => o.jour === today))
    out.push({ id: 'auj', label: `Aujourd’hui (${formatJour(today, false)})`, jour: today });
  return out;
}

/**
 * Décalage au clavier sur une tâche du calendrier : ← → un jour, ↑ ↓ une
 * semaine. `null` pour toute autre touche.
 */
export function decalageClavier(key: string): number | null {
  switch (key) {
    case 'ArrowLeft':
      return -1;
    case 'ArrowRight':
      return 1;
    case 'ArrowUp':
      return -7;
    case 'ArrowDown':
      return 7;
    default:
      return null;
  }
}

/** « du 3 au 7 nov. » / « 7 nov. » — étendue lisible d'une tâche. */
export function libelleEtendue(t: TacheCalendrier): string {
  const e = etendue(t);
  if (e === null) return 'Sans échéance';
  if (e.debut === e.fin) return formatJour(e.fin, false);
  return `du ${formatJour(e.debut, false)} au ${formatJour(e.fin, false)}`;
}
