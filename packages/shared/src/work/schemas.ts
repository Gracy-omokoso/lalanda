// Corps de requête et requêtes de liste du module « work » (ADR-0039 § 3, O5).
//
// Contrat partagé par l'API (validation) et le web (formulaires). Règles :
//
// - tous les corps sont `.strict()` : un champ inconnu est refusé ;
// - les règles métier posent leur code dans `params.code` (`WORK_DATES_INVERTED`…),
//   lu par `issuesOf()` des contrôleurs, comme `crm.dto.ts` ;
// - les montants sont des CHAÎNES décimales ; un `number` est refusé
//   `DECIMAL_MUST_BE_STRING` (docs/26). Aucune arithmétique ici ;
// - `zod` est une `peerDependency` de `@lalanda/shared` : l'API et ce fichier
//   partagent la même instance, donc la carte d'erreurs globale installée par
//   `apps/api/src/validation/zod-compat.ts` (`received` reposé, champ absent →
//   `FIELD_REQUIRED`). Les messages propres passent par `fr()`, qui repose
//   `received` exactement comme `typeMessages()` / `fixedMessage()` de l'API ;
// - un champ normalisé à la main s'écrit `z.unknown().optional()` (piège zod 4 :
//   une clé `z.unknown()` absente est refusée), seul cas ici : `hourlyCost`.
//
// Les règles qui exigent la base ou l'horloge (membre éligible, colonne
// existante, saisie future, somme du jour, cycle avec les tâches en base) sont
// vérifiées par le service, pas ici.

import { z } from 'zod';

import {
  WORK_COLUMN_CATEGORIES,
  WORK_KEY_PATTERN,
  WORK_LABEL_COLORS,
  WORK_LIMITS,
  WORK_PAGE_LIMIT_DEFAULT,
  WORK_PAGE_LIMIT_MAX,
  WORK_PRIORITIES,
  WORK_PROJECT_EDITABLE_STATUSES,
  WORK_PROJECT_KINDS,
  WORK_PROJECT_STATUSES,
  WORK_RATE_CURRENCIES,
} from './constants.js';
import { isCalendarDay } from './scheduling.js';

type RawIssue = z.core.$ZodRawIssue;
type Ctx = z.RefinementCtx;

// ── Outils ──────────────────────────────────────────────────────────────────

/**
 * Message français d'un schéma (`{ error }`). Repose `received` (`'undefined'` pour un champ
 * absent) comme `markReceived()` de l'API : sans cela, un champ absent porteur
 * d'un message propre ne serait plus reconnu `FIELD_REQUIRED`.
 */
function fr(message: string): { error: (iss: RawIssue) => string } {
  const error = (iss: RawIssue): string => {
    if (iss.code === 'invalid_type' || iss.code === 'invalid_value') {
      const input = iss.input;
      (iss as { received?: string }).received =
        input === undefined
          ? 'undefined'
          : input === null
            ? 'null'
            : Array.isArray(input)
              ? 'array'
              : typeof input;
    }
    return message;
  };
  return { error };
}

