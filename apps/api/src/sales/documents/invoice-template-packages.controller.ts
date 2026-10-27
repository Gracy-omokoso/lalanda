// Modèles de facture sur mesure — ADR-0029 § 8.
//
//   GET  /sales/invoice-template-packages                       (`sales.read`)           paquets installés, versions, plafonds
//   POST /sales/invoice-template-packages                       (`organization.manage`)  installe une archive ZIP (corps BINAIRE brut)
//   GET  /sales/invoice-template-packages/:packageId/preview    (`sales.read`)           aperçu, facture FICTIVE EXEMPLE
//   PUT  /sales/invoice-template/custom                         (`organization.manage`)  active un paquet installé
//
// Un paquet est du contenu NON FIABLE : il est validé entièrement avant toute
// écriture (`validateArchive`) ; refusé, il ne laisse aucune trace et le
// rapport de validation est rendu (`422 TEMPLATE_PACKAGE_INVALID`).

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { readRequestBody } from '../../account/request-body.js';
import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { PreviewQuerySchema, PutCustomTemplateSchema } from '../../branding/branding.dto.js';
import { BrandingService } from '../../branding/branding.service.js';
import {
  TemplatePackagesService,
  type TemplatePackageLean,
} from '../../branding/template-packages.service.js';
import { issuesOf } from '../../fiscal/fiscal.dto.js';
import { UserThrottlerGuard } from '../../security/user-throttler.guard.js';
import { ObjectStorageUnavailableError } from '../../storage/object-storage.service.js';
import { InvoiceDocumentsService } from './invoice-documents.service.js';
import { PACKAGE_LIMITS } from './templates/custom/package-files.js';
import type { ValidationReport } from './templates/custom/validate-package.js';
import { FONTS, isBodyFont, type FontId } from './templates/invoice-fonts.js';
import { CUSTOM_TEMPLATE_KEY, type TemplateFontChoice } from './templates/template.contract.js';

export interface TemplatePackageView {
  packageId: string;
  templateId: string;
  version: string;
  name: string;
  description: string;
  contentSha256: string;
  byteSize: number;
  author: { name: string; email?: string | null; url?: string | null };
  publisher: { id: string; name: string; url?: string | null } | null;
  license: string;
  options: {
    palettes: string[];
    accent: string;
    fonts: { id: string; label: string }[];
    font: string;
  };
  installedAt: string;
  /** Paquet actuellement choisi par l'organisation. */
  active: boolean;
}

export interface TemplatePackagesView {
  packages: TemplatePackageView[];
  /** Options saisies du paquet actif (`null` = suivre l'identité, puis le manifeste). */
  current: {
    packageId: string;
    options: { palette: string | null; accent: string | null; font: string | null };
  } | null;
  revision: number;
  limits: { maxArchiveBytes: number; storageAvailable: boolean };
}

function fontLabel(choice: string): string {
  if (isBodyFont(choice)) return FONTS[choice].label;
  return choice
    .split('+')
    .map((id) => FONTS[id as FontId]?.label ?? id)
    .join(' + ');
}

function viewOf(p: TemplatePackageLean, activeId: string | null): TemplatePackageView {
  const m = p.manifest;
  return {
    packageId: p.packageId,
    templateId: p.templateId,
    version: p.version,
    name: p.name,
    description: m.description,
    contentSha256: p.contentSha256,
    byteSize: p.byteSize,
    author: m.author,
    publisher: m.publisher,
    license: m.license,
    options: {
      palettes: [...m.options.palettes],
      accent: m.options.accent.toLowerCase(),
      fonts: m.options.fonts.map((id) => ({ id, label: fontLabel(id) })),
      font: m.options.font,
    },
    installedAt: new Date(p.createdAt).toISOString(),
    active: p.packageId === activeId,
  };
}

function invalid(error: Parameters<typeof issuesOf>[0]): never {
  throw new BadRequestException({
    code: 'INVALID_REQUEST',
    message: 'Requête invalide.',
    details: { issues: issuesOf(error) },
  });
}

/** Types annoncés acceptés ; le contenu fait foi (archive analysée). */
const ACCEPTED_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
  'multipart/x-zip',
]);

@Controller('sales')
@UseGuards(AuthGuard, PermissionsGuard)
export class InvoiceTemplatePackagesController {
  constructor(
    @Inject(BrandingService) private readonly branding: BrandingService,
    @Inject(TemplatePackagesService) private readonly packages: TemplatePackagesService,
    @Inject(InvoiceDocumentsService) private readonly documents: InvoiceDocumentsService,
  ) {}

