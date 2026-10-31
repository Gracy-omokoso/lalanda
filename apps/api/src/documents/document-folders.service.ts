// Dossiers de la bibliothèque et leurs droits (ADR-0046 § 4.1). ADR-0046 — S6.
//
// Arborescence de profondeur ≤ 5, sans cycle (`409 FOLDER_CYCLE`, `409 FOLDER_TOO_DEEP`).
// L'arbre servi est FILTRÉ : un dossier invisible (nom compris) n'apparaît pas, et ses
// descendants non plus (la lecture exige chaque niveau). Un dossier restreint par
// `userIds` reste invisible d'un gestionnaire (`docs.manage`) qui n'y figure pas : il ne
// peut ni le lire, ni le modifier, ni le déplacer (404). Changer les droits d'un dossier
// est journalisé (`documents.folder_access_changed`), sans nom de dossier.

import {
  CreateDocumentFolderBody,
  DOCUMENT_DEFAULT_FOLDERS,
  DOCUMENT_FOLDER_DEFAULT_ACCESS,
  DOCUMENT_LIMITS,
  normalizeDocumentSearchKey,
  type DocumentFolderAccessInput,
  type DocumentFolderList,
  type DocumentFolderView,
  type DocumentRevisionBody,
  type UpdateDocumentFolderBody,
} from '@lalanda/shared/documents';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { ACTIONS, type Action } from '../authz/permissions.js';
import { FolderIndex, type DocumentsActor } from './document-access.js';
import {
  DocumentFolder,
  LibraryDocument,
  type DocumentFolderDocument,
  type DocumentFolderLean,
  type LibraryDocumentDocument,
} from './document.schemas.js';
import {
  documentConflict,
  documentsForbidden,
  folderNotFound,
  staleRevision,
} from './documents.errors.js';

const OBJECT_ID = /^[0-9a-f]{24}$/;

function checkAccessAction(access: DocumentFolderAccessInput | undefined): void {
  if (!access || access.read === 'all' || !('action' in access.read)) return;
  if (!(ACTIONS as readonly string[]).includes(access.read.action)) {
    throw new BadRequestException({
      code: 'INVALID_REQUEST',
      message: 'Autorisation inconnue.',
      details: {
        issues: [
          {
            path: 'access.read.action',
            code: 'FOLDER_ACTION_INVALID',
            message: 'Autorisation inconnue.',
          },
        ],
      },
    });
  }
}

