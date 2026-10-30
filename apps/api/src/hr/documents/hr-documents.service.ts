// Documents RH — dépôt, liste, téléchargement, suppression (ADR-0045 § 2.8, § 3.3).
// ADR-0045 — H4.
//
// Stockage : motif EXACT des pièces jointes d'ADR-0039 § 2.5, réutilisé par les achats
// (`purchases/attachments/purchase-attachments.ts`) : images ≤ 2 Mio ASSAINIES, PDF ≤
// 10 Mio reconnus par `%PDF-` et NON analysés, type déduit du contenu, clé au hasard
// `hr-documents/<objectId>`, borne de 1 Gio par organisation EN COMMUN avec les pièces
// des projets et des achats. Une pièce SENSIBLE est chiffrée côté application AVANT le
// stockage (`hr-document-crypto.ts`) : ni le stockage, ni les journaux, ni le disque ne
// voient son clair.
//
// Droits (EFFECTIFS, jamais un `if (role === …)`) :
//   - voir un document : `hr.sensitive.read` (tous), `hr.read` (non sensibles), le
//     collaborateur lui-même (`visibleToEmployee`) ; le manager, non ;
//   - déposer : `hr.manage` (+ `hr.sensitive.read` si sensible) ; le collaborateur
//     lui-même pour un justificatif d'absence (`leave_justification`, qui lui reste
//     visible) ;
//   - supprimer : `hr.manage` (+ `hr.sensitive.read` si sensible).
// Un collaborateur hors portée, ou un document d'une autre organisation : 404.
// Télécharger est journalisé ; pour une pièce sensible, l'audit est STRICT et écrit
// AVANT de servir (`hr.document.downloaded`) : sans trace, rien n'est servi.

import { createHash } from 'node:crypto';

import {
  HR_LIMITS,
  type HrDocumentPage,
  type HrDocumentView,
  type ListHrDocumentsQuery,
  type UploadHrDocumentFields,
} from '@lalanda/shared/hr';
import { PURCHASE_ATTACHMENT_LIMITS } from '@lalanda/shared/purchases';
import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
  BadRequestException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { MASTER_KEYRING } from '../../integrations/keyring.provider.js';
import type { MasterKeyring } from '../../integrations/secrets-crypto.js';
import {
  classifyPurchaseAttachment,
  type AcceptedPurchaseAttachment,
} from '../../purchases/attachments/purchase-attachments.js';
import { conflict } from '../../sales/sales.errors.js';
import {
  ObjectStorageService,
  ObjectStorageUnavailableError,
} from '../../storage/object-storage.service.js';
import { newObjectId } from '../../storage/object-key.js';
import { sanitizeFileName } from '../../work/work-attachments.service.js';
import {
  auditUnavailable,
  employeeNotFound,
  secretsNotConfigured,
  sensitiveForbidden,
} from '../scope/hr-errors.js';
import type { HrViewer } from '../scope/hr-scope.service.js';
import { openHrDocument, sealHrDocument } from './hr-document-crypto.js';
import {
  HR_DOCUMENTS_COLLECTION,
  HrDocument,
  hrDocumentObjectKey,
  type HrDocumentDocument,
  type HrDocumentLean,
} from './hr-document.schema.js';

export interface HrDocumentActor {
  userId: string;
  role: string;
}

/** Collections dont les pièces comptent dans la borne commune (ADR-0039 § 2.5). */
const SHARED_STORAGE: readonly { collection: string; match: object; field: string }[] = [
  { collection: 'work_attachments', match: { deletedAt: null }, field: '$size' },
  {
    collection: 'purchase_receptions',
    match: { 'attachment.size': { $gt: 0 } },
    field: '$attachment.size',
  },
  {
    collection: 'supplier_invoices',
    match: { 'attachment.size': { $gt: 0 } },
    field: '$attachment.size',
  },
  { collection: HR_DOCUMENTS_COLLECTION, match: { deletedAt: null }, field: '$storedSize' },
];