function issue(ctx: Ctx, path: (string | number)[], code: string, message: string): void {
  ctx.addIssue({ code: 'custom', path, message, params: { code } });
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** Identifiant Mongo (24 hexadécimaux), ramené en minuscules. */
export const WorkId = z
  .string(fr('Identifiant attendu.'))
  .refine((v) => OBJECT_ID.test(v), {
    message: 'Identifiant invalide.',
    params: { code: 'WORK_ID_INVALID' },
  })
  .transform((v) => v.toLowerCase());

/** Liste d'identifiants sans doublon, `max` éléments au plus. */
function idList(max: number) {
  return z
    .array(WorkId, fr('Liste d’identifiants attendue.'))
    .max(max, { message: `${max} éléments au plus.` })
    .superRefine((ids, ctx) => {
      if (new Set(ids).size !== ids.length) {
        issue(ctx, [], 'WORK_ID_DUPLICATE', 'La liste contient un doublon.');
      }
    });
}

/** Date civile `AAAA-MM-JJ` (jour de Kinshasa, ADR-0027). */
export const WorkDay = z.string(fr('Date attendue : AAAA-MM-JJ.')).refine(isCalendarDay, {
  message: 'Date : AAAA-MM-JJ.',
  params: { code: 'DATE_INVALID' },
});

/** Texte obligatoire : espaces de bord retirés, 1 à `max` caractères. */
function requiredText(max: number, what: string) {
  return z
    .string(fr(`${what} : texte attendu.`))
    .trim()
    .refine((v) => v.length > 0, {
      message: `${what} obligatoire.`,
      params: { code: 'FIELD_REQUIRED' },
    })
    .refine((v) => v.length <= max, {
      message: `${max} caractères au plus.`,
      params: { code: 'TEXT_TOO_LONG' },
    });
}

/** Texte facultatif : espaces de bord retirés, vide → `null`. */
function optionalText(max: number) {
  return z
    .string(fr('Texte attendu.'))
    .trim()
    .refine((v) => v.length <= max, {
      message: `${max} caractères au plus.`,
      params: { code: 'TEXT_TOO_LONG' },
    })
    .transform((v) => (v === '' ? null : v))
    .nullable();
}

/** Clé stable de colonne ou d'étiquette. */
const WorkKey = z.string(fr('Clé attendue.')).refine((v) => WORK_KEY_PATTERN.test(v), {
  message: 'Clé : 1 à 32 caractères parmi a-z, 0-9, « _ » et « - ».',
  params: { code: 'WORK_KEY_INVALID' },
});

const expectedRevision = z
  .number(fr('Révision attendue : un entier.'))
  .int({ message: 'Révision attendue : un entier.' })
  .min(1);

/** Corps des gestes sans autre donnée : archiver, restaurer, terminer, rouvrir. */
export const WorkExpectedRevisionBody = z.object({ expectedRevision }).strict();
export type WorkExpectedRevisionBody = z.output<typeof WorkExpectedRevisionBody>;

/** `dueDate ≥ startDate` quand les deux sont fournis (`WORK_DATES_INVERTED`). */
function checkDates(v: { startDate?: string | null; dueDate?: string | null }, ctx: Ctx): void {
  if (v.startDate && v.dueDate && v.dueDate < v.startDate) {
    issue(ctx, ['dueDate'], 'WORK_DATES_INVERTED', 'L’échéance précède la date de début.');
  }
}

/**
 * Montant décimal > 0, 2 décimales au plus, rendu canonique (`"12.50"`). Un
 * `number` JSON est refusé `DECIMAL_MUST_BE_STRING`.
 */
function positiveDecimal(ctx: Ctx, path: string[], raw: unknown): string | null {
  if (raw === undefined || raw === null) {
    issue(ctx, path, 'FIELD_REQUIRED', 'Montant obligatoire.');
    return null;
  }
  if (typeof raw === 'number') {
    issue(
      ctx,
      path,
      'DECIMAL_MUST_BE_STRING',
      'Montant attendu sous forme de chaîne (par exemple "12.50"), jamais de nombre.',
    );
    return null;
  }
  const m = typeof raw === 'string' ? /^(\d{1,13})(?:\.(\d+))?$/.exec(raw) : null;
  if (m === null) {
    issue(ctx, path, 'AMOUNT_INVALID', 'Montant invalide : chiffres et point décimal seulement.');
    return null;
  }
  const fraction = m[2] ?? '';
  if (fraction.length > 2) {
    issue(ctx, path, 'AMOUNT_TOO_PRECISE', '2 décimales au plus.');
    return null;
  }
  const integer = m[1]!.replace(/^0+(?=\d)/, '');
  const canonical = `${integer}.${fraction.padEnd(2, '0')}`;
  if (/^0\.00$/.test(canonical)) {
    issue(ctx, path, 'AMOUNT_NOT_POSITIVE', 'Le montant doit être strictement positif.');
    return null;
  }
  return canonical;
}

// ── Colonnes et étiquettes ──────────────────────────────────────────────────

const WorkColumnSchema = z
  .object({
    key: WorkKey,
    label: requiredText(WORK_LIMITS.columnLabelMax, 'Libellé de colonne'),
    category: z.enum(WORK_COLUMN_CATEGORIES, fr('Catégorie : todo, in_progress ou done.')),
  })
  .strict();

/**
 * Colonnes d'un projet (ADR-0039 § 2.2) : 2 à 12, clés uniques, au moins une
 * `todo` et EXACTEMENT une `done`.
 */
export const WorkColumnsSchema = z
  .array(WorkColumnSchema, fr('Liste de colonnes attendue.'))
  .superRefine((cols, ctx) => {
    if (cols.length < WORK_LIMITS.columnsMin || cols.length > WORK_LIMITS.columnsMax) {
      issue(
        ctx,
        [],
        'WORK_COLUMNS_INVALID',
        `Un projet compte de ${WORK_LIMITS.columnsMin} à ${WORK_LIMITS.columnsMax} colonnes.`,
      );
    }
    const seen = new Set<string>();
    cols.forEach((c, i) => {
      if (seen.has(c.key)) {
        issue(ctx, [i, 'key'], 'WORK_COLUMN_KEY_DUPLICATE', 'Deux colonnes portent la même clé.');
      }
      seen.add(c.key);
    });
    if (!cols.some((c) => c.category === 'todo')) {
      issue(ctx, [], 'WORK_COLUMNS_INVALID', 'Il faut au moins une colonne « à faire ».');
    }
    if (cols.filter((c) => c.category === 'done').length !== 1) {
      issue(ctx, [], 'WORK_COLUMNS_INVALID', 'Il faut exactement une colonne « terminé ».');
    }
  });

const WorkLabelSchema = z
  .object({
    key: WorkKey,
    label: requiredText(WORK_LIMITS.labelLabelMax, 'Libellé d’étiquette'),
    color: z.enum(WORK_LABEL_COLORS, fr('Couleur hors de la palette.')),
  })
  .strict();

// ── Réglages ────────────────────────────────────────────────────────────────

/** `PUT /work/settings` — remplace les réglages (révision 0 : défaut implicite). */
export const PutWorkSettingsBody = z
  .object({
    expectedRevision: z.number(fr('Révision attendue : un entier.')).int().min(0),
    labels: z
      .array(WorkLabelSchema, fr('Liste d’étiquettes attendue.'))
      .max(WORK_LIMITS.labelsMax, { message: `${WORK_LIMITS.labelsMax} étiquettes au plus.` })
      .superRefine((labels, ctx) => {
        const seen = new Set<string>();
        labels.forEach((l, i) => {
          if (seen.has(l.key)) {
            issue(
              ctx,
              [i, 'key'],
              'WORK_LABEL_KEY_DUPLICATE',
              'Deux étiquettes portent la même clé.',
            );
          }
          seen.add(l.key);
        });
      }),
    defaultColumns: WorkColumnsSchema,
    dueSoonDays: z
      .number(fr('Nombre de jours attendu.'))
      .int()
      .min(WORK_LIMITS.dueSoonDaysMin)
      .max(WORK_LIMITS.dueSoonDaysMax),
  })
  .strict();
export type PutWorkSettingsBody = z.output<typeof PutWorkSettingsBody>;

// ── Projets ─────────────────────────────────────────────────────────────────

const WorkProjectLinksSchema = z
  .object({
    customerId: WorkId.nullable().optional(),
    opportunityId: WorkId.nullable().optional(),
    quoteIds: idList(WORK_LIMITS.quoteIdsMax).optional(),
  })
  .strict();

const projectFields = {
  name: requiredText(WORK_LIMITS.projectNameMax, 'Nom du projet'),
  description: optionalText(WORK_LIMITS.projectDescriptionMax).optional(),
  kind: z.enum(WORK_PROJECT_KINDS, fr('Nature : client ou internal.')),
  ownerUserId: WorkId.nullable().optional(),
  startDate: WorkDay.nullable().optional(),
  dueDate: WorkDay.nullable().optional(),
  links: WorkProjectLinksSchema.optional(),
};

/** `POST /work/projects`. Colonnes absentes : celles des réglages. */
export const CreateWorkProjectBody = z
  .object({ ...projectFields, columns: WorkColumnsSchema.optional() })
  .strict()
  .superRefine(checkDates);
export type CreateWorkProjectBody = z.output<typeof CreateWorkProjectBody>;

/**
 * `PUT /work/projects/:projectId` — champs partiels. L'archivage passe par sa
 * route ; retirer une colonne portant des tâches est refusé par le service.
 */
export const UpdateWorkProjectBody = z
  .object({
    expectedRevision,
    name: projectFields.name.optional(),
    description: projectFields.description,
    kind: projectFields.kind.optional(),
    status: z
      .enum(WORK_PROJECT_EDITABLE_STATUSES, fr('Statut : active, on_hold ou completed.'))
      .optional(),
    ownerUserId: projectFields.ownerUserId,
    startDate: projectFields.startDate,
    dueDate: projectFields.dueDate,
    links: projectFields.links,
    columns: WorkColumnsSchema.optional(),
  })
  .strict()
  .superRefine(checkDates);
export type UpdateWorkProjectBody = z.output<typeof UpdateWorkProjectBody>;

/** `POST /work/projects/from-quote` (ADR-0039 § 6.1). Aucun montant n'est recopié. */
export const CreateProjectFromQuoteBody = z
  .object({
    quoteId: WorkId,
    name: requiredText(WORK_LIMITS.projectNameMax, 'Nom du projet').optional(),
    lineIndexes: z
      .array(z.number(fr('Indice de ligne : un entier.')).int().min(0), fr('Liste attendue.'))
      .min(1, { message: 'Retenez au moins une ligne.' })
      .max(WORK_LIMITS.quoteLineIndexesMax)
      .superRefine((xs, ctx) => {
        if (new Set(xs).size !== xs.length) {
          issue(ctx, [], 'WORK_ID_DUPLICATE', 'Une ligne est retenue deux fois.');
        }
      })
      .optional(),
    milestone: z
      .object({
        title: requiredText(WORK_LIMITS.milestoneTitleMax, 'Titre du jalon'),
        dueDate: WorkDay,
      })
      .strict()
      .optional(),
  })
  .strict();
export type CreateProjectFromQuoteBody = z.output<typeof CreateProjectFromQuoteBody>;

// ── Tâches ──────────────────────────────────────────────────────────────────

const taskFields = {
  title: requiredText(WORK_LIMITS.taskTitleMax, 'Titre de la tâche'),
  description: optionalText(WORK_LIMITS.taskDescriptionMax).optional(),
  assigneeUserId: WorkId.nullable().optional(),
  followerUserIds: idList(WORK_LIMITS.followersMax).optional(),
  priority: z.enum(WORK_PRIORITIES, fr('Priorité : none, low, medium, high ou urgent.')).optional(),
  labelKeys: z
    .array(WorkKey, fr('Liste d’étiquettes attendue.'))
    .max(WORK_LIMITS.labelKeysPerTaskMax, {
      message: `${WORK_LIMITS.labelKeysPerTaskMax} étiquettes au plus.`,
    })
    .superRefine((keys, ctx) => {
      if (new Set(keys).size !== keys.length) {
        issue(ctx, [], 'WORK_LABEL_KEY_DUPLICATE', 'La même étiquette est posée deux fois.');
      }
    })
    .optional(),
  startDate: WorkDay.nullable().optional(),
  dueDate: WorkDay.nullable().optional(),
  isMilestone: z.boolean(fr('Vrai ou faux attendu.')).optional(),
  estimateMinutes: z
    .number(fr('Estimation : un nombre de minutes.'))
    .int()
    .min(0)
    .max(WORK_LIMITS.estimateMinutesMax)
    .nullable()
    .optional(),
};

/** Jalon : pas de date de début (durée nulle) ; échéance exigée à la création. */
function checkMilestone(
  v: { isMilestone?: boolean; startDate?: string | null; dueDate?: string | null },
  ctx: Ctx,
  creating: boolean,
): void {
  if (v.isMilestone !== true) return;
  if (v.startDate) {
    issue(ctx, ['startDate'], 'WORK_MILESTONE_HAS_START', 'Un jalon n’a pas de date de début.');
  }
  if ((creating && !v.dueDate) || v.dueDate === null) {
    issue(ctx, ['dueDate'], 'WORK_MILESTONE_NEEDS_DATE', 'Un jalon exige une échéance.');
  }
}

/**
 * `POST /work/projects/:projectId/tasks`. `columnKey` absent : première colonne
 * `todo`. `afterTaskId` : insérer juste après cette tâche, sinon en fin de colonne.
 */
export const CreateWorkTaskBody = z
  .object({
    ...taskFields,
    columnKey: WorkKey.optional(),
    parentTaskId: WorkId.nullable().optional(),
    afterTaskId: WorkId.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    checkDates(v, ctx);
    checkMilestone(v, ctx, true);
    if (v.isMilestone === true && v.parentTaskId) {
      issue(ctx, ['parentTaskId'], 'WORK_SUBTASK_DEPTH', 'Un jalon n’est pas une sous-tâche.');
    }
  });
export type CreateWorkTaskBody = z.output<typeof CreateWorkTaskBody>;

/**
 * `PATCH /work/tasks/:taskId` — champs partiels. La colonne change par `move`,
 * `complete` ou `reopen`. Le service revérifie dates et jalon contre l'état stocké.
 */
export const PatchWorkTaskBody = z
  .object({
    expectedRevision,
    title: taskFields.title.optional(),
    description: taskFields.description,
    assigneeUserId: taskFields.assigneeUserId,
    followerUserIds: taskFields.followerUserIds,
    priority: taskFields.priority,
    labelKeys: taskFields.labelKeys,
    startDate: taskFields.startDate,
    dueDate: taskFields.dueDate,
    isMilestone: taskFields.isMilestone,
    estimateMinutes: taskFields.estimateMinutes,
  })
  .strict()
  .superRefine((v, ctx) => {
    checkDates(v, ctx);
    checkMilestone(v, ctx, false);
  });
export type PatchWorkTaskBody = z.output<typeof PatchWorkTaskBody>;

/** `POST /work/tasks/:taskId/move` — glisser-déposer et menu clavier. */
export const MoveWorkTaskBody = z
  .object({
    columnKey: WorkKey,
    beforeTaskId: WorkId.optional(),
    afterTaskId: WorkId.optional(),
    expectedRevision,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.beforeTaskId !== undefined && v.beforeTaskId === v.afterTaskId) {
      issue(ctx, ['afterTaskId'], 'INVALID_VALUE', 'Les deux voisines doivent être distinctes.');
    }
  });
