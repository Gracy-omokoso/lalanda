// Identité visuelle de l'organisation active — ADR-0028 § 7.
//
//   GET    /organizations/current/brand                 → identité (logos, couleurs, police)
//   PUT    /organizations/current/brand/identity        → couleurs et police
//   POST   /organizations/current/brand/logos/:variant  → téléverse un logo (corps BINAIRE brut)
//   DELETE /organizations/current/brand/logos/:variant  → détache un logo
//
// `organization.manage` (Propriétaire, Administrateur) : l'identité visuelle est
// un paramètre de l'organisation, comme son nom ; elle n'engage pas le
// contribuable (le CONTENU fiscal d'une facture n'en dépend pas, ADR-0028 § 2).
//
// Le téléversement reprend À L'IDENTIQUE la porte de la photo de profil
// (`account.controller.ts`) : type annoncé non cru, corps borné AVANT lecture,
// `validateAndSanitizeImage` (PNG, JPEG, WebP ; SVG refusé), octets reconstruits.

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Req,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MIN_IMAGE_DIMENSION,
  validateAndSanitizeImage,
} from '../account/image-validation.js';
import { readRequestBody } from '../account/request-body.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { CurrentOrgRole } from '../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import type { OrgRole } from '../authz/permissions.js';
import { issuesOf } from '../fiscal/fiscal.dto.js';
import { BODY_FONT_IDS, FONTS } from '../sales/documents/templates/invoice-fonts.js';
import {
  LOGO_VARIANTS,
  LOGO_VARIANT_LABELS,
  type LogoVariant,
} from '../sales/documents/templates/template.contract.js';
import { UserThrottlerGuard } from '../security/user-throttler.guard.js';
import { ObjectStorageUnavailableError } from '../storage/object-storage.service.js';
import { BRAND_ASSET_URL_TTL_SECONDS, brandAssetUrlFor } from './brand-asset-url.js';
import { LogoVariantSchema, PutBrandIdentitySchema } from './branding.dto.js';
import { BrandingService, type BrandActor, type BrandState } from './branding.service.js';

export interface BrandLogoView {
  variant: LogoVariant;
  label: string;
  assetId: string;
  /** URL signée à durée limitée ; révoquée dès que le logo est remplacé ou retiré. */
  url: string;
  contentType: string;
  width: number;
  height: number;
  byteSize: number;
}

export interface BrandView {
  logos: Record<LogoVariant, BrandLogoView | null>;
  primaryColor: string | null;
  secondaryColor: string | null;
  font: string | null;
  revision: number;
  updatedAt: string | null;
  fonts: { id: string; label: string }[];
  variants: { id: LogoVariant; label: string }[];
  limits: {
    maxBytes: number;
    minDimension: number;
    maxDimension: number;
    acceptedTypes: readonly string[];
    urlTtlSeconds: number;
    storageAvailable: boolean;
  };
}

export function brandViewOf(state: BrandState, storageAvailable: boolean): BrandView {
  const logos = {} as Record<LogoVariant, BrandLogoView | null>;
  for (const v of LOGO_VARIANTS) {
    const a = state.logos[v];
    logos[v] = a
      ? {
          variant: v,
          label: LOGO_VARIANT_LABELS[v],
          assetId: a.assetId,
          url: brandAssetUrlFor(a.assetId),
          contentType: a.contentType,
          width: a.width,
          height: a.height,
          byteSize: a.byteSize,
        }
      : null;
  }
  return {
    logos,
    primaryColor: state.primaryColor,
    secondaryColor: state.secondaryColor,
    font: state.font,
    revision: state.revision,
    updatedAt: state.updatedAt ? state.updatedAt.toISOString() : null,
    fonts: BODY_FONT_IDS.map((id) => ({ id, label: FONTS[id].label })),
    variants: LOGO_VARIANTS.map((id) => ({ id, label: LOGO_VARIANT_LABELS[id] })),
    limits: {
      maxBytes: MAX_IMAGE_BYTES,
      minDimension: MIN_IMAGE_DIMENSION,
      maxDimension: MAX_IMAGE_DIMENSION,
      acceptedTypes: ACCEPTED_IMAGE_TYPES,
      urlTtlSeconds: BRAND_ASSET_URL_TTL_SECONDS,
      storageAvailable,
    },
  };
}

