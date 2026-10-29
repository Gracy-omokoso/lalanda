// Pièces jointes des tâches — ADR-0039 § 2.5.
//
//   - images PNG, JPEG, WebP ≤ 2 Mio : ASSAINIES par `account/image-validation.ts`
//     (octets reconstruits, métadonnées retirées), servies `inline` ;
//   - PDF ≤ 10 Mio : reconnus par leur signature `%PDF-`, NON analysés, servis
//     uniquement en téléchargement, en-têtes inertes (décision ouverte n° 7) ;
//   - tout autre contenu : `415 WORK_ATTACHMENT_TYPE` — le type est déduit du
//     CONTENU, jamais du nom ni de l'en-tête du client ;
//   - borne technique : 1 Gio de pièces non supprimées par organisation
//     (`409 WORK_STORAGE_FULL`).
//
// Supprimer marque `deletedAt` puis efface l'objet (au mieux).

import { createHash } from 'node:crypto';

import { WORK_LIMITS, type WorkAttachmentView } from '@lalanda/shared/work';
import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { sniffImageType, validateAndSanitizeImage } from '../account/image-validation.js';
import { ObjectStorageService, type StoredObject } from '../storage/object-storage.service.js';
import { newObjectId } from '../storage/object-key.js';
import {
  actorCan,
  attachmentNotFound,
  conflict,
  forbidden,
  isWorkId,
  oid,
  unsupportedType,
  type WorkActor,
} from './work.common.js';
import { WorkActivityService } from './work-activity.service.js';
import { attachmentViewOf } from './work-comments.service.js';
import {
  dropAttachmentObjects,
  requireUploadsBucket,
  workAttachmentObjectKey,
} from './work-attachments.storage.js';
import { WorkMembersService } from './work-members.service.js';
import { WorkTasksService } from './work-tasks.service.js';
import {
  WorkAttachment,
  type WorkAttachmentDocument,
  type WorkAttachmentLean,
  type WorkAttachmentType,
} from './work.schemas.js';

/** Plus grand corps lu : celui d'un PDF. Une image est bornée après détection. */
export const WORK_ATTACHMENT_READ_LIMIT = WORK_LIMITS.pdfMaxBytes;

const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');

/** Contenu accepté, prêt à stocker. */
export interface AcceptedAttachment {
  contentType: WorkAttachmentType;
  bytes: Buffer;
}

function rejection(status: number, code: string, message: string): never {
  throw new HttpException({ code, message }, status);
}

/**
 * Classe un contenu par ses octets (ADR-0039 § 2.5). Rend les octets À STOCKER :
 * reconstruits pour une image, tels quels pour un PDF.
 */
export function classifyAttachment(body: Buffer): AcceptedAttachment {
  if (body.length === 0) rejection(400, 'EMPTY_FILE', 'Le fichier est vide.');
  if (sniffImageType(body) !== null) {
    if (body.length > WORK_LIMITS.imageMaxBytes) {
      rejection(413, 'FILE_TOO_LARGE', 'Une image jointe pèse au plus 2 Mio.');
    }
    const verdict = validateAndSanitizeImage(body);
    if (!verdict.ok) {
      const status =
        verdict.code === 'FILE_TOO_LARGE'
          ? 413
          : verdict.code === 'UNSUPPORTED_IMAGE_TYPE'
            ? 415
            : verdict.code === 'IMAGE_DIMENSIONS_REJECTED'
              ? 422
              : 400;
      rejection(status, verdict.code, verdict.message);
    }
    return { contentType: verdict.contentType, bytes: verdict.bytes };
  }
  if (body.length >= PDF_MAGIC.length && body.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    if (body.length > WORK_LIMITS.pdfMaxBytes) {
      rejection(413, 'FILE_TOO_LARGE', 'Un PDF joint pèse au plus 10 Mio.');
    }
    return { contentType: 'application/pdf', bytes: body };
  }
  unsupportedType('Pièce refusée : seules les images PNG, JPEG, WebP et les PDF sont acceptés.');
}

const EXTENSIONS: Record<WorkAttachmentType, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

/**
 * Nom de fichier assaini (≤ 200) : en-tête `X-File-Name` encodé URI, séparateurs
 * de chemin et caractères de contrôle retirés. Il n'est qu'une étiquette : il ne
 * décide jamais du type.
 */
export function sanitizeFileName(raw: unknown, contentType: WorkAttachmentType): string {
  let name = '';
  if (typeof raw === 'string') {
    try {
      name = decodeURIComponent(raw);
    } catch {
      name = raw;
    }
  }
  name = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[/\\]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, WORK_LIMITS.attachmentFileNameMax);
  return name === '' ? `piece-jointe${EXTENSIONS[contentType]}` : name;
}