export type MoveWorkTaskBody = z.output<typeof MoveWorkTaskBody>;

/** `POST /work/tasks/:taskId/dependencies` — fin → début, même projet. */
export const AddDependencyBody = z.object({ predecessorTaskId: WorkId }).strict();
export type AddDependencyBody = z.output<typeof AddDependencyBody>;

// ── Commentaires ────────────────────────────────────────────────────────────

const commentFields = {
  body: requiredText(WORK_LIMITS.commentBodyMax, 'Commentaire'),
  /** Le client envoie la liste ; le serveur vérifie l'éligibilité (`work.read`). */
  mentionedUserIds: idList(WORK_LIMITS.mentionsMax).optional(),
};

/** `POST /work/tasks/:taskId/comments`. Une mention s'écrit `@[userId]` dans le texte. */
export const CreateWorkCommentBody = z
  .object({ ...commentFields, attachmentIds: idList(WORK_LIMITS.commentAttachmentsMax).optional() })
  .strict();
export type CreateWorkCommentBody = z.output<typeof CreateWorkCommentBody>;

/** `PUT /work/comments/:commentId` — l'auteur seul. */
export const UpdateWorkCommentBody = z.object({ ...commentFields, expectedRevision }).strict();
export type UpdateWorkCommentBody = z.output<typeof UpdateWorkCommentBody>;

