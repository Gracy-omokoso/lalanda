// Identité visuelle d'une organisation et modèle de facture — ADR-0028 § 6 et § 7.
//
// ── Logos : immuables ────────────────────────────────────────────────────────
// Un téléversement crée un NOUVEL objet (identifiant tiré au hasard, octets
// ASSAINIS par `validateAndSanitizeImage` — la même porte que la photo de
// profil) et un enregistrement `organization_brand_assets` qui ne change plus
// jamais. Remplacer ou retirer un logo ne fait que changer le POINTEUR de
// l'identité : l'ancien objet reste, parce qu'une facture gelée peut le désigner
// (`assetId` + `sha256`) et doit se réimprimer à l'identique.
//
// ── Isolation ────────────────────────────────────────────────────────────────
// Toute lecture d'un logo filtre par `organizationId` : une facture (ou un
// identifiant forgé) ne peut pas désigner le logo d'une autre organisation.
//
// ── Rendu ────────────────────────────────────────────────────────────────────
// Les octets d'un logo sont relus du stockage et leur SHA-256 comparé à
// l'empreinte figée avant d'être intégrés au PDF en `data:` (aucune URL dans le
// PDF, confinement S22e). Empreinte différente ou objet absent : 409, le PDF
// n'est pas rendu — un original « presque identique » serait un faux.

import { createHash } from 'node:crypto';

import {
  BRAND_PATTERNS,
  clampIntensity,
  effectiveLogoChoice,
  isLogoChoice,
  isPatternId,
  patternDataUri,
  patternTileSize,
  type BrandPatternSetting,
  type LogoChoice,
} from '@lalanda/shared/branding';

import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import type { ImageAcceptance } from '../account/image-validation.js';
import { isBodyFont } from '../sales/documents/templates/invoice-fonts.js';
import {
  fontAllowed,
  latestTemplate,
  resolveOptions,
  templateAt,
} from '../sales/documents/templates/registry.js';
import { resolveCustomOptions } from '../sales/documents/templates/custom/custom-options.js';
import { CUSTOM_ENGINE_VERSION } from '../sales/documents/templates/custom/custom-template.js';
import type { TemplateManifest } from '../sales/documents/templates/custom/manifest.js';
import type { ResolvedPresentation } from '../sales/documents/templates/template-engine.js';
import {
  CUSTOM_TEMPLATE_KEY,
  HEX_COLOR,
  LOGO_VARIANTS,
  isInvoiceTemplateId,
  type FrozenIdentity,
  type FrozenLogoRef,
  type FrozenPattern,
  type FrozenPresentation,
  type InvoiceTemplateId,
  type LogoVariant,
  type Palette,
  type RenderLogo,
  type RenderPattern,
  type TemplateFontChoice,
  type TemplateOptions,
  type TemplateOptionsInput,
} from '../sales/documents/templates/template.contract.js';
import { brandAssetObjectKey, newObjectId } from '../storage/object-key.js';
import {
  ObjectStorageService,
  ObjectStorageUnavailableError,
} from '../storage/object-storage.service.js';
import { brandAssetUrlFor } from './brand-asset-url.js';
import type {
  PutBrandIdentityInput,
  PutCustomTemplateInput,
  PutInvoiceTemplateInput,
  PutLogoChoiceInput,
  PutPatternInput,
} from './branding.dto.js';
import {
  OrganizationBrand,
  OrganizationBrandAsset,
  type OrganizationBrandAssetDocument,
  type OrganizationBrandDocument,
} from './branding.schema.js';
import {
  TemplatePackagesService,
  packageNotFound,
  type TemplatePackageLean,
} from './template-packages.service.js';

export interface BrandActor {
  userId: string;
  role: string;
}

type BrandLean = OrganizationBrand & { _id: unknown };
type AssetLean = OrganizationBrandAsset & { _id: unknown };

const EMPTY_LOGOS = { primary: null, horizontal: null, symbol: null, light: null } as const;

export interface BrandState {
  logos: Record<LogoVariant, AssetLean | null>;
  primaryColor: string | null;
  secondaryColor: string | null;
  font: string | null;
  invoiceTemplate: OrganizationBrand['invoiceTemplate'];
  /** Choix ENREGISTRÉ (`null` : déduit, voir `logoChoiceOf`). ADR-0073 § 1. */
  logoChoice: LogoChoice | null;
  favicon: AssetLean | null;
  patternImage: AssetLean | null;
  pattern: BrandPatternSetting;
  revision: number;
  updatedAt: Date | null;
}