export function hrDocumentNotFound(): never {
  throw new NotFoundException({ code: 'HR_DOCUMENT_NOT_FOUND', message: 'Document introuvable.' });
}

function forbiddenHr(action: 'hr.read' | 'hr.manage', role: string | null): never {
  throw new ForbiddenException({
    code: 'FORBIDDEN',
    action,
    role,
    customized: false,
    message:
      action === 'hr.read'
        ? 'Votre rôle ne permet pas de consulter les documents de ce collaborateur.'
        : 'Votre rôle ne permet pas de déposer ce document.',
  });
}

/** Partie fichier reçue (formulaire `multipart/form-data`, en mémoire, bornée à 10 Mio). */
export interface HrUploadedFile {
  buffer: Buffer;
  originalname?: string;
}

/** Classe le fichier par son contenu (`415 HR_DOCUMENT_TYPE` sinon). */
export function classifyHrDocument(file: HrUploadedFile | undefined): AcceptedPurchaseAttachment {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new BadRequestException({
      code: 'HR_DOCUMENT_FILE_MISSING',
      message: 'Fichier attendu dans la partie « file » du formulaire.',
    });
  }
  if (file.buffer.length > HR_LIMITS.documentPdfMaxBytes) {
    throw new HttpException({ code: 'FILE_TOO_LARGE', message: 'Le fichier dépasse 10 Mio.' }, 413);
  }
  try {
    return classifyPurchaseAttachment(file.buffer);
  } catch (err) {
    if (err instanceof UnsupportedMediaTypeException) {
      throw new UnsupportedMediaTypeException({
        code: 'HR_DOCUMENT_TYPE',
        message: 'Document refusé : seules les images PNG, JPEG, WebP et les PDF sont acceptés.',
      });
    }
    throw err;
  }
}

/** Ce que le lecteur peut faire sur les documents d'un collaborateur. */
interface DocumentAccess {
  isSelf: boolean;
  hrRead: boolean;
  sensitive: boolean;
  manage: boolean;
}

export function documentViewOf(d: HrDocumentLean): HrDocumentView {
  return {
    id: String(d._id),
    employeeId: d.employeeId,
    category: d.category,
    label: d.label,
    sensitive: d.sensitive,
    encrypted: d.encrypted,
    visibleToEmployee: d.visibleToEmployee,
    issuedOn: d.issuedOn ?? null,
    expiresOn: d.expiresOn ?? null,
    fileName: d.fileName,
    contentType: d.contentType,
    size: d.size,
    uploadedBy: d.uploadedBy,
    uploadedAt: new Date(d.uploadedAt).toISOString(),
  };
}

/** Projection des listes : jamais la clé enveloppée. */
const LIST_PROJECTION = { wrappedKey: 0 } as const;

@Injectable()
export class HrDocumentsService {
  private readonly logger = new Logger('HrDocuments');