// ── Temps ───────────────────────────────────────────────────────────────────

const minutes = z
  .number(fr('Durée : un nombre entier de minutes.'))
  .int({ message: 'Durée : un nombre entier de minutes.' })
  .min(WORK_LIMITS.timeEntryMinutesMin, { message: 'Au moins une minute.' })
  .max(WORK_LIMITS.minutesPerDayMax, { message: 'Une journée compte 1 440 minutes au plus.' });

/**
 * `POST /work/tasks/:taskId/time-entries`. `userId` absent : l'appelant ; pour
 * autrui, `work.manage` (contrôle du service). Saisie future et dépassement de
 * 1 440 minutes par jour : vérifiés par le service (horloge, base).
 */
export const CreateTimeEntryBody = z
  .object({
    userId: WorkId.optional(),
    workedOn: WorkDay,
    minutes,
    note: optionalText(WORK_LIMITS.timeEntryNoteMax).optional(),
  })
  .strict();
export type CreateTimeEntryBody = z.output<typeof CreateTimeEntryBody>;

/** `PUT /work/time-entries/:entryId` — champs partiels. */
export const UpdateTimeEntryBody = z
  .object({
    expectedRevision,
    workedOn: WorkDay.optional(),
    minutes: minutes.optional(),
    note: optionalText(WORK_LIMITS.timeEntryNoteMax).optional(),
  })
  .strict();
