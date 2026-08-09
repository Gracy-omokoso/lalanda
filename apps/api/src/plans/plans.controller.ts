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
  ConflictException,
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
import { AuditService } from '../authz/audit.service.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { AuthzService } from '../authz/authz.service.js';
import { CurrentOrgRole } from '../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { sodDecision, type OrgRole } from '../authz/permissions.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { toEvaluationView, type EvaluationView } from '../evaluate/evaluation-view.js';
import { getTemplate } from '../evaluate/template-registry.js';
import { getParameterPack } from '../parameter-packs/parameter-pack-registry.js';
import { ProjectsService } from '../projects/projects.service.js';
import { findDriverRangeViolations } from './driver-range.js';
import { computePlanFingerprint } from './fingerprint.js';
import type { FinancialPlanDocument } from './plan.schema.js';
import { PlansService } from './plans.service.js';

/**
 * Conditions de séparation des tâches au moment du gel (R2, ADR-0012 §6).
 *
 * Exposé dans la vue API, et pas seulement stocké : ADR-0012 qualifie
 * l'auto-approbation d'« information de bancabilité, pas un détail technique ».
 * Un lecteur du plan — l'entrepreneur, son mentor, un banquier — doit pouvoir
 * constater qu'une version a été validée par la personne qui l'a saisie.
 */
export interface PlanApprovalView {
  /** L'approbateur était le dernier auteur des hypothèses, faute d'autre habilité. */
  soleApprover: boolean;
  /** Dernier auteur des hypothèses figées, `null` si jamais modifiées depuis la création. */
  inputsAuthor: string | null;
}

/** Vue légère — liste des versions. */
export interface PlanSummaryView {
  id: string;
  projectId: string;
  version: number;
  status: 'approved' | 'superseded';
  fingerprint: string;
  approvedAt: string;
  approvedBy: string;
  approval: PlanApprovalView;
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
@UseGuards(AuthGuard, PermissionsGuard)
export class PlansController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(PlansService) private readonly plans: PlansService,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Post(':id/plans')
  @RequirePermission('plan.approve')
  async approve(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole,
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

    // Bornes du DSL : la saisie hors bornes est tolérée en brouillon (docs/06 — les
    // erreurs bloquantes empêchent la validation, pas la sauvegarde), mais figer un
    // plan officiel avec de telles valeurs ne l'est pas. Contrôle AVANT tout gel.
    const violations = findDriverRangeViolations(template, project.driverValues);
    if (violations.length > 0) {
      throw new BadRequestException({
        code: 'DRIVERS_OUT_OF_RANGE',
        message: `${violations.length} hypothèse(s) hors des bornes du modèle : le plan ne peut pas être validé.`,
        details: { drivers: violations },
      });
    }

    // On valide les drivers PERSISTÉS du projet — pas de surcharge one-shot :
    // ce qui est figé est exactement ce qui est enregistré et visible dans l'UI.
    let evaluation;
    try {
      evaluation = evaluateTemplate(template, project.driverValues, { parameterPack: pack });
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

    // ── R2 — séparation validation / saisie (ADR-0012 §6) ──────────────────────
    //
    // Le volet STATIQUE est déjà appliqué par `@RequirePermission('plan.approve')`.
    // Ici, le volet DYNAMIQUE : l'approbateur ne peut pas être le dernier auteur
    // des hypothèses qu'il fige.
    //
    // L'échappatoire `soleApprover` est ce qui rend le produit utilisable pour une
    // organisation d'une seule personne — l'entrepreneur seul, cas majoritaire en
    // RDC. Sans elle, un compte solo ne pourrait JAMAIS valider son plan, puisqu'il
    // est nécessairement l'auteur de ses propres hypothèses. L'auto-approbation est
    // donc autorisée, mais MARQUÉE dans le snapshot : un plan validé sans
    // séparation des tâches le dit, c'est une information de bancabilité.
    const decision = sodDecision({
      approverUserId: user.id,
      lastInputAuthorUserId: project.driversUpdatedBy ?? null,
      approverCountInOrg: await this.authz.countApprovers(orgId),
    });
    if (decision === 'self_forbidden') {
      throw new ConflictException({
        code: 'SELF_APPROVAL_FORBIDDEN',
        message:
          'Vous avez saisi les dernières hypothèses de ce plan : sa validation revient à ' +
          'une autre personne habilitée. (Séparation des tâches, docs/12.)',
      });
    }

    const doc = await this.plans.approve({
      organizationId: orgId,
      projectId: String(project._id),
      approvedBy: user.id,
      approval: {
        soleApprover: decision === 'sole_approver',
        inputsAuthor: project.driversUpdatedBy ?? null,
      },
      driverValues: resolvedDrivers,
      templateSlug: template.slug,
      templateVersion: template.version,
      parameterPackSlug: pack?.slug,
      packVersion: pack ? String(pack.annee) : undefined,
      engineVersion: ENGINE_VERSION,
      result: toEvaluationView(evaluation),
      fingerprint,
    });

    // R2 exige que l'auto-approbation soit marquée « dans le snapshot ET dans
    // l'audit » (ADR-0012 §6). Le snapshot dit les conditions d'UNE version;
    // le journal donne la vue transversale — « combien de plans cette
    // organisation a-t-elle validés sans séparation des tâches ? » — qu'aucune
    // lecture de plan isolée ne fournit.
    //
    // `record()` et non `recordStrict()` : contrairement à l'export (R4), le
    // plan est DÉJÀ figé et immuable quand on arrive ici. Faire échouer la
    // requête sur une panne de journal renverrait 500 pour une version pourtant
    // créée — l'appelant croirait à un échec et rejouerait, pour ne récolter
    // qu'un 409 PLAN_UNCHANGED. Le refus d'écrire n'annule rien : il ment.
    await this.audit.record({
      organizationId: orgId,
      actorUserId: user.id,
      actorRole: role,
      action: 'plan.approve',
      targetType: 'plan',
      targetId: String(doc._id),
      metadata: {
        projectId: String(project._id),
        version: doc.version,
        soleApprover: decision === 'sole_approver',
        inputsAuthor: project.driversUpdatedBy ?? null,
      },
    });

    return toDetailView(doc);
  }

  @Get(':id/plans')
  @RequirePermission('project.read')
  async list(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
  ): Promise<{ plans: PlanSummaryView[] }> {
    const project = await this.projects.findScoped(id, orgId);
    const docs = await this.plans.listByProject(orgId, String(project._id));
    return { plans: docs.map(toSummaryView) };
  }

  @Get(':id/plans/:version')
  @RequirePermission('project.read')
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
    // Défauts défensifs : les plans figés AVANT S20a n'ont pas de bloc `approval`.
    // Les présenter comme « séparés » serait un mensonge sur des données qu'on
    // n'a pas — mais `false` est ici la lecture honnête : rien ne prouve qu'ils
    // aient été auto-approuvés, et la règle R2 n'existait pas encore.
    approval: {
      soleApprover: doc.approval?.soleApprover === true,
      inputsAuthor: doc.approval?.inputsAuthor ?? null,
    },
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
