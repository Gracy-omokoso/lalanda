// Constantes du module « work » — projets et tâches du RUN (ADR-0039 § 2 et § 3).
//
// Libellé d'interface ↔ code : « Projet » = `WorkProject`, « Tâche » = `WorkTask`
// (docs/GLOSSAIRE.md). À ne pas confondre avec `project.*`, le plan financier
// BUILD, affiché « Initiative » (ADR-0038).
//
// Ce fichier ne contient que des unions fermées et des bornes : aucune règle
// financière. Les bornes sont TECHNIQUES (ADR-0039 § 9), pas des droits d'offre.

/** Nature d'un projet (ADR-0039 § 2.2). */
export const WORK_PROJECT_KINDS = ['client', 'internal'] as const;
export type WorkProjectKind = (typeof WORK_PROJECT_KINDS)[number];

/** Statut d'un projet. Seul `archived` masque le projet des listes par défaut. */
export const WORK_PROJECT_STATUSES = ['active', 'on_hold', 'completed', 'archived'] as const;
export type WorkProjectStatus = (typeof WORK_PROJECT_STATUSES)[number];

/**
 * Statuts qu'un `PUT /work/projects/:id` peut poser. `archived` passe par
 * `POST …/archive` et `…/restore` (ADR-0039 § 4), jamais par la mise à jour.
 */
export const WORK_PROJECT_EDITABLE_STATUSES = ['active', 'on_hold', 'completed'] as const;
export type WorkProjectEditableStatus = (typeof WORK_PROJECT_EDITABLE_STATUSES)[number];

/** Visibilité réservée (ADR-0039 O7) : une seule valeur en R1. */
export const WORK_PROJECT_VISIBILITIES = ['organization'] as const;
export type WorkProjectVisibility = (typeof WORK_PROJECT_VISIBILITIES)[number];

/** Catégorie d'une colonne du Kanban (ADR-0039 § 2.2). */
export const WORK_COLUMN_CATEGORIES = ['todo', 'in_progress', 'done'] as const;
export type WorkColumnCategory = (typeof WORK_COLUMN_CATEGORIES)[number];

/** Priorité d'une tâche, de la plus basse à la plus haute. */
export const WORK_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;
export type WorkPriority = (typeof WORK_PRIORITIES)[number];

/** Types de dépendance. R1 : fin → début seulement. */
export const WORK_DEPENDENCY_TYPES = ['finish_to_start'] as const;
export type WorkDependencyType = (typeof WORK_DEPENDENCY_TYPES)[number];

/**
 * Couleurs d'étiquette : clés d'une palette FERMÉE, jamais un code couleur libre
 * (ADR-0039 § 2.1). Les valeurs visuelles (contrastes clair et sombre) sont celles
 * du design system (`packages/ui`) ; ce fichier ne fixe que les clés.
 */
export const WORK_LABEL_COLORS = [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
] as const;
export type WorkLabelColor = (typeof WORK_LABEL_COLORS)[number];

/** Origine d'une facture liée à un projet (ADR-0039 § 2.9). */
export const WORK_INVOICE_LINK_ORIGINS = ['milestone', 'manual'] as const;
export type WorkInvoiceLinkOrigin = (typeof WORK_INVOICE_LINK_ORIGINS)[number];

/** Devises d'un coût horaire (ADR-0039 § 2.7) — aucune conversion (ADR-0031). */
export const WORK_RATE_CURRENCIES = ['CDF', 'USD'] as const;
export type WorkRateCurrency = (typeof WORK_RATE_CURRENCIES)[number];

/** Types de l'historique d'activité (ADR-0039 § 2.8). */
export const WORK_ACTIVITY_KINDS = [
  'project.created',
  'project.updated',
  'project.archived',
  'project.restored',
  'project.completed',
  'task.created',
  'task.updated',
  'task.moved',
  'task.assigned',
  'task.unassigned',
  'task.due_changed',
  'task.completed',
  'task.reopened',
  'task.deleted',
  'dependency.added',
  'dependency.removed',
  'comment.added',
  'comment.edited',
  'comment.deleted',
  'attachment.added',
  'attachment.removed',
  'time.logged',
  'time.updated',
  'time.deleted',
  'invoice.linked',
  'invoice.unlinked',
  'invoice.prepared',
] as const;
export type WorkActivityKind = (typeof WORK_ACTIVITY_KINDS)[number];

/** Colonne d'un projet : clé stable, libellé, catégorie. */
export interface WorkColumn {
  key: string;
  label: string;
  category: WorkColumnCategory;
}

/** Étiquette déclarée dans les réglages de l'organisation. */
export interface WorkLabel {
  key: string;
  label: string;
  color: WorkLabelColor;
}

/** Colonnes proposées par défaut à la création d'un projet (ADR-0039 § 2.1). */
export const DEFAULT_WORK_COLUMNS: readonly WorkColumn[] = [
  { key: 'todo', label: 'À faire', category: 'todo' },
  { key: 'doing', label: 'En cours', category: 'in_progress' },
  { key: 'review', label: 'En revue', category: 'in_progress' },
  { key: 'done', label: 'Terminé', category: 'done' },
];

