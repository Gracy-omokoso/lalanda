// Documents RH, listes d'entrée et de sortie, échéances — corps de requête, requêtes
// et vues (ADR-0045 § 2.8, § 2.9, § 3.3, § 6.4). ADR-0045 — H4.
//
// Ici, la FORME seulement : l'appartenance à l'organisation (collaborateur, modèle,
// compte assigné), les droits relationnels (soi, manager, `hr.sensitive.read`), le
// chiffrement des pièces sensibles et la taille des fichiers sont vérifiés par l'API.
// AUCUNE règle légale : les modèles proposés à l'activation n'ont aucune portée
// juridique ; aucun délai de conservation n'est posé (décision ouverte n° 14).

import { z } from 'zod';

import {
  HrCalendarDay,
  HrExpectedRevision,
  HrId,
  hrBooleanParam,
  hrFr,
  hrIssue,
  hrOptionalText,
  hrRequiredText,
} from './common.js';
import {
  HR_CHECKLIST_ASSIGNEE_ROLES,
  HR_CHECKLIST_KINDS,
  HR_DOCUMENT_CATEGORIES,
  HR_EMPLOYEE_VISIBLE_DOCUMENT_CATEGORIES,
  HR_LIMITS,
  HR_SENSITIVE_DOCUMENT_CATEGORIES,
  type HrChecklistAssigneeRole,
  type HrChecklistKind,
  type HrDocumentCategory,
  type HrIdDocumentKind,
} from './constants.js';

const L = HR_LIMITS;

// ── Documents (§ 2.8) ───────────────────────────────────────────────────────

/** Types de contenu acceptés (déduits du CONTENU, jamais du nom ni de l'en-tête). */
export const HR_DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;
export type HrDocumentContentType = (typeof HR_DOCUMENT_CONTENT_TYPES)[number];

/** Vrai si la catégorie impose `sensitive` (pièce d'identité, médical, justificatif). */
export function isSensitiveHrDocumentCategory(category: HrDocumentCategory): boolean {
  return HR_SENSITIVE_DOCUMENT_CATEGORIES.includes(category);
}

/** `visibleToEmployee` par défaut : vrai pour contrat, avenant, accueil. */
export function defaultVisibleToEmployee(category: HrDocumentCategory): boolean {
  return HR_EMPLOYEE_VISIBLE_DOCUMENT_CATEGORIES.includes(category);
}

/**
 * `POST /hr/employees/:id/documents?…` — le corps est le fichier BINAIRE (motif des
 * pièces des achats) ; les métadonnées passent en paramètres de requête, le nom du
 * fichier en `X-File-Name`. `sensitive` est IMPOSÉ vrai pour les catégories sensibles
 * (`false` y est refusé), libre (défaut faux) pour les autres.
 */
export const UploadHrDocumentQuery = z
  .object({
    category: z.enum(HR_DOCUMENT_CATEGORIES, hrFr('Catégorie de document inconnue.')),
    label: hrRequiredText(L.documentLabel, 'Libellé'),
    issuedOn: HrCalendarDay.optional(),
    expiresOn: HrCalendarDay.optional(),
    sensitive: hrBooleanParam.optional(),
    visibleToEmployee: hrBooleanParam.optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (q.sensitive === false && isSensitiveHrDocumentCategory(q.category)) {
      hrIssue(
        ctx,
        'HR_DOCUMENT_SENSITIVE_REQUIRED',
        'Une pièce d’identité, un document médical ou un justificatif est toujours sensible.',
        ['sensitive'],
      );
    }
    if (q.issuedOn && q.expiresOn && q.expiresOn < q.issuedOn) {
      hrIssue(ctx, 'DATE_BEFORE_ISSUE', 'La date d’expiration précède la date de délivrance.', [
        'expiresOn',
      ]);
    }
  })
  .transform((q) => ({
    category: q.category,
    label: q.label,
    issuedOn: q.issuedOn ?? null,
    expiresOn: q.expiresOn ?? null,
    sensitive: isSensitiveHrDocumentCategory(q.category) ? true : (q.sensitive ?? false),
    visibleToEmployee: q.visibleToEmployee ?? defaultVisibleToEmployee(q.category),
  }));
export type UploadHrDocumentQuery = z.output<typeof UploadHrDocumentQuery>;

/** `GET /hr/employees/:id/documents?category=` */
export const ListHrDocumentsQuery = z
  .object({
    category: z.enum(HR_DOCUMENT_CATEGORIES, hrFr('Catégorie de document inconnue.')).optional(),
  })
  .strict();
export type ListHrDocumentsQuery = z.output<typeof ListHrDocumentsQuery>;

