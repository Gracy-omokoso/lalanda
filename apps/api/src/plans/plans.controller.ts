// Endpoints du plan financier validé, figé et versionné (S16c — FIN-003).
//
//   POST /projects/:id/plans          → évalue le projet et fige vN+1 (vN → superseded)
//   GET  /projects/:id/plans          → liste légère des versions
//   GET  /projects/:id/plans/:version → détail complet (snapshot figé)
//
// Isolation : toutes les routes passent par `projects.findScoped(id, orgId)` — un
// projet d'une autre org renvoie 404 (jamais 403, pour ne pas révéler l'existence).

import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ENGINE_VERSION, EngineError, evaluateTemplate } from '@lalanda/engine';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { toEvaluationView, type EvaluationView } from '../evaluate/evaluation-view.js';
import { getTemplate } from '../evaluate/template-registry.js';
import { getParameterPack } from '../parameter-packs/parameter-pack-registry.js';
import { ProjectsService } from '../projects/projects.service.js';
import { computePlanFingerprint } from './fingerprint.js';
import type { FinancialPlanDocument } from './plan.schema.js';
import { PlansService } from './plans.service.js';

/** Vue légère — liste des versions. */
export interface PlanSummaryView {
  id: string;
  projectId: string;
  version: number;
  status: 'approved' | 'superseded';
  fingerprint: string;
  approvedAt: string;
  approvedBy: string;
  createdAt: string;
}

/** Vue complète — snapshot figé. */
export interface PlanDetailView extends PlanSummaryView {
  driverValues: Record<string, number>;
  templateSlug: string;
  templateVersion: string;
  parameterPackSlug?: string;
  packVersion?: string;
  engineVersion: string;
  result: EvaluationView;
}

@Controller('projects')
@UseGuards(AuthGuard)
export class PlansController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(PlansService) private readonly plans: PlansService,
  ) {}

  @Post(':id/plans')
  async approve(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ): Promise<PlanDetailView> {
    const project = await this.projects.findScoped(id, orgId);

    const template = getTemplate(project.templateSlug);
    if (!template) {
      throw new NotFoundException({
        code: 'TEMPLATE_NOT_FOUND',
        message: `Template introuvable pour le projet : ${project.templateSlug}`,
      });
    }
    const pack = project.parameterPackSlug
      ? getParameterPack(project.parameterPackSlug)
      : undefined;

    // On valide les drivers PERSISTÉS du projet — pas de surcharge one-shot :
    // ce qui est figé est exactement ce qui est enregistré et visible dans l'UI.
    let evaluation;
    try {
      evaluation = evaluateTemplate(template, project.driverValues, { parameterPack: pack });
    } catch (err) {
      if (err instanceof EngineError) {
        throw new BadRequestException({ code: err.code, message: err.message, details: err.details });
      }
      throw err;
    }

    // Drivers résolus (user > pack > défaut template) : c'est l'entrée réelle du moteur.
    const resolvedDrivers = Object.fromEntries(evaluation.drivers);
    const fingerprint = computePlanFingerprint({
      driverValues: resolvedDrivers,
      templateSlug: template.slug,
      templateVersion: template.version,
      parameterPackSlug: pack?.slug,
      packVersion: pack ? String(pack.annee) : undefined,
      engineVersion: ENGINE_VERSION,
    });

    const doc = await this.plans.approve({
      organizationId: orgId,
      projectId: String(project._id),
      approvedBy: user.id,
      driverValues: resolvedDrivers,
      templateSlug: template.slug,
      templateVersion: template.version,
      parameterPackSlug: pack?.slug,
      packVersion: pack ? String(pack.annee) : undefined,
      engineVersion: ENGINE_VERSION,
      result: toEvaluationView(evaluation),
      fingerprint,
    });
    return toDetailView(doc);
  }

  @Get(':id/plans')
  async list(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
  ): Promise<{ plans: PlanSummaryView[] }> {
    const project = await this.projects.findScoped(id, orgId);
    const docs = await this.plans.listByProject(orgId, String(project._id));
    return { plans: docs.map(toSummaryView) };
  }

  @Get(':id/plans/:version')
  async detail(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Param('version') versionRaw: string,
  ): Promise<PlanDetailView> {
    const project = await this.projects.findScoped(id, orgId);
    const version = Number(versionRaw);
    const doc = await this.plans.findVersion(orgId, String(project._id), version);
    return toDetailView(doc);
  }
}

function toSummaryView(doc: FinancialPlanDocument): PlanSummaryView {
  return {
    id: String(doc._id),
    projectId: doc.projectId,
    version: doc.version,
    status: doc.status,
    fingerprint: doc.fingerprint,
    approvedAt: doc.approvedAt.toISOString(),
    approvedBy: doc.approvedBy,
    createdAt: doc.createdAt.toISOString(),
  };
}

function toDetailView(doc: FinancialPlanDocument): PlanDetailView {
  return {
    ...toSummaryView(doc),
    driverValues: doc.driverValues,
    templateSlug: doc.templateSlug,
    templateVersion: doc.templateVersion,
    parameterPackSlug: doc.parameterPackSlug,
    packVersion: doc.packVersion,
    engineVersion: doc.engineVersion,
    result: doc.result,
  };
}
