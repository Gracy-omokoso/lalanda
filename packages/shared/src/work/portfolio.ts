// Accueil des projets (portefeuille) — ADR-0058.
//
// Contrat de `GET /work/portfolio` et règles PURES (sans horloge ni base)
// partagées par l'API (calcul) et le web (tests, libellés) : santé d'un projet,
// début de semaine de Kinshasa, pastille de couleur. Aucun calcul financier ici.

import { z } from 'zod';

import { WORK_AT_RISK_OVERDUE_TASKS, WORK_LABEL_COLORS, type WorkLabelColor } from './constants.js';
import type { WorkProjectKind, WorkProjectStatus } from './constants.js';
import { addDays, isCalendarDay } from './scheduling.js';
import type { WorkMemberRef } from './views.js';

/** Filtres de l'accueil : mes projets, tous les projets non archivés, archivés. */
export const WORK_PORTFOLIO_SCOPES = ['mine', 'all', 'archived'] as const;
export type WorkPortfolioScope = (typeof WORK_PORTFOLIO_SCOPES)[number];

export const WorkPortfolioQuery = z
  .object({ scope: z.enum(WORK_PORTFOLIO_SCOPES).default('all') })
  .strict();
export type WorkPortfolioQuery = z.output<typeof WorkPortfolioQuery>;

/** Nombre de projets rendus au plus (borne technique des projets non archivés). */
export const WORK_PORTFOLIO_MAX = 500;
/** Avatars rendus au plus par projet ; `memberCount` donne le total. */
export const WORK_PORTFOLIO_AVATARS = 5;

/**
 * Santé d'un projet (ADR-0058 § 2) :
 * - `late` — En retard : l'échéance du projet est passée et des tâches restent ouvertes ;
 * - `at_risk` — À risque : un jalon en retard, ou au moins `WORK_AT_RISK_OVERDUE_TASKS`
 *   tâches en retard (seuil S7 d'ADR-0039 § 6.5, le même que le brief du matin) ;
 * - `on_track` — En bonne voie : sinon ;
 * - `closed` — projet terminé ou archivé : la santé ne s'applique plus.
 */
export type WorkProjectHealth = 'on_track' | 'at_risk' | 'late' | 'closed';

export interface ProjectHealthInput {
  status: WorkProjectStatus;
  dueDate: string | null;
  openTaskCount: number;
  overdueTaskCount: number;
  overdueMilestoneCount: number;
}

export function projectHealth(p: ProjectHealthInput, today: string): WorkProjectHealth {
  if (!isCalendarDay(today)) throw new RangeError(`Date invalide : ${today}`);
  if (p.status === 'completed' || p.status === 'archived') return 'closed';
  if (p.dueDate !== null && p.dueDate < today && p.openTaskCount > 0) return 'late';
  if (p.overdueMilestoneCount > 0 || p.overdueTaskCount >= WORK_AT_RISK_OVERDUE_TASKS) {
    return 'at_risk';
  }
  return 'on_track';
}

/** Pourcentage de tâches terminées, entier arrondi vers le bas (0 sans tâche). */
export function progressPercent(done: number, total: number): number {
  if (total <= 0 || done <= 0) return 0;
  return Math.min(100, Math.floor((done * 100) / total));
}

/** Lundi (jour de Kinshasa) de la semaine ISO qui contient `day`. */
export function kinshasaWeekStart(day: string): string {
  if (!isCalendarDay(day)) throw new RangeError(`Date invalide : ${day}`);
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = dimanche
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

/** Instant UTC du début d'un jour de Kinshasa (UTC+1, sans heure d'été). */
export function kinshasaDayStartInstant(day: string): Date {
  if (!isCalendarDay(day)) throw new RangeError(`Date invalide : ${day}`);
  return new Date(`${day}T00:00:00+01:00`);
}

/** Pastille d'un projet : couleur stable tirée de son identifiant (palette fermée, sans gris). */
export function projectColor(projectId: string): WorkLabelColor {
  const palette = WORK_LABEL_COLORS.filter((c) => c !== 'gray');
  let h = 0;
  for (let i = 0; i < projectId.length; i += 1) h = (h * 31 + projectId.charCodeAt(i)) >>> 0;
  return palette[h % palette.length]!;
}

export interface WorkPortfolioProject {
  id: string;
  name: string;
  kind: WorkProjectKind;
  status: WorkProjectStatus;
  color: WorkLabelColor;
  health: WorkProjectHealth;
  customerName: string | null;
  owner: WorkMemberRef | null;
  dueDate: string | null;
  totalTaskCount: number;
  doneTaskCount: number;
  overdueTaskCount: number;
  overdueMilestoneCount: number;
  progressPercent: number;
  /** Responsable du projet puis assignés de ses tâches, au plus `WORK_PORTFOLIO_AVATARS`. */
  members: WorkMemberRef[];
  memberCount: number;
  /** Vrai si l'appelant est responsable, assigné ou abonné d'une tâche du projet. */
  mine: boolean;
  updatedAt: string;
}

export interface WorkPortfolioStats {
  /** Projets au statut « actif ». */
  activeProjects: number;
  /** Tâches ouvertes à échéance passée, projets non archivés. */
  overdueTasks: number;
  /** Tâches terminées depuis lundi 00 h (Kinshasa), projets non archivés. */
  completedThisWeek: number;
  /** Lundi de la semaine en cours (`AAAA-MM-JJ`). */
  weekStart: string;
}

/** `GET /work/portfolio`. Les chiffres portent sur l'organisation, quel que soit le filtre. */
export interface WorkPortfolioView {
  asOf: string;
  scope: WorkPortfolioScope;
  stats: WorkPortfolioStats;
  items: WorkPortfolioProject[];
  truncated: boolean;
}

/** Fin de la semaine (dimanche) qui commence le lundi `weekStart`. */
export function weekEnd(weekStart: string): string {
  return addDays(weekStart, 6);
}