/** Document RH, sans contenu. */
export interface HrDocumentView {
  id: string;
  employeeId: string;
  category: HrDocumentCategory;
  label: string;
  sensitive: boolean;
  /** Chiffré côté application (pièces sensibles) ; sinon, chiffrement du stockage. */
  encrypted: boolean;
  visibleToEmployee: boolean;
  issuedOn: string | null;
  expiresOn: string | null;
  fileName: string;
  contentType: HrDocumentContentType;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
}

export interface HrDocumentPage {
  items: HrDocumentView[];
}

// ── Listes d'entrée et de sortie (§ 2.9) ────────────────────────────────────

/** Libellé de la nature d'une liste (« Mes tâches », notifications). */
export const HR_CHECKLIST_KIND_LABELS: Readonly<Record<HrChecklistKind, string>> = Object.freeze({
  onboarding: 'Liste d’accueil',
  offboarding: 'Liste de départ',
});

/** Assigné d'un élément de modèle : un rôle symbolique, ou une personne nommée. */
export type HrChecklistAssignee = HrChecklistAssigneeRole | { userId: string };

const ITEM_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;

const ChecklistAssigneeSchema = z.union([
  z.enum(HR_CHECKLIST_ASSIGNEE_ROLES, hrFr('Assigné attendu : hr, manager ou employee.')),
  z.object({ userId: z.string(hrFr('Compte attendu.')).min(1).max(64) }).strict(),
]);

export const ChecklistTemplateItemSchema = z
  .object({
    /** Identifiant stable de l'élément ; tiré au hasard si absent. */
    id: z
      .string(hrFr('Identifiant attendu.'))
      .refine((v) => ITEM_ID.test(v), {
        message: 'Identifiant : minuscules, chiffres, tirets, 40 caractères au plus.',
        params: { code: 'CHECKLIST_ITEM_ID_INVALID' },
      })
      .optional(),
    label: hrRequiredText(L.checklistItemLabel, 'Libellé'),
    assignee: ChecklistAssigneeSchema,
    offsetDays: z
      .number(hrFr('Décalage attendu : un entier de jours.'))
      .int({ message: 'Décalage attendu : un entier de jours.' })
      .min(-L.checklistOffsetDaysMax)
      .max(L.checklistOffsetDaysMax),
    note: hrOptionalText(L.checklistItemNote).optional(),
  })
  .strict();
export type ChecklistTemplateItemInput = z.output<typeof ChecklistTemplateItemSchema>;

const ChecklistItemsSchema = z
  .array(ChecklistTemplateItemSchema)
  .min(L.checklistItemsMin, { message: 'Au moins un élément.' })
  .max(L.checklistItemsMax, { message: `${L.checklistItemsMax} éléments au plus.` })
  .superRefine((items, ctx) => {
    const ids = items.map((i) => i.id).filter((id): id is string => id !== undefined);
    if (new Set(ids).size !== ids.length) {
      hrIssue(ctx, 'CHECKLIST_ITEM_ID_DUPLICATE', 'Deux éléments portent le même identifiant.');
    }
  });

/** `POST /hr/checklist-templates` — `hr.manage`. */
export const CreateChecklistTemplateBody = z
  .object({
    kind: z.enum(HR_CHECKLIST_KINDS, hrFr('Nature attendue : onboarding ou offboarding.')),
    label: hrRequiredText(L.checklistTemplateLabel, 'Libellé'),
    items: ChecklistItemsSchema,
  })
  .strict();
export type CreateChecklistTemplateBody = z.output<typeof CreateChecklistTemplateBody>;

/** `PUT /hr/checklist-templates/:id` — `hr.manage`. La nature ne change pas. */
export const UpdateChecklistTemplateBody = z
  .object({
    expectedRevision: HrExpectedRevision,
    label: hrRequiredText(L.checklistTemplateLabel, 'Libellé').optional(),
    items: ChecklistItemsSchema.optional(),
  })
  .strict();
export type UpdateChecklistTemplateBody = z.output<typeof UpdateChecklistTemplateBody>;

/**
 * `POST /hr/employees/:id/checklists` — `hr.manage`. `hrAssigneeUserId` : le
 * détenteur de `hr.manage` qui reçoit les éléments `hr` (défaut : l'auteur).
 */
export const InstantiateChecklistBody = z
  .object({
    templateId: HrId,
    hrAssigneeUserId: z.string(hrFr('Compte attendu.')).min(1).max(64).optional(),
  })
  .strict();
export type InstantiateChecklistBody = z.output<typeof InstantiateChecklistBody>;

