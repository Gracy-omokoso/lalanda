// Types de réponse du module « work » (ADR-0039 § 3). Contrat de forme entre
// l'API et le web : aucune logique ici.
//
// Conventions : identifiants en chaînes hexadécimales ; dates civiles
// `AAAA-MM-JJ` (jour de Kinshasa) ; horodatages ISO 8601 UTC ; montants en
// CHAÎNES décimales, jamais en `number` (docs/26). Les montants sont produits
// par le moteur (`packages/engine/src/work/`) : le web les affiche sans calcul.

import type { CrmMyTaskItem } from '../crm/agenda.js';
// ADR-0044 — P3 : approbations d'achat dans « Mes tâches » (§ 6.5).
import type { PurchasesMyTaskItem } from '../purchases/agenda.js';
import type {
  WorkActivityKind,
  WorkColumn,
  WorkColumnCategory,
  WorkDependencyType,
  WorkInvoiceLinkOrigin,
  WorkLabel,
  WorkPriority,
  WorkProjectKind,
  WorkProjectStatus,
  WorkProjectVisibility,
  WorkRateCurrency,
  WorkSuggestionCode,
  WorkWarningCode,
} from './constants.js';

/** Avertissement non bloquant rendu avec une écriture réussie. */
export interface WorkWarning {
  code: WorkWarningCode;
  taskId: string;
  predecessorId: string;
}

/** Suggestion rendue avec une écriture réussie (jalon terminé → facture). */
export interface WorkSuggestion {
  code: WorkSuggestionCode;
  taskId: string;
}

/** Page d'une liste paginée par curseur (`null` : dernière page). */
export interface WorkPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** Membre cité dans une réponse : identifiant et nom courant. */
export interface WorkMemberRef {
  userId: string;
  name: string;
}

// ── Réglages ────────────────────────────────────────────────────────────────

export interface WorkSettingsView {
  labels: WorkLabel[];
  defaultColumns: WorkColumn[];
  dueSoonDays: number;
  /** 0 tant que l'organisation n'a rien enregistré (défaut implicite). */
  revision: number;
  updatedAt: string | null;
}

// ── Projets ─────────────────────────────────────────────────────────────────

export interface WorkProjectLinksView {
  customerId: string | null;
  customerName: string | null;
  opportunityId: string | null;
  opportunityTitle: string | null;
  quotes: { quoteId: string; number: string | null }[];
}

export type WorkProjectSource =
  | null
  | {
      kind: 'quote';
      quoteId: string;
      quoteVersion: number;
      createdAt: string;
    }
  // ADR-0040 — C7 § 6.4 : projet créé depuis une opportunité gagnée, sans devis.
  | { kind: 'opportunity'; opportunityId: string; createdAt: string };