function actorOf(user: { id: string }, role: OrgRole | undefined): BrandActor {
  return { userId: user.id, role: role ?? 'unknown' };
}

function variantOf(raw: string): LogoVariant {
  const parsed = LogoVariantSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'INVALID_LOGO_VARIANT',
      message: `Déclinaison inconnue. Attendu : ${LOGO_VARIANTS.join(', ')}.`,
    });
  }
  return parsed.data;
}

function imageRejection(code: string, message: string): HttpException {
  const statut =
    code === 'FILE_TOO_LARGE'
      ? 413
      : code === 'UNSUPPORTED_IMAGE_TYPE'
        ? 415
        : code === 'IMAGE_DIMENSIONS_REJECTED'
          ? 422
          : 400;
  return new HttpException({ code, message }, statut);
}

function storageFailure(cause: unknown): HttpException {
  if (cause instanceof ObjectStorageUnavailableError) {
    return new ServiceUnavailableException({ code: 'STORAGE_UNAVAILABLE', message: cause.reason });
  }
  if (cause instanceof HttpException) return cause;
  return new ServiceUnavailableException({
    code: 'STORAGE_FAILURE',
    message: 'Le stockage des fichiers n’a pas pu traiter la demande.',
  });
}

@Controller('organizations/current/brand')
@UseGuards(AuthGuard, PermissionsGuard)
export class BrandingController {
  constructor(@Inject(BrandingService) private readonly branding: BrandingService) {}

  private async view(orgId: string): Promise<BrandView> {
    return brandViewOf(await this.branding.state(orgId), this.branding.storageAvailable());
  }

  @Get()
  @RequirePermission('organization.manage')
  async get(@CurrentOrgId() orgId: string): Promise<BrandView> {
    return this.view(orgId);
  }

  @Put('identity')
  @RequirePermission('organization.manage')
  async putIdentity(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<BrandView> {
    const parsed = PutBrandIdentitySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Corps de requête invalide.',
        details: { issues: issuesOf(parsed.error) },
      });
    }
    await this.branding.putIdentity(orgId, parsed.data, actorOf(user, role));
    return this.view(orgId);
  }

  /** Vingt écritures par heure et par utilisateur, comme la photo de profil. */
  @Post('logos/:variant')
  @HttpCode(201)
  @RequirePermission('organization.manage')
  @Throttle({ default: { ttl: 3_600_000, limit: 20 } })
  @UseGuards(UserThrottlerGuard)
  async uploadLogo(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('variant') rawVariant: string,
    @Req() req: Request,
  ): Promise<BrandView> {
    const variant = variantOf(rawVariant);
    const annonce = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (
      annonce &&
      !ACCEPTED_IMAGE_TYPES.includes(annonce as never) &&
      annonce !== 'application/octet-stream'
    ) {
      throw new UnsupportedMediaTypeException({
        code: 'UNSUPPORTED_IMAGE_TYPE',
        message: `Type « ${annonce} » non accepté. Attendu : ${ACCEPTED_IMAGE_TYPES.join(', ')} (le SVG est refusé).`,
      });
    }
    const lecture = await readRequestBody(req, MAX_IMAGE_BYTES);
    if (!lecture.ok) {
      if (lecture.reason === 'TOO_LARGE') {
        throw imageRejection(
          'FILE_TOO_LARGE',
          `Le fichier dépasse ${MAX_IMAGE_BYTES / 1024 / 1024} Mio.`,
        );
      }
      throw new BadRequestException({ code: 'UPLOAD_ABORTED', message: 'Envoi interrompu.' });
    }
    const verdict = validateAndSanitizeImage(lecture.body);
    if (!verdict.ok) throw imageRejection(verdict.code, verdict.message);
    try {
      await this.branding.uploadLogo(orgId, variant, verdict, actorOf(user, role));
    } catch (cause) {
      throw storageFailure(cause);
    }
    return this.view(orgId);
  }

  @Delete('logos/:variant')
  @RequirePermission('organization.manage')
  async removeLogo(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('variant') rawVariant: string,
  ): Promise<BrandView & { removed: boolean }> {
    const removed = await this.branding.removeLogo(
      orgId,
      variantOf(rawVariant),
      actorOf(user, role),
    );
    return { ...(await this.view(orgId)), removed };
  }
}
