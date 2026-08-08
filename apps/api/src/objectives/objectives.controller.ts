// Endpoints des objectifs financiers (S18d — docs/01 + docs/10 § Objectifs).
//
//   GET /projects/:id/objectives            → cibles courantes (toutes optionnelles)
//   PUT /projects/:id/objectives            → remplacement complet (absent = effacé)
//   GET /projects/:id/objectives/attainment → taux d'atteinte vs DERNIER PLAN VALIDÉ
//                                             (409 NO_APPROVED_PLAN si aucun)
//
// Isolation : toutes les routes passent par `projects.findScoped(id, orgId)` — un
// projet d'une autre org renvoie 404 (même convention que plans/ et canvas/).

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { CurrentOrgId } from '../auth/current-user.decorator.js';
import { PlansService } from '../plans/plans.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import {
  computeAttainment,
  PARTIAL_THRESHOLD_PCT,
  type ObjectiveAttainment,
} from './attainment.js';
import { OBJECTIVE_KEYS, PutObjectivesSchema, type ObjectiveKey } from './objectives.dto.js';
import type { FinancialObjectivesDocument } from './objectives.schema.js';
import { ObjectivesService } from './objectives.service.js';

export interface ObjectivesView {
  projectId: string;
  ca_cible_an1?: number;
  ca_cible_an5?: number;
  resultat_net_cible_an1?: number;
  resultat_net_cible_an5?: number;
  tresorerie_cible?: number;
  updatedAt: string | null;
}

export interface AttainmentView {
  /**
   * Base de comparaison. docs/01 prévoit trois bases distinctes (plan validé,
   * réalisé, dernière projection) ; S18d n'implémente que le plan validé —
   * le champ rend la base explicite pour l'UI et pour les bases à venir.
   */
  source: 'plan_valide';
  planVersion: number;
  planApprovedAt: string;
  /** Seuil (%) séparant « partiel » de « non atteint », pour affichage. */
  seuilPartielPct: number;
  objectifs: ObjectiveAttainment[];
}

@Controller('projects')
@UseGuards(AuthGuard, PermissionsGuard)
export class ObjectivesController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(ObjectivesService) private readonly objectives: ObjectivesService,
    @Inject(PlansService) private readonly plans: PlansService,
  ) {}

  @Get(':id/objectives')
  @RequirePermission('project.read')
  async get(@CurrentOrgId() orgId: string, @Param('id') id: string): Promise<ObjectivesView> {
    const project = await this.projects.findScoped(id, orgId);
    const doc = await this.objectives.find(orgId, String(project._id));
    return toView(String(project._id), doc);
  }

  @Put(':id/objectives')
  @RequirePermission('inputs.update')
  async put(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ObjectivesView> {
    // Scope AVANT validation : un appelant d'une autre org doit recevoir 404,
    // même avec un corps malformé (cf. même règle dans canvas.controller.ts).
    const project = await this.projects.findScoped(id, orgId);
    const parsed = PutObjectivesSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    const doc = await this.objectives.replace(orgId, String(project._id), parsed.data);
    return toView(String(project._id), doc);
  }

  @Get(':id/objectives/attainment')
  @RequirePermission('analytics.read')
  async attainment(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
  ): Promise<AttainmentView> {
    const project = await this.projects.findScoped(id, orgId);
    const projectId = String(project._id);

    // Dernier plan validé — la machine d'état plans/ garantit au plus UN
    // plan `approved` par projet (les précédents passent à `superseded`).
    const planDocs = await this.plans.listByProject(orgId, projectId);
    const approved = planDocs.find((p) => p.status === 'approved');
    if (!approved) {
      throw new ConflictException({
        code: 'NO_APPROVED_PLAN',
        message:
          "Aucun plan validé pour ce projet — validez d'abord un plan pour mesurer l'atteinte des objectifs.",
      });
    }

    const doc = await this.objectives.find(orgId, projectId);
    const targets: Partial<Record<ObjectiveKey, number | undefined>> = {};
    if (doc) {
      for (const key of OBJECTIVE_KEYS) targets[key] = doc[key];
    }

    return {
      source: 'plan_valide',
      planVersion: approved.version,
      planApprovedAt: approved.approvedAt.toISOString(),
      seuilPartielPct: PARTIAL_THRESHOLD_PCT,
      objectifs: computeAttainment(targets, approved.result),
    };
  }
}

function toView(projectId: string, doc: FinancialObjectivesDocument | null): ObjectivesView {
  return {
    projectId,
    ca_cible_an1: doc?.ca_cible_an1,
    ca_cible_an5: doc?.ca_cible_an5,
    resultat_net_cible_an1: doc?.resultat_net_cible_an1,
    resultat_net_cible_an5: doc?.resultat_net_cible_an5,
    tresorerie_cible: doc?.tresorerie_cible,
    updatedAt: doc ? doc.updatedAt.toISOString() : null,
  };
}
