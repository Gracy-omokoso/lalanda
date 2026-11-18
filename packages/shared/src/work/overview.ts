// Aperçu d'un projet (ADR-0057) — `GET /work/projects/:projectId/overview`.
//
// Contrat ET calcul pur : le serveur charge les tâches et les commentaires, puis
// appelle `computeWorkProjectOverview` ; l'écran ne fait que mettre en forme.
// Aucun montant : des nombres de tâches seulement.
//
// Périmètre des chiffres : les tâches de PREMIER NIVEAU (une sous-tâche se lit
// dans le panneau de son parent), comme la progression de l'en-tête et du
// Kanban. Les compteurs de commentaires, eux, couvrent toutes les tâches.
//
// Règle du statut du projet (« santé »), au jour de Kinshasa — LA règle unique,
// reprise par l'accueil des projets (`portfolio.ts`, ADR-0058) :
// - « En retard » (`off_track`) : l'échéance du projet est dépassée alors que
//   des tâches restent ouvertes, OU au moins 3 tâches ouvertes sont en retard
//   et elles font au moins le quart des tâches ouvertes ;
// - « À risque » (`at_risk`) : au moins une tâche ouverte est en retard, OU
//   l'échéance du projet tombe dans les 7 jours et moins de 75 % des tâches
//   sont terminées ;
// - « En bonne voie » (`on_track`) sinon (y compris un projet sans tâche).
// Un projet terminé (`completed`) est toujours « En bonne voie » : son statut
// propre est affiché à côté.

import type { WorkMemberRef } from './views.js';
// ADR-0080 : heures facultatives et fuseau de l'organisation.
import { WORK_DEFAULT_TIME_ZONE, isPastDue, orgClock, type OrgClock } from './time.js';

export type WorkOverviewHealth = 'on_track' | 'at_risk' | 'off_track';

export type WorkOverviewHealthReason =
  'PROJECT_DUE_PASSED' | 'MANY_OVERDUE_TASKS' | 'OVERDUE_TASKS' | 'PROJECT_DUE_SOON';

export interface WorkOverviewTaskRef {
  taskId: string;
  number: number;
  title: string;
  dueDate: string;
  /** ADR-0080 : heure d'échéance facultative. */
  dueTime?: string | null;
  done: boolean;
  assignee: WorkMemberRef | null;
}

export interface WorkOverviewWeek {
  /** Lundi de la semaine (`AAAA-MM-JJ`, Kinshasa). */
  weekStart: string;
  /** Tâches terminées cumulées à la fin de la semaine (encore terminées aujourd'hui). */
  done: number;
  /** Tâches créées cumulées à la fin de la semaine (périmètre total). */
  total: number;
}

export interface WorkProjectOverview {
  projectId: string;
  /** Jour de Kinshasa du calcul. */
  today: string;
  health: {
    status: WorkOverviewHealth;
    reasons: WorkOverviewHealthReason[];
  };
  totals: {
    open: number;
    done: number;
    overdue: number;
    /** Tâches ouvertes sans responsable. */
    unassigned: number;
    milestones: number;
  };
  /** Tâches ouvertes par responsable (les plus chargés d'abord ; `null` = sans responsable). */
  openByAssignee: { assignee: WorkMemberRef | null; open: number; overdue: number }[];
  /** Courbe d'avancement : les 8 dernières semaines, la courante comprise. */
  weeks: WorkOverviewWeek[];
  /** Jalons ouverts à venir (échéance ≥ aujourd'hui), les 5 plus proches. */
  upcomingMilestones: WorkOverviewTaskRef[];
  /** Tâches ouvertes en retard, les 10 plus anciennes échéances. */
  overdueTasks: WorkOverviewTaskRef[];
  /** Commentaires non supprimés par tâche (toutes les tâches du projet). */
  commentCounts: Record<string, number>;
}

/** Forme minimale d'une tâche pour le calcul. */
export interface WorkOverviewTaskInput {
  id: string;
  number: number;
  title: string;
  parentTaskId: string | null;
  done: boolean;
  completedAt: Date | null;
  createdAt: Date;
  dueDate: string | null;
  /** ADR-0080 : heure d'échéance facultative. */
  dueTime?: string | null;
  isMilestone: boolean;
  assignee: WorkMemberRef | null;
}

export const WORK_OVERVIEW_WEEKS = 8;
export const WORK_OVERVIEW_DUE_SOON_DAYS = 7;

const DAY_MS = 86_400_000;

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Lundi de la semaine d'un jour civil. */
export function mondayOf(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = dimanche
  return addDays(day, -((dow + 6) % 7));
}

function ref(t: WorkOverviewTaskInput): WorkOverviewTaskRef {
  return {
    taskId: t.id,
    number: t.number,
    title: t.title,
    dueDate: t.dueDate!,
    dueTime: t.dueTime ?? null,
    done: t.done,
    assignee: t.assignee,
  };
}

