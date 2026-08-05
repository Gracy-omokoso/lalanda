// Route de génération PDF d'un rapport de projet (S8-lite).
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
import { ProjectsService } from '../projects/projects.service.js';
import { ReportsService } from './reports.service.js';

function pdfFilename(name: string): string {
  const safe = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return `${safe || 'plan-financier'}.pdf`;
}

@Controller('projects')
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(OrganizationsService) private readonly organizations: OrganizationsService,
    @Inject(ReportsService) private readonly reports: ReportsService,
  ) {}

  @Get(':id/report/pdf')
  @Header('content-type', 'application/pdf')
  async downloadPdf(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const project = await this.projects.findScoped(id, orgId);
    const template = getTemplate(project.templateSlug);
    if (!template) {
      throw new NotFoundException({
        code: 'TEMPLATE_NOT_FOUND',
        message: `Template introuvable pour le projet : ${project.templateSlug}`,
      });
    }
    const org = await this.organizations.findOrgById(orgId);

    const evaluation = evaluateTemplate(template, project.driverValues);
    const pdf = await this.reports.renderPdf({
      organization: { name: org.name, pays: org.pays },
      project: {
        name: project.name,
        templateSlug: project.templateSlug,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      },
      template,
      driverValues: Object.fromEntries(evaluation.drivers),
      lines: evaluation.lines.map((l) => ({
        sheetId: l.sheetId,
        lineId: l.lineId,
        label: l.label,
        value: l.value,
        format: l.format,
      })),
      generatedAt: new Date().toISOString(),
      currency: template.devise_base ?? 'USD',
    });

    res.setHeader('content-disposition', `attachment; filename="${pdfFilename(project.name)}"`);
    res.setHeader('content-length', String(pdf.byteLength));
    res.end(pdf);
  }
}
