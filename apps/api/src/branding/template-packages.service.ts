// Paquets de modèle de facture sur mesure : installation, lecture, compilation — ADR-0029.
//
// ── Installation ─────────────────────────────────────────────────────────────
// Le paquet est validé ENTIÈREMENT (archive, manifeste, gabarit, CSS, batterie
// de rendu) avant toute écriture : un paquet invalide n'est jamais stocké.
// Puis : 1. l'objet (clé tirée au hasard), 2. l'enregistrement IMMUABLE. Une
// version déjà installée avec la même empreinte est rendue telle quelle ; avec
// une autre empreinte, refus (409) — une version ne change jamais de contenu.
//
// ── Rendu ────────────────────────────────────────────────────────────────────
// L'archive est relue, son empreinte RECALCULÉE et comparée à celle figée dans
// la facture : différente ou absente ⇒ 409 (jamais un original « presque
// identique ») ; stockage indisponible ⇒ 503. Compilation mise en cache par
// (organisation, paquet, empreinte).
//
// ── Isolation ────────────────────────────────────────────────────────────────
// Toute lecture filtre par `organizationId`, cache compris.

import { createHash } from 'node:crypto';

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import type { CompiledCustomTemplate } from '../sales/documents/templates/custom/custom-template.js';
import {
  validateArchive,
  type ValidationReport,
} from '../sales/documents/templates/custom/validate-package.js';
import type { FrozenPackageRef } from '../sales/documents/templates/template.contract.js';
import { isObjectId, newObjectId, templatePackageObjectKey } from '../storage/object-key.js';
import {
  ObjectStorageService,
  ObjectStorageUnavailableError,
} from '../storage/object-storage.service.js';
import {
  InvoiceTemplatePackage,
  type InvoiceTemplatePackageDocument,
} from './template-packages.schema.js';

export type TemplatePackageLean = InvoiceTemplatePackage & { _id: unknown };

export interface PackageActor {
  userId: string;
  role: string;
}

/** Compilations gardées en mémoire (paquets immuables). */
const CACHE_MAX = 16;

const sha256Hex = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export function packageNotFound(): never {
  throw new NotFoundException({
    code: 'TEMPLATE_PACKAGE_NOT_FOUND',
    message: 'Modèle personnalisé introuvable.',
  });
}

function integrity(): never {
  throw new ConflictException({
    code: 'TEMPLATE_PACKAGE_INTEGRITY',
    message:
      'Le modèle personnalisé figé sur ce document est introuvable ou a changé : le document ne peut pas être réimprimé à l’identique.',
  });
}

function unavailable(): never {
  throw new ServiceUnavailableException({
    code: 'TEMPLATE_PACKAGE_UNAVAILABLE',
    message: 'Le modèle personnalisé ne peut pas être lu pour le moment : réessayez.',
  });
}

@Injectable()
export class TemplatePackagesService {
  private readonly cache = new Map<string, CompiledCustomTemplate>();