export function overviewHealth(input: {
  status: string;
  projectDueDate: string | null;
  today: string;
  open: number;
  done: number;
  overdue: number;
  /** ADR-0080 : heure d'échéance du projet et heure courante (fuseau de l'organisation). */
  projectDueTime?: string | null;
  nowTime?: string;
}): { status: WorkOverviewHealth; reasons: WorkOverviewHealthReason[] } {
  const { open, done, overdue, today, projectDueDate } = input;
  if (input.status === 'completed') return { status: 'on_track', reasons: [] };
  const off: WorkOverviewHealthReason[] = [];
  const duePassed =
    projectDueDate !== null &&
    (projectDueDate < today ||
      (input.nowTime !== undefined &&
        isPastDue(
          { dueDate: projectDueDate, dueTime: input.projectDueTime ?? null },
          { today, time: input.nowTime },
        )));
  if (duePassed && open > 0) off.push('PROJECT_DUE_PASSED');
  if (overdue >= 3 && overdue * 4 >= open) off.push('MANY_OVERDUE_TASKS');
  if (off.length > 0) return { status: 'off_track', reasons: off };
  const risk: WorkOverviewHealthReason[] = [];
  if (overdue > 0) risk.push('OVERDUE_TASKS');
  const total = open + done;
  if (
    projectDueDate !== null &&
    !duePassed &&
    projectDueDate >= today &&
    projectDueDate <= addDays(today, WORK_OVERVIEW_DUE_SOON_DAYS) &&
    total > 0 &&
    done * 4 < total * 3
  ) {
    risk.push('PROJECT_DUE_SOON');
  }
  return risk.length > 0
    ? { status: 'at_risk', reasons: risk }
    : { status: 'on_track', reasons: [] };
}

export function computeWorkProjectOverview(input: {
  projectId: string;
  status: string;
  projectDueDate: string | null;
  tasks: readonly WorkOverviewTaskInput[];
  /** `taskId` de chaque commentaire non supprimé. */
  commentTaskIds: readonly string[];
  now: Date;
  /** ADR-0080 : fuseau de l'organisation (absent : Kinshasa) et heure d'échéance du projet. */
  timeZone?: string;
  projectDueTime?: string | null;
}): WorkProjectOverview {
  const tz = input.timeZone ?? WORK_DEFAULT_TIME_ZONE;
  const clock: OrgClock = orgClock(input.now, tz);
  const today = clock.today;
  const dayOf = (d: Date): string => orgClock(d, tz).today;
  const late = (t: WorkOverviewTaskInput): boolean => isPastDue(t, clock);
  const top = input.tasks.filter((t) => t.parentTaskId === null);
  const open = top.filter((t) => !t.done);
  const done = top.length - open.length;
  const overdueTasks = open
    .filter(late)
    .sort((a, b) =>
      a.dueDate! < b.dueDate!
        ? -1
        : a.dueDate! > b.dueDate!
          ? 1
          : (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') || a.number - b.number,
    );

  const parResponsable = new Map<
    string,
    { assignee: WorkMemberRef | null; open: number; overdue: number }
  >();
  for (const t of open) {
    const k = t.assignee?.userId ?? '';
    const e = parResponsable.get(k) ?? { assignee: t.assignee, open: 0, overdue: 0 };
    e.open += 1;
    if (late(t)) e.overdue += 1;
    parResponsable.set(k, e);
  }
  const openByAssignee = [...parResponsable.values()].sort(
    (a, b) =>
      b.open - a.open ||
      (a.assignee === null ? 1 : 0) - (b.assignee === null ? 1 : 0) ||
      (a.assignee?.name ?? '').localeCompare(b.assignee?.name ?? '', 'fr'),
  );

  // Jour de chaque création et achèvement, calculé une seule fois (Intl est coûteux).
  const createdDays = top.map((t) => dayOf(t.createdAt));
  const completedDays = top.map((t) =>
    t.done && t.completedAt !== null ? dayOf(t.completedAt) : null,
  );
  const lundi = mondayOf(today);
  const weeks: WorkOverviewWeek[] = [];
  for (let i = WORK_OVERVIEW_WEEKS - 1; i >= 0; i -= 1) {
    const weekStart = addDays(lundi, -7 * i);
    const fin = addDays(weekStart, 6);
    weeks.push({
      weekStart,
      done: completedDays.filter((d) => d !== null && d <= fin).length,
      total: createdDays.filter((d) => d <= fin).length,
    });
  }

  const upcomingMilestones = top
    .filter((t) => t.isMilestone && !t.done && t.dueDate !== null && !late(t))
    .sort((a, b) =>
      a.dueDate! < b.dueDate!
        ? -1
        : a.dueDate! > b.dueDate!
          ? 1
          : (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99'),
    )
    .slice(0, 5)
    .map(ref);

  const commentCounts: Record<string, number> = {};
  for (const id of input.commentTaskIds) commentCounts[id] = (commentCounts[id] ?? 0) + 1;

  return {
    projectId: input.projectId,
    today,
    health: overviewHealth({
      status: input.status,
      projectDueDate: input.projectDueDate,
      projectDueTime: input.projectDueTime ?? null,
      nowTime: clock.time,
      today,
      open: open.length,
      done,
      overdue: overdueTasks.length,
    }),
    totals: {
      open: open.length,
      done,
      overdue: overdueTasks.length,
      unassigned: open.filter((t) => t.assignee === null).length,
      milestones: top.filter((t) => t.isMilestone).length,
    },
    openByAssignee,
    weeks,
    upcomingMilestones,
    overdueTasks: overdueTasks.slice(0, 10).map(ref),
    commentCounts,
  };
}