  private async view(orgId: string): Promise<TemplatePackagesView> {
    const state = await this.branding.state(orgId);
    const chosen = state.invoiceTemplate;
    const activeId =
      chosen?.id === CUSTOM_TEMPLATE_KEY && chosen.packageId ? chosen.packageId : null;
    return {
      packages: (await this.packages.list(orgId)).map((p) => viewOf(p, activeId)),
      current:
        activeId && chosen
          ? {
              packageId: activeId,
              options: {
                palette: chosen.options.palette ?? null,
                accent: chosen.options.accent ?? null,
                font: chosen.options.font ?? null,
              },
            }
          : null,
      revision: state.revision,
      limits: {
        maxArchiveBytes: PACKAGE_LIMITS.maxArchiveBytes,
        storageAvailable: this.packages.storageAvailable(),
      },
    };
  }

  @Get('invoice-template-packages')
  @RequirePermission('sales.read')
  async list(@CurrentOrgId() orgId: string): Promise<TemplatePackagesView> {
    return this.view(orgId);
  }

  /** Vingt installations par heure et par utilisateur (validation complète à chaque fois). */
  @Post('invoice-template-packages')
  @RequirePermission('organization.manage')
  @Throttle({ default: { ttl: 3_600_000, limit: 20 } })
  @UseGuards(UserThrottlerGuard)
  async install(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<
    TemplatePackagesView & {
      installed: TemplatePackageView;
      created: boolean;
      report: ValidationReport;
    }
  > {
    const annonce = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (annonce && !ACCEPTED_TYPES.has(annonce)) {
      throw new UnsupportedMediaTypeException({
        code: 'UNSUPPORTED_PACKAGE_TYPE',
        message: `Type « ${annonce} » non accepté : envoyez l’archive .zip du modèle.`,
      });
    }
    const lecture = await readRequestBody(req, PACKAGE_LIMITS.maxArchiveBytes);
    if (!lecture.ok) {
      if (lecture.reason === 'TOO_LARGE') {
        throw new HttpException(
          {
            code: 'PACKAGE_TOO_LARGE',
            message: `L’archive dépasse ${PACKAGE_LIMITS.maxArchiveBytes / 1024 / 1024} Mio.`,
          },
          413,
        );
      }
      throw new BadRequestException({ code: 'UPLOAD_ABORTED', message: 'Envoi interrompu.' });
    }
    let out;
    try {
      out = await this.packages.install(orgId, lecture.body, {
        userId: user.id,
        role: role ?? 'unknown',
      });
    } catch (cause) {
      if (cause instanceof ObjectStorageUnavailableError) {
        throw new ServiceUnavailableException({
          code: 'STORAGE_UNAVAILABLE',
          message: cause.reason,
        });
      }
      throw cause;
    }
    res.status(out.created ? 201 : 200);
    const view = await this.view(orgId);
    return {
      ...view,
      installed: view.packages.find((p) => p.packageId === out.pkg.packageId)!,
      created: out.created,
      report: out.report,
    };
  }

  /** Aperçu RÉEL (Chromium, portillon partagé) : borné à 120 par heure et par utilisateur. */
  @Get('invoice-template-packages/:packageId/preview')
  @RequirePermission('sales.read')
  @Throttle({ default: { ttl: 3_600_000, limit: 120 } })
  @UseGuards(UserThrottlerGuard)
  async preview(
    @CurrentOrgId() orgId: string,
    @Param('packageId') packageId: string,
    @Query() query: unknown,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const parsed = PreviewQuerySchema.safeParse(query);
    if (!parsed.success) invalid(parsed.error);
    const { palette, accent, font, format } = parsed.data;
    const out = await this.documents.previewPackage(
      orgId,
      packageId,
      {
        ...(palette ? { palette } : {}),
        ...(accent ? { accent } : {}),
        ...(font ? { font: font as TemplateFontChoice } : {}),
      },
      format ?? 'pdf',
    );
    res.setHeader('content-type', out.contentType);
    res.setHeader('content-disposition', `inline; filename="${out.fileName}"`);
    res.setHeader('content-length', String(out.body.byteLength));
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.end(out.body);
  }

  @Put('invoice-template/custom')
  @RequirePermission('organization.manage')
  async activate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<TemplatePackagesView> {
    const parsed = PutCustomTemplateSchema.safeParse(body);
    if (!parsed.success) invalid(parsed.error);
    await this.branding.putCustomTemplate(orgId, parsed.data, {
      userId: user.id,
      role: role ?? 'unknown',
    });
    return this.view(orgId);
  }
}