/** Image d'une organisation : usage et champ de l'identité qui la relie. */
export type BrandImageKind = 'favicon' | 'pattern';
const IMAGE_FIELD: Record<BrandImageKind, 'favicon' | 'patternImage'> = {
  favicon: 'favicon',
  pattern: 'patternImage',
};

/** Couleur d'un motif de la bibliothèque sur une facture : l'accent, noir en « noir et blanc ». */
export function invoicePatternColor(options: TemplateOptions): string {
  return options.palette === 'mono' ? '#111111' : options.accent;
}

/** Entrées de cache : octets d'un logo IMMUABLE, clé `organisation:assetId:sha256`. */
const CACHE_MAX = 32;

function sha256Hex(b: Buffer): string {
  return createHash('sha256').update(b).digest('hex');
}

function staleRevision(current: number): never {
  throw new ConflictException({
    code: 'STALE_BRAND_REVISION',
    message: 'L’identité visuelle a été modifiée entre-temps : rechargez la page.',
    details: { revision: current },
  });
}

function assetUnavailable(cause?: unknown): never {
  if (cause instanceof ObjectStorageUnavailableError) {
    throw new ServiceUnavailableException({
      code: 'BRAND_ASSET_UNAVAILABLE',
      message: 'Le logo de la facture ne peut pas être lu pour le moment : réessayez.',
    });
  }
  throw new ConflictException({
    code: 'BRAND_ASSET_INTEGRITY',
    message:
      'Le logo figé sur ce document est introuvable ou a changé : le document ne peut pas être réimprimé à l’identique.',
  });
}

@Injectable()
export class BrandingService {
  private readonly cache = new Map<string, Buffer>();