export type UpdateTimeEntryBody = z.output<typeof UpdateTimeEntryBody>;

/** `POST /work/rates` — coût horaire d'un membre (donnée salariale, ADR-0039 § 2.7). */
export const SetMemberRateBody = z
  .object({
    userId: WorkId,
    currency: z.enum(WORK_RATE_CURRENCIES, fr('Devise : CDF ou USD.')),
    hourlyCost: z.unknown().optional(),
    effectiveFrom: WorkDay,
  })
  .strict()
  .transform((v, ctx) => {
    const hourlyCost = positiveDecimal(ctx, ['hourlyCost'], v.hourlyCost);
    if (hourlyCost === null) return z.NEVER;
    return { ...v, hourlyCost };
  });
export type SetMemberRateBody = z.output<typeof SetMemberRateBody>;

// ── Branchements (lot L4a) ──────────────────────────────────────────────────

/** `POST /work/projects/:projectId/invoices` — lier une facture existante. */
export const LinkInvoiceBody = z.object({ invoiceId: WorkId }).strict();
export type LinkInvoiceBody = z.output<typeof LinkInvoiceBody>;

/** `POST /work/tasks/:taskId/prepare-invoice` — brouillon `FV`, jamais émis (§ 6.3). */
export const PrepareInvoiceBody = z.discriminatedUnion(
  'source',
  [
    z
      .object({
        source: z.literal('quote_lines'),
        quoteId: WorkId,
        lineIndexes: z
          .array(z.number(fr('Indice de ligne : un entier.')).int().min(0))
          .min(1, { message: 'Retenez au moins une ligne.' })
          .max(WORK_LIMITS.quoteLineIndexesMax)
          .superRefine((xs, ctx) => {
            if (new Set(xs).size !== xs.length) {
              issue(ctx, [], 'WORK_ID_DUPLICATE', 'Une ligne est retenue deux fois.');
            }
          }),
      })
      .strict(),
    z.object({ source: z.literal('empty') }).strict(),
  ],
  fr('Source : quote_lines ou empty.'),
);
export type PrepareInvoiceBody = z.output<typeof PrepareInvoiceBody>;

