// Modèles de facture — ADR-0028 § 8.
//
//   GET /sales/invoice-templates                       (`sales.read`)           catalogue + choix courant
//   PUT /sales/invoice-template                        (`organization.manage`)  enregistre le choix
//   GET /sales/invoice-templates/:templateId/preview   (`sales.read`)           aperçu PDF, facture FICTIVE
//
// Choisir le modèle est une action d'administration de l'organisation (comme
// son identité visuelle) : le contenu fiscal d'une facture n'en dépend pas. La
// consultation et l'aperçu sont ouverts à qui consulte les ventes.

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { PreviewQuerySchema, PutInvoiceTemplateSchema } from '../../branding/branding.dto.js';
import { BrandingService } from '../../branding/branding.service.js';
import { issuesOf } from '../../fiscal/fiscal.dto.js';
import { UserThrottlerGuard } from '../../security/user-throttler.guard.js';
import { InvoiceDocumentsService } from './invoice-documents.service.js';
import {
  fontAllowed,
  latestTemplate,
  templateCatalog,
  type InvoiceTemplateCatalogEntry,
} from './templates/registry.js';
import {
  isInvoiceTemplateId,
  LOGO_VARIANTS,
  type LogoVariant,
  type TemplateFontChoice,
  type TemplateOptions,
  type TemplateOptionsInput,
} from './templates/template.contract.js';

export interface InvoiceTemplatesView {
  templates: InvoiceTemplateCatalogEntry[];
  /** `null` : aucun modèle choisi — présentation d'origine. */
  current: {
    templateId: string;
    version: string;
    /** Options saisies (`null` = suivre l'identité, puis le défaut du modèle). */
    options: TemplateOptionsInput;
    /** Options qui seront figées au prochain gel. */
    resolved: TemplateOptions;
  } | null;
  identity: {
    primaryColor: string | null;
    secondaryColor: string | null;
    font: string | null;
    logos: Record<LogoVariant, boolean>;
  };
  revision: number;
}

function invalid(error: Parameters<typeof issuesOf>[0]): never {
  throw new BadRequestException({
    code: 'INVALID_REQUEST',
    message: 'Requête invalide.',
    details: { issues: issuesOf(error) },
  });
}

@Controller('sales')
@UseGuards(AuthGuard, PermissionsGuard)
export class InvoiceTemplatesController {
  constructor(
    @Inject(BrandingService) private readonly branding: BrandingService,
    @Inject(InvoiceDocumentsService) private readonly documents: InvoiceDocumentsService,
  ) {}

  private async view(orgId: string): Promise<InvoiceTemplatesView> {
    const state = await this.branding.state(orgId);
    const frozen = await this.branding.presentationToFreeze(orgId);
    const logos = {} as Record<LogoVariant, boolean>;
    for (const v of LOGO_VARIANTS) logos[v] = state.logos[v] !== null;
    const saved = state.invoiceTemplate;
    return {
      templates: templateCatalog(),
      current:
        saved && frozen
          ? {
              templateId: frozen.template.id,
              version: frozen.template.version,
              options: {
                palette: (saved.options.palette ?? null) as TemplateOptionsInput['palette'],
                accent: saved.options.accent ?? null,
                font: (saved.options.font ?? null) as TemplateOptionsInput['font'],
              },
              resolved: frozen.options,
            }
          : null,
      identity: {
        primaryColor: state.primaryColor,
        secondaryColor: state.secondaryColor,
        font: state.font,
        logos,
      },
      revision: state.revision,
    };
  }

  @Get('invoice-templates')
  @RequirePermission('sales.read')
  async list(@CurrentOrgId() orgId: string): Promise<InvoiceTemplatesView> {
    return this.view(orgId);
  }

  @Put('invoice-template')
  @RequirePermission('organization.manage')
  async put(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<InvoiceTemplatesView> {
    const parsed = PutInvoiceTemplateSchema.safeParse(body);
    if (!parsed.success) invalid(parsed.error);
    await this.branding.putInvoiceTemplate(orgId, parsed.data, {
      userId: user.id,
      role: role ?? 'unknown',
    });
    return this.view(orgId);
  }

  /**
   * Aperçu PDF d'un modèle : facture FICTIVE marquée EXEMPLE, aux couleurs de
   * l'organisation. Rendu Chromium réel (portillon partagé) : borné à 120 par
   * heure et par utilisateur.
   */
  @Get('invoice-templates/:templateId/preview')
  @RequirePermission('sales.read')
  @Throttle({ default: { ttl: 3_600_000, limit: 120 } })
  @UseGuards(UserThrottlerGuard)
  async preview(
    @CurrentOrgId() orgId: string,
    @Param('templateId') templateId: string,
    @Query() query: unknown,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    if (!isInvoiceTemplateId(templateId)) {
      throw new BadRequestException({
        code: 'UNKNOWN_INVOICE_TEMPLATE',
        message: 'Modèle de facture inconnu.',
      });
    }
    const parsed = PreviewQuerySchema.safeParse(query);
    if (!parsed.success) invalid(parsed.error);
    const { palette, accent, font } = parsed.data;
    if (font !== undefined && !fontAllowed(latestTemplate(templateId), font)) {
      throw new BadRequestException({
        code: 'FONT_NOT_ALLOWED',
        message: 'Cette police n’est pas proposée par ce modèle.',
      });
    }
    const out = await this.documents.preview(orgId, templateId, {
      ...(palette ? { palette } : {}),
      ...(accent ? { accent } : {}),
      ...(font ? { font: font as TemplateFontChoice } : {}),
    });
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `inline; filename="${out.fileName}"`);
    res.setHeader('content-length', String(out.pdf.byteLength));
    res.setHeader('cache-control', 'no-store');
    res.end(out.pdf);
  }
}
