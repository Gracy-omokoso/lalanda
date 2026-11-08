// Cartes de service (badge vérifiable) et cartes de visite — ADR-0069.
//
// ── Isolation ────────────────────────────────────────────────────────────────
// Toute lecture filtre par `organizationId`. Une fiche, un profil de carte ou un
// paquet d'une autre organisation est « introuvable » (404). La page publique ne
// part que du JETON et ne lit que l'organisation de la fiche qu'il désigne.
//
// ── Photo ────────────────────────────────────────────────────────────────────
// Exception documentée à la minimisation d'ADR-0045 § 2.1 : facultative, jamais
// sans consentement enregistré (date + auteur), effacée au retrait du
// consentement et à l'anonymisation. Octets ASSAINIS par la porte de la photo de
// profil ; objet `hr-card-photos/<128 bits>` ; jamais montrée publiquement sans
// second accord (`photoPublic`).
//
// ── Jeton ────────────────────────────────────────────────────────────────────
// Émettre tire un nouveau jeton et remplace l'ancien (carte précédente « non
// valide ») ; révoquer le retire. Le jeton n'entre jamais dans le journal d'audit.

import { createHash } from 'node:crypto';

import {
  CARD_BATCH_MAX,
  CARD_KIND_LABELS,
  type CardBatchInput,
  type CardExportInput,
  type CardFace,
  type CardKind,
  type CardPackageView,
  type CardProfileView,
  type CardSettingsView,
  type CardTemplateSummary,
  type CardVariant,
  type PublicCardView,
  type PutCardConsentInput,
  type PutCardSettingsInput,
} from '@lalanda/shared/hr';
import { employeeStatusOf } from '@lalanda/engine';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { isValidObjectId } from 'mongoose';

import type { ImageAcceptance } from '../../account/image-validation.js';
import { AuditService } from '../../authz/audit.service.js';
import { brandAssetUrlFor } from '../../branding/brand-asset-url.js';
import { BrandingService } from '../../branding/branding.service.js';
import {
  Organization,
  type OrganizationDocument,
} from '../../organizations/organization.schema.js';
import { PdfRenderingService } from '../../reports/pdf-rendering.service.js';
import { qrCodeSvg } from '../../sales/documents/invoice-qr.js';
import { newObjectId } from '../../storage/object-key.js';
import {
  ObjectStorageService,
  ObjectStorageUnavailableError,
} from '../../storage/object-storage.service.js';
import { Department, type DepartmentDocument } from '../departments/department.schema.js';
import {
  Employee,
  type EmployeeDocument,
  type EmployeeLean,
} from '../employees/employee.schema.js';
import type { HrEmployeeLifecycleEvent } from '../employees/hr-employee-lifecycle.port.js';
import { hrToday } from '../scope/hr-errors.js';
import { engineEmployeeOf } from '../scope/hr-scope.service.js';
import type { RenderedCard } from './card-document.js';
import { cardFormat, type CardFormat } from './card-formats.js';
import {
  cardThemeOf,
  initialsOf,
  type CardData,
  type CardIdentity,
  type CardImage,
  type CardTheme,
} from './card-model.js';
import {
  exportPdf,
  exportPng,
  exportPngZip,
  exportSheet,
  facesFor,
  fileSlug,
  renderBuiltinCard,
  type CardExportJob,
} from './card-render.js';
import { sampleCardData } from './card-sample.js';
import {
  cardVerifyBaseUrl,
  cardVerifyLabel,
  cardVerifyUrl,
  isCardToken,
  newCardToken,
} from './card-token.js';
import {
  HrCardProfile,
  HrCardSettings,
  HrCardTemplatePackage,
  type HrCardProfileDocument,
  type HrCardProfileLean,
  type HrCardSettingsDocument,
  type HrCardSettingsLean,
  type HrCardTemplatePackageDocument,
  type HrCardTemplatePackageLean,
} from './card.schemas.js';
import {
  validateCardPackage,
  type CardValidationReport,
  type CompiledCardPackage,
} from './custom/card-package.js';
import {
  BUILTIN_CARD_TEMPLATES,
  DEFAULT_CARD_TEMPLATE,
  builtinCardTemplate,
  summaryOf,
} from './templates/registry.js';
import { vcardOf } from './vcard.js';
import type { FontId } from '../../sales/documents/templates/invoice-fonts.js';

export interface CardActor {
  userId: string;
  role: string;
}

export interface CardFile {
  body: Buffer;
  contentType: string;
  fileName: string;
}

const PHOTO_PREFIX = 'hr-card-photos/';
const PACKAGE_PREFIX = 'hr-card-packages/';
const CACHE_MAX = 16;

function sha256Hex(b: Buffer): string {
  return createHash('sha256').update(b).digest('hex');
}

export function cardEmployeeNotFound(): never {
  throw new NotFoundException({
    code: 'EMPLOYEE_NOT_FOUND',
    message: 'Collaborateur introuvable.',
  });
}

function stale(revision: number): never {
  throw new ConflictException({
    code: 'STALE_CARD_REVISION',
    message: 'La carte a été modifiée entre-temps : rechargez la page.',
    details: { revision },
  });
}