// ── Requêtes de liste (paramètres de chaîne) ────────────────────────────────

const limit = z
  .string()
  .regex(/^\d{1,3}$/, `Limite : un entier de 1 à ${WORK_PAGE_LIMIT_MAX}.`)
  .transform((v) => Number.parseInt(v, 10))
  .pipe(z.number().int().min(1).max(WORK_PAGE_LIMIT_MAX))
  .prefault(String(WORK_PAGE_LIMIT_DEFAULT));

const cursor = z.string().min(1).max(512).optional();

const booleanQuery = z
  .enum(['true', 'false'], fr('Valeur attendue : true ou false.'))
  .transform((v) => v === 'true')
  .optional();

const dayQuery = WorkDay.optional();

/** Pagination seule (historique d'activité). */
export const WorkCursorQuery = z.object({ limit, cursor }).strict();
export type WorkCursorQuery = z.output<typeof WorkCursorQuery>;

/** `GET /work/projects`. Sans `status`, les projets archivés sont exclus. */
export const ListWorkProjectsQuery = z
  .object({
    status: z.enum(WORK_PROJECT_STATUSES, fr('Statut inconnu.')).optional(),
    kind: z.enum(WORK_PROJECT_KINDS, fr('Nature : client ou internal.')).optional(),
    customerId: WorkId.optional(),
    opportunityId: WorkId.optional(),
    q: z.string().trim().min(1).max(100).optional(),
    limit,
    cursor,
  })
  .strict();
