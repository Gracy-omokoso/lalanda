// Briques de schéma communes aux contrats de la bibliothèque (ADR-0046 § 4). ADR-0046 — S0.
//
// Mêmes règles que `@lalanda/shared/stock` : corps `.strict()`, codes métier dans
// `params.code`, identifiants Mongo ramenés en minuscules, dates civiles `AAAA-MM-JJ`.
// Règle propre à la bibliothèque (§ 4.3, leçon du lot H4 d'ADR-0045) : un titre, une
// étiquette ou un nom de fichier est une DONNÉE — jamais dans l'URL ni dans un en-tête.
// Les requêtes `GET` ne prennent donc que des IDENTIFIANTS (`DocumentListQuerySchema`,
// strict) ; la recherche passe par le corps de `POST /documents/search`
// (`DocumentSearchBodySchema`). Les lots S6, S7 et S9 RÉUTILISENT ces briques.

import { z } from 'zod';

import {
  DOCUMENT_LIMITS,
  DOCUMENT_LINK_ENTITY_TYPES,
  DOCUMENT_NATURES,
  DOCUMENT_PAGE_LIMIT_MAX,
  normalizeDocumentTag,
} from './constants.js';

type RawIssue = z.core.$ZodRawIssue;
type Ctx = z.RefinementCtx;

