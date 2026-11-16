// Projets synchronisés — ADR-0077.
//
//   § 1 : contrat signé → projet (`POST /work/projects/from-contract`), lien lu des deux
//         côtés (`GET /work/contracts/:id/project`, `GET /work/projects/:id/contract`) ;
//   § 4 : validation hebdomadaire des feuilles de temps (soumission, approbation, renvoi,
//         réouverture) et élément « Mes tâches » du validateur.
//
// Contrats zod partagés par l'API et le web. Aucun montant ici : le contrat fait foi.

import { z } from 'zod';

import { CreateProjectFromQuoteBody, WorkId, WorkDay } from './schemas.js';
import { isCalendarDay } from './scheduling.js';
import type { WorkMemberRef, WorkProjectView } from './views.js';

// ── § 1 Contrat → projet ────────────────────────────────────────────────────

/**
 * `POST /work/projects/from-contract`. `lineIndexes` désigne les lignes du contrat
 * (défaut : toutes) ; `scheduleMilestones` (défaut vrai) : un jalon par échéance d'un
 * échéancier. Ignorés quand un projet existant (devis, opportunité) est relié.
 */
export const CreateProjectFromContractBody = z
  .object({
    contractId: WorkId,
    name: CreateProjectFromQuoteBody.shape.name,
    lineIndexes: CreateProjectFromQuoteBody.shape.lineIndexes,
    scheduleMilestones: z.boolean().optional(),
  })
  .strict();
export type CreateProjectFromContractBody = z.output<typeof CreateProjectFromContractBody>;

/** `created` : projet neuf ; `linked` : projet du devis ou de l'opportunité relié. */
export type WorkContractProjectOutcome = 'created' | 'linked';

export interface WorkProjectFromContractView {
  project: WorkProjectView;
  outcome: WorkContractProjectOutcome;
}

/** Facturation déclarée par le contrat (ADR-0050 § 2.3), sans montant. */
export type WorkContractBillingKind = 'none' | 'schedule' | 'recurring';

/** Bloc « Contrat » d'un projet (`GET /work/projects/:id/contract`), sans montant. */
export interface WorkProjectContractView {
  contractId: string;
  number: string;
  title: string;
  /** Statut STOCKÉ (`signed`, `terminated`…). */
  status: string;
  customerName: string;
  startDate: string;
  initialTermMonths: number | null;
  billingKind: WorkContractBillingKind;
  /** Nombre d'échéances d'un échéancier (0 sinon). */
  scheduleItemCount: number;
}

// ── § 4 Feuilles de temps : validation hebdomadaire ─────────────────────────

/** Statut d'une semaine ; `open` = aucune ligne (en cours de saisie). */
export const TIMESHEET_WEEK_STATUSES = [
  'open',
  'submitted',
  'approved',
  'returned',
  'reopened',
] as const;
export type TimesheetWeekStatus = (typeof TIMESHEET_WEEK_STATUSES)[number];

export const TIMESHEET_STATUS_LABELS: Readonly<Record<TimesheetWeekStatus, string>> = Object.freeze(
  {
    open: 'En cours',
    submitted: 'Soumise',
    approved: 'Validée',
    returned: 'Renvoyée',
    reopened: 'Rouverte',
  },
);

export const TIMESHEET_ACTIONS = ['submitted', 'approved', 'returned', 'reopened'] as const;
export type TimesheetAction = (typeof TIMESHEET_ACTIONS)[number];

/** Longueur maximale d'un motif de renvoi ou de réouverture. */
export const TIMESHEET_REASON_MAX = 500;

/** Lundi `AAAA-MM-JJ`. */
export function isMondayDay(day: string): boolean {
  if (!isCalendarDay(day)) return false;
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1;
}

const Monday = WorkDay.refine(isMondayDay, {
  message: 'Semaine attendue : le lundi, au format AAAA-MM-JJ.',
  params: { code: 'WORK_TIMESHEET_WEEK' },
});

const expectedRevision = z
  .number()
  .int()
  .min(0, { message: 'Révision attendue : 0 pour une semaine encore en cours.' });

const reason = z
  .string()
  .trim()
  .min(1, { message: 'Motif obligatoire.' })
  .max(TIMESHEET_REASON_MAX, { message: `${TIMESHEET_REASON_MAX} caractères au plus.` });

/** `POST /work/timesheets/submit` — le membre soumet SA semaine. Révision 0 : semaine en cours. */
export const SubmitTimesheetBody = z.object({ week: Monday, expectedRevision }).strict();
export type SubmitTimesheetBody = z.output<typeof SubmitTimesheetBody>;

/** `POST /work/timesheets/approve`. */
export const DecideTimesheetBody = z
  .object({ userId: WorkId, week: Monday, expectedRevision: expectedRevision.min(1) })
  .strict();
export type DecideTimesheetBody = z.output<typeof DecideTimesheetBody>;

/** `POST /work/timesheets/return` et `/reopen` : motif obligatoire. */
export const DecideTimesheetWithReasonBody = DecideTimesheetBody.extend({ reason }).strict();
export type DecideTimesheetWithReasonBody = z.output<typeof DecideTimesheetWithReasonBody>;

export interface TimesheetHistoryEntryView {
  action: TimesheetAction;
  at: string;
  by: WorkMemberRef;
  reason: string | null;
}

/** État de validation d'une semaine, rendu dans `WeeklyTimesheetView.approval`. */
export interface TimesheetApprovalView {
  status: TimesheetWeekStatus;
  /** 0 tant que la semaine est en cours (aucune ligne). */
  revision: number;
  submittedAt: string | null;
  decidedAt: string | null;
  decidedBy: WorkMemberRef | null;
  /** Minutes au moment de l'approbation (information). */
  approvedMinutes: number | null;
  /** Motif du dernier renvoi ou de la dernière réouverture. */
  reason: string | null;
  /** Saisies verrouillées (semaine validée). */
  locked: boolean;
  /** L'appelant est le membre et la semaine peut être soumise. */
  canSubmit: boolean;
  /** L'appelant peut approuver ou renvoyer (validateur, semaine soumise). */
  canDecide: boolean;
  /** L'appelant peut rouvrir (validateur, semaine validée). */
  canReopen: boolean;
  history: TimesheetHistoryEntryView[];
}

/** Semaine soumise que l'appelant peut valider (`GET /work/timesheets/pending`). */
export interface PendingTimesheetView {
  user: WorkMemberRef;
  week: string;
  totalMinutes: number;
  submittedAt: string;
  revision: number;
}

export const WORK_TIMESHEET_APPROVAL_KIND_LABEL = 'Feuille de temps à valider';

/** Élément de « Mes tâches » : une semaine à valider, sans case à cocher (ADR-0077 § 4.6). */
export interface WorkTimesheetMyTaskItem {
  source: 'work_timesheet';
  kind: 'timesheet_approval';
  /** `work:timesheet:<userId>:<week>`. */
  id: string;
  userId: string;
  userName: string;
  week: string;
  totalMinutes: number;
  /** Dimanche de la semaine : échéance naturelle de la décision. */
  dueDate: string;
  priority: 'none';
  /** Rang dans un même jour : l'instant de soumission. */
  rank: string;
  done: false;
  kindLabel: typeof WORK_TIMESHEET_APPROVAL_KIND_LABEL;
  href: string;
}

/** Lien de la feuille d'un membre pour une semaine. */
export function timesheetHref(userId: string, week: string): string {
  return `/projets/mes-taches/temps?membre=${userId}&semaine=${week}`;
}
