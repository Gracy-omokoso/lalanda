// Documents de la bibliothèque : dépôt, versions, lecture, recherche, échéances,
// présentation par entité, suppression (ADR-0046 § 4.2, § 4.3, § 5.3). ADR-0046 — S6.
//
// Stockage : motif EXACT d'ADR-0039 § 2.5 réutilisé (`classifyPurchaseAttachment` : PDF
// ≤ 10 Mio reconnus par `%PDF-` et NON analysés, images ≤ 2 Mio ASSAINIES, type déduit
// du contenu ; clé au hasard `documents/<objectId>`), borne COMMUNE de 1 Gio
// (`storage/attachments-usage.ts`). Une version SENSIBLE est chiffrée côté application
// AVANT le stockage (`library-document-crypto.ts`) : ni le stockage, ni le disque, ni
// les journaux ne voient son clair.
//
// Droits (EFFECTIFS, jamais un `if (role === …)`) : `FolderIndex` (décisions pures de
// S0). Lire = dossier ET module de chaque lien ; un document illisible rend 404 et n'est
// compté nulle part (listes et recherche filtrées AVANT pagination). Écrire = dossier
// inscriptible (sans dossier : `docs.manage`) ; sensible : `docs.manage`. Lier une entité
// exige la lecture de son module, et l'entité doit exister DANS l'organisation (404).
//
// Journal : téléchargement toujours tracé ; pour une pièce sensible, l'audit est STRICT
// et écrit AVANT de servir (`documents.sensitive_downloaded`) : sans trace, rien n'est
// servi. Aucun titre, étiquette ni nom de fichier n'entre dans l'audit ni dans un
// message de journal.

import { createHash } from 'node:crypto';

import {
  DOCUMENT_LIMITS,
  DOCUMENT_PAGE_LIMIT_DEFAULT,
  normalizeDocumentSearchKey,
  type DocumentDeadlineList,
  type DocumentDeadlinesQuery,
  type DocumentExpiryStatus,
  type DocumentLinkEntityType,
  type DocumentListQuery,
  type DocumentRevisionBody,
  type DocumentSearchBody,
  type DocumentVersionView,
  type EntityPieceView,
  type EntityPiecesQuery,
  type EntityPiecesView,
  type LibraryDocumentDetail,
  type LibraryDocumentPage,
  type LibraryDocumentView,
  type UpdateLibraryDocumentBody,
  type UploadDocumentVersionFields,
  type UploadLibraryDocumentFields,
} from '@lalanda/shared/documents';
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type FilterQuery, type Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { DOCUMENT_LINK_READ_ACTION } from '../authz/permissions.js';
import { MASTER_KEYRING } from '../integrations/keyring.provider.js';
import type { MasterKeyring } from '../integrations/secrets-crypto.js';
import {
  classifyPurchaseAttachment,
  type AcceptedPurchaseAttachment,
} from '../purchases/attachments/purchase-attachments.js';
import { kinshasaDayOf } from '../sales/receipts/kinshasa-day.js';
import { sharedAttachmentsUsage } from '../storage/attachments-usage.js';
import { newObjectId } from '../storage/object-key.js';
import {
  ObjectStorageService,
  ObjectStorageUnavailableError,
} from '../storage/object-storage.service.js';
import { sanitizeFileName } from '../work/work-attachments.service.js';
import { FolderIndex, type DocumentsActor } from './document-access.js';
import { DocumentFoldersService } from './document-folders.service.js';
import {
  LibraryDocument,
  LibraryDocumentVersion,
  libraryDocumentObjectKey,
  type LibraryDocumentDocument,
  type LibraryDocumentLean,
  type LibraryDocumentVersionDocument,
  type LibraryDocumentVersionLean,
} from './document.schemas.js';
import {
  documentConflict,
  documentNotFound,
  documentUnreadable,
  documentsAuditUnavailable,
  documentsForbidden,
  documentsSecretsNotConfigured,
  linkedEntityNotFound,
  staleRevision,
  versionNotFound,
} from './documents.errors.js';
import { openLibraryDocument, sealLibraryDocument } from './library-document-crypto.js';

const OBJECT_ID = /^[0-9a-f]{24}$/;
/** Plafond de lecture d'une liste avant filtrage par les droits. */
const SCAN_MAX = 5_000;

/** Collection de chaque nature d'entité liable (existence vérifiée dans l'organisation). */
const ENTITY_COLLECTIONS: Readonly<Record<DocumentLinkEntityType, string>> = {
  customer: 'customers',
  supplier: 'suppliers',
  work_project: 'work_projects',
  crm_account: 'crm_accounts',
  asset: 'assets',
  stock_item: 'stock_items',
  purchase_order: 'purchase_orders',
};

/** Partie fichier reçue (formulaire `multipart/form-data`, en mémoire, bornée à 10 Mio). */
export interface DocumentUploadedFile {
  buffer: Buffer;
  originalname?: string;
}