/** Message français d'un schéma (repose `received`, motif de `@lalanda/shared/work`). */
export function documentFr(message: string): { error: (iss: RawIssue) => string } {
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

/** Ajoute une erreur portant un code métier stable (`params.code`). */
export function documentIssue(ctx: Ctx, code: string, message: string, path?: PropertyKey[]): void {
  ctx.addIssue({
    code: 'custom',
    message,
    params: { code },
    ...(path === undefined ? {} : { path }),
  });
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** Identifiant Mongo (24 hexadécimaux), ramené en minuscules. */
export const DocumentId = z
  .string(documentFr('Identifiant attendu.'))
  .refine((v) => OBJECT_ID.test(v), {
    message: 'Identifiant invalide.',
    params: { code: 'DOCUMENT_ID_INVALID' },
  })
  .transform((v) => v.toLowerCase());

/** Révision attendue (écriture concurrente → `409 STALE_REVISION`). */
export const DocumentExpectedRevision = z
  .number(documentFr('Révision attendue : un entier.'))
  .int({ message: 'Révision attendue : un entier.' })
  .min(1);

export const DocumentNatureSchema = z.enum(
  DOCUMENT_NATURES,
  documentFr('Nature de document inconnue.'),
);

export const DocumentLinkEntityTypeSchema = z.enum(
  DOCUMENT_LINK_ENTITY_TYPES,
  documentFr('Type d’entité inconnu.'),
);

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Vrai pour une date civile `AAAA-MM-JJ` qui existe au calendrier grégorien. */
export function isDocumentCalendarDay(value: string): boolean {
  const m = CALENDAR_DAY.exec(value);
  if (m === null) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= lengths[month - 1]!;
}

export const DocumentCalendarDay = z
  .string(documentFr('Date attendue au format AAAA-MM-JJ.'))
  .refine(isDocumentCalendarDay, {
    message: 'Date attendue au format AAAA-MM-JJ.',
    params: { code: 'INVALID_DATE' },
  });

/** Lien vers une entité `{ entityType, entityId }` (§ 4.2). */
export const DocumentLinkSchema = z
  .object({ entityType: DocumentLinkEntityTypeSchema, entityId: DocumentId })
  .strict();
export type DocumentLinkInput = z.output<typeof DocumentLinkSchema>;

/** 0 à 10 liens, sans doublon. */
export const DocumentLinksSchema = z
  .array(DocumentLinkSchema, documentFr('Liste de liens attendue.'))
  .max(DOCUMENT_LIMITS.links, { message: `${DOCUMENT_LIMITS.links} liens au plus.` })
  .superRefine((links, ctx) => {
    const seen = new Set<string>();
    links.forEach((l, i) => {
      const key = `${l.entityType}:${l.entityId}`;
      if (seen.has(key)) documentIssue(ctx, 'DOCUMENT_LINK_DUPLICATE', 'Lien en double.', [i]);
      seen.add(key);
    });
  });

/** 0 à 10 étiquettes de 1 à 40 caractères, normalisées et dédoublonnées. */
export const DocumentTagsSchema = z
  .array(z.string(documentFr('Étiquette attendue.')), documentFr('Liste d’étiquettes attendue.'))
  .transform((tags, ctx): string[] => {
    const out: string[] = [];
    for (const [i, raw] of tags.entries()) {
      const tag = normalizeDocumentTag(raw);
      if (tag.length < DOCUMENT_LIMITS.tagMin || tag.length > DOCUMENT_LIMITS.tagMax) {
        documentIssue(
          ctx,
          'DOCUMENT_TAG_INVALID',
          `Étiquette : ${DOCUMENT_LIMITS.tagMin} à ${DOCUMENT_LIMITS.tagMax} caractères.`,
          [i],
        );
        return z.NEVER;
      }
      if (!out.includes(tag)) out.push(tag);
    }
    if (out.length > DOCUMENT_LIMITS.tags) {
      documentIssue(ctx, 'DOCUMENT_TAGS_TOO_MANY', `${DOCUMENT_LIMITS.tags} étiquettes au plus.`);
      return z.NEVER;
    }
    return out;
  });

/** Liste d'utilisateurs désignés (dossier restreint, écrivains en plus des gestionnaires). */
const FolderUserIds = z
  .array(z.string(documentFr('Identifiant attendu.')).min(1).max(64))
  .min(1, { message: 'Au moins une personne.' })
  .max(DOCUMENT_LIMITS.folderUserIds)
  .transform((ids) => [...new Set(ids)]);

/** Nom d'action granulaire (`treasury.read`) ; son existence est vérifiée par l'API. */
const ACTION_NAME = /^[a-z]+(?:\.[a-z]+)+$/;

/**
 * Droits d'un dossier (§ 4.1). Jugés sur les droits EFFECTIFS et les PERSONNES par
 * `folderAccessDecision` (`apps/api/src/authz/permissions.ts`), jamais sur le rôle.
 */
export const DocumentFolderAccessSchema = z
  .object({
    read: z.union([
      z.literal('all'),
      z
        .object({
          action: z.string().refine((v) => ACTION_NAME.test(v), {
            message: 'Autorisation inconnue.',
            params: { code: 'FOLDER_ACTION_INVALID' },
          }),
        })
        .strict(),
      z.object({ userIds: FolderUserIds }).strict(),
    ]),
    write: z.union([z.literal('managers'), z.object({ userIds: FolderUserIds }).strict()]),
    inherit: z.boolean(documentFr('Booléen attendu.')).default(true),
  })
  .strict();
export type DocumentFolderAccessInput = z.output<typeof DocumentFolderAccessSchema>;

/**
 * Requête `GET /documents` : IDENTIFIANTS SEULEMENT (§ 4.3). Strict : un `title`, un
 * `q` ou une étiquette en requête est refusé, jamais ignoré en silence.
 */
export const DocumentListQuerySchema = z
  .object({
    folderId: DocumentId.optional(),
    entityType: DocumentLinkEntityTypeSchema.optional(),
    entityId: DocumentId.optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(DOCUMENT_PAGE_LIMIT_MAX).optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    if ((q.entityType === undefined) !== (q.entityId === undefined)) {
      documentIssue(ctx, 'DOCUMENT_ENTITY_INCOMPLETE', '`entityType` et `entityId` vont ensemble.');
    }
  });
export type DocumentListQuery = z.output<typeof DocumentListQuerySchema>;

/**
 * Corps de `POST /documents/search` (§ 4.3) : titre, étiquettes, nature, dossier, entité
 * liée, expiration et auteur ; JAMAIS dans le contenu des fichiers. Les résultats sont
 * filtrés par les droits de lecture AVANT pagination (service).
 */
export const DocumentSearchBodySchema = z
  .object({
    text: z.string(documentFr('Texte attendu.')).trim().max(DOCUMENT_LIMITS.searchText).optional(),
    tags: DocumentTagsSchema.optional(),
    nature: DocumentNatureSchema.optional(),
    folderId: DocumentId.nullable().optional(),
    entity: DocumentLinkSchema.optional(),
    expiresFrom: DocumentCalendarDay.optional(),
    expiresTo: DocumentCalendarDay.optional(),
    createdBy: z.string().min(1).max(64).optional(),
    includeArchived: z.boolean().optional(),
    cursor: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(DOCUMENT_PAGE_LIMIT_MAX).optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.expiresFrom !== undefined && b.expiresTo !== undefined && b.expiresFrom > b.expiresTo) {
      documentIssue(ctx, 'INVALID_RANGE', 'La période d’expiration est inversée.', ['expiresTo']);
    }
  });
export type DocumentSearchBody = z.output<typeof DocumentSearchBodySchema>;