  constructor(
    @InjectModel(InvoiceTemplatePackage.name)
    private readonly packages: Model<InvoiceTemplatePackageDocument>,
    @Inject(ObjectStorageService) private readonly storage: ObjectStorageService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  storageAvailable(): boolean {
    return this.storage.availability().available;
  }

  async list(organizationId: string): Promise<TemplatePackageLean[]> {
    return this.packages
      .find({ organizationId })
      .sort({ templateId: 1, createdAt: -1 })
      .lean<TemplatePackageLean[]>()
      .exec();
  }

  /** Paquet de CETTE organisation, ou `null`. */
  async find(
    organizationId: string,
    packageId: string,
    session?: ClientSession,
  ): Promise<TemplatePackageLean | null> {
    if (!isObjectId(packageId)) return null;
    return this.packages
      .findOne({ organizationId, packageId }, null, session ? { session } : {})
      .lean<TemplatePackageLean>()
      .exec();
  }

  /**
   * Valide puis installe une archive. `created: false` : cette version était
   * déjà installée avec la même empreinte (téléversement idempotent).
   */
  async install(
    organizationId: string,
    archive: Buffer,
    actor: PackageActor,
  ): Promise<{ pkg: TemplatePackageLean; created: boolean; report: ValidationReport }> {
    const { report, template } = await validateArchive(archive);
    if (!report.ok || !template) {
      throw new UnprocessableEntityException({
        code: 'TEMPLATE_PACKAGE_INVALID',
        message: `Le modèle n’est pas valide : ${report.errors.length} erreur(s) à corriger.`,
        details: { report },
      });
    }
    const m = template.manifest;
    const existing = await this.packages
      .findOne({ organizationId, templateId: m.id, version: m.version })
      .lean<TemplatePackageLean>()
      .exec();
    if (existing) return this.sameVersion(existing, template.digest, report);

    const bucket = this.storage.uploadsBucket();
    if (!bucket) {
      const a = this.storage.availability();
      throw new ObjectStorageUnavailableError(a.available ? 'Bucket absent.' : a.reason);
    }
    const packageId = newObjectId();
    const objectKey = templatePackageObjectKey(packageId);
    await this.storage.putObject(bucket, objectKey, archive, 'application/zip');
    try {
      await this.packages.create({
        packageId,
        organizationId,
        templateId: m.id,
        version: m.version,
        name: m.name,
        contentSha256: template.digest,
        archiveSha256: sha256Hex(archive),
        objectKey,
        byteSize: archive.length,
        manifest: m,
        createdBy: actor.userId,
      });
    } catch (err) {
      // Deux installations simultanées de la même version : l'une gagne.
      if ((err as { code?: number }).code !== 11000) throw err;
      await this.storage.deleteObject(bucket, objectKey).catch(() => undefined);
      const winner = await this.packages
        .findOne({ organizationId, templateId: m.id, version: m.version })
        .lean<TemplatePackageLean>()
        .exec();
      if (!winner) throw err;
      return this.sameVersion(winner, template.digest, report);
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'sales.invoice_template_package_installed',
      targetType: 'invoice_template_package',
      targetId: packageId,
      metadata: {
        templateId: m.id,
        version: m.version,
        contentSha256: template.digest,
        bytes: archive.length,
      },
    });
    const pkg = await this.find(organizationId, packageId);
    return { pkg: pkg!, created: true, report };
  }

  private sameVersion(
    existing: TemplatePackageLean,
    digest: string,
    report: ValidationReport,
  ): { pkg: TemplatePackageLean; created: boolean; report: ValidationReport } {
    if (existing.contentSha256 !== digest) {
      throw new ConflictException({
        code: 'TEMPLATE_VERSION_EXISTS',
        message: `La version ${existing.version} de « ${existing.templateId} » est déjà installée avec un autre contenu : une version installée ne change plus. Publiez une nouvelle version (ex. ${bump(existing.version)}).`,
        details: { templateId: existing.templateId, version: existing.version },
      });
    }
    return { pkg: existing, created: false, report };
  }

  /**
   * Modèle compilé d'un paquet FIGÉ (ou choisi) : enregistrement de CETTE
   * organisation, archive relue, empreinte recalculée et comparée.
   */
  async compiled(
    organizationId: string,
    ref: Pick<FrozenPackageRef, 'packageId' | 'sha256'>,
  ): Promise<CompiledCustomTemplate> {
    const key = `${organizationId}:${ref.packageId}:${ref.sha256}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const pkg = await this.find(organizationId, ref.packageId);
    if (!pkg || pkg.contentSha256 !== ref.sha256) integrity();
    const bucket = this.storage.uploadsBucket();
    if (!bucket) unavailable();
    let bytes: Buffer;
    try {
      const obj = await this.storage.getObject(bucket, pkg.objectKey);
      if (!obj) integrity();
      bytes = obj.body;
    } catch (cause) {
      if (cause instanceof ConflictException) throw cause;
      unavailable();
    }
    const { report, template } = await validateArchive(bytes, pkg.packageId, { battery: false });
    if (!report.ok || !template || template.digest !== ref.sha256) integrity();
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, template);
    return template;
  }
}

/** Version suivante proposée (« 1.0.0 » → « 1.0.1 »). */
function bump(v: string): string {
  const [a, b, c] = v.split('.').map(Number);
  return `${a}.${b}.${(c ?? 0) + 1}`;
}