/** En-tête `Content-Disposition` : forme ASCII et forme UTF-8 (RFC 6266). */
export function contentDisposition(kind: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

@Injectable()
export class WorkAttachmentsService {
  private readonly logger = new Logger('WorkAttachments');

  constructor(
    @InjectModel(WorkAttachment.name) private readonly attachments: Model<WorkAttachmentDocument>,
    @Inject(WorkTasksService) private readonly tasks: WorkTasksService,
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
    @Inject(WorkActivityService) private readonly activity: WorkActivityService,
    @Inject(ObjectStorageService) private readonly storage: ObjectStorageService,
  ) {}

  private async requireOwn(organizationId: string, attachmentId: string): Promise<WorkAttachmentLean> {
    if (!isWorkId(attachmentId)) attachmentNotFound();
    const doc = await this.attachments
      .findOne({ _id: oid(attachmentId), organizationId, deletedAt: null })
      .lean<WorkAttachmentLean>()
      .exec();
    if (!doc) attachmentNotFound();
    return doc;
  }

  async list(organizationId: string, taskId: string): Promise<{ items: WorkAttachmentView[] }> {
    const task = await this.tasks.requireOwn(organizationId, taskId);
    const docs = await this.attachments
      .find({ organizationId, taskId: String(task._id), deletedAt: null })
      .sort({ createdAt: 1, _id: 1 })
      .lean<WorkAttachmentLean[]>()
      .exec();
    const refs = await this.members.refs(docs.map((d) => d.uploadedBy));
    return { items: docs.map((d) => attachmentViewOf(d, refs)) };
  }

  /** Tâche écrivable : vérifié AVANT de lire le corps (on ne lit pas pour rien). */
  async assertUploadable(organizationId: string, taskId: string): Promise<void> {
    await this.tasks.requireWritable(organizationId, taskId);
  }

  async upload(
    organizationId: string,
    taskId: string,
    file: AcceptedAttachment,
    rawFileName: unknown,
    actor: WorkActor,
  ): Promise<WorkAttachmentView> {
    const { task } = await this.tasks.requireWritable(organizationId, taskId);
    const [usage] = await this.attachments
      .aggregate<{ total: number }>([
        { $match: { organizationId, deletedAt: null } },
        { $group: { _id: null, total: { $sum: '$size' } } },
      ])
      .exec();
    if ((usage?.total ?? 0) + file.bytes.length > WORK_LIMITS.storagePerOrganizationBytes) {
      conflict(
        'WORK_STORAGE_FULL',
        'L’espace des pièces jointes de l’organisation (1 Gio) est plein : supprimez des pièces.',
      );
    }
    const bucket = requireUploadsBucket(this.storage);
    const objectId = newObjectId();
    const fileName = sanitizeFileName(rawFileName, file.contentType);
    // 1. l'objet, 2. le document : à aucun instant une pièce ne désigne un objet absent.
    await this.storage.putObject(
      bucket,
      workAttachmentObjectKey(objectId),
      file.bytes,
      file.contentType,
    );
    const created = await this.attachments.create({
      organizationId,
      projectId: task.projectId,
      taskId: String(task._id),
      commentId: null,
      objectId,
      fileName,
      contentType: file.contentType,
      size: file.bytes.length,
      sha256: createHash('sha256').update(file.bytes).digest('hex'),
      uploadedBy: actor.userId,
      deletedAt: null,
      _schemaVersion: 1,
    });
    await this.activity.record(organizationId, {
      projectId: task.projectId,
      taskId: String(task._id),
      actorUserId: actor.userId,
      kind: 'attachment.added',
      data: { attachmentId: String(created._id), contentType: file.contentType, size: file.bytes.length },
    });
    const doc = await this.requireOwn(organizationId, String(created._id));
    return attachmentViewOf(doc, await this.members.refs([actor.userId]));
  }

  /** Octets et métadonnées ; `null` si l'objet a disparu du stockage. */
  async read(
    organizationId: string,
    attachmentId: string,
  ): Promise<{ meta: WorkAttachmentLean; object: StoredObject } | null> {
    const meta = await this.requireOwn(organizationId, attachmentId);
    const bucket = requireUploadsBucket(this.storage);
    const object = await this.storage.getObject(bucket, workAttachmentObjectKey(meta.objectId));
    return object ? { meta, object } : null;
  }

  /** Le déposant (`work.update`) ; sinon il faut `work.manage`. */
  async remove(organizationId: string, attachmentId: string, actor: WorkActor): Promise<void> {
    const current = await this.requireOwn(organizationId, attachmentId);
    if (current.uploadedBy !== actor.userId && !actorCan(actor, 'work.manage')) {
      forbidden(
        'WORK_ATTACHMENT_NOT_UPLOADER',
        'Seul le déposant, ou un gestionnaire des projets, retire une pièce jointe.',
      );
    }
    await this.tasks.requireWritable(organizationId, current.taskId);
    const res = await this.attachments
      .updateOne(
        { _id: current._id, organizationId, deletedAt: null },
        { $set: { deletedAt: new Date() } },
      )
      .exec();
    if (res.modifiedCount !== 1) return;
    await dropAttachmentObjects(this.storage, [current.objectId], this.logger);
    await this.activity.record(organizationId, {
      projectId: current.projectId,
      taskId: current.taskId,
      actorUserId: actor.userId,
      kind: 'attachment.removed',
      data: { attachmentId },
    });
  }
}
