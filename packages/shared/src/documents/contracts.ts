// Contrats HTTP de la bibliothèque de documents (ADR-0046 § 4, § 5.3). ADR-0046 — S6.
//
// Réutilise les briques de S0 (`common.ts`). Deux règles portées par la forme même des
// contrats (§ 4.3, leçon du lot H4 d'ADR-0045) :
//   - l'envoi d'un document ou d'une version est un formulaire `multipart/form-data` :
//     partie `file` et champs TEXTE (titre, dossier, nature, étiquettes et liens en
//     JSON, dates, sensibilité, note) — jamais dans l'URL ni dans un en-tête ;
//   - les requêtes `GET` ne portent que des IDENTIFIANTS (`DocumentListQuerySchema`,
//     `EntityPiecesQuerySchema`, `DocumentDeadlinesQuerySchema`) ; la recherche passe
//     par le corps de `POST /documents/search`.

import { z } from 'zod';

import {
  DocumentCalendarDay,
  DocumentExpectedRevision,
  DocumentFolderAccessSchema,
  DocumentId,
  DocumentLinkEntityTypeSchema,
  DocumentLinksSchema,
  DocumentNatureSchema,
  DocumentTagsSchema,
  documentFr,
  documentIssue,
  type DocumentFolderAccessInput,
} from './common.js';
import {
  DOCUMENT_LIMITS,
  type DocumentFileType,
  type DocumentLinkEntityType,
  type DocumentNature,
  type DocumentStatus,
} from './constants.js';

/** Nom de la partie fichier du formulaire d'envoi. */
export const DOCUMENT_FILE_FIELD = 'file';

/**
 * Clé de recherche d'un titre (§ 4.2, `searchKey`) : sans accents, minuscules, espaces
 * réduits. La recherche compare des sous-chaînes de cette clé, jamais le contenu.
 */
export function normalizeDocumentSearchKey(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const Title = z
  .string(documentFr('Titre attendu.'))
  .trim()
  .min(1, { message: 'Titre attendu.' })
  .max(DOCUMENT_LIMITS.title, { message: `Titre : ${DOCUMENT_LIMITS.title} caractères au plus.` });

const FolderName = z
  .string(documentFr('Nom de dossier attendu.'))
  .trim()
  .min(1, { message: 'Nom de dossier attendu.' })
  .max(DOCUMENT_LIMITS.folderName, {
    message: `Nom : ${DOCUMENT_LIMITS.folderName} caractères au plus.`,
  });

const ReminderDays = z
  .number(documentFr('Délai de rappel : un entier.'))
  .int()
  .min(0)
  .max(DOCUMENT_LIMITS.reminderDaysMax);

const Note = z.string().trim().max(DOCUMENT_LIMITS.versionNote);

// ── Dossiers ────────────────────────────────────────────────────────────────

/** Droits par défaut d'un dossier : ouvert aux lecteurs, écrit par les gestionnaires. */
export const DOCUMENT_FOLDER_DEFAULT_ACCESS: DocumentFolderAccessInput = Object.freeze({
  read: 'all',
  write: 'managers',
  inherit: true,
}) as DocumentFolderAccessInput;

/** `POST /documents/folders` */
export const CreateDocumentFolderBodySchema = z
  .object({
    name: FolderName,
    parentId: DocumentId.nullable().optional(),
    access: DocumentFolderAccessSchema.optional(),
  })
  .strict();
export type CreateDocumentFolderBody = z.output<typeof CreateDocumentFolderBodySchema>;

/** `PUT /documents/folders/:id` — renommer, déplacer, changer les droits. */
export const UpdateDocumentFolderBodySchema = z
  .object({
    expectedRevision: DocumentExpectedRevision,
    name: FolderName.optional(),
    parentId: DocumentId.nullable().optional(),
    access: DocumentFolderAccessSchema.optional(),
  })
  .strict();
export type UpdateDocumentFolderBody = z.output<typeof UpdateDocumentFolderBodySchema>;

/** Corps des gestes qui ne portent que la révision attendue (archiver, restaurer). */
export const DocumentRevisionBodySchema = z
  .object({ expectedRevision: DocumentExpectedRevision })
  .strict();
export type DocumentRevisionBody = z.output<typeof DocumentRevisionBodySchema>;

export interface DocumentFolderView {
  id: string;
  name: string;
  parentId: string | null;
  /** Profondeur (racine = 1). */
  depth: number;
  access: DocumentFolderAccessInput;
  status: DocumentStatus;
  /** L'appelant peut y déposer et y modifier des documents. */
  canWrite: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentFolderList {
  items: DocumentFolderView[];
}

// ── Documents ───────────────────────────────────────────────────────────────

/** Champ texte d'un formulaire : JSON d'un tableau (étiquettes, liens). */
function jsonArrayField<T extends z.ZodType>(schema: T, label: string) {
  return z
    .string(documentFr(`${label} : JSON attendu.`))
    .max(4_000)
    .transform((raw, ctx): unknown => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        documentIssue(ctx, 'INVALID_JSON', `${label} : JSON attendu.`);
        return z.NEVER;
      }
    })
    .pipe(schema);
}

