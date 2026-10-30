// Pièces jointes des achats (ADR-0044 § 2.7). ADR-0044 — P4.
//
// Motif EXACT d'ADR-0039 § 2.5 (`work/work-attachments.*`), réutilisé :
//   - images PNG, JPEG, WebP ≤ 2 Mio ASSAINIES (`account/image-validation.ts`) ;
//   - PDF ≤ 10 Mio reconnus par la signature `%PDF-`, NON analysés, servis
//     UNIQUEMENT en téléchargement (`attachment`, `nosniff`, CSP `sandbox`) ;
//   - tout autre contenu : `415 PURCHASE_ATTACHMENT_TYPE` — type déduit du CONTENU ;
//   - clé `purchase-attachments/<objectId>` tirée au hasard ;
//   - 1 Gio par organisation EN COMMUN avec les pièces des projets.
//
// Une pièce par réception et une par facture fournisseur (R3) : ses métadonnées sont
// portées par le document (`attachment`). Remplacer une pièce efface l'ancien objet
// au mieux (un objet orphelin est inoffensif : clé au hasard, aucune URL publique).

import { createHash } from 'node:crypto';

import {
  PURCHASE_ATTACHMENT_LIMITS,
  type PurchaseAttachmentType,
  type PurchaseAttachmentView,
} from '@lalanda/shared/purchases';
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { Request, Response } from 'express';
import type { Connection } from 'mongoose';

import { sniffImageType, validateAndSanitizeImage } from '../../account/image-validation.js';
import { readRequestBody } from '../../account/request-body.js';
import { conflict } from '../../sales/sales.errors.js';
import {
  ObjectStorageService,
  ObjectStorageUnavailableError,
} from '../../storage/object-storage.service.js';
import { newObjectId } from '../../storage/object-key.js';
import { contentDisposition, sanitizeFileName } from '../../work/work-attachments.service.js';

const A = PURCHASE_ATTACHMENT_LIMITS;
const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');

/** Collections dont les pièces comptent dans la borne commune (§ 2.7). */
const WORK_ATTACHMENTS = 'work_attachments';
const PURCHASE_ATTACHMENT_OWNERS = ['purchase_receptions', 'supplier_invoices'] as const;

export function purchaseAttachmentObjectKey(objectId: string): string {
  return `purchase-attachments/${objectId}`;
}

/** Métadonnées d'une pièce, portées par la réception ou la facture. */
@Schema({ _id: false, strict: true })
export class PurchaseAttachmentDoc {
  @Prop({ type: String, required: true })
  objectId!: string;

  @Prop({ type: String, required: true })
  fileName!: string;

  @Prop({ type: String, required: true })
  contentType!: PurchaseAttachmentType;

  @Prop({ type: Number, required: true })
  size!: number;

  @Prop({ type: String, required: true })
  sha256!: string;

  @Prop({ type: String, required: true })
  uploadedBy!: string;

  @Prop({ type: Date, required: true })
  uploadedAt!: Date;
}
export const PurchaseAttachmentDocSchema = SchemaFactory.createForClass(PurchaseAttachmentDoc);

export function attachmentViewOf(
  doc: PurchaseAttachmentDoc | null | undefined,
): PurchaseAttachmentView | null {
  if (!doc) return null;
  return {
    fileName: doc.fileName,
    contentType: doc.contentType,
    size: doc.size,
    uploadedBy: doc.uploadedBy,
    uploadedAt: new Date(doc.uploadedAt).toISOString(),
  };
}

function rejection(status: number, code: string, message: string): never {
  throw new HttpException({ code, message }, status);
}

/** Contenu accepté, prêt à stocker. */
export interface AcceptedPurchaseAttachment {
  contentType: PurchaseAttachmentType;
  bytes: Buffer;
}

/**
 * Classe un contenu par ses octets. Rend les octets À STOCKER : reconstruits pour une
 * image, tels quels pour un PDF.
 */