/** Clé stable d'une colonne ou d'une étiquette. */
export const WORK_KEY_PATTERN = /^[a-z0-9_-]{1,32}$/;

/** Bornes des champs et des volumes (ADR-0039 § 2). */
export const WORK_LIMITS = {
  projectNameMax: 120,
  projectDescriptionMax: 5_000,
  quoteIdsMax: 10,
  columnsMin: 2,
  columnsMax: 12,
  columnLabelMax: 40,
  labelsMax: 50,
  labelLabelMax: 40,
  labelKeysPerTaskMax: 10,
  dueSoonDaysMin: 0,
  dueSoonDaysMax: 14,
  dueSoonDaysDefault: 1,
  taskTitleMax: 300,
  taskDescriptionMax: 10_000,
  subtasksMax: 100,
  followersMax: 20,
  dependenciesMax: 20,
  estimateMinutesMax: 100_000,
  commentBodyMax: 5_000,
  mentionsMax: 20,
  commentAttachmentsMax: 10,
  attachmentFileNameMax: 200,
  imageMaxBytes: 2 * 1024 * 1024,
  pdfMaxBytes: 10 * 1024 * 1024,
  attachmentsPerHourPerUser: 30,
  storagePerOrganizationBytes: 1024 * 1024 * 1024,
  timeEntryMinutesMin: 1,
  minutesPerDayMax: 1_440,
  timeEntryNoteMax: 500,
  activityDataMaxBytes: 2_048,
  /** Projets non archivés par organisation (`WORK_PROJECT_LIMIT`). */
  activeProjectsPerOrganization: 500,
  /** Tâches par projet (`WORK_TASK_LIMIT`). */
  tasksPerProject: 5_000,
  /** Lignes de devis retenues à la création d'un projet depuis un devis. */
  quoteLineIndexesMax: 200,
  milestoneTitleMax: 300,
} as const;

/** Taille de page par défaut et maximale des listes paginées par curseur. */
export const WORK_PAGE_LIMIT_DEFAULT = 50;
export const WORK_PAGE_LIMIT_MAX = 100;

/** Seuil « projet à risque » (ADR-0039 § 6.5, S7 — paramètre produit à valider). */
export const WORK_AT_RISK_OVERDUE_TASKS = 3;

/**
 * Codes d'erreur métier du module (ADR-0039 § 2 et § 4). Les erreurs de forme
 * gardent les codes génériques des contrôleurs (`FIELD_REQUIRED`, `INVALID_TYPE`,
 * `UNKNOWN_FIELD`, `INVALID_VALUE`).
 */
export const WORK_ERROR_CODES = [
  // Validation des corps (400)
  'WORK_DATES_INVERTED',
  'WORK_KEY_INVALID',
  'WORK_COLUMNS_INVALID',
  'WORK_COLUMN_KEY_DUPLICATE',
  'WORK_LABEL_KEY_DUPLICATE',
  'WORK_MILESTONE_NEEDS_DATE',
  'WORK_MILESTONE_HAS_START',
  'WORK_ID_INVALID',
  'WORK_ID_DUPLICATE',
  'DATE_INVALID',
  'TEXT_TOO_LONG',
  'DECIMAL_MUST_BE_STRING',
  'AMOUNT_INVALID',
  'AMOUNT_TOO_PRECISE',
  'AMOUNT_NOT_POSITIVE',
  'WORK_MENTION_NOT_ELIGIBLE',
  'WORK_ASSIGNEE_NOT_ELIGIBLE',
  'WORK_SUBTASK_DEPTH',
  'WORK_TIME_IN_FUTURE',
  'WORK_TIME_DAY_OVERFLOW',
  // Conflits (409)
  'STALE_REVISION',
  'WORK_LABEL_IN_USE',
  'WORK_COLUMN_IN_USE',
  'WORK_COLUMN_CATEGORY_CHANGED',
  'WORK_PROJECT_EXISTS_FOR_QUOTE',
  'WORK_PROJECT_LIMIT',
  'WORK_TASK_LIMIT',
  'WORK_PROJECT_ARCHIVED',
  'WORK_PROJECT_NOT_EMPTY',
  'WORK_DEPENDENCY_CYCLE',
  'WORK_TASK_HAS_TIME',
  'WORK_TASK_HAS_INVOICE',
  'WORK_QUOTE_NOT_ACCEPTED',
  'WORK_MILESTONE_ALREADY_INVOICED',
  'WORK_STORAGE_FULL',
  // Autres
  'WORK_TIME_FOR_OTHER',
  'WORK_ATTACHMENT_TYPE',
  'EXPENSE_WORK_PROJECT_UNKNOWN',
] as const;
export type WorkErrorCode = (typeof WORK_ERROR_CODES)[number];

/** Codes d'avertissement non bloquants rendus avec une écriture réussie. */
export const WORK_WARNING_CODES = ['WORK_DEPENDENCY_DATE_CONFLICT'] as const;
export type WorkWarningCode = (typeof WORK_WARNING_CODES)[number];

/** Suggestions rendues avec une écriture réussie (ADR-0039 § 6.3). */
export const WORK_SUGGESTION_CODES = ['PREPARE_INVOICE'] as const;
export type WorkSuggestionCode = (typeof WORK_SUGGESTION_CODES)[number];