export interface WorkProjectView {
  id: string;
  name: string;
  description: string | null;
  kind: WorkProjectKind;
  status: WorkProjectStatus;
  owner: WorkMemberRef | null;
  startDate: string | null;
  dueDate: string | null;
  links: WorkProjectLinksView;
  source: WorkProjectSource;
  columns: WorkColumn[];
  visibility: WorkProjectVisibility;
  archivedAt: string | null;
  completedAt: string | null;
  revision: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Ligne de la liste des projets, avec ses compteurs (§ 4). */
export interface WorkProjectSummary {
  id: string;
  name: string;
  kind: WorkProjectKind;
  status: WorkProjectStatus;
  owner: WorkMemberRef | null;
  customerName: string | null;
  startDate: string | null;
  dueDate: string | null;
  openTaskCount: number;
  overdueTaskCount: number;
  doneTaskCount: number;
  nextMilestone: { taskId: string; title: string; dueDate: string } | null;
  updatedAt: string;
}

// ── Tâches ──────────────────────────────────────────────────────────────────

export interface WorkDependencyView {
  taskId: string;
  type: WorkDependencyType;
}

export type WorkTaskSource = null | { kind: 'quote_line'; quoteId: string; lineIndex: number };

export type WorkTaskBilling = null | { invoiceId: string; preparedAt: string; preparedBy: string };

/**
 * Tâche en projection allégée (sans `description`) : listes, Kanban, Gantt,
 * calendrier. `blocked` est calculé à la lecture (`isBlocked`), jamais stocké.
 */
export interface WorkTaskView {
  id: string;
  projectId: string;
  number: number;
  parentTaskId: string | null;
  title: string;
  columnKey: string;
  columnCategory: WorkColumnCategory;
  done: boolean;
  completedAt: string | null;
  rank: string;
  assignee: WorkMemberRef | null;
  priority: WorkPriority;
  labelKeys: string[];
  startDate: string | null;
  dueDate: string | null;
  isMilestone: boolean;
  blockedBy: WorkDependencyView[];
  blocked: boolean;
  loggedMinutes: number;
  estimateMinutes: number | null;
  subtaskCount: number;
  doneSubtaskCount: number;
  revision: number;
  updatedAt: string;
}

/** Détail d'une tâche (`GET /work/tasks/:taskId`). */
export interface WorkTaskDetail extends WorkTaskView {
  description: string | null;
  completedBy: string | null;
  followers: WorkMemberRef[];
  subtasks: WorkTaskView[];
  /** Prédécesseurs avec leur état (titre, terminé). */
  predecessors: { taskId: string; number: number; title: string; done: boolean }[];
  /** Tâches qui attendent celle-ci. */
  successors: { taskId: string; number: number; title: string; done: boolean }[];
  commentCount: number;
  attachmentCount: number;
  source: WorkTaskSource;
  billing: WorkTaskBilling;
  createdBy: string;
  createdAt: string;
}

/** Réponse d'une écriture de tâche : la tâche, ses avertissements, ses suggestions. */
export interface WorkTaskWriteResult {
  task: WorkTaskView;
  warnings: WorkWarning[];
  suggestions: WorkSuggestion[];
}

/** Tâche de « Mes tâches », avec le nom de son projet. */
export interface MyTaskItem extends WorkTaskView {
  projectName: string;
}

/** Tâche du module `work` dans « Mes tâches » (ADR-0040 — C4 § 5.2). */
export type WorkMyTaskItem = MyTaskItem & { source: 'work' };

export type { CrmMyTaskItem, PurchasesMyTaskItem };

/**
 * Élément de « Mes tâches » : une tâche, ou une relance du CRM agrégée à la
 * lecture (ADR-0040 — C4 § 5.2), ou une approbation d'achat (ADR-0044 § 6.5, sans
 * case à cocher). `source` dit quel module la possède, donc quelle route la coche.
 */
export type MyTaskEntry = WorkMyTaskItem | CrmMyTaskItem | PurchasesMyTaskItem;

/** `GET /work/my-tasks` — groupes calculés par `groupMyTasks`. */
export interface MyTasksView {
  /** Jour de Kinshasa utilisé pour le regroupement (`AAAA-MM-JJ`). */
  asOf: string;
  overdue: MyTaskEntry[];
  today: MyTaskEntry[];
  next7Days: MyTaskEntry[];
  later: MyTaskEntry[];
  noDate: MyTaskEntry[];
  /** Les deux sources, avec le même `dueSoonDays` de l'organisation. */
  dueSoonCount: number;
  /** Vrai si une source a dépassé sa borne de lecture (500 par source). */
  truncated: boolean;
}

// ── Commentaires et pièces jointes ──────────────────────────────────────────

export interface WorkAttachmentView {
  id: string;
  taskId: string;
  commentId: string | null;
  fileName: string;
  contentType: 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';
  size: number;
  sha256: string;
  uploadedBy: WorkMemberRef;
  createdAt: string;
}

export interface WorkCommentView {
  id: string;
  taskId: string;
  author: WorkMemberRef;
  /** Texte brut ; vide si le commentaire est supprimé. Mentions : `@[userId]`. */
  body: string;
  mentions: WorkMemberRef[];
  attachments: WorkAttachmentView[];
  editedAt: string | null;
  deletedAt: string | null;
  revision: number;
  createdAt: string;
}

// ── Temps ───────────────────────────────────────────────────────────────────

/** Saisie de temps : minutes seulement, jamais de coût (§ 2.6). */
export interface TimeEntryView {
  id: string;
  projectId: string;
  taskId: string;
  taskNumber: number;
  taskTitle: string;
  user: WorkMemberRef;
  workedOn: string;
  minutes: number;
  note: string | null;
  revision: number;
  createdBy: string;
  createdAt: string;
}

/** `GET /work/projects/:projectId/time-summary` — minutes seulement. */
export interface TimeSummaryView {
  projectId: string;
  totalMinutes: number;
  byMember: { user: WorkMemberRef; minutes: number }[];
  byTask: { taskId: string; number: number; title: string; minutes: number }[];
  /** Semaine ISO commençant le lundi `weekStart` (AAAA-MM-JJ). */
  byWeek: { weekStart: string; minutes: number }[];
}

/** Coût horaire d'un membre (donnée salariale : `treasury.manage`). */
export interface WorkMemberRateView {
  id: string;
  user: WorkMemberRef;
  currency: WorkRateCurrency;
  /** Chaîne décimale, deux décimales. */
  hourlyCost: string;
  effectiveFrom: string;
  createdBy: string;
  createdAt: string;
}

// ── Branchements ────────────────────────────────────────────────────────────

export interface WorkInvoiceLinkView {
  invoiceId: string;
  number: string | null;
  status: string;
  currency: WorkRateCurrency;
  milestoneTaskId: string | null;
  origin: WorkInvoiceLinkOrigin;
  linkedAt: string;
  linkedBy: string;
}

/** Constats codés de la marge (§ 5). */
export const PROJECT_MARGIN_FINDINGS = [
  'MULTI_CURRENCY',
  'TIME_WITHOUT_RATE',
  'NO_INVOICE_LINKED',
  'DRAFT_INVOICES_IGNORED',
  'AMOUNTS_INCLUDE_TAX',
] as const;
export type ProjectMarginFinding = (typeof PROJECT_MARGIN_FINDINGS)[number];

/** Marge d'une devise : quatre composantes et le résultat, en chaînes décimales. */
export interface ProjectMarginCurrencyView {
  currency: WorkRateCurrency;
  received: string;
  refunded: string;
  expenses: string;
  timeCost: string;
  margin: string;
  /** Facturé HT des factures liées, pour information, jamais soustrait. */
  invoicedExclTax: string;
  invoiceCount: number;
  expenseCount: number;
  timeMinutes: number;
}

/**
 * `GET /work/projects/:projectId/margin` — calculée par le moteur
 * (`computeProjectMargin`), recalculée à chaque lecture, jamais écrite.
 */
export interface ProjectMarginView {
  projectId: string;
  /** Version du calcul (`WORK_MARGIN_VERSION`). */
  version: string;
  from: string | null;
  to: string | null;
  currencies: ProjectMarginCurrencyView[];
  findings: { code: ProjectMarginFinding; minutes?: number; count?: number }[];
  minutesWithoutRate: number;
  /** Rendu seulement si l'appelant détient `treasury.manage` ; sinon `null`. */
  byMember:
    | null
    | {
        user: WorkMemberRef;
        currency: WorkRateCurrency;
        minutes: number;
        cost: string;
      }[];
}

// ── Historique ──────────────────────────────────────────────────────────────

export interface WorkActivityView {
  id: string;
  projectId: string;
  taskId: string | null;
  actor: WorkMemberRef;
  kind: WorkActivityKind;
  /** Petit différentiel `{ from, to }`, sans texte de commentaire. */
  data: Record<string, unknown>;
  at: string;
}