export function classifyPurchaseAttachment(body: Buffer): AcceptedPurchaseAttachment {
  if (body.length === 0) rejection(400, 'EMPTY_FILE', 'Le fichier est vide.');
  if (sniffImageType(body) !== null) {
    if (body.length > A.imageMaxBytes) {
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
    if (body.length > A.pdfMaxBytes) {
      rejection(413, 'FILE_TOO_LARGE', 'Un PDF joint pèse au plus 10 Mio.');
    }
    return { contentType: 'application/pdf', bytes: body };
  }
  throw new UnsupportedMediaTypeException({
    code: 'PURCHASE_ATTACHMENT_TYPE',
    message: 'Pièce refusée : seules les images PNG, JPEG, WebP et les PDF sont acceptés.',
  });
}

/** Traduit une panne du stockage en réponse HTTP (motif des pièces de projet). */
export function storageFailure(cause: unknown): HttpException {
  if (cause instanceof HttpException) return cause;
  if (cause instanceof ObjectStorageUnavailableError) {
    return new ServiceUnavailableException({ code: 'STORAGE_UNAVAILABLE', message: cause.reason });
  }
  return new ServiceUnavailableException({
    code: 'STORAGE_FAILURE',
    message: 'Le stockage des fichiers n’a pas pu traiter la demande.',
  });
}

export function attachmentNotFound(): never {
  throw new NotFoundException({
    code: 'PURCHASE_ATTACHMENT_NOT_FOUND',
    message: 'Aucune pièce jointe.',
  });
}

/** Lit le corps binaire brut de la requête (borné à la taille d'un PDF). */
export async function readAttachmentBody(req: Request): Promise<AcceptedPurchaseAttachment> {
  const read = await readRequestBody(req, A.pdfMaxBytes);
  if (!read.ok) {
    if (read.reason === 'TOO_LARGE') {
      rejection(413, 'FILE_TOO_LARGE', 'Le fichier dépasse 10 Mio.');
    }
    throw new BadRequestException({ code: 'UPLOAD_ABORTED', message: 'Envoi interrompu.' });
  }
  return classifyPurchaseAttachment(read.body);
}

/** Sert une pièce : en-têtes INERTES, PDF en téléchargement seulement. */
export function sendAttachment(res: Response, meta: PurchaseAttachmentDoc, body: Buffer): void {
  const isPdf = meta.contentType === 'application/pdf';
  res
    .status(200)
    .set({
      // Le type servi est celui déduit du contenu au dépôt, jamais celui du stockage.
      'Content-Type': meta.contentType,
      'Content-Length': String(body.length),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': contentDisposition(isPdf ? 'attachment' : 'inline', meta.fileName),
      'Cache-Control': 'private, no-store',
    })
    .end(body);
}

@Injectable()
export class PurchaseAttachmentsService {
  private readonly logger = new Logger('PurchaseAttachments');

  constructor(
    @Inject(ObjectStorageService) private readonly storage: ObjectStorageService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private bucket(): string {
    const bucket = this.storage.uploadsBucket();
    if (!bucket) {
      const a = this.storage.availability();
      throw new ObjectStorageUnavailableError(a.available ? 'Bucket absent.' : a.reason);
    }
    return bucket;
  }

  /** Octets occupés par l'organisation : pièces de projet et pièces des achats. */
  private async usage(organizationId: string): Promise<number> {
    const sum = async (collection: string, match: Record<string, unknown>, field: string) => {
      const [row] = await this.connection
        .collection(collection)
        .aggregate<{ total: number }>([
          { $match: { organizationId, ...match } },
          { $group: { _id: null, total: { $sum: field } } },
        ])
        .toArray();
      return row?.total ?? 0;
    };
    const parts = await Promise.all([
      sum(WORK_ATTACHMENTS, { deletedAt: null }, '$size'),
      ...PURCHASE_ATTACHMENT_OWNERS.map((c) =>
        sum(c, { 'attachment.size': { $gt: 0 } }, '$attachment.size'),
      ),
    ]);
    return parts.reduce((a, b) => a + b, 0);
  }

  /** Stocke l'objet (avant tout document qui le désigne) et rend ses métadonnées. */
  async store(
    organizationId: string,
    file: AcceptedPurchaseAttachment,
    rawFileName: unknown,
    uploadedBy: string,
    replacedSize = 0,
  ): Promise<PurchaseAttachmentDoc> {
    const used = (await this.usage(organizationId)) - replacedSize;
    if (used + file.bytes.length > A.storagePerOrganizationBytes) {
      conflict(
        'PURCHASE_STORAGE_FULL',
        'L’espace des pièces jointes de l’organisation (1 Gio) est plein : supprimez des pièces.',
      );
    }
    const bucket = this.bucket();
    const objectId = newObjectId();
    await this.storage.putObject(
      bucket,
      purchaseAttachmentObjectKey(objectId),
      file.bytes,
      file.contentType,
    );
    return {
      objectId,
      fileName: sanitizeFileName(rawFileName, file.contentType),
      contentType: file.contentType,
      size: file.bytes.length,
      sha256: createHash('sha256').update(file.bytes).digest('hex'),
      uploadedBy,
      uploadedAt: new Date(),
    };
  }

  /** Octets d'une pièce ; `null` si l'objet a disparu du stockage. */
  async read(meta: PurchaseAttachmentDoc): Promise<Buffer | null> {
    const object = await this.storage.getObject(
      this.bucket(),
      purchaseAttachmentObjectKey(meta.objectId),
    );
    return object ? object.body : null;
  }

  /** Efface un objet au mieux ; un échec est journalisé, jamais remonté. */
  async drop(objectId: string): Promise<void> {
    const bucket = this.storage.uploadsBucket();
    if (!bucket) return;
    try {
      await this.storage.deleteObject(bucket, purchaseAttachmentObjectKey(objectId));
    } catch (err) {
      this.logger.warn(`Pièce ${objectId} non supprimée du stockage : ${(err as Error).message}`);
    }
  }
}
