import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
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
import { BillingService } from '../billing/billing.service.js';
import {
  toEvaluationView,
  type AmortissementsView,
  type EvaluatedLineView,
} from '../evaluate/evaluation-view.js';
import { getTemplate } from '../evaluate/template-registry.js';
import {
  findDefaultPackForCountry,
  getParameterPack,
} from '../parameter-packs/parameter-pack-registry.js';
import type { ProjectDocument } from './project.schema.js';
import { CreateProjectSchema, EvaluateProjectSchema, UpdateDriversSchema } from './projects.dto.js';
import { ProjectsService } from './projects.service.js';

interface ProjectView {
  id: string;
  organizationId: string;
  createdBy: string;
  name: string;
  templateSlug: string;
  pays: string;
  parameterPackSlug: string;
  systemeComptable: string;
  deviseAffichage: string;
  driverValues: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

@Controller('projects')
@UseGuards(AuthGuard)
export class ProjectsController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

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

    // Entitlements (S16b) : l'API impose la limite de projets du plan (docs/13).
    // NB : check-then-create sans transaction — une course peut dépasser d'un projet,
    // acceptable pour un quota commercial (pas une invariante de sécurité).
    const { plan, entitlements } = await this.billing.getPlanEntitlements(orgId);
    if (entitlements.maxProjects !== null) {
      const count = await this.projects.countByOrg(orgId);
      if (count >= entitlements.maxProjects) {
        throw new ForbiddenException({
          code: 'PLAN_LIMIT_PROJECTS',
          limit: entitlements.maxProjects,
          plan,
          message: `Limite de ${entitlements.maxProjects} projet(s) atteinte pour le plan ${plan}.`,
        });
      }
    }

    // Validation : le template doit exister dans le registre.
    if (!getTemplate(parsed.data.templateSlug)) {
      throw new NotFoundException({
        code: 'TEMPLATE_NOT_FOUND',
        message: `Template inconnu : ${parsed.data.templateSlug}`,
      });
    }

    // Résolution du ParameterPack :
    // - si `parameterPackSlug` fourni → on l'utilise
    // - sinon on cherche le meilleur pack pour le `pays` fourni
    // - fallback ultime : cd-2026 (pour ne pas casser l'existant)
    const pays = parsed.data.pays ?? 'CD';
    let pack = parsed.data.parameterPackSlug
      ? getParameterPack(parsed.data.parameterPackSlug)
      : findDefaultPackForCountry(pays);
    if (!pack) {
      throw new BadRequestException({
        code: 'PARAMETER_PACK_NOT_FOUND',
        message: `Aucun ParameterPack disponible pour pays "${pays}" ni slug fourni.`,
      });
    }
    // Sanity : si l'utilisateur a explicitement fourni pays + pack, on vérifie la cohérence.
    if (
      parsed.data.pays &&
      parsed.data.parameterPackSlug &&
      pack.pays !== parsed.data.pays &&
      !pack.pays_couverts?.includes(parsed.data.pays)
    ) {
      throw new BadRequestException({
        code: 'PACK_COUNTRY_MISMATCH',
        message: `Le pack "${pack.slug}" ne couvre pas le pays "${parsed.data.pays}".`,
      });
    }

    const doc = await this.projects.create({
      organizationId: orgId,
      createdBy: user.id,
      name: parsed.data.name,
      templateSlug: parsed.data.templateSlug,
      pays,
      parameterPackSlug: pack.slug,
      systemeComptable: pack.systeme_comptable,
      deviseAffichage: parsed.data.deviseAffichage ?? pack.devise_principale,
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
  ): Promise<{
    project: ProjectView;
    lines: EvaluatedLineView[];
    amortissements?: AmortissementsView;
  }> {
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

    // Pack : optionnel — un projet créé avant S9 n'en a pas (fallback silencieux).
    const pack = project.parameterPackSlug
      ? getParameterPack(project.parameterPackSlug)
      : undefined;

    try {
      const result = evaluateTemplate(template, drivers, { parameterPack: pack });
      // (S16c) Mapping factorisé dans evaluation-view.ts — même forme que le
      // snapshot figé d'un plan validé (module plans/).
      const view = toEvaluationView(result);
      return {
        project: toView(project),
        lines: view.lines,
        // (S14c) Absent si le template ne déclare pas d'immobilisations.
        amortissements: view.amortissements,
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

function toView(doc: ProjectDocument): ProjectView {
  return {
    id: String(doc._id),
    organizationId: doc.organizationId,
    createdBy: doc.createdBy,
    name: doc.name,
    templateSlug: doc.templateSlug,
    // Fallbacks pour projets créés avant S9 (avant migration schéma).
    pays: doc.pays ?? 'CD',
    parameterPackSlug: doc.parameterPackSlug ?? 'cd-2026',
    systemeComptable: doc.systemeComptable ?? 'syscohada-revise-2017',
    deviseAffichage: doc.deviseAffichage ?? 'USD',
    driverValues: doc.driverValues,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
