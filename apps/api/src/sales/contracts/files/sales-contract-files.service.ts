// Pièces des engagements clients — ADR-0050 § 2.6. ADR-0050 — V2.
//
// Motif d'ADR-0039 § 2.5 et d'ADR-0044 § 2.7, restreint au PDF :
//   - PDF ≤ 10 Mio reconnu par la signature `%PDF-` (type déduit du CONTENU, jamais
//     de l'en-tête du client), NON analysé ; tout autre contenu → `422 FILE_NOT_PDF`,
//     au-delà de 10 Mio → `422 FILE_TOO_LARGE` (critère 16) ;
//   - servi UNIQUEMENT en téléchargement (`attachment`, `nosniff`, CSP `sandbox`) ;
//   - clé `sales-contract-files/<objectId>` tirée au hasard, stockage par l'adaptateur
//     des pièces jointes existant ;
//   - 1 Gio par organisation EN COMMUN avec les pièces des projets et des achats
//     (lues en lecture seule par la connexion).
//
// Ajout seul : rien n'est remplacé. Partagé par le lot V3 (copies de contrat et
// d'avenant).

import { createHash } from 'node:crypto';

import {
  SALES_CONTRACT_FILE_MIME_TYPE,
  SALES_CONTRACT_LIMITS,
  type SalesContractFileKind,
} from '@lalanda/shared/sales-contracts';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Request, Response } from 'express';
import { Types, type Connection, type Model } from 'mongoose';

import { readRequestBody } from '../../../account/request-body.js';
import {
  ObjectStorageService,
  ObjectStorageUnavailableError,
} from '../../../storage/object-storage.service.js';
import { newObjectId } from '../../../storage/object-key.js';
import { contentDisposition, sanitizeFileName } from '../../../work/work-attachments.service.js';
import { conflict } from '../../sales.errors.js';
import { isObjectIdHex } from '../../search.js';
import { contractsNotFound, unprocessable } from '../common/contracts.common.js';
import {
  SalesContractFile,
  type SalesContractFileDocument,
  type SalesContractFileLean,
} from './sales-contract-file.schema.js';

const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');
/** 1 Gio par organisation, en commun avec les pièces des projets et des achats. */
const STORAGE_PER_ORGANIZATION_BYTES = 1024 * 1024 * 1024;

/** Pièces comptées dans la borne commune : collection, filtre, champ de taille. */
const SHARED_USAGE: readonly [string, Record<string, unknown>, string][] = [
  ['work_attachments', { deletedAt: null }, '$size'],
  ['purchase_receptions', { 'attachment.size': { $gt: 0 } }, '$attachment.size'],
  ['supplier_invoices', { 'attachment.size': { $gt: 0 } }, '$attachment.size'],
  ['sales_contract_files', {}, '$size'],
];

export function salesContractFileObjectKey(objectId: string): string {
  return `sales-contract-files/${objectId}`;
}

/** Propriétaire d'une pièce : une commande, un contrat, ou un avenant d'un contrat. */
export type SalesContractFileOwner =
  { orderId: string } | { contractId: string; amendmentId: string | null };

export interface SalesContractFileView {
  id: string;
  kind: SalesContractFileKind;
  amendmentId: string | null;
  fileName: string;
  contentType: typeof SALES_CONTRACT_FILE_MIME_TYPE;
  size: number;
  sha256: string;
  uploadedBy: string;
  uploadedAt: string;
}

export function salesContractFileView(f: SalesContractFileLean): SalesContractFileView {
  return {
    id: String(f._id),
    kind: f.kind,
    amendmentId: f.amendmentId ?? null,
    fileName: f.fileName,
    contentType: SALES_CONTRACT_FILE_MIME_TYPE,
    size: f.size,
    sha256: f.sha256,
    uploadedBy: f.uploadedBy,
    uploadedAt: new Date(f.uploadedAt).toISOString(),
  };
}

/** Lit le corps binaire et vérifie : PDF seul, 10 Mio au plus (`422` sinon). */
export async function readSalesContractPdf(req: Request): Promise<Buffer> {
  const read = await readRequestBody(req, SALES_CONTRACT_LIMITS.fileMaxBytes);
  if (!read.ok) {
    if (read.reason === 'TOO_LARGE') {
      unprocessable('FILE_TOO_LARGE', 'Le PDF dépasse 10 Mio.');
    }
    throw new BadRequestException({ code: 'UPLOAD_ABORTED', message: 'Envoi interrompu.' });
  }
  const body = read.body;
  if (body.length === 0)
    throw new BadRequestException({ code: 'EMPTY_FILE', message: 'Le fichier est vide.' });
  if (body.length < PDF_MAGIC.length || !body.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    unprocessable('FILE_NOT_PDF', 'Pièce refusée : seul un PDF est accepté.');
  }
  return body;
}

