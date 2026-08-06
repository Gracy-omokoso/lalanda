// Routes de génération de rapports de projet.
// - PDF (S8-lite → S13e) : dossier bancable rendu via Puppeteer.
// - XLSX (S14b) : classeur avec une feuille par feuille moteur et formules Excel natives.
//
// La route est côté /projects pour rester cohérente avec le scope (projet appartient à une org).

import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { evaluateTemplate } from '@lalanda/engine';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId } from '../auth/current-user.decorator.js';
import { getTemplate } from '../evaluate/template-registry.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import { getParameterPack } from '../parameter-packs/parameter-pack-registry.js';
import { ProjectsService } from '../projects/projects.service.js';
import { ReportsService } from './reports.service.js';
import type { ReportData } from './report-html.js';

/** Slug de fichier — retire diacritiques/caractères spéciaux, borne à 80 caractères. */
function fileSlug(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9-_ ]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 80) || 'plan-financier'
  );
}

@Controller('projects')
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(OrganizationsService) private readonly organizations: OrganizationsService,
    @Inject(ReportsService) private readonly reports: ReportsService,
  ) {}

  /**
   * Prépare le `ReportData` partagé par PDF et Excel : lookup projet + org + pack,
   * évaluation moteur, résolution de la devise d'affichage.
   * Factorise pour garantir que les deux exports partent des mêmes chiffres.
   */
  private async buildReportData(orgId: string, id: string): Promise<ReportData> {
    const project = await this.projects.findScoped(id, orgId);
    const template = getTemplate(project.templateSlug);
    if (!template) {
      throw new NotFoundException({
        code: 'TEMPLATE_NOT_FOUND',
        message: `Template introuvable pour le projet : ${project.templateSlug}`,
      });
    }
    const org = await this.organizations.findOrgById(orgId);
    const pack = project.parameterPackSlug
      ? getParameterPack(project.parameterPackSlug)
      : undefined;

    const evaluation = evaluateTemplate(template, project.driverValues, {
      parameterPack: pack,
    });
    // Devise d'affichage : projet > pack > template > USD.
    const currency =
      (project.deviseAffichage as 'USD' | 'CDF' | 'XOF' | 'XAF' | 'EUR' | undefined) ??
      pack?.devise_principale ??
      template.devise_base ??
      'USD';

    return {
      organization: { name: org.name, pays: org.pays },
      project: {
        name: project.name,
        templateSlug: project.templateSlug,
        pays: project.pays ?? org.pays,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      },
      template,
      parameterPack: pack
        ? {
            slug: pack.slug,
            label: pack.label,
            annee: pack.annee,
            systeme_comptable: pack.systeme_comptable,
            avertissement: pack.avertissement,
          }
        : undefined,
      driverValues: Object.fromEntries(evaluation.drivers),
      lines: evaluation.lines.map((l) => ({
        sheetId: l.sheetId,
        lineId: l.lineId,
        label: l.label,
        value: l.value,
        format: l.format,
        seuil: l.seuil,
      })),
      generatedAt: new Date().toISOString(),
      currency: currency as 'USD' | 'CDF' | 'XOF' | 'XAF' | 'EUR',
    };
  }

  @Get(':id/report/pdf')
  @Header('content-type', 'application/pdf')
  async downloadPdf(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const data = await this.buildReportData(orgId, id);
    const pdf = await this.reports.renderPdf(data);
    res.setHeader(
      'content-disposition',
      `attachment; filename="${fileSlug(data.project.name)}.pdf"`,
    );
    res.setHeader('content-length', String(pdf.byteLength));
    res.end(pdf);
  }

  @Get(':id/report/xlsx')
  @Header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async downloadXlsx(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const data = await this.buildReportData(orgId, id);
    const xlsx = await this.reports.renderXlsx(data);
    res.setHeader(
      'content-disposition',
      `attachment; filename="${fileSlug(data.project.name)}.xlsx"`,
    );
    res.setHeader('content-length', String(xlsx.byteLength));
    res.end(xlsx);
  }
}
