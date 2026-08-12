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
import { forbidden } from '../authz/authz.service.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { CurrentOrgRole } from '../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { can, type OrgRole } from '../authz/permissions.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { BillingService } from '../billing/billing.service.js';
import { projectLimitExceededPayload, projectLimitStatus } from '../billing/project-limit.js';
import {
  toEvaluationView,
  type AmortissementsView,
  type EtatsFinanciersView,
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
@UseGuards(AuthGuard, PermissionsGuard)
export class ProjectsController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  @Get()
  @RequirePermission('project.read')
  async list(@CurrentOrgId() orgId: string): Promise<{ projects: ProjectView[] }> {
    const docs = await this.projects.listByOrg(orgId);
    return { projects: docs.map(toView) };
  }

  @Post()
  @RequirePermission('project.create')
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
    //
    // Le refus est construit par `billing/project-limit.ts` et non écrit ici,
    // parce qu'il doit distinguer deux situations que le code appelant n'a aucune
    // raison de connaître : être PILE à la limite (l'utilisateur a consommé ce
    // qu'il a acheté) et être AU-DESSUS (la grille a changé sous ses pieds — une
    // organisation détient 5 projets sur une offre qui en autorise 1). Le second
    // cas n'est pas la faute de l'utilisateur, et le message doit le dire.
    //
    // C'est le SEUL endroit du dépôt qui bloque sur `maxProjects` : lire,
    // modifier et exporter un projet existant ne consulte jamais cette limite.
    // Un dépassement suspend les créations, il ne ferme rien.
    const { plan, entitlements } = await this.billing.getPlanEntitlements(orgId);
    if (entitlements.maxProjects !== null) {
      const count = await this.projects.countByOrg(orgId);
      const status = projectLimitStatus(plan, entitlements, count);
      if (status.blocked) {
        throw new ForbiddenException(projectLimitExceededPayload(status));
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
  @RequirePermission('project.read')
  async findOne(@CurrentOrgId() orgId: string, @Param('id') id: string): Promise<ProjectView> {
    const doc = await this.projects.findScoped(id, orgId);
    return toView(doc);
  }

  @Post(':id/drivers')
  @RequirePermission('inputs.update')
  async updateDrivers(
    @CurrentUser() user: { id: string },
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ProjectView> {
    const parsed = UpdateDriversSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    const doc = await this.projects.updateDrivers(id, orgId, parsed.data.driverValues, user.id);
    return toView(doc);
  }

  /**
   * Évaluation à la volée. Deux comportements sous une seule route :
   * un calcul sans effet (`plan.calculate`), et — quand `persist` est vrai — une
   * ÉCRITURE des hypothèses, qui relève d'`inputs.update`.
   *
   * Pourquoi le second contrôle est dans le corps et pas dans le décorateur :
   * `@RequirePermission` est conjonctif, donc exiger les deux au niveau de la
   * route refuserait le calcul NON persistant à tout rôle dépourvu
   * d'`inputs.update`, ce qui casserait l'exploration de scénarios. Scinder en
   * deux routes serait plus propre mais changerait le contrat public de l'API —
   * hors périmètre de S20a.
   */
  @Post(':id/evaluate')
  @RequirePermission('plan.calculate')
  async evaluate(
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole,
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{
    project: ProjectView;
    lines: EvaluatedLineView[];
    amortissements?: AmortissementsView;
    etatsFinanciers?: EtatsFinanciersView;
  }> {
    const parsed = EvaluateProjectSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    let project = await this.projects.findScoped(id, orgId);

    const drivers = parsed.data.driverValues ?? project.driverValues;
    if (parsed.data.persist && parsed.data.driverValues) {
      // Écriture déguisée en calcul : elle exige `inputs.update`, que
      // `plan.calculate` n'implique pas (un `analyst` calcule, un `accountant`
      // ne calcule pas). Décision prise par la matrice, jamais par un test de rôle.
      if (!can(role, 'inputs.update')) {
        throw new ForbiddenException(forbidden('inputs.update', role));
      }
      project = await this.projects.updateDrivers(id, orgId, parsed.data.driverValues, user.id);
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
        // (S18a) Absent si le template ne déclare pas `structure_financiere`.
        etatsFinanciers: view.etatsFinanciers,
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