const BooleanField = z
  .enum(['true', 'false'], documentFr('Booléen attendu : true ou false.'))
  .transform((v) => v === 'true');

const IntegerField = z
  .string(documentFr('Entier attendu.'))
  .regex(/^\d{1,4}$/, { message: 'Entier attendu.' })
  .transform((v) => Number(v))
  .pipe(ReminderDays);

/** Un dossier en champ de formulaire : identifiant, ou vide pour « sans dossier ». */
const FolderField = z.union([z.literal('').transform(() => null), DocumentId]);

function checkDates(
  q: { issuedOn?: string | null; expiresOn?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (q.issuedOn && q.expiresOn && q.expiresOn < q.issuedOn) {
    documentIssue(ctx, 'DATE_BEFORE_ISSUE', 'La date d’expiration précède la date de délivrance.', [
      'expiresOn',
    ]);
  }
}

/**
 * Champs du formulaire `POST /documents` (`multipart/form-data`, partie `file`). Tout
 * est texte : `tags` et `links` en JSON, `sensitive` en `true`/`false`.
 */
export const UploadLibraryDocumentFieldsSchema = z
  .object({
    title: Title,
    folderId: FolderField.optional(),
    nature: DocumentNatureSchema.optional(),
    tags: jsonArrayField(DocumentTagsSchema, 'Étiquettes').optional(),
    links: jsonArrayField(DocumentLinksSchema, 'Liens').optional(),
    issuedOn: DocumentCalendarDay.optional(),
    expiresOn: DocumentCalendarDay.optional(),
    reminderDays: IntegerField.optional(),
    sensitive: BooleanField.optional(),
    note: Note.optional(),
  })
  .strict()
  .superRefine(checkDates)
  .transform((q) => ({
    title: q.title,
    folderId: q.folderId ?? null,
    nature: q.nature ?? ('other' as DocumentNature),
    tags: q.tags ?? [],
    links: q.links ?? [],
    issuedOn: q.issuedOn ?? null,
    expiresOn: q.expiresOn ?? null,
    reminderDays: q.reminderDays ?? DOCUMENT_LIMITS.reminderDaysDefault,
    sensitive: q.sensitive ?? false,
    note: q.note ?? null,
  }));
export type UploadLibraryDocumentFields = z.output<typeof UploadLibraryDocumentFieldsSchema>;

/** Champs du formulaire `POST /documents/:id/versions` (partie `file`). */
export const UploadDocumentVersionFieldsSchema = z
  .object({ note: Note.optional() })
  .strict()
  .transform((q) => ({ note: q.note ?? null }));
export type UploadDocumentVersionFields = z.output<typeof UploadDocumentVersionFieldsSchema>;

/**
 * `PUT /documents/:id` — métadonnées et liens (JSON). La sensibilité ne change pas après
 * le dépôt : elle décide du chiffrement de chaque version.
 */
export const UpdateLibraryDocumentBodySchema = z
  .object({
    expectedRevision: DocumentExpectedRevision,
    title: Title.optional(),
    folderId: DocumentId.nullable().optional(),
    nature: DocumentNatureSchema.optional(),
    tags: DocumentTagsSchema.optional(),
    links: DocumentLinksSchema.optional(),
    issuedOn: DocumentCalendarDay.nullable().optional(),
    expiresOn: DocumentCalendarDay.nullable().optional(),
    reminderDays: ReminderDays.optional(),
  })
  .strict()
  .superRefine(checkDates);
export type UpdateLibraryDocumentBody = z.output<typeof UpdateLibraryDocumentBodySchema>;

/** `GET /documents/deadlines?within=` — jours ; à défaut, le délai de chaque document. */
export const DocumentDeadlinesQuerySchema = z
  .object({
    within: z.coerce.number().int().min(0).max(DOCUMENT_LIMITS.reminderDaysMax).optional(),
  })
  .strict();
export type DocumentDeadlinesQuery = z.output<typeof DocumentDeadlinesQuerySchema>;

/** `GET /documents/entity-pieces?entityType=&entityId=` — identifiants seulement. */
export const EntityPiecesQuerySchema = z
  .object({ entityType: DocumentLinkEntityTypeSchema, entityId: DocumentId })
  .strict();
export type EntityPiecesQuery = z.output<typeof EntityPiecesQuerySchema>;

export interface DocumentLinkView {
  entityType: DocumentLinkEntityType;
  entityId: string;
}

export interface DocumentVersionView {
  id: string;
  number: number;
  fileName: string;
  contentType: DocumentFileType;
  size: number;
  sha256: string;
  /** Chiffrée côté application (document sensible). */
  encrypted: boolean;
  uploadedBy: string;
  uploadedAt: string;
  note: string | null;
}

export type DocumentExpiryStatus = 'ok' | 'due_soon' | 'expired';

export interface LibraryDocumentView {
  id: string;
  title: string;
  folderId: string | null;
  nature: DocumentNature;
  tags: string[];
  links: DocumentLinkView[];
  issuedOn: string | null;
  expiresOn: string | null;
  reminderDays: number;
  /** `null` sans date d'expiration. */
  expiryStatus: DocumentExpiryStatus | null;
  sensitive: boolean;
  status: DocumentStatus;
  currentVersion: DocumentVersionView;
  versionCount: number;
  /** L'appelant peut modifier le document et y ajouter une version. */
  canWrite: boolean;
  revision: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryDocumentDetail extends LibraryDocumentView {
  /** Toutes les versions, la plus récente d'abord. */
  versions: DocumentVersionView[];
}

/** Liste et recherche : filtrées par les droits AVANT pagination. */
export interface LibraryDocumentPage {
  items: LibraryDocumentView[];
  nextCursor: string | null;
  /** Nombre de documents LISIBLES correspondant au filtre (un invisible n'est pas compté). */
  total: number;
}

export interface DocumentDeadlineView {
  document: LibraryDocumentView;
  expiresOn: string;
  status: Exclude<DocumentExpiryStatus, 'ok'>;
}

export interface DocumentDeadlineList {
  today: string;
  items: DocumentDeadlineView[];
}

/** Pièce d'un module propriétaire, PRÉSENTÉE sans être copiée ni indexée (O5). */
export interface EntityPieceView {
  module: 'purchases' | 'work';
  ownerType: 'supplier_invoice' | 'purchase_reception' | 'work_task';
  ownerId: string;
  /** Numéro interne de la pièce propriétaire (facture, réception) ; `null` pour une tâche. */
  ownerReference: string | null;
  fileName: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  /** Route de téléchargement du module propriétaire (sa propre permission s'applique). */
  href: string;
}

export interface EntityPiecesView {
  entityType: DocumentLinkEntityType;
  entityId: string;
  /** Documents de la bibliothèque liés à l'entité et lisibles par l'appelant. */
  library: LibraryDocumentView[];
  /** Pièces des modules propriétaires, chacune filtrée par la permission de son module. */
  pieces: EntityPieceView[];
}