  constructor(
    @InjectModel(OrganizationBrand.name) private readonly brands: Model<OrganizationBrandDocument>,
    @InjectModel(OrganizationBrandAsset.name)
    private readonly assets: Model<OrganizationBrandAssetDocument>,
    @Inject(ObjectStorageService) private readonly storage: ObjectStorageService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TemplatePackagesService) private readonly packages: TemplatePackagesService,
  ) {}

  storageAvailable(): boolean {
    return this.storage.availability().available;
  }

  // ── Lecture ────────────────────────────────────────────────────────────────

  async state(organizationId: string, session?: ClientSession): Promise<BrandState> {
    const doc = await this.brands
      .findOne({ organizationId }, null, session ? { session } : {})
      .lean<BrandLean>()
      .exec();
    const ids = [
      ...LOGO_VARIANTS.map((v) => doc?.logos?.[v] ?? null),
      doc?.favicon ?? null,
      doc?.patternImage ?? null,
    ].filter((x): x is string => typeof x === 'string');
    const found =
      ids.length > 0
        ? await this.assets
            .find({ organizationId, assetId: { $in: ids } }, null, session ? { session } : {})
            .lean<AssetLean[]>()
            .exec()
        : [];
    const logos = {} as Record<LogoVariant, AssetLean | null>;
    for (const v of LOGO_VARIANTS) {
      const id = doc?.logos?.[v] ?? null;
      logos[v] = id ? (found.find((a) => a.assetId === id) ?? null) : null;
    }
    return {
      logos,
      primaryColor: doc?.primaryColor ?? null,
      secondaryColor: doc?.secondaryColor ?? null,
      font: doc?.font ?? null,
      invoiceTemplate: doc?.invoiceTemplate ?? null,
      logoChoice: isLogoChoice(doc?.logoChoice) ? doc.logoChoice : null,
      favicon: doc?.favicon ? (found.find((a) => a.assetId === doc.favicon) ?? null) : null,
      patternImage: doc?.patternImage
        ? (found.find((a) => a.assetId === doc.patternImage) ?? null)
        : null,
      pattern: patternSettingOf(doc?.pattern),
      revision: doc?.revision ?? 0,
      updatedAt: doc?.updatedAt ?? null,
    };
  }

  /** Choix de logo EFFECTIF : enregistré, sinon déduit des logos téléversés (ADR-0073 § 1). */
  logoChoiceOf(state: BrandState): LogoChoice {
    return effectiveLogoChoice(state.logoChoice, {
      primary: state.logos.primary !== null,
      horizontal: state.logos.horizontal !== null,
      symbol: state.logos.symbol !== null,
    });
  }

  /**
   * Motif à FIGER (ADR-0073 § 4) : `null` sans motif, ou si l'image choisie a été
   * retirée. La couleur d'un motif de la bibliothèque est résolue ici, figée.
   */
  patternToFreeze(state: BrandState, color: string): FrozenPattern | null {
    const p = state.pattern;
    if (p.source === 'library' && p.libraryId && isPatternId(p.libraryId)) {
      return {
        source: 'library',
        id: p.libraryId,
        color: HEX_COLOR.test(color) ? color : '#111111',
        intensity: clampIntensity(p.intensity),
      };
    }
    if (p.source === 'upload' && state.patternImage) {
      const a = state.patternImage;
      return {
        source: 'upload',
        image: {
          assetId: a.assetId,
          sha256: a.sha256,
          contentType: a.contentType,
          width: a.width,
          height: a.height,
        },
        intensity: clampIntensity(p.intensity),
      };
    }
    return null;
  }

  /** Motif prêt au rendu ; l'image téléversée est relue et vérifiée contre son empreinte. */
  async renderPattern(organizationId: string, p: FrozenPattern): Promise<RenderPattern> {
    const opacity = clampIntensity(p.intensity) / 100;
    if (p.source === 'library') {
      const size = patternTileSize(p.id);
      return {
        dataUri: patternDataUri(p.id, p.color),
        width: size.w,
        height: size.h,
        raster: false,
        opacity,
      };
    }
    const l = await this.renderLogo(organizationId, p.image);
    return { dataUri: l.dataUri, width: l.width, height: l.height, raster: true, opacity };
  }

  /**
   * Motif COURANT d'un document non figé (cartes, documents RH) dans la couleur
   * demandée. Une image illisible est omise (pas de motif) plutôt que de bloquer.
   */
  async currentPatternForRender(
    organizationId: string,
    color: string,
    state?: BrandState,
  ): Promise<RenderPattern | null> {
    const s = state ?? (await this.state(organizationId));
    const frozen = this.patternToFreeze(s, color);
    if (!frozen) return null;
    return this.renderPattern(organizationId, frozen).catch(() => null);
  }

  /** URL signée du favicon de l'organisation, ou `null` (favicon Lalanda). */
  async faviconUrl(organizationId: string): Promise<string | null> {
    try {
      const s = await this.state(organizationId);
      return s.favicon ? brandAssetUrlFor(s.favicon.assetId) : null;
    } catch {
      return null;
    }
  }

  /** Empreinte de l'identité COURANTE (ce que le gel recopie). */
  identityOf(state: BrandState): FrozenIdentity {
    const logos = {} as Record<LogoVariant, FrozenLogoRef | null>;
    for (const v of LOGO_VARIANTS) {
      const a = state.logos[v];
      logos[v] = a
        ? {
            assetId: a.assetId,
            sha256: a.sha256,
            contentType: a.contentType,
            width: a.width,
            height: a.height,
          }
        : null;
    }
    return {
      primaryColor:
        state.primaryColor && HEX_COLOR.test(state.primaryColor) ? state.primaryColor : null,
      secondaryColor:
        state.secondaryColor && HEX_COLOR.test(state.secondaryColor) ? state.secondaryColor : null,
      font: isBodyFont(state.font) ? state.font : null,
      logos,
      logoChoice: this.logoChoiceOf(state),
    };
  }

  /** Options saisies du modèle choisi, normalisées (valeurs hors liste → `null`). */
  private optionsInput(state: BrandState): TemplateOptionsInput {
    const o = state.invoiceTemplate?.options;
    return {
      palette: o?.palette === 'brand' || o?.palette === 'mono' ? o.palette : null,
      accent: o?.accent && HEX_COLOR.test(o.accent) ? o.accent : null,
      font: (o?.font ?? null) as TemplateOptionsInput['font'],
    };
  }

  /**
   * Présentation à FIGER au gel d'une facture : modèle (dernière version),
   * options résolues, empreinte de l'identité. `null` si l'organisation n'a
   * choisi aucun modèle (présentation d'origine, inchangée).
   */
  async presentationToFreeze(
    organizationId: string,
    session?: ClientSession,
  ): Promise<FrozenPresentation | null> {
    const state = await this.state(organizationId, session);
    const id = state.invoiceTemplate?.id;
    if (id === CUSTOM_TEMPLATE_KEY) {
      const pkg = await this.packages.find(
        organizationId,
        state.invoiceTemplate?.packageId ?? '',
        session,
      );
      // Paquet introuvable (ne devrait pas arriver : jamais supprimé) :
      // présentation d'origine plutôt qu'une facture impossible à geler.
      if (!pkg) return null;
      const p = this.customPresentation(pkg, this.optionsInput(state), this.identityOf(state));
      return withPattern(p, this.patternToFreeze(state, invoicePatternColor(p.options)));
    }
    if (!isInvoiceTemplateId(id)) return null;
    const template = latestTemplate(id);
    const identity = this.identityOf(state);
    const options = resolveOptions(template, this.optionsInput(state), identity);
    return withPattern(
      { template: { id: template.id, version: template.version }, options, identity },
      this.patternToFreeze(state, invoicePatternColor(options)),
    );
  }

  /** Présentation d'un paquet sur mesure (ADR-0029 § 7) : référence figée et options résolues. */
  private customPresentation(
    pkg: TemplatePackageLean,
    input: TemplateOptionsInput | null,
    identity: FrozenIdentity,
  ): FrozenPresentation {
    return {
      template: { id: CUSTOM_TEMPLATE_KEY, version: CUSTOM_ENGINE_VERSION },
      package: {
        packageId: pkg.packageId,
        id: pkg.templateId,
        name: pkg.name,
        version: pkg.version,
        sha256: pkg.contentSha256,
      },
      options: resolveCustomOptions(optionsSourceOf(pkg.manifest), input, identity),
      identity,
    };
  }

  /**
   * Aperçu d'un paquet installé : les options passées, sinon celles
   * enregistrées si c'est le modèle choisi, sinon l'identité et le manifeste.
   */
  async presentationForPackagePreview(
    organizationId: string,
    packageId: string,
    override: Partial<TemplateOptions>,
  ): Promise<FrozenPresentation> {
    const pkg = await this.packages.find(organizationId, packageId);
    if (!pkg) packageNotFound();
    const state = await this.state(organizationId);
    const saved =
      state.invoiceTemplate?.id === CUSTOM_TEMPLATE_KEY &&
      state.invoiceTemplate.packageId === packageId
        ? this.optionsInput(state)
        : null;
    const choices = pkg.manifest.options.fonts;
    const p = this.customPresentation(
      pkg,
      {
        palette: override.palette ?? saved?.palette ?? null,
        accent: override.accent ?? saved?.accent ?? null,
        font:
          override.font && choices.includes(override.font) ? override.font : (saved?.font ?? null),
      },
      this.identityOf(state),
    );
    return withPattern(p, this.patternToFreeze(state, invoicePatternColor(p.options)));
  }

  /**
   * Présentation d'un APERÇU : le modèle demandé, les options passées (sinon
   * celles enregistrées si c'est le modèle choisi, sinon l'identité), l'identité
   * courante.
   */
  async presentationForPreview(
    organizationId: string,
    templateId: InvoiceTemplateId,
    override: Partial<TemplateOptions>,
  ): Promise<FrozenPresentation> {
    const state = await this.state(organizationId);
    const template = latestTemplate(templateId);
    const identity = this.identityOf(state);
    const saved = state.invoiceTemplate?.id === templateId ? this.optionsInput(state) : null;
    const input: TemplateOptionsInput = {
      palette: override.palette ?? saved?.palette ?? null,
      accent: override.accent ?? saved?.accent ?? null,
      font:
        override.font && fontAllowed(template, override.font)
          ? override.font
          : (saved?.font ?? null),
    };
    const options = resolveOptions(template, input, identity);
    return withPattern(
      { template: { id: template.id, version: template.version }, options, identity },
      this.patternToFreeze(state, invoicePatternColor(options)),
    );
  }

  /**
   * Résout une présentation (figée ou courante) pour le rendu : version EXACTE
   * du modèle, octets des logos relus et vérifiés contre leur empreinte.
   */
  async resolveForRender(
    organizationId: string,
    p: FrozenPresentation,
  ): Promise<ResolvedPresentation> {
    const template =
      p.template.id === CUSTOM_TEMPLATE_KEY
        ? p.package && p.template.version === CUSTOM_ENGINE_VERSION
          ? await this.packages.compiled(organizationId, p.package)
          : null
        : templateAt(p.template.id, p.template.version);
    if (!template) {
      throw new ConflictException({
        code: 'INVOICE_TEMPLATE_UNAVAILABLE',
        message: `Le modèle « ${p.template.id} » en version ${p.template.version} n’est pas disponible dans cette version de Lalanda.`,
      });
    }
    const logos = {} as Record<LogoVariant, RenderLogo | null>;
    for (const v of LOGO_VARIANTS) {
      const ref = p.identity.logos[v];
      logos[v] = ref ? await this.renderLogo(organizationId, ref) : null;
    }
    // Motif figé (ADR-0073) : absent des présentations d'avant, donc aucun.
    const pattern = p.pattern ? await this.renderPattern(organizationId, p.pattern) : null;
    return {
      template,
      options: p.options,
      identity: p.identity,
      logos,
      ...(pattern ? { pattern } : {}),
    };
  }

  private async renderLogo(organizationId: string, ref: FrozenLogoRef): Promise<RenderLogo> {
    const bytes = await this.assetBytes(organizationId, ref.assetId, ref.sha256);
    return {
      dataUri: `data:${ref.contentType};base64,${bytes.toString('base64')}`,
      width: ref.width,
      height: ref.height,
    };
  }

  /** Octets d'un logo de CETTE organisation, vérifiés contre `sha256`. */
  private async assetBytes(
    organizationId: string,
    assetId: string,
    sha256: string,
  ): Promise<Buffer> {
    // L'organisation fait partie de la clé : un cache commun ne doit jamais
    // court-circuiter le filtre par organisation (isolation).
    const key = `${organizationId}:${assetId}:${sha256}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const asset = await this.assets.findOne({ assetId, organizationId }).lean<AssetLean>().exec();
    if (!asset || asset.sha256 !== sha256) assetUnavailable();
    const bucket = this.storage.uploadsBucket();
    if (!bucket) assetUnavailable(new ObjectStorageUnavailableError('Bucket absent.'));
    let body: Buffer;
    try {
      const obj = await this.storage.getObject(bucket, asset.objectKey);
      if (!obj) assetUnavailable();
      body = obj.body;
    } catch (cause) {
      if (cause instanceof ConflictException) throw cause;
      assetUnavailable(
        cause instanceof ObjectStorageUnavailableError
          ? cause
          : new ObjectStorageUnavailableError((cause as Error).message),
      );
    }
    if (sha256Hex(body) !== sha256) assetUnavailable();
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, body);
    return body;
  }

  /**
   * Octets servis à l'interface (`GET /brand-assets/:token`) : SEULEMENT si le
   * logo est encore relié à l'identité de son organisation (révocation).
   */
  async readLinkedAsset(assetId: string): Promise<{ body: Buffer; contentType: string } | null> {
    const asset = await this.assets.findOne({ assetId }).lean<AssetLean>().exec();
    if (!asset) return null;
    const linked = await this.brands
      .exists({
        organizationId: asset.organizationId,
        $or: [
          ...LOGO_VARIANTS.map((v) => ({ [`logos.${v}`]: assetId })),
          { favicon: assetId },
          { patternImage: assetId },
        ],
      })
      .exec();
    if (!linked) return null;
    const bucket = this.storage.uploadsBucket();
    if (!bucket) return null;
    const obj = await this.storage.getObject(bucket, asset.objectKey);
    if (!obj) return null;
    return { body: obj.body, contentType: asset.contentType };
  }

  // ── Écriture ───────────────────────────────────────────────────────────────

  async putIdentity(
    organizationId: string,
    input: PutBrandIdentityInput,
    actor: BrandActor,
  ): Promise<void> {
    await this.ensure(organizationId);
    const res = await this.brands
      .updateOne(
        { organizationId, revision: input.expectedRevision },
        {
          $set: {
            primaryColor: input.primaryColor,
            secondaryColor: input.secondaryColor,
            font: input.font,
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision((await this.state(organizationId)).revision);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'organization.brand_identity_updated',
      targetType: 'organization',
      targetId: organizationId,
      metadata: {
        primaryColor: input.primaryColor,
        secondaryColor: input.secondaryColor,
        font: input.font,
      },
    });
  }

  async putInvoiceTemplate(
    organizationId: string,
    input: PutInvoiceTemplateInput,
    actor: BrandActor,
  ): Promise<void> {
    if (input.templateId !== null && input.options.font !== null) {
      if (!fontAllowed(latestTemplate(input.templateId), input.options.font)) {
        throw new ConflictException({
          code: 'FONT_NOT_ALLOWED',
          message: 'Cette police n’est pas proposée par ce modèle.',
          details: { templateId: input.templateId, font: input.options.font },
        });
      }
    }
    await this.ensure(organizationId);
    const res = await this.brands
      .updateOne(
        { organizationId, revision: input.expectedRevision },
        {
          $set: {
            invoiceTemplate:
              input.templateId === null ? null : { id: input.templateId, options: input.options },
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision((await this.state(organizationId)).revision);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'sales.invoice_template_updated',
      targetType: 'organization',
      targetId: organizationId,
      metadata: {
        templateId: input.templateId,
        palette: input.options.palette,
        accent: input.options.accent,
        font: input.options.font,
      },
    });
  }

  /** Active un paquet sur mesure installé comme modèle de l'organisation (ADR-0029 § 8). */
  async putCustomTemplate(
    organizationId: string,
    input: PutCustomTemplateInput,
    actor: BrandActor,
  ): Promise<void> {
    const pkg = await this.packages.find(organizationId, input.packageId);
    if (!pkg) packageNotFound();
    const o = pkg.manifest.options;
    if (input.options.font !== null && !o.fonts.includes(input.options.font)) {
      throw new ConflictException({
        code: 'FONT_NOT_ALLOWED',
        message: 'Cette police n’est pas proposée par ce modèle.',
        details: { packageId: input.packageId, font: input.options.font },
      });
    }
    if (input.options.palette !== null && !o.palettes.includes(input.options.palette)) {
      throw new ConflictException({
        code: 'PALETTE_NOT_ALLOWED',
        message: 'Cette palette n’est pas proposée par ce modèle.',
        details: { packageId: input.packageId, palette: input.options.palette },
      });
    }
    await this.ensure(organizationId);
    const res = await this.brands
      .updateOne(
        { organizationId, revision: input.expectedRevision },
        {
          $set: {
            invoiceTemplate: {
              id: CUSTOM_TEMPLATE_KEY,
              packageId: pkg.packageId,
              options: input.options,
            },
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision((await this.state(organizationId)).revision);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'sales.invoice_template_updated',
      targetType: 'organization',
      targetId: organizationId,
      metadata: {
        templateId: CUSTOM_TEMPLATE_KEY,
        packageId: pkg.packageId,
        package: `${pkg.templateId}@${pkg.version}`,
        contentSha256: pkg.contentSha256,
        palette: input.options.palette,
        accent: input.options.accent,
        font: input.options.font,
      },
    });
  }

  /**
   * Téléverse un logo (octets DÉJÀ assainis) et le relie à `variant`.
   * L'ancien logo de cette déclinaison n'est PAS supprimé (factures gelées).
   */
  async uploadLogo(
    organizationId: string,
    variant: LogoVariant,
    image: ImageAcceptance,
    actor: BrandActor,
  ): Promise<AssetLean> {
    const bucket = this.storage.uploadsBucket();
    if (!bucket) {
      const a = this.storage.availability();
      throw new ObjectStorageUnavailableError(a.available ? 'Bucket absent.' : a.reason);
    }
    const assetId = newObjectId();
    const objectKey = brandAssetObjectKey(assetId);
    const sha256 = sha256Hex(image.bytes);
    // 1. l'objet, 2. son enregistrement immuable, 3. le pointeur de l'identité :
    // à aucun instant l'identité ne désigne un logo absent.
    await this.storage.putObject(bucket, objectKey, image.bytes, image.contentType);
    await this.assets.create({
      assetId,
      organizationId,
      objectKey,
      contentType: image.contentType,
      width: image.width,
      height: image.height,
      byteSize: image.bytes.length,
      sha256,
      createdBy: actor.userId,
    });
    await this.ensure(organizationId);
    await this.brands
      .updateOne(
        { organizationId },
        { $set: { [`logos.${variant}`]: assetId, updatedBy: actor.userId }, $inc: { revision: 1 } },
      )
      .exec();
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'organization.brand_logo_uploaded',
      targetType: 'organization_brand_asset',
      targetId: assetId,
      metadata: { variant, contentType: image.contentType, bytes: image.bytes.length, sha256 },
    });
    const created = await this.assets.findOne({ assetId }).lean<AssetLean>().exec();
    return created!;
  }

  /** Détache le logo de `variant`. Idempotent ; l'objet est conservé. */
  async removeLogo(
    organizationId: string,
    variant: LogoVariant,
    actor: BrandActor,
  ): Promise<boolean> {
    const res = await this.brands
      .updateOne(
        { organizationId, [`logos.${variant}`]: { $type: 'string' } },
        { $set: { [`logos.${variant}`]: null, updatedBy: actor.userId }, $inc: { revision: 1 } },
      )
      .exec();
    if (res.modifiedCount !== 1) return false;
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'organization.brand_logo_removed',
      targetType: 'organization',
      targetId: organizationId,
      metadata: { variant },
    });
    return true;
  }

  private async ensure(organizationId: string): Promise<void> {
    await this.brands
      .updateOne(
        { organizationId },
        {
          $setOnInsert: {
            organizationId,
            logos: { ...EMPTY_LOGOS },
            primaryColor: null,
            secondaryColor: null,
            font: null,
            invoiceTemplate: null,
            logoChoice: null,
            favicon: null,
            patternImage: null,
            pattern: null,
            revision: 0,
            updatedBy: null,
            _schemaVersion: 1,
          },
        },
        { upsert: true },
      )
      .exec()
      .catch((err: { code?: number }) => {
        // Deux premières écritures simultanées : l'une crée, l'autre retrouve.
        if (err?.code !== 11000) throw err;
      });
  }

  /**
   * ADR-0069 : logos COURANTS de l'organisation, octets relus et vérifiés contre
   * leur empreinte, prêts pour le rendu d'une carte (`data:`). Un logo illisible
   * est omis (la carte retombe sur le monogramme) plutôt que de bloquer l'export.
   */
  async currentLogosForRender(organizationId: string): Promise<{
    identity: FrozenIdentity;
    logos: Record<LogoVariant, RenderLogo | null>;
    /** ADR-0073 : choix effectif, et l'état pour résoudre le motif courant. */
    logoChoice: LogoChoice;
    state: BrandState;
  }> {
    const state = await this.state(organizationId);
    const identity = this.identityOf(state);
    const logos = {} as Record<LogoVariant, RenderLogo | null>;
    for (const v of LOGO_VARIANTS) {
      const ref = identity.logos[v];
      logos[v] = ref ? await this.renderLogo(organizationId, ref).catch(() => null) : null;
    }
    return { identity, logos, logoChoice: this.logoChoiceOf(state), state };
  }

  // ── Identité visuelle v2 (ADR-0073) ─────────────────────────────────────────

  async putLogoChoice(
    organizationId: string,
    input: PutLogoChoiceInput,
    actor: BrandActor,
  ): Promise<void> {
    await this.ensure(organizationId);
    const res = await this.brands
      .updateOne(
        { organizationId, revision: input.expectedRevision },
        { $set: { logoChoice: input.logoChoice, updatedBy: actor.userId }, $inc: { revision: 1 } },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision((await this.state(organizationId)).revision);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'organization.brand_logo_choice_updated',
      targetType: 'organization',
      targetId: organizationId,
      metadata: { logoChoice: input.logoChoice },
    });
  }

  async putPattern(
    organizationId: string,
    input: PutPatternInput,
    actor: BrandActor,
  ): Promise<void> {
    if (input.source === 'upload') {
      const s = await this.state(organizationId);
      if (!s.patternImage) {
        throw new ConflictException({
          code: 'PATTERN_IMAGE_MISSING',
          message: 'Téléversez d’abord votre motif (PNG transparent).',
        });
      }
    }
    const pattern: BrandPatternSetting = {
      source: input.source,
      libraryId: input.source === 'library' ? input.libraryId : null,
      intensity: clampIntensity(input.intensity),
    };
    await this.ensure(organizationId);
    const res = await this.brands
      .updateOne(
        { organizationId, revision: input.expectedRevision },
        { $set: { pattern, updatedBy: actor.userId }, $inc: { revision: 1 } },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision((await this.state(organizationId)).revision);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'organization.brand_pattern_updated',
      targetType: 'organization',
      targetId: organizationId,
      metadata: { ...pattern },
    });
  }

  /**
   * Téléverse un favicon ou un motif (octets DÉJÀ assainis et contrôlés) et le
   * relie à l'identité. L'ancien objet n'est pas supprimé : un document figé
   * peut désigner un ancien motif.
   */
  async uploadImage(
    organizationId: string,
    kind: BrandImageKind,
    image: ImageAcceptance,
    actor: BrandActor,
  ): Promise<void> {
    const assetId = await this.storeAsset(organizationId, kind, image, actor);
    await this.ensure(organizationId);
    await this.brands
      .updateOne(
        { organizationId },
        { $set: { [IMAGE_FIELD[kind]]: assetId, updatedBy: actor.userId }, $inc: { revision: 1 } },
      )
      .exec();
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action:
        kind === 'favicon'
          ? 'organization.brand_favicon_uploaded'
          : 'organization.brand_pattern_uploaded',
      targetType: 'organization_brand_asset',
      targetId: assetId,
      metadata: {
        contentType: image.contentType,
        bytes: image.bytes.length,
        width: image.width,
        height: image.height,
      },
    });
  }

  /** Détache le favicon ou le motif téléversé. Idempotent ; l'objet est conservé. */
  async removeImage(
    organizationId: string,
    kind: BrandImageKind,
    actor: BrandActor,
  ): Promise<boolean> {
    const field = IMAGE_FIELD[kind];
    const set: Record<string, unknown> = { [field]: null, updatedBy: actor.userId };
    const res = await this.brands
      .updateOne(
        { organizationId, [field]: { $type: 'string' } },
        { $set: set, $inc: { revision: 1 } },
      )
      .exec();
    if (res.modifiedCount !== 1) return false;
    // Motif téléversé retiré alors qu'il était choisi : plus de motif.
    if (kind === 'pattern') {
      await this.brands
        .updateOne(
          { organizationId, 'pattern.source': 'upload' },
          { $set: { 'pattern.source': 'none' } },
        )
        .exec();
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action:
        kind === 'favicon'
          ? 'organization.brand_favicon_removed'
          : 'organization.brand_pattern_removed',
      targetType: 'organization',
      targetId: organizationId,
      metadata: {},
    });
    return true;
  }

  /** Objet + enregistrement immuable d'une image (même ordre que `uploadLogo`). */
  private async storeAsset(
    organizationId: string,
    kind: 'logo' | BrandImageKind,
    image: ImageAcceptance,
    actor: BrandActor,
  ): Promise<string> {
    const bucket = this.storage.uploadsBucket();
    if (!bucket) {
      const a = this.storage.availability();
      throw new ObjectStorageUnavailableError(a.available ? 'Bucket absent.' : a.reason);
    }
    const assetId = newObjectId();
    const objectKey = brandAssetObjectKey(assetId);
    await this.storage.putObject(bucket, objectKey, image.bytes, image.contentType);
    await this.assets.create({
      assetId,
      organizationId,
      objectKey,
      contentType: image.contentType,
      width: image.width,
      height: image.height,
      byteSize: image.bytes.length,
      sha256: sha256Hex(image.bytes),
      createdBy: actor.userId,
      kind,
    });
    return assetId;
  }
}

/** Options d'un paquet (manifeste validé) dans la forme attendue par la résolution. */
export function optionsSourceOf(m: TemplateManifest): {
  defaults: TemplateOptions;
  fontChoices: readonly TemplateFontChoice[];
  palettes: readonly Palette[];
} {
  const palettes = m.options.palettes as Palette[];
  return {
    defaults: {
      palette: palettes.includes('brand') ? 'brand' : palettes[0]!,
      accent: m.options.accent.toLowerCase(),
      font: m.options.font as TemplateFontChoice,
    },
    fontChoices: m.options.fonts as TemplateFontChoice[],
    palettes,
  };
}

/** Réglage de motif normalisé (valeurs hors liste ⇒ aucun motif). */
export function patternSettingOf(raw: unknown): BrandPatternSetting {
  const p = (raw ?? null) as Partial<BrandPatternSetting> | null;
  const source = p?.source === 'library' || p?.source === 'upload' ? p.source : 'none';
  const libraryId = isPatternId(p?.libraryId) ? p.libraryId : null;
  return {
    source: source === 'library' && libraryId === null ? 'none' : source,
    libraryId,
    intensity: clampIntensity(p?.intensity),
  };
}

/** Ajoute le motif à une présentation seulement s'il y en a un (présentation d'avant sinon). */
function withPattern(p: FrozenPresentation, pattern: FrozenPattern | null): FrozenPresentation {
  return pattern ? { ...p, pattern } : p;
}

/** Bibliothèque exposée à l'écran (identifiants et noms). */
export const PATTERN_LIBRARY = BRAND_PATTERNS;