function storageDown(): never {
  throw new ServiceUnavailableException({
    code: 'STORAGE_UNAVAILABLE',
    message: 'Le stockage des fichiers est indisponible : réessayez plus tard.',
  });
}

function templateNotFound(): never {
  throw new NotFoundException({
    code: 'CARD_TEMPLATE_NOT_FOUND',
    message: 'Modèle de carte introuvable.',
  });
}

interface ResolvedTemplate {
  ref: string;
  kind: CardKind;
  format: CardFormat;
  displayFont: FontId | null;
  /** Faces que le modèle sait rendre. */
  faces: CardFace[];
  render(d: CardData, t: CardTheme, faces: readonly CardFace[]): RenderedCard;
  extraCss: string;
  extraFonts: FontId[];
}

@Injectable()
export class HrCardsService {
  private readonly logger = new Logger(HrCardsService.name);
  private readonly compiledCache = new Map<string, CompiledCardPackage>();

  constructor(
    @InjectModel(HrCardProfile.name) private readonly profiles: Model<HrCardProfileDocument>,
    @InjectModel(HrCardSettings.name) private readonly settingsModel: Model<HrCardSettingsDocument>,
    @InjectModel(HrCardTemplatePackage.name)
    private readonly packages: Model<HrCardTemplatePackageDocument>,
    @InjectModel(Employee.name) private readonly employees: Model<EmployeeDocument>,
    @InjectModel(Department.name) private readonly departments: Model<DepartmentDocument>,
    @InjectModel(Organization.name) private readonly organizations: Model<OrganizationDocument>,
    @Inject(BrandingService) private readonly branding: BrandingService,
    @Inject(ObjectStorageService) private readonly storage: ObjectStorageService,
    @Inject(PdfRenderingService) private readonly renderer: PdfRenderingService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ── Lectures de base ───────────────────────────────────────────────────────

  private async employee(organizationId: string, employeeId: string): Promise<EmployeeLean> {
    if (!isValidObjectId(employeeId)) cardEmployeeNotFound();
    const e = await this.employees
      .findOne({ _id: employeeId, organizationId })
      .lean<EmployeeLean>()
      .exec();
    if (!e || e.status === 'anonymized') cardEmployeeNotFound();
    return e;
  }

  private async profile(
    organizationId: string,
    employeeId: string,
  ): Promise<HrCardProfileLean | null> {
    return this.profiles.findOne({ organizationId, employeeId }).lean<HrCardProfileLean>().exec();
  }

  private async settingsDoc(organizationId: string): Promise<HrCardSettingsLean | null> {
    return this.settingsModel.findOne({ organizationId }).lean<HrCardSettingsLean>().exec();
  }

  private bucket(): string {
    const b = this.storage.uploadsBucket();
    if (!b) storageDown();
    return b;
  }

  // ── Réglages ───────────────────────────────────────────────────────────────

  async settings(organizationId: string): Promise<CardSettingsView> {
    const s = await this.settingsDoc(organizationId);
    const pkgs = await this.listPackages(organizationId);
    const templates: CardTemplateSummary[] = [
      ...BUILTIN_CARD_TEMPLATES.map(summaryOf),
      ...pkgs.map((p) => ({
        id: p.templateRef,
        kind: p.kind,
        orientation: p.orientation,
        name: p.name,
        description: `Sur mesure (${p.format === 'code' ? 'paquet code' : 'gabarit graphiste'}) — ${p.id} ${p.version}`,
        version: p.version,
        source: p.format,
      })),
    ];
    const kindView = (k: CardKind) => ({
      templateId: s?.[k]?.templateId ?? DEFAULT_CARD_TEMPLATE[k],
      variant: s?.[k]?.variant ?? 'brand',
      accent: s?.[k]?.accent ?? null,
    });
    return {
      badge: kindView('badge'),
      business: kindView('business'),
      showEmployeeNumber: s?.showEmployeeNumber ?? true,
      badgeVerso: s?.badgeVerso ?? true,
      vcardQr: s?.vcardQr ?? true,
      address: s?.address ?? null,
      website: s?.website ?? null,
      phone: s?.phone ?? null,
      slogan: s?.slogan ?? null,
      revision: s?.revision ?? 0,
      templates,
      verifyBaseUrl: cardVerifyBaseUrl(),
      storageAvailable: this.storage.availability().available,
    };
  }

  async putSettings(
    organizationId: string,
    input: PutCardSettingsInput,
    actor: CardActor,
  ): Promise<CardSettingsView> {
    for (const k of ['badge', 'business'] as const) {
      const id = input[k].templateId;
      if (id !== null) {
        const t = await this.resolveTemplate(organizationId, id).catch(() => null);
        if (!t || t.kind !== k) {
          throw new UnprocessableEntityException({
            code: 'CARD_TEMPLATE_KIND_MISMATCH',
            message: `Le modèle choisi pour « ${CARD_KIND_LABELS[k]} » est inconnu ou d’un autre type.`,
          });
        }
      }
    }
    const current = await this.settingsDoc(organizationId);
    const revision = current?.revision ?? 0;
    if (input.expectedRevision !== revision) stale(revision);
    const set = {
      badge: input.badge,
      business: input.business,
      showEmployeeNumber: input.showEmployeeNumber,
      badgeVerso: input.badgeVerso,
      vcardQr: input.vcardQr,
      address: input.address,
      website: input.website,
      phone: input.phone,
      slogan: input.slogan,
      updatedBy: actor.userId,
    };
    if (!current) {
      try {
        await this.settingsModel.create({ organizationId, ...set, revision: 1 });
      } catch (err) {
        if ((err as { code?: number }).code === 11000) stale(1);
        throw err;
      }
    } else {
      const res = await this.settingsModel
        .updateOne({ organizationId, revision }, { $set: set, $inc: { revision: 1 } })
        .exec();
      if (res.modifiedCount !== 1) stale(revision + 1);
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.card_settings_updated',
      targetType: 'hr_card_settings',
      targetId: organizationId,
      metadata: {
        badgeTemplate: input.badge.templateId,
        businessTemplate: input.business.templateId,
        showEmployeeNumber: input.showEmployeeNumber,
      },
    });
    return this.settings(organizationId);
  }