/** Sert une pièce : en-têtes INERTES, téléchargement seulement. */
export function sendSalesContractFile(
  res: Response,
  meta: SalesContractFileLean,
  body: Buffer,
): void {
  res
    .status(200)
    .set({
      'Content-Type': SALES_CONTRACT_FILE_MIME_TYPE,
      'Content-Length': String(body.length),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': contentDisposition('attachment', meta.fileName),
      'Cache-Control': 'private, no-store',
    })
    .end(body);
}

function fileNotFound(): never {
  contractsNotFound('SALES_CONTRACT_FILE_NOT_FOUND', 'Pièce introuvable.');
}

function ownerFilter(owner: SalesContractFileOwner): Record<string, unknown> {
  return 'orderId' in owner
    ? { orderId: owner.orderId }
    : { contractId: owner.contractId, amendmentId: owner.amendmentId };
}

@Injectable()
export class SalesContractFilesService {
  private readonly logger = new Logger('SalesContractFiles');

  constructor(
    @InjectModel(SalesContractFile.name)
    private readonly files: Model<SalesContractFileDocument>,
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

  private async usage(organizationId: string): Promise<number> {
    const parts = await Promise.all(
      SHARED_USAGE.map(async ([collection, match, field]) => {
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

  /** Stocke l'objet puis ses métadonnées (ajout seul). */
  async add(
    organizationId: string,
    owner: SalesContractFileOwner,
    kind: SalesContractFileKind,
    bytes: Buffer,
    rawFileName: unknown,
    uploadedBy: string,
  ): Promise<SalesContractFileLean> {
    if ((await this.usage(organizationId)) + bytes.length > STORAGE_PER_ORGANIZATION_BYTES) {
      conflict(
        'SALES_CONTRACT_STORAGE_FULL',
        'L’espace des pièces jointes de l’organisation (1 Gio) est plein : supprimez des pièces.',
      );
    }
    const objectId = newObjectId();
    await this.storage.putObject(
      this.bucket(),
      salesContractFileObjectKey(objectId),
      bytes,
      SALES_CONTRACT_FILE_MIME_TYPE,
    );
    const doc = await this.files.create({
      organizationId,
      contractId: 'contractId' in owner ? owner.contractId : null,
      amendmentId: 'contractId' in owner ? owner.amendmentId : null,
      orderId: 'orderId' in owner ? owner.orderId : null,
      kind,
      objectId,
      fileName: sanitizeFileName(rawFileName, SALES_CONTRACT_FILE_MIME_TYPE),
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      uploadedBy,
      uploadedAt: new Date(),
      _schemaVersion: 1,
    });
    return doc.toObject() as SalesContractFileLean;
  }

  /** Pièces d'un propriétaire, dans l'ordre de dépôt. */
  async list(
    organizationId: string,
    owner: SalesContractFileOwner,
  ): Promise<SalesContractFileLean[]> {
    return this.files
      .find({ organizationId, ...ownerFilter(owner) })
      .sort({ uploadedAt: 1, _id: 1 })
      .lean<SalesContractFileLean[]>()
      .exec();
  }

  /** Une pièce d'un propriétaire et ses octets ; `404` sinon (autre organisation comprise). */
  async read(
    organizationId: string,
    owner: SalesContractFileOwner,
    fileId: string,
  ): Promise<{ meta: SalesContractFileLean; body: Buffer }> {
    if (!isObjectIdHex(fileId)) fileNotFound();
    const meta = await this.files
      .findOne({ _id: new Types.ObjectId(fileId), organizationId, ...ownerFilter(owner) })
      .lean<SalesContractFileLean>()
      .exec();
    if (!meta) fileNotFound();
    const object = await this.storage.getObject(
      this.bucket(),
      salesContractFileObjectKey(meta.objectId),
    );
    if (!object) fileNotFound();
    return { meta, body: object.body };
  }

  /** Retire toutes les pièces d'un brouillon supprimé (objets effacés au mieux). */
  async removeAll(organizationId: string, owner: SalesContractFileOwner): Promise<void> {
    const metas = await this.list(organizationId, owner);
    if (metas.length === 0) return;
    await this.files.deleteMany({ organizationId, _id: { $in: metas.map((m) => m._id) } }).exec();
    const bucket = this.storage.uploadsBucket();
    if (!bucket) return;
    for (const m of metas) {
      try {
        await this.storage.deleteObject(bucket, salesContractFileObjectKey(m.objectId));
      } catch (err) {
        this.logger.warn(
          `Pièce ${m.objectId} non supprimée du stockage : ${(err as Error).message}`,
        );
      }
    }
  }
}