/** Classe le fichier par son contenu : `415 DOCUMENT_TYPE`, `413 DOCUMENT_TOO_LARGE`. */
export function classifyLibraryDocument(
  file: DocumentUploadedFile | undefined,
): AcceptedPurchaseAttachment {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new BadRequestException({
      code: 'DOCUMENT_FILE_MISSING',
      message: 'Fichier attendu dans la partie « file » du formulaire.',
    });
  }
  if (file.buffer.length > DOCUMENT_LIMITS.pdfMaxBytes) tooLarge('Le fichier dépasse 10 Mio.');
  try {
    return classifyPurchaseAttachment(file.buffer);
  } catch (err) {
    if (err instanceof UnsupportedMediaTypeException) {
      throw new UnsupportedMediaTypeException({
        code: 'DOCUMENT_TYPE',
        message: 'Document refusé : seules les images PNG, JPEG, WebP et les PDF sont acceptés.',
      });
    }
    if (err instanceof HttpException && err.getStatus() === 413) {
      const body = err.getResponse() as { message?: string };
      tooLarge(body.message ?? 'Fichier trop lourd.');
    }
    throw err;
  }
}

function tooLarge(message: string): never {
  throw new HttpException({ code: 'DOCUMENT_TOO_LARGE', message }, 413);
}

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Échéance d'un document (même règle que `expiryStatus` du moteur des équipements :
 * expiré avant le jour, « bientôt » sous le délai de rappel). Recopiée ici parce que le
 * délai d'un document va jusqu'à 365 jours, au-delà de la borne du moteur (120).
 */
export function documentExpiry(
  expiresOn: string | null,
  reminderDays: number,
  today: string,
): DocumentExpiryStatus | null {
  if (expiresOn === null) return null;
  if (expiresOn < today) return 'expired';
  return expiresOn <= addDays(today, reminderDays) ? 'due_soon' : 'ok';
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const o = (JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown }).o;
    if (typeof o === 'number' && Number.isInteger(o) && o >= 0) return o;
  } catch {
    // illisible : voir ci-dessous
  }
  throw new BadRequestException({
    code: 'INVALID_CURSOR',
    message: 'Curseur de pagination illisible : reprenez la liste depuis le début.',
  });
}

function versionViewOf(v: LibraryDocumentVersionLean): DocumentVersionView {
  return {
    id: String(v._id),
    number: v.number,
    fileName: v.fileName,
    contentType: v.contentType,
    size: v.size,
    sha256: v.sha256,
    encrypted: v.encrypted,
    uploadedBy: v.uploadedBy,
    uploadedAt: new Date(v.uploadedAt).toISOString(),
    note: v.note ?? null,
  };
}

/** Projection des versions servies : jamais la clé enveloppée. */
const VERSION_PROJECTION = { wrappedKey: 0 } as const;

@Injectable()
export class LibraryDocumentsService {
  private readonly logger = new Logger('LibraryDocuments');