@Injectable()
export class DocumentFoldersService {
  constructor(
    @InjectModel(DocumentFolder.name) private readonly folders: Model<DocumentFolderDocument>,
    @InjectModel(LibraryDocument.name) private readonly documents: Model<LibraryDocumentDocument>,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Index des dossiers de l'organisation pour un acteur (archivés compris). */
  async index(organizationId: string, actor: DocumentsActor): Promise<FolderIndex> {
    const rows = await this.folders.find({ organizationId }).lean<DocumentFolderLean[]>().exec();
    return new FolderIndex(new Map(rows.map((f) => [String(f._id), f])), actor);
  }

  viewOf(f: DocumentFolderLean, index: FolderIndex): DocumentFolderView {
    const id = String(f._id);
    return {
      id,
      name: f.name,
      parentId: f.parentId,
      depth: index.chainOf(id)?.length ?? 0,
      access: f.access,
      status: f.status,
      canWrite: index.decision(id).write,
      revision: f.revision,
      createdAt: new Date(f.createdAt).toISOString(),
      updatedAt: new Date(f.updatedAt).toISOString(),
    };
  }

  /** Arbre filtré : seuls les dossiers lisibles, triés par nom. */
  async list(organizationId: string, actor: DocumentsActor): Promise<DocumentFolderList> {
    const index = await this.index(organizationId, actor);
    const items = [...index.byId.values()]
      .filter((f) => index.decision(String(f._id)).read)
      .sort((a, b) =>
        a.sortName === b.sortName
          ? String(a._id) < String(b._id)
            ? -1
            : 1
          : a.sortName < b.sortName
            ? -1
            : 1,
      )
      .map((f) => this.viewOf(f, index));
    return { items };
  }

  /** Dossier lisible de l'organisation, sinon 404 (y compris restreint). */
  requireReadable(index: FolderIndex, folderId: string): DocumentFolderLean {
    const folder = OBJECT_ID.test(folderId) ? index.byId.get(folderId) : undefined;
    if (!folder || !index.decision(folderId).read) folderNotFound();
    return folder;
  }

  async create(
    organizationId: string,
    actor: DocumentsActor,
    body: CreateDocumentFolderBody,
  ): Promise<DocumentFolderView> {
    checkAccessAction(body.access);
    const index = await this.index(organizationId, actor);
    const parentId = body.parentId ?? null;
    if (parentId !== null) {
      this.requireReadable(index, parentId);
      const depth = index.chainOf(parentId)!.length;
      if (depth + 1 > DOCUMENT_LIMITS.folderDepth) {
        documentConflict(
          'FOLDER_TOO_DEEP',
          `L’arborescence compte ${DOCUMENT_LIMITS.folderDepth} niveaux au plus.`,
        );
      }
    }
    const created = await this.folders.create({
      organizationId,
      name: body.name,
      sortName: normalizeDocumentSearchKey(body.name),
      parentId,
      access: body.access ?? DOCUMENT_FOLDER_DEFAULT_ACCESS,
      status: 'active',
      revision: 1,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
    });
    await this.recordAccess(organizationId, actor, String(created._id), 'created', created.access);
    const after = await this.index(organizationId, actor);
    return this.viewOf(after.byId.get(String(created._id))!, after);
  }

  /** Dossiers proposés à l'activation (§ 4.1) : créés s'ils manquent, idempotent. */
  async createDefaults(organizationId: string, actor: DocumentsActor): Promise<DocumentFolderList> {
    for (const d of DOCUMENT_DEFAULT_FOLDERS) {
      const sortName = normalizeDocumentSearchKey(d.name);
      const exists = await this.folders.exists({ organizationId, parentId: null, sortName });
      if (exists) continue;
      const access: DocumentFolderAccessInput = d.readAction
        ? { read: { action: d.readAction as Action }, write: 'managers', inherit: true }
        : DOCUMENT_FOLDER_DEFAULT_ACCESS;
      const created = await this.folders.create({
        organizationId,
        name: d.name,
        sortName,
        parentId: null,
        access,
        status: 'active',
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        _schemaVersion: 1,
      });
      await this.recordAccess(organizationId, actor, String(created._id), 'created', access);
    }
    return this.list(organizationId, actor);
  }

  async update(
    organizationId: string,
    actor: DocumentsActor,
    folderId: string,
    body: UpdateDocumentFolderBody,
  ): Promise<DocumentFolderView> {
    checkAccessAction(body.access);
    const index = await this.index(organizationId, actor);
    const folder = this.requireReadable(index, folderId);
    const set: Record<string, unknown> = { updatedBy: actor.userId };
    if (body.name !== undefined) {
      set['name'] = body.name;
      set['sortName'] = normalizeDocumentSearchKey(body.name);
    }
    if (body.parentId !== undefined && body.parentId !== folder.parentId) {
      const parentId = body.parentId;
      if (parentId !== null) {
        this.requireReadable(index, parentId);
        // Cycle : le nouveau parent est le dossier lui-même ou l'un de ses descendants.
        if (index.chainOf(parentId)!.some((f) => String(f._id) === folderId)) {
          documentConflict(
            'FOLDER_CYCLE',
            'Un dossier ne peut pas être rangé dans lui-même ni dans un de ses sous-dossiers.',
          );
        }
      }
      const parentDepth = parentId === null ? 0 : index.chainOf(parentId)!.length;
      if (parentDepth + this.subtreeHeight(index, folderId) > DOCUMENT_LIMITS.folderDepth) {
        documentConflict(
          'FOLDER_TOO_DEEP',
          `L’arborescence compte ${DOCUMENT_LIMITS.folderDepth} niveaux au plus.`,
        );
      }
      set['parentId'] = parentId;
    }
    if (body.access !== undefined) set['access'] = body.access;
    const res = await this.folders
      .updateOne(
        { _id: folder._id, organizationId, revision: body.expectedRevision },
        { $set: set, $inc: { revision: 1 } },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision();
    if (body.access !== undefined || set['parentId'] !== undefined) {
      await this.recordAccess(
        organizationId,
        actor,
        folderId,
        'updated',
        body.access ?? folder.access,
      );
    }
    const after = await this.index(organizationId, actor);
    const updated = after.byId.get(folderId)!;
    return this.viewOf(updated, after);
  }

  /** Archiver : seulement vide (aucun document actif, aucun sous-dossier actif). */
  async archive(
    organizationId: string,
    actor: DocumentsActor,
    folderId: string,
    body: DocumentRevisionBody,
  ): Promise<DocumentFolderView> {
    const index = await this.index(organizationId, actor);
    const folder = this.requireReadable(index, folderId);
    const children = [...index.byId.values()].some(
      (f) => f.parentId === folderId && f.status === 'active',
    );
    const docs = await this.documents.exists({
      organizationId,
      folderId,
      deletedAt: null,
      status: 'active',
    });
    if (children || docs) {
      documentConflict(
        'FOLDER_NOT_EMPTY',
        'Ce dossier contient encore des documents ou des sous-dossiers actifs.',
      );
    }
    const res = await this.folders
      .updateOne(
        { _id: folder._id, organizationId, revision: body.expectedRevision },
        { $set: { status: 'archived', updatedBy: actor.userId }, $inc: { revision: 1 } },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision();
    const after = await this.index(organizationId, actor);
    return this.viewOf(after.byId.get(folderId)!, after);
  }

  /** Dossier où déposer : lisible ET actif ET inscriptible, sinon 404 ou 403. */
  requireWritable(index: FolderIndex, folderId: string, actor: DocumentsActor): DocumentFolderLean {
    const folder = this.requireReadable(index, folderId);
    if (folder.status !== 'active') {
      documentConflict('FOLDER_ARCHIVED', 'Ce dossier est archivé : rien ne peut y être déposé.');
    }
    if (!index.decision(folderId).write) {
      documentsForbidden('docs.manage', actor.role, 'Vous ne pouvez pas écrire dans ce dossier.');
    }
    return folder;
  }

  private subtreeHeight(index: FolderIndex, folderId: string): number {
    const children = [...index.byId.values()].filter((f) => f.parentId === folderId);
    return 1 + Math.max(0, ...children.map((c) => this.subtreeHeight(index, String(c._id))));
  }

  private async recordAccess(
    organizationId: string,
    actor: DocumentsActor,
    folderId: string,
    change: 'created' | 'updated',
    access: DocumentFolderAccessInput,
  ): Promise<void> {
    const read = access.read;
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'documents.folder_access_changed',
      targetType: 'document_folder',
      targetId: folderId,
      // La forme des droits, jamais le nom du dossier.
      metadata: {
        change,
        read: read === 'all' ? 'all' : 'action' in read ? `action:${read.action}` : 'users',
        readUserCount: read !== 'all' && 'userIds' in read ? read.userIds.length : 0,
        write: access.write === 'managers' ? 'managers' : 'users',
        inherit: access.inherit,
      },
    });
  }
}

export function isFolderObjectId(id: string): boolean {
  return Types.ObjectId.isValid(id) && OBJECT_ID.test(id);
}