export type ListWorkProjectsQuery = z.output<typeof ListWorkProjectsQuery>;

/** `GET /work/projects/:projectId/tasks` — tout le projet, filtres facultatifs. */
export const ListProjectTasksQuery = z
  .object({
    assignee: z.union([z.literal('me'), WorkId]).optional(),
    label: WorkKey.optional(),
    done: booleanQuery,
    dueFrom: dayQuery,
    dueTo: dayQuery,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.dueFrom && v.dueTo && v.dueTo < v.dueFrom) {
      issue(ctx, ['dueTo'], 'WORK_DATES_INVERTED', 'La fin précède le début.');
    }
  });
export type ListProjectTasksQuery = z.output<typeof ListProjectTasksQuery>;

/** `GET /work/tasks` — liste transverse (calendrier « Mes tâches », etc.). */
export const ListWorkTasksQuery = z
  .object({
    assignee: z.union([z.literal('me'), WorkId]).optional(),
    projectId: WorkId.optional(),
    label: WorkKey.optional(),
    done: booleanQuery,
    dueFrom: dayQuery,
    dueTo: dayQuery,
    limit,
    cursor,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.dueFrom && v.dueTo && v.dueTo < v.dueFrom) {
      issue(ctx, ['dueTo'], 'WORK_DATES_INVERTED', 'La fin précède le début.');
    }
  });
export type ListWorkTasksQuery = z.output<typeof ListWorkTasksQuery>;

/** `GET /work/time-entries` — minutes seulement, jamais de coût. */
export const ListTimeEntriesQuery = z
  .object({
    projectId: WorkId.optional(),
    taskId: WorkId.optional(),
    userId: z.union([z.literal('me'), WorkId]).optional(),
    from: dayQuery,
    to: dayQuery,
    limit,
    cursor,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.from && v.to && v.to < v.from) {
      issue(ctx, ['to'], 'WORK_DATES_INVERTED', 'La fin précède le début.');
    }
  });
export type ListTimeEntriesQuery = z.output<typeof ListTimeEntriesQuery>;

/** `GET /work/projects/:projectId/margin` — période facultative (§ 5). */
export const ProjectMarginQuery = z
  .object({ from: dayQuery, to: dayQuery })
  .strict()
  .superRefine((v, ctx) => {
    if (v.from && v.to && v.to < v.from) {
      issue(ctx, ['to'], 'WORK_DATES_INVERTED', 'La fin précède le début.');
    }
  });
export type ProjectMarginQuery = z.output<typeof ProjectMarginQuery>;
