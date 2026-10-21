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
import type { ResolvedPresentation } from '../sales/documents/templates/template-engine.js';
import {
  HEX_COLOR,
  LOGO_VARIANTS,
  isInvoiceTemplateId,
  type FrozenIdentity,
  type FrozenLogoRef,
  type FrozenPresentation,
  type InvoiceTemplateId,
  type LogoVariant,
  type RenderLogo,
  type TemplateOptions,
  type TemplateOptionsInput,
} from '../sales/documents/templates/template.contract.js';
import { brandAssetObjectKey, newObjectId } from '../storage/object-key.js';
import {
  ObjectStorageService,
  ObjectStorageUnavailableError,
} from '../storage/object-storage.service.js';
import type { PutBrandIdentityInput, PutInvoiceTemplateInput } from './branding.dto.js';
import {
  OrganizationBrand,
  OrganizationBrandAsset,
  type OrganizationBrandAssetDocument,
  type OrganizationBrandDocument,
} from './branding.schema.js';

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
  revision: number;
  updatedAt: Date | null;
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
    const ids = LOGO_VARIANTS.map((v) => doc?.logos?.[v] ?? null).filter(
      (x): x is string => typeof x === 'string',
    );
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
      revision: doc?.revision ?? 0,
      updatedAt: doc?.updatedAt ?? null,
    };
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
    if (!isInvoiceTemplateId(id)) return null;
    const template = latestTemplate(id);
    const identity = this.identityOf(state);
    return {
      template: { id: template.id, version: template.version },
      options: resolveOptions(template, this.optionsInput(state), identity),
      identity,
    };
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
    return {
      template: { id: template.id, version: template.version },
      options: resolveOptions(template, input, identity),
      identity,
    };
  }

  /**
   * Résout une présentation (figée ou courante) pour le rendu : version EXACTE
   * du modèle, octets des logos relus et vérifiés contre leur empreinte.
   */
  async resolveForRender(
    organizationId: string,
    p: FrozenPresentation,
  ): Promise<ResolvedPresentation> {
    const template = templateAt(p.template.id, p.template.version);
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
    return { template, options: p.options, identity: p.identity, logos };
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
        $or: LOGO_VARIANTS.map((v) => ({ [`logos.${v}`]: assetId })),
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
}
