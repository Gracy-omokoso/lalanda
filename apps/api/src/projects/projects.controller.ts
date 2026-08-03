import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { EngineError, evaluateTemplate } from '@lalanda/engine';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { getTemplate } from '../evaluate/template-registry.js';
import type { ProjectDocument } from './project.schema.js';
import { CreateProjectSchema, EvaluateProjectSchema, UpdateDriversSchema } from './projects.dto.js';
import { ProjectsService } from './projects.service.js';

interface ProjectView {
  id: string;
  organizationId: string;
  createdBy: string;
  name: string;
  templateSlug: string;
  driverValues: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

@Controller('projects')
@UseGuards(AuthGuard)
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Get()
  async list(@CurrentOrgId() orgId: string): Promise<{ projects: ProjectView[] }> {
    const docs = await this.projects.listByOrg(orgId);
    return { projects: docs.map(toView) };
  }

  @Post()
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @Body() body: unknown,
  ): Promise<ProjectView> {
    const parsed = CreateProjectSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    // Validation : le template doit exister dans le registre.
    if (!getTemplate(parsed.data.templateSlug)) {
      throw new NotFoundException({
        code: 'TEMPLATE_NOT_FOUND',
        message: `Template inconnu : ${parsed.data.templateSlug}`,
      });
    }
    const doc = await this.projects.create({
      organizationId: orgId,
      createdBy: user.id,
      name: parsed.data.name,
      templateSlug: parsed.data.templateSlug,
      driverValues: parsed.data.driverValues,
    });
    return toView(doc);
  }

  @Get(':id')
  async findOne(@CurrentOrgId() orgId: string, @Param('id') id: string): Promise<ProjectView> {
    const doc = await this.projects.findScoped(id, orgId);
    return toView(doc);
  }

  @Post(':id/drivers')
  async updateDrivers(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ProjectView> {
    const parsed = UpdateDriversSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    const doc = await this.projects.updateDrivers(id, orgId, parsed.data.driverValues);
    return toView(doc);
  }

  @Post(':id/evaluate')
  async evaluate(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ project: ProjectView; lines: EvaluatedLine[] }> {
    const parsed = EvaluateProjectSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    let project = await this.projects.findScoped(id, orgId);

    const drivers = parsed.data.driverValues ?? project.driverValues;
    if (parsed.data.persist && parsed.data.driverValues) {
      project = await this.projects.updateDrivers(id, orgId, parsed.data.driverValues);
    }

    const template = getTemplate(project.templateSlug);
    if (!template) {
      throw new NotFoundException({
        code: 'TEMPLATE_NOT_FOUND',
        message: `Template introuvable pour le projet : ${project.templateSlug}`,
      });
    }

    try {
      const result = evaluateTemplate(template, drivers);
      return {
        project: toView(project),
        lines: result.lines.map((l) => ({
          sheetId: l.sheetId,
          lineId: l.lineId,
          label: l.label,
          formulaSource: l.formulaSource,
          value: l.value,
          format: l.format,
        })),
      };
    } catch (err) {
      if (err instanceof EngineError) {
        throw new BadRequestException({
          code: err.code,
          message: err.message,
          details: err.details,
        });
      }
      throw err;
    }
  }
}

interface EvaluatedLine {
  sheetId: string;
  lineId: string;
  label: string;
  formulaSource: string;
  value: number;
  format: 'money' | 'number' | 'percent';
}

function toView(doc: ProjectDocument): ProjectView {
  return {
    id: String(doc._id),
    organizationId: doc.organizationId,
    createdBy: doc.createdBy,
    name: doc.name,
    templateSlug: doc.templateSlug,
    driverValues: doc.driverValues,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
