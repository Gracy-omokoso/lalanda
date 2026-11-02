// Présences et pointage simple — ADR-0051 § 2.3, § 3.4 et § 10 (lot H16). Logique pure.
//
// Le pointage enregistre l'heure du serveur, rien d'autre (aucune position, photo ni
// appareil). Les minutes, les paires et les constats viennent du moteur
// (`attendanceDay`) par l'API : l'écran les met en forme, sans calcul d'heures
// supplémentaires ni de durée légale. Les constats sont des faits, jamais des sanctions.

import { ATTENDANCE_CLOCK_NOTICE } from '@lalanda/shared/hr';

import type { OrgAction } from '@/lib/api';
import type {
  AttendanceCorrectionView,
  AttendanceEventView,
  HrPresenceSettingsView,
} from '@/lib/api-rh-2';

import type { Moi } from './frais-model';

type Actions = readonly OrgAction[] | null;
const a = (x: Actions, action: OrgAction): boolean => x !== null && x.includes(action);

export const MENTION_POINTAGE = ATTENDANCE_CLOCK_NOTICE;

export const LIBELLES_CONSTAT_PRESENCE: Record<string, string> = {
  ATTENDANCE_UNPAIRED: 'Pointage sans arrivée ou sans départ correspondant',
  ATTENDANCE_ON_LEAVE_DAY: 'Pointage un jour d’absence accordée',
  ATTENDANCE_WITHOUT_SHIFT: 'Pointage sans créneau publié ce jour-là',
  SHIFT_WITHOUT_ATTENDANCE: 'Créneau publié passé sans pointage',
  ATTENDANCE_LATE_START: 'Arrivée après le début du créneau et la tolérance fixée',
  PROJECT_TIME_ABOVE_ATTENDANCE: 'Temps saisi sur les projets supérieur à la présence du jour',
};

export const libelleConstat = (code: string): string => LIBELLES_CONSTAT_PRESENCE[code] ?? code;

export const LIBELLES_SOURCE: Record<AttendanceEventView['source'], string> = {
  self: 'pointé par la personne',
  manager: 'saisi par le manager',
  hr: 'saisi par les ressources humaines',
  correction: 'issu d’une correction',
};

export interface AccesPresences {
  /** Pointage activé par l'organisation. */
  active: boolean;
  /** « J'arrive / Je pars » offert : activé, pointage par soi permis, `attendance.clock`. */
  pointer: boolean;
  /** Voir l'équipe ou le personnel : manager (relation) ou `hr.read`. */
  equipe: boolean;
  /** Saisir pour autrui et décider des corrections : manager ou `hr.manage`. */
  saisirPourAutrui: boolean;
}

export function accesPresences(
  s: Pick<HrPresenceSettingsView, 'attendance'> | null,
  x: Actions,
  estManager: boolean,
): AccesPresences {
  const active = s?.attendance.enabled === true;
  return {
    active,
    pointer: active && s!.attendance.selfClock && a(x, 'attendance.clock'),
    equipe: active && (estManager || a(x, 'hr.read')),
    saisirPourAutrui: active && (estManager || a(x, 'hr.manage')),
  };
}

/**
 * Pointage suggéré : « Je pars » après une arrivée encore ouverte, sinon « J'arrive ».
 * Les pointages annulés par une correction ne comptent pas. Une suggestion : deux
 * arrivées de suite restent possibles (le moteur les signale, l'API ne refuse pas).
 */
export function pointageSuggere(
  evenements: readonly Pick<AttendanceEventView, 'kind' | 'at' | 'voidedBy'>[],
): 'in' | 'out' {
  const valides = evenements.filter((e) => e.voidedBy === null);
  if (valides.length === 0) return 'in';
  const dernier = [...valides].sort((p, q) => p.at.localeCompare(q.at))[valides.length - 1]!;
  return dernier.kind === 'in' ? 'out' : 'in';
}

export const LIBELLES_STATUT_CORRECTION: Record<AttendanceCorrectionView['status'], string> = {
  pending: 'En attente',
  approved: 'Acceptée',
  rejected: 'Refusée',
};

/**
 * Pourquoi l'appelant ne peut pas décider de cette correction, ou `null` : le
 * bénéficiaire et l'auteur d'une correction saisie pour autrui ne décident pas.
 */
export function separationCorrection(
  c: Pick<AttendanceCorrectionView, 'employeeId' | 'requestedBy' | 'status'>,
  moi: Moi,
): string | null {
  if (c.status !== 'pending') return null;
  if (moi.employeeId !== null && c.employeeId === moi.employeeId) {
    return 'C’est votre propre correction : votre manager ou les ressources humaines en décident.';
  }
  if (moi.userId !== null && c.requestedBy === moi.userId) {
    return 'Vous avez saisi cette correction : une autre personne en décide.';
  }
  return null;
}