  // ── Profil de carte ────────────────────────────────────────────────────────

  private publicStatusOf(
    e: EmployeeLean,
    p: HrCardProfileLean | null,
  ): CardProfileView['publicStatus'] {
    if (!p?.verification || e.status === 'anonymized') return 'invalid';
    return employeeStatusOf(engineEmployeeOf(e), hrToday()) === 'exited' ? 'inactive' : 'active';
  }

  private viewOf(e: EmployeeLean, p: HrCardProfileLean | null): CardProfileView {
    return {
      employeeId: String(e._id),
      photo: p?.photo
        ? {
            contentType: p.photo.contentType,
            width: p.photo.width,
            height: p.photo.height,
            byteSize: p.photo.byteSize,
          }
        : null,
      consent: {
        photo: p?.photoConsent != null,
        photoPublic: p?.photoConsent != null && p.photoPublic === true,
        at: p?.photoConsent ? new Date(p.photoConsent.at).toISOString() : null,
        by: p?.photoConsent?.by ?? null,
      },
      verification: {
        issued: p?.verification != null,
        serial: p?.verification?.serial ?? p?.issueCount ?? 0,
        issuedAt: p?.verification ? new Date(p.verification.issuedAt).toISOString() : null,
        url: p?.verification ? cardVerifyUrl(p.verification.token) : null,
        revokedAt: p?.revokedAt ? new Date(p.revokedAt).toISOString() : null,
      },
      publicStatus: this.publicStatusOf(e, p),
      revision: p?.revision ?? 0,
    };
  }

  async getProfile(organizationId: string, employeeId: string): Promise<CardProfileView> {
    const e = await this.employee(organizationId, employeeId);
    return this.viewOf(e, await this.profile(organizationId, employeeId));
  }

  /**
   * Applique `update` au profil à la révision attendue (création à la révision 0).
   * Renvoie le profil AVANT modification.
   */
  private async mutate(
    organizationId: string,
    employeeId: string,
    expectedRevision: number,
    update: Record<string, unknown>,
  ): Promise<HrCardProfileLean | null> {
    const before = await this.profile(organizationId, employeeId);
    const revision = before?.revision ?? 0;
    if (expectedRevision !== revision) stale(revision);
    if (!before) {
      try {
        await this.profiles.create({
          organizationId,
          employeeId,
          revision: 1,
          ...((update['$set'] as Record<string, unknown>) ?? {}),
          ...((update['$inc'] as Record<string, number> | undefined)?.['issueCount']
            ? { issueCount: 1 }
            : {}),
        });
      } catch (err) {
        if ((err as { code?: number }).code === 11000) stale(1);
        throw err;
      }
      return null;
    }
    const inc = { ...((update['$inc'] as Record<string, number>) ?? {}), revision: 1 };
    const res = await this.profiles
      .updateOne({ organizationId, employeeId, revision }, { ...update, $inc: inc })
      .exec();
    if (res.modifiedCount !== 1) stale(revision + 1);
    return before;
  }

  async putConsent(
    organizationId: string,
    employeeId: string,
    input: PutCardConsentInput,
    actor: CardActor,
  ): Promise<CardProfileView> {
    const e = await this.employee(organizationId, employeeId);
    const current = await this.profile(organizationId, employeeId);
    const had = current?.photoConsent != null;
    if (input.photo) {
      await this.mutate(organizationId, employeeId, input.expectedRevision, {
        $set: {
          photoConsent: had ? current!.photoConsent : { at: new Date(), by: actor.userId },
          photoPublic: input.photoPublic,
        },
      });
    } else {
      const before = await this.mutate(organizationId, employeeId, input.expectedRevision, {
        $set: { photoConsent: null, photoPublic: false, photo: null },
      });
      if (before?.photo) await this.deletePhotoObject(before.photo.objectId);
    }
    if (
      input.photo !== had ||
      (input.photo && input.photoPublic !== (current?.photoPublic ?? false))
    ) {
      await this.audit.record({
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: input.photo ? 'hr.card_photo_consent_recorded' : 'hr.card_photo_consent_withdrawn',
        targetType: 'hr_employee',
        targetId: employeeId,
        metadata: { photoPublic: input.photo ? input.photoPublic : false },
      });
    }
    return this.viewOf(e, await this.profile(organizationId, employeeId));
  }