/** `GET /hr/checklists?employeeId=&open=` — `hr.read`. */
export const ListChecklistsQuery = z
  .object({
    employeeId: HrId.optional(),
    open: hrBooleanParam.optional(),
  })
  .strict();
export type ListChecklistsQuery = z.output<typeof ListChecklistsQuery>;

export interface ChecklistTemplateItemView {
  id: string;
  label: string;
  assignee: HrChecklistAssignee;
  offsetDays: number;
  note: string | null;
}

export interface ChecklistTemplateView {
  id: string;
  kind: HrChecklistKind;
  label: string;
  items: ChecklistTemplateItemView[];
  /** Modèle proposé à l'activation (libellés sans portée légale). */
  isDefault: boolean;
  revision: number;
  updatedAt: string;
}

export interface ChecklistTemplatePage {
  items: ChecklistTemplateView[];
}

export interface ChecklistItemView {
  id: string;
  label: string;
  note: string | null;
  assigneeUserId: string;
  dueDate: string;
  doneAt: string | null;
  doneBy: string | null;
}

export interface ChecklistView {
  id: string;
  employeeId: string;
  employeeName: string;
  kind: HrChecklistKind;
  kindLabel: string;
  templateId: string;
  label: string;
  /** Date d'entrée ou de sortie à l'instanciation : échéance = pivot + décalage. */
  pivotDate: string;
  items: ChecklistItemView[];
  done: number;
  total: number;
  revision: number;
  createdBy: string;
  createdAt: string;
}

export interface ChecklistPage {
  items: ChecklistView[];
}

/** Élément de liste de l'appelant (`GET /hr/me`, lot H4). */
export interface HrMyChecklistItemView {
  checklistId: string;
  itemId: string;
  kind: HrChecklistKind;
  label: string;
  employeeName: string;
  dueDate: string;
  doneAt: string | null;
}

/** Ajouts du lot H4 à `GET /hr/me` : mes documents visibles et mes éléments de liste. */
export interface HrMeDocumentsAndChecklists {
  documents: HrDocumentView[];
  checklistItems: HrMyChecklistItemView[];
}

// ── Échéances (§ 3.3, § 6.4) ────────────────────────────────────────────────

/** `GET /hr/deadlines?within=` — `hr.read`. Sans `within` : délais des réglages. */
export const HrDeadlinesQuery = z
  .object({
    within: z
      .string(hrFr('Nombre de jours attendu.'))
      .regex(/^\d{1,3}$/, { message: `Entier de 0 à ${L.reminderDaysMax}.` })
      .transform((v) => Number.parseInt(v, 10))
      .pipe(z.number().int().min(0).max(L.reminderDaysMax))
      .optional(),
  })
  .strict();
export type HrDeadlinesQuery = z.output<typeof HrDeadlinesQuery>;

export const HR_DEADLINE_KINDS = [
  'probation_end',
  'contract_end',
  'document_expiry',
  'id_expiry',
] as const;
export type HrDeadlineKindView = (typeof HR_DEADLINE_KINDS)[number];

export interface HrDeadlineView {
  kind: HrDeadlineKindView;
  employeeId: string;
  employeeName: string;
  date: string;
  daysLeft: number;
  /** `document_expiry` : document concerné ; libellé masqué hors `hr.sensitive.read` s'il est sensible. */
  documentId: string | null;
  documentLabel: string | null;
  /** `id_expiry` : nature de la pièce pour `hr.sensitive.read`, sinon `null` ; jamais le numéro. */
  idKind: HrIdDocumentKind | null;
}

export interface HrDeadlinesView {
  today: string;
  horizons: { probationEnd: number; contractEnd: number; documentExpiry: number };
  items: HrDeadlineView[];
  counts: Record<HrDeadlineKindView, number>;
  total: number;
}

/** Libellé d'un document sensible pour qui ne détient pas `hr.sensitive.read`. */
export const HR_MASKED_DOCUMENT_LABEL = 'Document confidentiel';

/** Codes d'erreur du lot H4 (s'ajoutent à `HR_ERROR_CODES`). */
export const HR_H4_ERROR_CODES = [
  'HR_DOCUMENT_NOT_FOUND',
  'HR_DOCUMENT_UNREADABLE',
  'HR_STORAGE_FULL',
  'HR_DOCUMENT_EMPLOYEE_ANONYMIZED',
  'CHECKLIST_TEMPLATE_NOT_FOUND',
  'CHECKLIST_NOT_FOUND',
  'CHECKLIST_ITEM_NOT_FOUND',
  'CHECKLIST_ASSIGNEE_NOT_HR',
] as const;
export type HrH4ErrorCode = (typeof HR_H4_ERROR_CODES)[number];