  constructor(
    @InjectModel(HrDocument.name) private readonly documents: Model<HrDocumentDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(ObjectStorageService) private readonly storage: ObjectStorageService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MASTER_KEYRING) private readonly keyring: MasterKeyring | null,
  ) {}

  // ── Droits ───────────────────────────────────────────────────────────────

  /** Portée du lecteur sur le collaborateur ; hors portée → 404, manager seul → 403. */
  private accessTo(viewer: HrViewer, employeeId: string): DocumentAccess {
    const employee = viewer.byId.get(employeeId);
    if (!employee) employeeNotFound();
    const isSelf = viewer.scope.selfEmployeeId === employeeId;
    const hrRead = viewer.actions.has('hr.read');
    const inTeam = viewer.scope.teamEmployeeIds.includes(employeeId);
    if (!hrRead && !isSelf) {
      if (inTeam) forbiddenHr('hr.read', viewer.role);
      employeeNotFound();
    }
    return {
      isSelf,
      hrRead,
      sensitive: viewer.actions.has('hr.sensitive.read'),
      manage: viewer.actions.has('hr.manage'),
    };
  }

  private static sees(access: DocumentAccess, d: HrDocumentLean): boolean {
    if (access.isSelf && d.visibleToEmployee) return true;
    if (access.sensitive) return true;
    return access.hrRead && !d.sensitive;
  }

  // ── Lecture ──────────────────────────────────────────────────────────────

  async list(
    organizationId: string,
    viewer: HrViewer,
    employeeId: string,
    query: ListHrDocumentsQuery,
  ): Promise<HrDocumentPage> {
    const access = this.accessTo(viewer, employeeId);
    const rows = await this.documents
      .find(
        {
          organizationId,
          employeeId,
          deletedAt: null,
          ...(query.category ? { category: query.category } : {}),
        },
        LIST_PROJECTION,
      )
      .sort({ uploadedAt: -1, _id: -1 })
      .lean<HrDocumentLean[]>()
      .exec();
    return {
      items: rows.filter((d) => HrDocumentsService.sees(access, d)).map(documentViewOf),
    };
  }

  /** Mes documents visibles (`GET /hr/me`) ; vide sans fiche reliée. */
  async mine(organizationId: string, viewer: HrViewer): Promise<HrDocumentView[]> {
    const selfId = viewer.scope.selfEmployeeId;
    if (!selfId) return [];
    const self = viewer.byId.get(selfId);
    if (!self || self.status === 'anonymized') return [];
    const rows = await this.documents
      .find(
        { organizationId, employeeId: selfId, deletedAt: null, visibleToEmployee: true },
        LIST_PROJECTION,
      )
      .sort({ uploadedAt: -1, _id: -1 })
      .limit(100)
      .lean<HrDocumentLean[]>()
      .exec();
    return rows.map(documentViewOf);
  }

  // ── Dépôt ────────────────────────────────────────────────────────────────

  /**
   * Vérifie le droit de déposer AVANT de lire le corps (rien n'est lu pour rien).
   * Rend les métadonnées définitives (un justificatif déposé par le collaborateur lui
   * reste visible).
   */
  assertCanUpload(
    viewer: HrViewer,
    employeeId: string,
    meta: UploadHrDocumentFields,
  ): UploadHrDocumentFields {
    const access = this.accessTo(viewer, employeeId);
    const employee = viewer.byId.get(employeeId)!;
    if (employee.status === 'anonymized') {
      conflict(
        'HR_DOCUMENT_EMPLOYEE_ANONYMIZED',
        'Ce collaborateur est anonymisé : aucun document ne peut y être ajouté.',
      );
    }
    if (access.manage) {
      if (meta.sensitive && !access.sensitive) sensitiveForbidden(viewer.role);
      return meta;
    }
    if (access.isSelf && meta.category === 'leave_justification') {
      return { ...meta, sensitive: true, visibleToEmployee: true };
    }
    forbiddenHr('hr.manage', viewer.role);
  }

  async upload(
    organizationId: string,
    employeeId: string,
    meta: UploadHrDocumentFields,
    file: AcceptedPurchaseAttachment,
    rawFileName: unknown,
    actor: HrDocumentActor,
  ): Promise<HrDocumentView> {
    if (meta.sensitive && !this.keyring) secretsNotConfigured();
    const documentId = new Types.ObjectId();
    const objectId = newObjectId();
    const sealed = meta.sensitive
      ? sealHrDocument(
          { organizationId, employeeId, documentId: String(documentId) },
          file.bytes,
          this.keyring!,
          actor.userId,
        )
      : null;
    const stored = sealed ? sealed.blob : file.bytes;

    const used = await this.usage(organizationId);
    if (used + stored.length > PURCHASE_ATTACHMENT_LIMITS.storagePerOrganizationBytes) {
      conflict(
        'HR_STORAGE_FULL',
        'L’espace des pièces jointes de l’organisation (1 Gio) est plein : supprimez des pièces.',
      );
    }
    const bucket = this.bucket();
    await this.storage.putObject(
      bucket,
      hrDocumentObjectKey(objectId),
      stored,
      // Un objet chiffré n'a pas de type lisible : rien ne le sert tel quel.
      sealed ? 'application/octet-stream' : file.contentType,
    );
    const now = new Date();
    try {
      await this.documents.create({
        _id: documentId,
        organizationId,
        employeeId,
        category: meta.category,
        label: meta.label,
        sensitive: meta.sensitive,
        visibleToEmployee: meta.visibleToEmployee,
        issuedOn: meta.issuedOn,
        expiresOn: meta.expiresOn,
        objectId,
        fileName: sanitizeFileName(rawFileName, file.contentType),
        contentType: file.contentType,
        size: file.bytes.length,
        storedSize: stored.length,
        storedSha256: createHash('sha256').update(stored).digest('hex'),
        encrypted: sealed !== null,
        wrappedKey: sealed ? sealed.wrappedKey : null,
        uploadedBy: actor.userId,
        uploadedAt: now,
        deletedAt: null,
        deletedBy: null,
        revision: 1,
        _schemaVersion: 1,
      });
    } catch (err) {
      await this.drop([objectId]);
      throw err;
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.document.uploaded',
      targetType: 'hr_document',
      targetId: String(documentId),
      // Jamais le libellé ni le nom du fichier : seulement la forme.
      metadata: {
        employeeId,
        category: meta.category,
        sensitive: meta.sensitive,
        size: file.bytes.length,
      },
    });
    const created = await this.documents
      .findById(documentId, LIST_PROJECTION)
      .lean<HrDocumentLean>()
      .exec();
    return documentViewOf(created!);
  }

  // ── Téléchargement ───────────────────────────────────────────────────────

  async download(
    organizationId: string,
    viewer: HrViewer,
    documentId: string,
    actor: HrDocumentActor,
  ): Promise<{ doc: HrDocumentLean; body: Buffer }> {
    const doc = await this.requireOwn(organizationId, documentId);
    let access: DocumentAccess;
    try {
      access = this.accessTo(viewer, doc.employeeId);
    } catch (err) {
      // Collaborateur hors portée : on ne confirme pas l'existence du document.
      if (err instanceof NotFoundException) hrDocumentNotFound();
      throw err;
    }
    if (!HrDocumentsService.sees(access, doc)) {
      if (access.hrRead) sensitiveForbidden(viewer.role);
      hrDocumentNotFound();
    }
    if (doc.sensitive && !this.keyring) secretsNotConfigured();

    const record = {
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.document.downloaded',
      targetType: 'hr_document',
      targetId: documentId,
      metadata: {
        employeeId: doc.employeeId,
        category: doc.category,
        sensitive: doc.sensitive,
        self: access.isSelf,
      },
    };
    if (doc.sensitive) {
      try {
        await this.audit.recordStrict(record);
      } catch {
        auditUnavailable();
      }
    } else {
      await this.audit.record(record);
    }

    const object = await this.storage.getObject(this.bucket(), hrDocumentObjectKey(doc.objectId));
    if (!object) hrDocumentNotFound();
    if (!doc.encrypted) return { doc, body: object.body };
    if (!doc.wrappedKey) unreadable();
    try {
      return {
        doc,
        body: openHrDocument(
          { organizationId, employeeId: doc.employeeId, documentId },
          object.body,
          doc.wrappedKey,
          this.keyring!,
        ),
      };
    } catch {
      unreadable();
    }
  }

  // ── Suppression ──────────────────────────────────────────────────────────

  async remove(
    organizationId: string,
    viewer: HrViewer,
    documentId: string,
    actor: HrDocumentActor,
  ): Promise<void> {
    const doc = await this.requireOwn(organizationId, documentId);
    if (!viewer.byId.has(doc.employeeId)) hrDocumentNotFound();
    if (doc.sensitive && !viewer.actions.has('hr.sensitive.read')) sensitiveForbidden(viewer.role);
    const res = await this.documents
      .updateOne(
        { _id: doc._id, organizationId, deletedAt: null },
        {
          $set: { deletedAt: new Date(), deletedBy: actor.userId, wrappedKey: null },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1) hrDocumentNotFound();
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.document.deleted',
      targetType: 'hr_document',
      targetId: documentId,
      metadata: { employeeId: doc.employeeId, category: doc.category, sensitive: doc.sensitive },
    });
    await this.drop([doc.objectId]);
  }

  /**
   * Efface les documents SENSIBLES d'un collaborateur (anonymisation, purge de
   * conservation), dans la transaction de l'appelant : suppression logique et clé
   * enveloppée effacée (l'objet chiffré devient illisible à jamais). Rend les objets
   * à effacer du stockage APRÈS la transaction.
   */
  async eraseSensitive(
    organizationId: string,
    employeeId: string,
    actorUserId: string,
    session: ClientSession,
  ): Promise<string[]> {
    const rows = await this.documents
      .find(
        { organizationId, employeeId, sensitive: true, deletedAt: null },
        { objectId: 1 },
        { session },
      )
      .lean<{ objectId: string }[]>()
      .exec();
    if (rows.length === 0) return [];
    await this.documents
      .updateMany(
        { organizationId, employeeId, sensitive: true, deletedAt: null },
        {
          $set: { deletedAt: new Date(), deletedBy: actorUserId, wrappedKey: null },
          $inc: { revision: 1 },
        },
        { session },
      )
      .exec();
    return rows.map((r) => r.objectId);
  }

  /** Efface des objets au mieux ; un échec est journalisé (sans contenu), jamais remonté. */
  async drop(objectIds: readonly string[]): Promise<void> {
    const bucket = this.storage.uploadsBucket();
    if (!bucket) return;
    for (const objectId of objectIds) {
      try {
        await this.storage.deleteObject(bucket, hrDocumentObjectKey(objectId));
      } catch (err) {
        this.logger.warn(
          `Document ${objectId} non supprimé du stockage : ${(err as Error).message}`,
        );
      }
    }
  }

  // ── Interne ──────────────────────────────────────────────────────────────

  private async requireOwn(organizationId: string, documentId: string): Promise<HrDocumentLean> {
    if (!Types.ObjectId.isValid(documentId) || !/^[0-9a-f]{24}$/i.test(documentId)) {
      hrDocumentNotFound();
    }
    const doc = await this.documents
      .findOne({ _id: new Types.ObjectId(documentId), organizationId, deletedAt: null })
      .lean<HrDocumentLean>()
      .exec();
    if (!doc) hrDocumentNotFound();
    return doc;
  }

  private bucket(): string {
    const bucket = this.storage.uploadsBucket();
    if (!bucket) {
      const a = this.storage.availability();
      throw new ObjectStorageUnavailableError(a.available ? 'Bucket absent.' : a.reason);
    }
    return bucket;
  }

  private async usage(organizationId: string): Promise<number> {
    const parts = await Promise.all(
      SHARED_STORAGE.map(async ({ collection, match, field }) => {
        const [row] = await this.connection
          .collection(collection)
          .aggregate<{ total: number }>([
            { $match: { organizationId, ...match } },
            { $group: { _id: null, total: { $sum: field } } },
          ])
          .toArray();
        return row?.total ?? 0;
      }),
    );
    return parts.reduce((a, b) => a + b, 0);
  }
}

function unreadable(): never {
  throw new HttpException(
    { code: 'HR_DOCUMENT_UNREADABLE', message: 'Ce document ne peut pas être déchiffré.' },
    500,
  );
}