  async putPhoto(
    organizationId: string,
    employeeId: string,
    image: ImageAcceptance,
    actor: CardActor,
  ): Promise<CardProfileView> {
    const e = await this.employee(organizationId, employeeId);
    const p = await this.profile(organizationId, employeeId);
    if (!p?.photoConsent) {
      throw new ConflictException({
        code: 'CARD_PHOTO_CONSENT_REQUIRED',
        message:
          'Enregistrez d’abord le consentement du collaborateur à figurer en photo sur sa carte.',
      });
    }
    const bucket = this.bucket();
    const objectId = newObjectId();
    try {
      await this.storage.putObject(
        bucket,
        `${PHOTO_PREFIX}${objectId}`,
        image.bytes,
        image.contentType,
      );
    } catch (err) {
      if (err instanceof ObjectStorageUnavailableError) storageDown();
      throw err;
    }
    const before = await this.mutate(organizationId, employeeId, p.revision, {
      $set: {
        photo: {
          objectId,
          contentType: image.contentType,
          width: image.width,
          height: image.height,
          byteSize: image.bytes.length,
          sha256: sha256Hex(image.bytes),
        },
      },
    }).catch(async (err: unknown) => {
      await this.deletePhotoObject(objectId);
      throw err;
    });
    if (before?.photo) await this.deletePhotoObject(before.photo.objectId);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.card_photo_uploaded',
      targetType: 'hr_employee',
      targetId: employeeId,
      metadata: { contentType: image.contentType, bytes: image.bytes.length },
    });
    return this.viewOf(e, await this.profile(organizationId, employeeId));
  }

  async removePhoto(
    organizationId: string,
    employeeId: string,
    actor: CardActor,
  ): Promise<CardProfileView> {
    const e = await this.employee(organizationId, employeeId);
    const p = await this.profile(organizationId, employeeId);
    if (p?.photo) {
      await this.mutate(organizationId, employeeId, p.revision, { $set: { photo: null } });
      await this.deletePhotoObject(p.photo.objectId);
      await this.audit.record({
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'hr.card_photo_removed',
        targetType: 'hr_employee',
        targetId: employeeId,
        metadata: {},
      });
    }
    return this.viewOf(e, await this.profile(organizationId, employeeId));
  }

  /** Octets de la photo (interface RH) ; `null` si absente. */
  async photoBytes(
    organizationId: string,
    employeeId: string,
  ): Promise<{ body: Buffer; contentType: string } | null> {
    await this.employee(organizationId, employeeId);
    const p = await this.profile(organizationId, employeeId);
    if (!p?.photo || !p.photoConsent) return null;
    return this.readPhoto(p.photo);
  }

  private async readPhoto(
    photo: NonNullable<HrCardProfile['photo']>,
  ): Promise<{ body: Buffer; contentType: string } | null> {
    const bucket = this.storage.uploadsBucket();
    if (!bucket) return null;
    const obj = await this.storage
      .getObject(bucket, `${PHOTO_PREFIX}${photo.objectId}`)
      .catch(() => null);
    if (!obj || sha256Hex(obj.body) !== photo.sha256) return null;
    return { body: obj.body, contentType: photo.contentType };
  }

  private async deletePhotoObject(objectId: string): Promise<void> {
    const bucket = this.storage.uploadsBucket();
    if (!bucket) return;
    await this.storage.deleteObject(bucket, `${PHOTO_PREFIX}${objectId}`).catch((err: unknown) => {
      this.logger.warn(`Photo de carte ${objectId} non supprimée : ${(err as Error).message}`);
    });
  }

  async issue(
    organizationId: string,
    employeeId: string,
    expectedRevision: number,
    actor: CardActor,
  ): Promise<CardProfileView> {
    const e = await this.employee(organizationId, employeeId);
    const p = await this.profile(organizationId, employeeId);
    const serial = (p?.issueCount ?? 0) + 1;
    await this.mutate(organizationId, employeeId, expectedRevision, {
      $set: {
        verification: {
          token: newCardToken(),
          serial,
          issuedAt: new Date(),
          issuedBy: actor.userId,
        },
      },
      $inc: { issueCount: 1 },
    });
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.card_issued',
      targetType: 'hr_employee',
      targetId: employeeId,
      metadata: { serial, replaced: p?.verification != null },
    });
    return this.viewOf(e, await this.profile(organizationId, employeeId));
  }

  async revoke(
    organizationId: string,
    employeeId: string,
    expectedRevision: number,
    actor: CardActor,
  ): Promise<CardProfileView> {
    const e = await this.employee(organizationId, employeeId);
    const p = await this.profile(organizationId, employeeId);
    if (p?.verification) {
      await this.mutate(organizationId, employeeId, expectedRevision, {
        $set: { verification: null, revokedAt: new Date(), revokedBy: actor.userId },
      });
      await this.audit.record({
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'hr.card_revoked',
        targetType: 'hr_employee',
        targetId: employeeId,
        metadata: { serial: p.verification.serial },
      });
    }
    return this.viewOf(e, await this.profile(organizationId, employeeId));
  }

  // ── Anonymisation (point d'extension HR_CARDS_LIFECYCLE) ───────────────────

  async onAnonymize(event: HrEmployeeLifecycleEvent): Promise<void> {
    const p = await this.profiles
      .findOne({ organizationId: event.organizationId, employeeId: event.employeeId }, null, {
        session: event.session,
      })
      .lean<HrCardProfileLean>()
      .exec();
    if (!p) return;
    await this.profiles
      .updateOne(
        { _id: p._id },
        {
          $set: {
            photo: null,
            photoConsent: null,
            photoPublic: false,
            verification: null,
            revokedAt: new Date(),
            revokedBy: event.actorUserId,
          },
          $inc: { revision: 1 },
        },
        { session: event.session },
      )
      .exec();
    if (p.photo) await this.deletePhotoObject(p.photo.objectId);
  }

  // ── Modèles ────────────────────────────────────────────────────────────────

  private async resolveTemplate(organizationId: string, ref: string): Promise<ResolvedTemplate> {
    if (ref.startsWith('pkg:')) {
      const compiled = await this.compiledPackage(organizationId, ref.slice(4));
      return {
        ref,
        kind: compiled.kind,
        format: compiled.cardFormat,
        displayFont: null,
        faces: compiled.faces,
        render: (d, t, faces) => compiled.render(d, t, faces),
        extraCss: compiled.fontFaces,
        extraFonts: compiled.builtinFonts,
      };
    }
    const def = builtinCardTemplate(ref);
    if (!def) templateNotFound();
    const f = cardFormat(def.kind, def.orientation);
    return {
      ref,
      kind: def.kind,
      format: f,
      displayFont: def.displayFont,
      faces: ['recto', 'verso'],
      render: (d, t, faces) => renderBuiltinCard(def, d, t, f, faces),
      extraCss: '',
      extraFonts: [],
    };
  }

  private async identity(organizationId: string): Promise<{
    identity: CardIdentity;
    logo: CardImage | null;
    logoLight: CardImage | null;
  }> {
    const { identity, logos } = await this.branding.currentLogosForRender(organizationId);
    return {
      identity: {
        primaryColor: identity.primaryColor,
        secondaryColor: identity.secondaryColor,
        font: identity.font,
      },
      logo: logos.primary ?? logos.horizontal ?? logos.symbol ?? null,
      logoLight: logos.light ?? null,
    };
  }

  private async orgName(organizationId: string): Promise<string> {
    const o = isValidObjectId(organizationId)
      ? await this.organizations.findById(organizationId).lean<{ name: string }>().exec()
      : null;
    return o?.name ?? 'Organisation';
  }

  /** Données imprimées d'un collaborateur. */
  private async cardDataOf(
    organizationId: string,
    kind: CardKind,
    e: EmployeeLean,
    p: HrCardProfileLean | null,
    ctx: {
      settings: CardSettingsView;
      orgName: string;
      logo: CardImage | null;
      logoLight: CardImage | null;
      departments: Map<string, string>;
    },
  ): Promise<CardData> {
    const firstName = e.preferredName?.trim() || e.firstName;
    const displayName = `${firstName} ${e.lastName}`;
    let photo: CardImage | null = null;
    if (p?.photo && p.photoConsent) {
      const bytes = await this.readPhoto(p.photo);
      if (bytes) {
        photo = {
          dataUri: `data:${bytes.contentType};base64,${bytes.body.toString('base64')}`,
          width: p.photo.width,
          height: p.photo.height,
        };
      }
    }
    const s = ctx.settings;
    let verifyQrSvg: string | null = null;
    if (kind === 'badge') {
      if (!p?.verification) {
        throw new ConflictException({
          code: 'CARD_NOT_ISSUED',
          message: `Aucune carte de service émise pour ${displayName} : émettez-la d’abord.`,
          details: { employeeIds: [String(e._id)] },
        });
      }
      verifyQrSvg = await qrCodeSvg(cardVerifyUrl(p.verification.token));
    }
    let vcardQrSvg: string | null = null;
    if (kind === 'business' && s.vcardQr) {
      vcardQrSvg = await qrCodeSvg(
        vcardOf({
          firstName,
          lastName: e.lastName,
          organization: ctx.orgName,
          jobTitle: e.jobTitle,
          workPhone: e.workPhone ?? s.phone,
          workEmail: e.workEmail,
          website: s.website,
          address: s.address,
        }),
      );
    }
    return {
      kind,
      firstName,
      lastName: e.lastName,
      displayName,
      initials: initialsOf(displayName),
      jobTitle: e.jobTitle,
      department: e.departmentId ? (ctx.departments.get(e.departmentId) ?? null) : null,
      employeeNumber: s.showEmployeeNumber ? (e.employeeNumber ?? null) : null,
      workEmail: e.workEmail ?? null,
      workPhone: e.workPhone ?? null,
      photo,
      org: {
        name: ctx.orgName,
        initials: initialsOf(ctx.orgName),
        logo: ctx.logo,
        logoLight: ctx.logoLight,
        address: s.address,
        website: s.website,
        phone: s.phone,
        slogan: s.slogan,
      },
      verifyQrSvg,
      verifyLabel: cardVerifyLabel(),
      serial: kind === 'badge' ? (p?.verification?.serial ?? null) : null,
      vcardQrSvg,
      sample: false,
    };
  }

  private async job(
    organizationId: string,
    kind: CardKind,
    templateRef: string | undefined,
    employees: EmployeeLean[],
  ): Promise<{ job: CardExportJob; names: string[] }> {
    const settings = await this.settings(organizationId);
    const tpl = await this.resolveTemplate(
      organizationId,
      templateRef ?? settings[kind].templateId,
    );
    if (tpl.kind !== kind) {
      throw new UnprocessableEntityException({
        code: 'CARD_TEMPLATE_KIND_MISMATCH',
        message: `Ce modèle n’est pas un modèle de ${CARD_KIND_LABELS[kind].toLowerCase()}.`,
      });
    }
    const { identity, logo, logoLight } = await this.identity(organizationId);
    const theme = cardThemeOf(
      identity,
      settings[kind].variant,
      settings[kind].accent,
      tpl.displayFont,
    );
    const deptIds = [
      ...new Set(employees.map((e) => e.departmentId).filter((x): x is string => !!x)),
    ];
    const depts = deptIds.length
      ? await this.departments
          .find({ organizationId, _id: { $in: deptIds.filter((x) => isValidObjectId(x)) } })
          .lean<Array<{ _id: unknown; name: string }>>()
          .exec()
      : [];
    const departments = new Map(depts.map((d) => [String(d._id), d.name]));
    const orgName = await this.orgName(organizationId);
    const profiles = await this.profiles
      .find({ organizationId, employeeId: { $in: employees.map((e) => String(e._id)) } })
      .lean<HrCardProfileLean[]>()
      .exec();
    const byEmployee = new Map(profiles.map((p) => [p.employeeId, p]));
    if (kind === 'badge') {
      const missing = employees
        .filter((e) => !byEmployee.get(String(e._id))?.verification)
        .map((e) => String(e._id));
      if (missing.length > 0) {
        throw new ConflictException({
          code: 'CARD_NOT_ISSUED',
          message:
            missing.length === 1
              ? 'Aucune carte de service émise pour ce collaborateur : émettez-la d’abord.'
              : `${missing.length} collaborateurs n’ont pas de carte de service émise.`,
          details: { employeeIds: missing },
        });
      }
    }
    const faces = facesFor(kind, settings.badgeVerso).filter((f) => tpl.faces.includes(f));
    const cards: RenderedCard[] = [];
    const names: string[] = [];
    for (const e of employees) {
      const d = await this.cardDataOf(
        organizationId,
        kind,
        e,
        byEmployee.get(String(e._id)) ?? null,
        {
          settings,
          orgName,
          logo,
          logoLight,
          departments,
        },
      );
      cards.push(tpl.render(d, theme, faces));
      names.push(fileSlug(d.displayName));
    }
    return {
      job: {
        format: tpl.format,
        fonts: [...new Set<FontId>([...theme.fonts, ...tpl.extraFonts])],
        cards,
        extraCss: tpl.extraCss,
      },
      names,
    };
  }

  // ── Exports ────────────────────────────────────────────────────────────────

  async exportOne(
    organizationId: string,
    employeeId: string,
    q: CardExportInput,
  ): Promise<CardFile> {
    const e = await this.employee(organizationId, employeeId);
    const { job, names } = await this.job(organizationId, q.kind, q.template, [e]);
    const base = `${q.kind === 'badge' ? 'carte-de-service' : 'carte-de-visite'}-${names[0]}`;
    if (q.format === 'png') {
      const face = job.cards[0]!.faces.some((f) => f.face === q.face) ? q.face : 'recto';
      return {
        body: await exportPng(this.renderer, job, face),
        contentType: 'image/png',
        fileName: `${base}-${face}.png`,
      };
    }
    return {
      body: await exportPdf(this.renderer, job),
      contentType: 'application/pdf',
      fileName: `${base}.pdf`,
    };
  }

  async exportBatch(organizationId: string, input: CardBatchInput): Promise<CardFile> {
    const ids = [...new Set(input.employeeIds)].slice(0, CARD_BATCH_MAX);
    const found = await this.employees
      .find({ organizationId, _id: { $in: ids }, status: { $ne: 'anonymized' } })
      .sort({ sortName: 1, _id: 1 })
      .lean<EmployeeLean[]>()
      .exec();
    if (found.length !== ids.length) cardEmployeeNotFound();
    const { job, names } = await this.job(organizationId, input.kind, input.template, found);
    const base = input.kind === 'badge' ? 'cartes-de-service' : 'cartes-de-visite';
    if (input.format === 'png-zip') {
      return {
        body: await exportPngZip(this.renderer, job, names),
        contentType: 'application/zip',
        fileName: `${base}.zip`,
      };
    }
    if (input.format === 'sheet') {
      return {
        body: await exportSheet(this.renderer, job),
        contentType: 'application/pdf',
        fileName: `${base}-planche-a4.pdf`,
      };
    }
    return {
      body: await exportPdf(this.renderer, job),
      contentType: 'application/pdf',
      fileName: `${base}.pdf`,
    };
  }

  /** Aperçu d'un modèle avec des données FICTIVES (bandeau « EXEMPLE »). */
  async preview(
    organizationId: string,
    templateRef: string,
    q: { format: 'pdf' | 'png'; face: CardFace; variant?: CardVariant | undefined },
  ): Promise<CardFile> {
    const tpl = await this.resolveTemplate(organizationId, templateRef);
    const settings = await this.settings(organizationId);
    const { identity, logo, logoLight } = await this.identity(organizationId);
    const ks = settings[tpl.kind];
    const theme = cardThemeOf(identity, q.variant ?? ks.variant, ks.accent, tpl.displayFont);
    const verify = await qrCodeSvg(cardVerifyUrl('EXEMPLE-0000000000000000'.slice(0, 24)));
    const vcard = await qrCodeSvg(
      vcardOf({
        firstName: 'Aline',
        lastName: 'Mbuyi Kabongo',
        organization: await this.orgName(organizationId),
        jobTitle: 'Responsable des opérations',
        workPhone: '+243 81 000 00 00',
        workEmail: 'aline.mbuyi@exemple.cd',
        website: settings.website,
        address: null,
      }),
    );
    const d = sampleCardData(
      tpl.kind,
      {
        name: await this.orgName(organizationId),
        logo,
        logoLight,
        address: settings.address,
        website: settings.website,
        phone: settings.phone,
        slogan: settings.slogan,
      },
      { verify, vcard: settings.vcardQr ? vcard : null },
      cardVerifyLabel(),
      { employeeNumber: settings.showEmployeeNumber ? 'EX-0042' : null },
    );
    const faces = facesFor(tpl.kind, settings.badgeVerso).filter((f) => tpl.faces.includes(f));
    const job: CardExportJob = {
      format: tpl.format,
      fonts: [...new Set<FontId>([...theme.fonts, ...tpl.extraFonts])],
      cards: [tpl.render(d, theme, faces)],
      extraCss: tpl.extraCss,
    };
    const slug = templateRef.replace(/[^a-z0-9-]/g, '-');
    if (q.format === 'png') {
      const face = faces.includes(q.face) ? q.face : 'recto';
      return {
        body: await exportPng(this.renderer, job, face),
        contentType: 'image/png',
        fileName: `apercu-${slug}-${face}.png`,
      };
    }
    return {
      body: await exportPdf(this.renderer, job),
      contentType: 'application/pdf',
      fileName: `apercu-${slug}.pdf`,
    };
  }

  // ── Page publique ──────────────────────────────────────────────────────────

  private static readonly INVALID: PublicCardView = { valid: false };

  /** Profil + fiche d'un jeton VALIDE (non révoqué, fiche non anonymisée), sinon `null`. */
  private async byToken(token: string): Promise<{ p: HrCardProfileLean; e: EmployeeLean } | null> {
    if (!isCardToken(token)) return null;
    const p = await this.profiles
      .findOne({ 'verification.token': token })
      .lean<HrCardProfileLean>()
      .exec();
    if (!p?.verification || p.verification.token !== token) return null;
    if (!isValidObjectId(p.employeeId)) return null;
    const e = await this.employees
      .findOne({ _id: p.employeeId, organizationId: p.organizationId })
      .lean<EmployeeLean>()
      .exec();
    if (!e || e.status === 'anonymized') return null;
    return { p, e };
  }

  async verify(token: string, apiBaseUrl: string): Promise<PublicCardView> {
    const hit = await this.byToken(token);
    if (!hit) return HrCardsService.INVALID;
    const { p, e } = hit;
    const exited = employeeStatusOf(engineEmployeeOf(e), hrToday()) === 'exited';
    const brand = await this.branding.state(p.organizationId);
    const logo = brand.logos.primary ?? brand.logos.horizontal ?? brand.logos.symbol ?? null;
    const firstName = e.preferredName?.trim() || e.firstName;
    return {
      valid: true,
      displayName: `${firstName} ${e.lastName}`,
      jobTitle: e.jobTitle,
      organization: {
        name: await this.orgName(p.organizationId),
        logoUrl: logo ? brandAssetUrlFor(logo.assetId) : null,
      },
      status: exited ? 'inactive' : 'active',
      statusLabel: exited ? 'N’est plus en fonction' : 'En fonction',
      photoUrl:
        p.photo && p.photoConsent && p.photoPublic
          ? `${apiBaseUrl}/public/cards/${token}/photo`
          : null,
      checkedAt: new Date().toISOString(),
    };
  }

  async publicPhoto(token: string): Promise<{ body: Buffer; contentType: string } | null> {
    const hit = await this.byToken(token);
    if (!hit) return null;
    const { p } = hit;
    if (!p.photo || !p.photoConsent || !p.photoPublic) return null;
    return this.readPhoto(p.photo);
  }

  // ── Paquets sur mesure ─────────────────────────────────────────────────────

  private packageView(p: HrCardTemplatePackageLean): CardPackageView {
    return {
      packageId: p.packageId,
      templateRef: `pkg:${p.packageId}`,
      format: p.format,
      kind: p.kind,
      orientation: p.orientation,
      id: p.templateId,
      name: p.name,
      version: p.version,
      contentSha256: p.contentSha256,
      byteSize: p.byteSize,
      createdAt: new Date(p.createdAt).toISOString(),
    };
  }

  async listPackages(organizationId: string): Promise<CardPackageView[]> {
    const list = await this.packages
      .find({ organizationId })
      .sort({ templateId: 1, createdAt: -1 })
      .lean<HrCardTemplatePackageLean[]>()
      .exec();
    return list.map((p) => this.packageView(p));
  }

  private static sampleFor(kind: CardKind) {
    return (i: number): CardData =>
      sampleCardData(
        kind,
        {
          name:
            i === 2
              ? 'Société <Kin> & Fils « Très Longue Raison Sociale »'
              : 'Organisation d’essai',
          logo: null,
          logoLight: null,
          address: null,
          website: null,
          phone: null,
          slogan: null,
        },
        { verify: '<svg viewBox="0 0 1 1"></svg>', vcard: '<svg viewBox="0 0 1 1"></svg>' },
        'lalanda.co/v',
        i === 2
          ? {
              firstName: 'Marie-Françoise <b>',
              lastName: 'Kabasele Tshimanga & "Fils"',
              displayName: 'Marie-Françoise <b> Kabasele Tshimanga & "Fils"',
              jobTitle: 'Directrice administrative et financière adjointe',
            }
          : {},
      );
  }

  async installPackage(
    organizationId: string,
    archive: Buffer,
    actor: CardActor,
  ): Promise<{ installed: CardPackageView; created: boolean; report: CardValidationReport }> {
    // Première passe : type de carte inconnu tant que le manifeste n'est pas lu.
    const probe = validateCardPackage(archive, null);
    const kind = probe.compiled?.kind ?? 'badge';
    const { report, compiled } = validateCardPackage(archive, HrCardsService.sampleFor(kind));
    if (!report.ok || !compiled) {
      throw new UnprocessableEntityException({
        code: 'CARD_PACKAGE_INVALID',
        message: `Le modèle n’est pas valide : ${report.errors.length} erreur(s) à corriger.`,
        details: { report },
      });
    }
    const m = compiled.manifest;
    const existing = await this.packages
      .findOne({ organizationId, templateId: m.id, version: m.version })
      .lean<HrCardTemplatePackageLean>()
      .exec();
    if (existing) {
      if (existing.contentSha256 !== compiled.digest) {
        throw new ConflictException({
          code: 'TEMPLATE_VERSION_EXISTS',
          message: `La version ${m.version} de « ${m.id} » est déjà installée avec un autre contenu : publiez une nouvelle version.`,
        });
      }
      return { installed: this.packageView(existing), created: false, report };
    }
    const bucket = this.bucket();
    const packageId = newObjectId();
    const objectKey = `${PACKAGE_PREFIX}${packageId}`;
    await this.storage.putObject(bucket, objectKey, archive, 'application/zip');
    await this.packages.create({
      packageId,
      organizationId,
      format: compiled.format,
      kind: m.kind,
      orientation: m.orientation,
      templateId: m.id,
      version: m.version,
      name: m.name,
      contentSha256: compiled.digest,
      objectKey,
      byteSize: archive.length,
      manifest: m as unknown as Record<string, unknown>,
      createdBy: actor.userId,
    });
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.card_template_package_installed',
      targetType: 'hr_card_template_package',
      targetId: packageId,
      metadata: {
        templateId: m.id,
        version: m.version,
        format: compiled.format,
        contentSha256: compiled.digest,
      },
    });
    const created = await this.packages
      .findOne({ packageId })
      .lean<HrCardTemplatePackageLean>()
      .exec();
    return { installed: this.packageView(created!), created: true, report };
  }

  /** Paquet de CETTE organisation, relu, empreinte recalculée et comparée. */
  private async compiledPackage(
    organizationId: string,
    packageId: string,
  ): Promise<CompiledCardPackage> {
    if (!/^[0-9a-f]{32}$/.test(packageId)) templateNotFound();
    const pkg = await this.packages
      .findOne({ organizationId, packageId })
      .lean<HrCardTemplatePackageLean>()
      .exec();
    if (!pkg) templateNotFound();
    const key = `${organizationId}:${packageId}:${pkg.contentSha256}`;
    const hit = this.compiledCache.get(key);
    if (hit) return hit;
    const obj = await this.storage.getObject(this.bucket(), pkg.objectKey).catch(() => null);
    if (!obj) storageDown();
    const { compiled } = validateCardPackage(obj.body, null);
    if (!compiled || compiled.digest !== pkg.contentSha256) {
      throw new ConflictException({
        code: 'TEMPLATE_PACKAGE_INTEGRITY',
        message: 'Le modèle sur mesure est introuvable ou a changé : réinstallez-le.',
      });
    }
    if (this.compiledCache.size >= CACHE_MAX)
      this.compiledCache.delete(this.compiledCache.keys().next().value!);
    this.compiledCache.set(key, compiled);
    return compiled;
  }
}