  constructor(
    @InjectModel(LibraryDocument.name) private readonly documents: Model<LibraryDocumentDocument>,
    @InjectModel(LibraryDocumentVersion.name)
    private readonly versions: Model<LibraryDocumentVersionDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(DocumentFoldersService) private readonly folders: DocumentFoldersService,
    @Inject(ObjectStorageService) private readonly storage: ObjectStorageService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MASTER_KEYRING) private readonly keyring: MasterKeyring | null,
  ) {}

  // ── Vues ─────────────────────────────────────────────────────────────────

  private async views(
    rows: LibraryDocumentLean[],
    index: FolderIndex,
    today: string,
  ): Promise<LibraryDocumentView[]> {
    if (rows.length === 0) return [];
    const current = await this.versions
      .find(
        { _id: { $in: rows.map((r) => new Types.ObjectId(r.currentVersionId)) } },
        VERSION_PROJECTION,
      )
      .lean<LibraryDocumentVersionLean[]>()
      .exec();
    const byId = new Map(current.map((v) => [String(v._id), v]));
    return rows.map((d) => this.viewOf(d, byId.get(d.currentVersionId)!, index, today));
  }

  private viewOf(
    d: LibraryDocumentLean,
    current: LibraryDocumentVersionLean,
    index: FolderIndex,
    today: string,
  ): LibraryDocumentView {
    return {
      id: String(d._id),
      title: d.title,
      folderId: d.folderId,
      nature: d.nature,
      tags: [...d.tags],
      links: d.links.map((l) => ({ entityType: l.entityType, entityId: l.entityId })),
      issuedOn: d.issuedOn ?? null,
      expiresOn: d.expiresOn ?? null,
      reminderDays: d.reminderDays,
      expiryStatus: documentExpiry(d.expiresOn ?? null, d.reminderDays, today),
      sensitive: d.sensitive,
      status: d.status,
      currentVersion: versionViewOf(current),
      versionCount: d.versionCount,
      canWrite: d.status === 'active' && index.canWrite(d),
      revision: d.revision,
      createdBy: d.createdBy,
      updatedBy: d.updatedBy,
      createdAt: new Date(d.createdAt).toISOString(),
      updatedAt: new Date(d.updatedAt).toISOString(),
    };
  }

  // ── Lecture ──────────────────────────────────────────────────────────────

  /** Document lisible de l'organisation, sinon 404 (jamais 403 : on ne confirme rien). */
  private async requireReadable(
    organizationId: string,
    index: FolderIndex,
    documentId: string,
  ): Promise<LibraryDocumentLean> {
    if (!OBJECT_ID.test(documentId)) documentNotFound();
    const doc = await this.documents
      .findOne({ _id: new Types.ObjectId(documentId), organizationId, deletedAt: null })
      .lean<LibraryDocumentLean>()
      .exec();
    if (!doc || !index.canRead(doc)) documentNotFound();
    return doc;
  }

  private requireWrite(index: FolderIndex, doc: LibraryDocumentLean, actor: DocumentsActor): void {
    if (doc.status !== 'active') {
      documentConflict('DOCUMENT_ARCHIVED', 'Ce document est archivé : restaurez-le d’abord.');
    }
    if (!index.canWrite(doc)) {
      documentsForbidden('docs.manage', actor.role, 'Vous ne pouvez pas modifier ce document.');
    }
    if (doc.sensitive && !actor.actions.has('docs.manage')) {
      documentsForbidden(
        'docs.manage',
        actor.role,
        'Un document sensible se gère avec `docs.manage`.',
      );
    }
  }

  async get(
    organizationId: string,
    actor: DocumentsActor,
    documentId: string,
  ): Promise<LibraryDocumentDetail> {
    const index = await this.folders.index(organizationId, actor);
    const doc = await this.requireReadable(organizationId, index, documentId);
    const versions = await this.versions
      .find({ documentId: String(doc._id), organizationId }, VERSION_PROJECTION)
      .sort({ number: -1 })
      .lean<LibraryDocumentVersionLean[]>()
      .exec();
    const current = versions.find((v) => String(v._id) === doc.currentVersionId)!;
    return {
      ...this.viewOf(doc, current, index, kinshasaDayOf(new Date())),
      versions: versions.map(versionViewOf),
    };
  }

  /** Lecture filtrée par les droits AVANT pagination ; tri par titre puis identifiant. */
  private async page(
    organizationId: string,
    actor: DocumentsActor,
    filter: FilterQuery<LibraryDocumentDocument>,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<LibraryDocumentPage> {
    const offset = decodeCursor(cursor);
    const size = limit ?? DOCUMENT_PAGE_LIMIT_DEFAULT;
    const index = await this.folders.index(organizationId, actor);
    const rows = await this.documents
      .find({ ...filter, organizationId, deletedAt: null })
      .sort({ sortTitle: 1, _id: 1 })
      .limit(SCAN_MAX)
      .lean<LibraryDocumentLean[]>()
      .exec();
    const visible = rows.filter((d) => index.canRead(d));
    const slice = visible.slice(offset, offset + size);
    return {
      items: await this.views(slice, index, kinshasaDayOf(new Date())),
      nextCursor: offset + size < visible.length ? encodeCursor(offset + size) : null,
      total: visible.length,
    };
  }

  async list(
    organizationId: string,
    actor: DocumentsActor,
    q: DocumentListQuery,
  ): Promise<LibraryDocumentPage> {
    const filter: FilterQuery<LibraryDocumentDocument> = { status: 'active' };
    if (q.folderId !== undefined) filter.folderId = q.folderId;
    if (q.entityType !== undefined && q.entityId !== undefined) {
      filter.links = { $elemMatch: { entityType: q.entityType, entityId: q.entityId } };
    }
    return this.page(organizationId, actor, filter, q.cursor, q.limit);
  }

  /** Recherche par métadonnées (§ 4.3) : jamais dans le contenu des fichiers. */
  async search(
    organizationId: string,
    actor: DocumentsActor,
    b: DocumentSearchBody,
  ): Promise<LibraryDocumentPage> {
    const filter: FilterQuery<LibraryDocumentDocument> = {};
    if (!b.includeArchived) filter.status = 'active';
    if (b.text) {
      const key = normalizeDocumentSearchKey(b.text);
      if (key !== '') filter.searchKey = { $regex: escapeRegex(key) };
    }
    if (b.tags && b.tags.length > 0) filter.tags = { $all: b.tags };
    if (b.nature) filter.nature = b.nature;
    if (b.folderId !== undefined) filter.folderId = b.folderId;
    if (b.entity) {
      filter.links = {
        $elemMatch: { entityType: b.entity.entityType, entityId: b.entity.entityId },
      };
    }
    if (b.expiresFrom || b.expiresTo) {
      filter.expiresOn = {
        $type: 'string',
        ...(b.expiresFrom ? { $gte: b.expiresFrom } : {}),
        ...(b.expiresTo ? { $lte: b.expiresTo } : {}),
      };
    }
    if (b.createdBy) filter.createdBy = b.createdBy;
    return this.page(organizationId, actor, filter, b.cursor, b.limit);
  }

  /** Échéances (§ 5.3) : documents lisibles qui expirent, sous `within` ou leur délai. */
  async deadlines(
    organizationId: string,
    actor: DocumentsActor,
    q: DocumentDeadlinesQuery,
    now: Date = new Date(),
  ): Promise<DocumentDeadlineList> {
    const today = kinshasaDayOf(now);
    const index = await this.folders.index(organizationId, actor);
    const rows = await this.documents
      .find({ organizationId, deletedAt: null, status: 'active', expiresOn: { $type: 'string' } })
      .sort({ expiresOn: 1, _id: 1 })
      .limit(SCAN_MAX)
      .lean<LibraryDocumentLean[]>()
      .exec();
    const due = rows.filter((d) => {
      if (!index.canRead(d)) return false;
      const status = documentExpiry(d.expiresOn, q.within ?? d.reminderDays, today);
      return status === 'expired' || status === 'due_soon';
    });
    const views = await this.views(due, index, today);
    return {
      today,
      items: views.map((v) => ({
        document: v,
        expiresOn: v.expiresOn!,
        status: documentExpiry(v.expiresOn, q.within ?? v.reminderDays, today) as
          'expired' | 'due_soon',
      })),
    };
  }

  // ── Liens ────────────────────────────────────────────────────────────────

  /**
   * Lier une entité : la permission de lecture de son module (403 qui la nomme), et
   * l'entité dans l'organisation (404, y compris un identifiant forgé).
   */
  private async checkLinks(
    organizationId: string,
    actor: DocumentsActor,
    links: readonly { entityType: DocumentLinkEntityType; entityId: string }[],
  ): Promise<void> {
    for (const l of links) {
      const action = DOCUMENT_LINK_READ_ACTION[l.entityType];
      if (!actor.actions.has(action)) {
        documentsForbidden(
          action,
          actor.role,
          'Vous ne pouvez pas lier un élément d’un module que vous ne consultez pas.',
        );
      }
      await this.requireEntity(organizationId, l.entityType, l.entityId);
    }
  }

  private async requireEntity(
    organizationId: string,
    entityType: DocumentLinkEntityType,
    entityId: string,
  ): Promise<void> {
    if (!OBJECT_ID.test(entityId)) linkedEntityNotFound();
    const found = await this.connection
      .collection(ENTITY_COLLECTIONS[entityType])
      .findOne({ _id: new Types.ObjectId(entityId), organizationId }, { projection: { _id: 1 } });
    if (!found) linkedEntityNotFound();
  }

  // ── Dépôt ────────────────────────────────────────────────────────────────

  /**
   * Vérifie le droit de déposer AVANT de lire le fichier : dossier inscriptible (sans
   * dossier : `docs.manage`), `docs.manage` pour un document sensible, liens lisibles.
   */
  async assertCanUpload(
    organizationId: string,
    actor: DocumentsActor,
    meta: UploadLibraryDocumentFields,
  ): Promise<void> {
    const index = await this.folders.index(organizationId, actor);
    if (meta.folderId !== null) this.folders.requireWritable(index, meta.folderId, actor);
    else if (!actor.actions.has('docs.manage')) {
      documentsForbidden(
        'docs.manage',
        actor.role,
        'Un document sans dossier se dépose avec `docs.manage`.',
      );
    }
    if (meta.folderId === null && meta.links.length === 0) {
      throw new BadRequestException({
        code: 'DOCUMENT_UNFILED',
        message: 'Un document sans dossier doit être lié à au moins un élément.',
      });
    }
    if (meta.sensitive && !actor.actions.has('docs.manage')) {
      documentsForbidden(
        'docs.manage',
        actor.role,
        'Un document sensible se dépose avec `docs.manage`.',
      );
    }
    if (meta.sensitive && !this.keyring) documentsSecretsNotConfigured();
    await this.checkLinks(organizationId, actor, meta.links);
  }

  async upload(
    organizationId: string,
    actor: DocumentsActor,
    meta: UploadLibraryDocumentFields,
    file: AcceptedPurchaseAttachment,
    rawFileName: unknown,
  ): Promise<LibraryDocumentDetail> {
    const documentId = new Types.ObjectId();
    const version = await this.storeVersion(
      organizationId,
      actor,
      String(documentId),
      1,
      meta.sensitive,
      file,
      rawFileName,
      meta.note,
    );
    const searchKey = normalizeDocumentSearchKey(meta.title);
    try {
      await this.documents.create({
        _id: documentId,
        organizationId,
        title: meta.title,
        searchKey,
        sortTitle: searchKey,
        folderId: meta.folderId,
        nature: meta.nature,
        tags: meta.tags,
        links: meta.links,
        issuedOn: meta.issuedOn,
        expiresOn: meta.expiresOn,
        reminderDays: meta.reminderDays,
        sensitive: meta.sensitive,
        currentVersionId: String(version._id),
        versionCount: 1,
        status: 'active',
        deletedAt: null,
        deletedBy: null,
        purgedAt: null,
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        _schemaVersion: 1,
      });
    } catch (err) {
      await this.versions.deleteOne({ _id: version._id }).exec();
      await this.drop([version.objectId]);
      throw err;
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'documents.uploaded',
      targetType: 'library_document',
      targetId: String(documentId),
      // Jamais le titre, les étiquettes ni le nom du fichier : seulement la forme.
      metadata: {
        nature: meta.nature,
        sensitive: meta.sensitive,
        size: file.bytes.length,
        version: 1,
      },
    });
    return this.get(organizationId, actor, String(documentId));
  }

  /** Droit d'ajouter une version, vérifié AVANT de lire le fichier. */
  async assertCanAddVersion(
    organizationId: string,
    actor: DocumentsActor,
    documentId: string,
  ): Promise<void> {
    const index = await this.folders.index(organizationId, actor);
    const doc = await this.requireReadable(organizationId, index, documentId);
    this.requireWrite(index, doc, actor);
    if (doc.sensitive && !this.keyring) documentsSecretsNotConfigured();
  }

  async addVersion(
    organizationId: string,
    actor: DocumentsActor,
    documentId: string,
    meta: UploadDocumentVersionFields,
    file: AcceptedPurchaseAttachment,
    rawFileName: unknown,
  ): Promise<LibraryDocumentDetail> {
    const index = await this.folders.index(organizationId, actor);
    const doc = await this.requireReadable(organizationId, index, documentId);
    this.requireWrite(index, doc, actor);
    return this.appendVersion(organizationId, actor, doc, file, rawFileName, meta.note);
  }

  /** Restaurer une version : la recopier comme nouvelle version (§ 4.2). */
  async restoreVersion(
    organizationId: string,
    actor: DocumentsActor,
    documentId: string,
    versionId: string,
  ): Promise<LibraryDocumentDetail> {
    const index = await this.folders.index(organizationId, actor);
    const doc = await this.requireReadable(organizationId, index, documentId);
    this.requireWrite(index, doc, actor);
    const source = await this.requireVersion(organizationId, doc, versionId);
    const bytes = await this.readVersion(organizationId, doc, source);
    return this.appendVersion(
      organizationId,
      actor,
      doc,
      { contentType: source.contentType, bytes },
      source.fileName,
      `Restauration de la version ${source.number}`,
    );
  }

  private async appendVersion(
    organizationId: string,
    actor: DocumentsActor,
    doc: LibraryDocumentLean,
    file: AcceptedPurchaseAttachment,
    rawFileName: unknown,
    note: string | null,
  ): Promise<LibraryDocumentDetail> {
    if (doc.versionCount >= DOCUMENT_LIMITS.versions) {
      documentConflict(
        'DOCUMENT_VERSIONS_FULL',
        `Un document garde ${DOCUMENT_LIMITS.versions} versions au plus.`,
      );
    }
    const documentId = String(doc._id);
    const number = doc.versionCount + 1;
    let version: LibraryDocumentVersionLean;
    try {
      version = await this.storeVersion(
        organizationId,
        actor,
        documentId,
        number,
        doc.sensitive,
        file,
        rawFileName,
        note,
      );
    } catch (err) {
      if ((err as { code?: number }).code === 11000) staleRevision();
      throw err;
    }
    const res = await this.documents
      .updateOne(
        { _id: doc._id, organizationId, versionCount: doc.versionCount, deletedAt: null },
        {
          $set: { currentVersionId: String(version._id), updatedBy: actor.userId },
          $inc: { versionCount: 1, revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1) {
      await this.versions.deleteOne({ _id: version._id }).exec();
      await this.drop([version.objectId]);
      staleRevision();
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'documents.version_added',
      targetType: 'library_document',
      targetId: documentId,
      metadata: { version: number, sensitive: doc.sensitive, size: file.bytes.length },
    });
    return this.get(organizationId, actor, documentId);
  }

  /** Chiffre si sensible, vérifie la borne commune, stocke l'objet puis la version. */
  private async storeVersion(
    organizationId: string,
    actor: DocumentsActor,
    documentId: string,
    number: number,
    sensitive: boolean,
    file: AcceptedPurchaseAttachment,
    rawFileName: unknown,
    note: string | null,
  ): Promise<LibraryDocumentVersionLean> {
    if (sensitive && !this.keyring) documentsSecretsNotConfigured();
    const versionId = new Types.ObjectId();
    const sealed = sensitive
      ? sealLibraryDocument(
          { organizationId, documentId, versionId: String(versionId) },
          file.bytes,
          this.keyring!,
          actor.userId,
        )
      : null;
    const stored = sealed ? sealed.blob : file.bytes;
    const used = await sharedAttachmentsUsage(this.connection, organizationId);
    if (used + stored.length > DOCUMENT_LIMITS.storagePerOrganizationBytes) {
      documentConflict(
        'DOCUMENT_STORAGE_FULL',
        'L’espace des pièces jointes de l’organisation (1 Gio) est plein : supprimez des pièces.',
      );
    }
    const objectId = newObjectId();
    await this.storage.putObject(
      this.bucket(),
      libraryDocumentObjectKey(objectId),
      stored,
      // Un objet chiffré n'a pas de type lisible : rien ne le sert tel quel.
      sealed ? 'application/octet-stream' : file.contentType,
    );
    try {
      const created = await this.versions.create({
        _id: versionId,
        organizationId,
        documentId,
        number,
        objectId,
        fileName: sanitizeFileName(rawFileName, file.contentType),
        contentType: file.contentType,
        size: file.bytes.length,
        storedSize: stored.length,
        sha256: createHash('sha256').update(file.bytes).digest('hex'),
        encrypted: sealed !== null,
        wrappedKey: sealed ? sealed.wrappedKey : null,
        uploadedBy: actor.userId,
        uploadedAt: new Date(),
        note,
        purgedAt: null,
        _schemaVersion: 1,
      });
      return created.toObject() as LibraryDocumentVersionLean;
    } catch (err) {
      await this.drop([objectId]);
      throw err;
    }
  }

  // ── Téléchargement ───────────────────────────────────────────────────────

  private async requireVersion(
    organizationId: string,
    doc: LibraryDocumentLean,
    versionId: string,
  ): Promise<LibraryDocumentVersionLean> {
    if (!OBJECT_ID.test(versionId)) versionNotFound();
    const v = await this.versions
      .findOne({
        _id: new Types.ObjectId(versionId),
        documentId: String(doc._id),
        organizationId,
        purgedAt: null,
      })
      .lean<LibraryDocumentVersionLean>()
      .exec();
    if (!v) versionNotFound();
    return v;
  }

  private async readVersion(
    organizationId: string,
    doc: LibraryDocumentLean,
    v: LibraryDocumentVersionLean,
  ): Promise<Buffer> {
    if (v.encrypted && !this.keyring) documentsSecretsNotConfigured();
    const object = await this.storage.getObject(
      this.bucket(),
      libraryDocumentObjectKey(v.objectId),
    );
    if (!object) versionNotFound();
    if (!v.encrypted) return object.body;
    if (!v.wrappedKey) documentUnreadable();
    try {
      return openLibraryDocument(
        { organizationId, documentId: String(doc._id), versionId: String(v._id) },
        object.body,
        v.wrappedKey,
        this.keyring!,
      );
    } catch {
      documentUnreadable();
    }
  }

  async download(
    organizationId: string,
    actor: DocumentsActor,
    documentId: string,
    versionId: string,
  ): Promise<{ version: LibraryDocumentVersionLean; body: Buffer }> {
    const index = await this.folders.index(organizationId, actor);
    const doc = await this.requireReadable(organizationId, index, documentId);
    const version = await this.requireVersion(organizationId, doc, versionId);
    if (version.encrypted && !this.keyring) documentsSecretsNotConfigured();
    const record = {
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: doc.sensitive ? 'documents.sensitive_downloaded' : 'documents.downloaded',
      targetType: 'library_document',
      targetId: documentId,
      metadata: { version: version.number, sensitive: doc.sensitive },
    };
    if (doc.sensitive) {
      try {
        await this.audit.recordStrict(record);
      } catch {
        documentsAuditUnavailable();
      }
    } else {
      await this.audit.record(record);
    }
    return { version, body: await this.readVersion(organizationId, doc, version) };
  }

  // ── Modification ─────────────────────────────────────────────────────────

  async update(
    organizationId: string,
    actor: DocumentsActor,
    documentId: string,
    body: UpdateLibraryDocumentBody,
  ): Promise<LibraryDocumentDetail> {
    const index = await this.folders.index(organizationId, actor);
    const doc = await this.requireReadable(organizationId, index, documentId);
    this.requireWrite(index, doc, actor);
    const next = {
      folderId: body.folderId !== undefined ? body.folderId : doc.folderId,
      links: body.links ?? doc.links,
    };
    if (body.folderId !== undefined && body.folderId !== doc.folderId) {
      if (body.folderId !== null) this.folders.requireWritable(index, body.folderId, actor);
      else if (!actor.actions.has('docs.manage')) {
        documentsForbidden(
          'docs.manage',
          actor.role,
          'Un document sans dossier se gère avec `docs.manage`.',
        );
      }
    }
    if (body.links !== undefined) {
      const known = new Set(doc.links.map((l) => `${l.entityType}:${l.entityId}`));
      await this.checkLinks(
        organizationId,
        actor,
        body.links.filter((l) => !known.has(`${l.entityType}:${l.entityId}`)),
      );
    }
    if (next.folderId === null && next.links.length === 0) {
      throw new BadRequestException({
        code: 'DOCUMENT_UNFILED',
        message: 'Un document sans dossier doit être lié à au moins un élément.',
      });
    }
    const issuedOn = body.issuedOn !== undefined ? body.issuedOn : doc.issuedOn;
    const expiresOn = body.expiresOn !== undefined ? body.expiresOn : doc.expiresOn;
    if (issuedOn && expiresOn && expiresOn < issuedOn) {
      throw new BadRequestException({
        code: 'DATE_BEFORE_ISSUE',
        message: 'La date d’expiration précède la date de délivrance.',
      });
    }
    // Le document doit rester lisible et inscriptible pour son auteur de la modification.
    if (!index.canWrite({ folderId: next.folderId, links: next.links })) {
      documentsForbidden(
        'docs.manage',
        actor.role,
        'Ce rangement vous retirerait l’accès au document.',
      );
    }
    const set: Record<string, unknown> = {
      updatedBy: actor.userId,
      folderId: next.folderId,
      links: next.links,
    };
    if (body.title !== undefined) {
      const key = normalizeDocumentSearchKey(body.title);
      Object.assign(set, { title: body.title, searchKey: key, sortTitle: key });
    }
    if (body.nature !== undefined) set['nature'] = body.nature;
    if (body.tags !== undefined) set['tags'] = body.tags;
    if (body.issuedOn !== undefined) set['issuedOn'] = body.issuedOn;
    if (body.expiresOn !== undefined) set['expiresOn'] = body.expiresOn;
    if (body.reminderDays !== undefined) set['reminderDays'] = body.reminderDays;
    const res = await this.documents
      .updateOne(
        { _id: doc._id, organizationId, revision: body.expectedRevision, deletedAt: null },
        { $set: set, $inc: { revision: 1 } },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision();
    return this.get(organizationId, actor, documentId);
  }

  async setStatus(
    organizationId: string,
    actor: DocumentsActor,
    documentId: string,
    status: 'active' | 'archived',
    body: DocumentRevisionBody,
  ): Promise<LibraryDocumentDetail> {
    const index = await this.folders.index(organizationId, actor);
    const doc = await this.requireReadable(organizationId, index, documentId);
    if (!index.canWrite(doc) || (doc.sensitive && !actor.actions.has('docs.manage'))) {
      documentsForbidden('docs.manage', actor.role, 'Vous ne pouvez pas modifier ce document.');
    }
    const res = await this.documents
      .updateOne(
        { _id: doc._id, organizationId, revision: body.expectedRevision, deletedAt: null },
        { $set: { status, updatedBy: actor.userId }, $inc: { revision: 1 } },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision();
    return this.get(organizationId, actor, documentId);
  }

  /** Suppression logique ; les objets partent avec `documents.purge` après 30 jours. */
  async remove(organizationId: string, actor: DocumentsActor, documentId: string): Promise<void> {
    const index = await this.folders.index(organizationId, actor);
    const doc = await this.requireReadable(organizationId, index, documentId);
    if (!index.canWrite(doc) || (doc.sensitive && !actor.actions.has('docs.manage'))) {
      documentsForbidden('docs.manage', actor.role, 'Vous ne pouvez pas supprimer ce document.');
    }
    const res = await this.documents
      .updateOne(
        { _id: doc._id, organizationId, deletedAt: null },
        { $set: { deletedAt: new Date(), deletedBy: actor.userId }, $inc: { revision: 1 } },
      )
      .exec();
    if (res.matchedCount !== 1) documentNotFound();
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'documents.deleted',
      targetType: 'library_document',
      targetId: documentId,
      metadata: { nature: doc.nature, sensitive: doc.sensitive, versions: doc.versionCount },
    });
  }

  /**
   * Tâche `documents.purge` : documents supprimés depuis 30 jours ou plus — clés
   * enveloppées effacées (l'objet chiffré devient illisible à jamais), objets effacés au
   * mieux, versions marquées purgées (elles ne comptent plus dans la borne).
   */
  async purge(now: Date = new Date()): Promise<{ documents: number; versions: number }> {
    const before = new Date(now.getTime() - DOCUMENT_LIMITS.purgeAfterDays * 86_400_000);
    const report = { documents: 0, versions: 0 };
    const rows = await this.documents
      .find(
        { deletedAt: { $ne: null, $lte: before }, purgedAt: null },
        { _id: 1, organizationId: 1 },
      )
      .limit(500)
      .lean<{ _id: Types.ObjectId; organizationId: string }[]>()
      .exec();
    for (const d of rows) {
      const versions = await this.versions
        .find(
          { documentId: String(d._id), organizationId: d.organizationId, purgedAt: null },
          { objectId: 1 },
        )
        .lean<{ _id: Types.ObjectId; objectId: string }[]>()
        .exec();
      await this.versions
        .updateMany(
          { documentId: String(d._id), organizationId: d.organizationId, purgedAt: null },
          { $set: { purgedAt: now, wrappedKey: null } },
        )
        .exec();
      await this.drop(versions.map((v) => v.objectId));
      await this.documents.updateOne({ _id: d._id }, { $set: { purgedAt: now } }).exec();
      report.documents += 1;
      report.versions += versions.length;
    }
    return report;
  }

  // ── Présentation par entité (O5) ─────────────────────────────────────────

  /**
   * Fiche d'une entité : ses documents de bibliothèque lisibles ET les pièces des modules
   * propriétaires (achats, projets), chacune filtrée par la permission de son module.
   * Rien n'est copié ni indexé ; jamais une pièce RH (aucune entité `employee`).
   */
  async entityPieces(
    organizationId: string,
    actor: DocumentsActor,
    q: EntityPiecesQuery,
  ): Promise<EntityPiecesView> {
    const action = DOCUMENT_LINK_READ_ACTION[q.entityType];
    if (!actor.actions.has(action)) {
      documentsForbidden(action, actor.role, 'Vous ne consultez pas ce module.');
    }
    await this.requireEntity(organizationId, q.entityType, q.entityId);
    const library = (
      await this.page(
        organizationId,
        actor,
        {
          status: 'active',
          links: { $elemMatch: { entityType: q.entityType, entityId: q.entityId } },
        },
        undefined,
        100,
      )
    ).items;
    return {
      entityType: q.entityType,
      entityId: q.entityId,
      library,
      pieces: await this.ownerPieces(organizationId, actor, q),
    };
  }

  private async ownerPieces(
    organizationId: string,
    actor: DocumentsActor,
    q: EntityPiecesQuery,
  ): Promise<EntityPieceView[]> {
    const pieces: EntityPieceView[] = [];
    const db = this.connection;
    type Att = { fileName: string; contentType: string; size: number; uploadedAt: Date };
    const purchaseRead = actor.actions.has('purchase.read');
    if (purchaseRead && (q.entityType === 'supplier' || q.entityType === 'purchase_order')) {
      const invoiceFilter =
        q.entityType === 'supplier' ? { supplierId: q.entityId } : { orderIds: q.entityId };
      for (const inv of await db
        .collection('supplier_invoices')
        .find(
          { organizationId, ...invoiceFilter, 'attachment.size': { $gt: 0 } },
          { projection: { internalNumber: 1, attachment: 1 } },
        )
        .sort({ _id: -1 })
        .limit(200)
        .toArray()) {
        const a = inv['attachment'] as Att;
        pieces.push({
          module: 'purchases',
          ownerType: 'supplier_invoice',
          ownerId: String(inv._id),
          ownerReference: String(inv['internalNumber'] ?? '') || null,
          fileName: a.fileName,
          contentType: a.contentType,
          size: a.size,
          uploadedAt: new Date(a.uploadedAt).toISOString(),
          href: `/purchases/invoices/${String(inv._id)}/attachment`,
        });
      }
      const receptionFilter =
        q.entityType === 'supplier' ? { supplierId: q.entityId } : { orderId: q.entityId };
      for (const rec of await db
        .collection('purchase_receptions')
        .find(
          { organizationId, ...receptionFilter, 'attachment.size': { $gt: 0 } },
          { projection: { attachment: 1 } },
        )
        .sort({ _id: -1 })
        .limit(200)
        .toArray()) {
        const a = rec['attachment'] as Att;
        pieces.push({
          module: 'purchases',
          ownerType: 'purchase_reception',
          ownerId: String(rec._id),
          ownerReference: null,
          fileName: a.fileName,
          contentType: a.contentType,
          size: a.size,
          uploadedAt: new Date(a.uploadedAt).toISOString(),
          href: `/purchases/receptions/${String(rec._id)}/attachment`,
        });
      }
    }
    if (q.entityType === 'work_project' && actor.actions.has('work.read')) {
      for (const att of await db
        .collection('work_attachments')
        .find(
          { organizationId, projectId: q.entityId, deletedAt: null },
          { projection: { taskId: 1, fileName: 1, contentType: 1, size: 1, createdAt: 1 } },
        )
        .sort({ _id: -1 })
        .limit(200)
        .toArray()) {
        pieces.push({
          module: 'work',
          ownerType: 'work_task',
          ownerId: String(att['taskId']),
          ownerReference: null,
          fileName: String(att['fileName']),
          contentType: String(att['contentType']),
          size: Number(att['size']),
          uploadedAt: new Date(att['createdAt'] as Date).toISOString(),
          href: `/work/attachments/${String(att._id)}`,
        });
      }
    }
    return pieces;
  }

  // ── Interne ──────────────────────────────────────────────────────────────

  private bucket(): string {
    const bucket = this.storage.uploadsBucket();
    if (!bucket) {
      const a = this.storage.availability();
      throw new ObjectStorageUnavailableError(a.available ? 'Bucket absent.' : a.reason);
    }
    return bucket;
  }

  /** Efface des objets au mieux ; un échec est journalisé (sans contenu), jamais remonté. */
  async drop(objectIds: readonly string[]): Promise<void> {
    const bucket = this.storage.uploadsBucket();
    if (!bucket) return;
    for (const objectId of objectIds) {
      try {
        await this.storage.deleteObject(bucket, libraryDocumentObjectKey(objectId));
      } catch (err) {
        this.logger.warn(`Objet ${objectId} non supprimé du stockage : ${(err as Error).message}`);
      }
    }
  }
}
