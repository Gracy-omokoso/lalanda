// Endpoints du suivi prévisionnel vs réalisé (S18b — docs/08).
//
//   PUT  /projects/:id/actual-periods/:year/:month        → upsert du réalisé (409 si clôturée)
//   POST /projects/:id/actual-periods/:year/:month/close  → clôture (open → closed)
//   POST /projects/:id/actual-periods/:year/:month/reopen → réouverture (owner + motif)
//   GET  /projects/:id/actual-periods?year=N              → périodes de l'année
//   GET  /projects/:id/variances?year=N                   → écarts vs dernier plan validé
//   GET  /projects/:id/updated-projection?year=N          → projection actualisée simple
//
// Isolation : toutes les routes passent par `projects.findScoped(id, orgId)` — un
// projet d'une autre org renvoie 404 (même convention que plans.controller.ts).
// Les écarts se calculent contre le DERNIER PLAN VALIDÉ (S16c) ; sans plan validé
// il n'y a pas de référence → 409 { code: 'NO_APPROVED_PLAN' }.

import {
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import type { FinancialPlanDocument } from '../plans/plan.schema.js';
import { PlansService } from '../plans/plans.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import type { ActualPeriodDocument } from './actual-period.schema.js';
import { ActualsService } from './actuals.service.js';
import {
  computeUpdatedProjection,
  computeVariances,
  referenceLines,
  type ProjectionLine,
  type VarianceLine,
} from './variance.js';

/** Vue API d'une période réalisée. */
export interface ActualPeriodView {
  id: string;
  projectId: string;
  year: number;
  month: number;
  status: 'open' | 'closed';
  values: Record<string, number>;
  closedAt: string | null;
  closedBy: string | null;
  reopenedLog: { reopenedAt: string; reopenedBy: string; reason: string }[];
  updatedAt: string;
}

export interface VariancesView {
  year: number;
  /** Version du plan validé servant de référence. */
  planVersion: number;
  /**
   * Mois porteurs d'au moins une valeur (ouverts + clôturés). Le cumul d'une
   * ligne donnée ne couvre que le sous-ensemble de ces mois où ELLE est saisie —
   * une ligne absente d'un mois n'y vaut pas zéro.
   */
  monthsCounted: number[];
  /** Convention MVP documentée : prévu mensuel = plan annuel / 12. */
  convention: 'annuel/12';
  /**
   * Lignes du compte d'exploitation du plan comparé, suivies des lignes saisies
   * au réalisé sans contrepartie dans ce plan (`comparable: false` + `raison`) —
   * ADR-0011 friction n°3 : jamais d'écart de 100 % sur une ligne sans référence.
   */
  lines: VarianceLine[];
}

export interface UpdatedProjectionView {
  year: number;
  planVersion: number;
  monthsClosed: number[];
  convention: 'annuel/12';
  lines: ProjectionLine[];
}

@Controller('projects')
@UseGuards(AuthGuard, PermissionsGuard)
export class ActualsController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(PlansService) private readonly plans: PlansService,
    @Inject(ActualsService) private readonly actuals: ActualsService,
  ) {}

  @Put(':id/actual-periods/:year/:month')
  @RequirePermission('actuals.import')
  async upsert(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Param('year') yearRaw: string,
    @Param('month') monthRaw: string,
    @Body() body: { values?: Record<string, number | null> },
  ): Promise<ActualPeriodView> {
    const project = await this.projects.findScoped(id, orgId);
    // La saisie est bornée par le compte d'exploitation du plan validé courant :
    // pas de référence ⇒ pas de saisie possible (même contrat que /variances).
    const plan = await this.latestApprovedPlan(orgId, String(project._id));
    const allowed = new Set(referenceLines(plan.result.lines).map((l) => l.lineId));
    const doc = await this.actuals.upsertValues(
      {
        organizationId: orgId,
        projectId: String(project._id),
        year: Number(yearRaw),
        month: Number(monthRaw),
      },
      body?.values ?? {},
      allowed,
    );
    return toPeriodView(doc);
  }

  @Post(':id/actual-periods/:year/:month/close')
  @RequirePermission('period.close')
  async close(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('year') yearRaw: string,
    @Param('month') monthRaw: string,
  ): Promise<ActualPeriodView> {
    const project = await this.projects.findScoped(id, orgId);
    const doc = await this.actuals.close(
      {
        organizationId: orgId,
        projectId: String(project._id),
        year: Number(yearRaw),
        month: Number(monthRaw),
      },
      user.id,
    );
    return toPeriodView(doc);
  }

  @Post(':id/actual-periods/:year/:month/reopen')
  @RequirePermission('period.close', 'plan.approve')
  async reopen(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('year') yearRaw: string,
    @Param('month') monthRaw: string,
    @Body() body: { reason?: string },
  ): Promise<ActualPeriodView> {
    const project = await this.projects.findScoped(id, orgId);
    const doc = await this.actuals.reopen(
      {
        organizationId: orgId,
        projectId: String(project._id),
        year: Number(yearRaw),
        month: Number(monthRaw),
      },
      user.id,
      body?.reason,
    );
    return toPeriodView(doc);
  }

  @Get(':id/actual-periods')
  @RequirePermission('project.read')
  async list(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Query('year') yearRaw?: string,
  ): Promise<{ year: number; periods: ActualPeriodView[] }> {
    const project = await this.projects.findScoped(id, orgId);
    const year = parseYear(yearRaw);
    this.actuals.assertValidPeriod(year, 1);
    const docs = await this.actuals.listByYear(orgId, String(project._id), year);
    return { year, periods: docs.map(toPeriodView) };
  }

  @Get(':id/variances')
  @RequirePermission('analytics.read')
  async variances(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Query('year') yearRaw?: string,
  ): Promise<VariancesView> {
    const project = await this.projects.findScoped(id, orgId);
    const year = parseYear(yearRaw);
    this.actuals.assertValidPeriod(year, 1);
    const plan = await this.latestApprovedPlan(orgId, String(project._id));
    const periods = await this.actuals.listByYear(orgId, String(project._id), year);
    return {
      year,
      planVersion: plan.version,
      monthsCounted: periods.filter((p) => Object.keys(p.values).length > 0).map((p) => p.month),
      convention: 'annuel/12',
      lines: computeVariances(plan.result.lines, periods, year),
    };
  }

  @Get(':id/updated-projection')
  @RequirePermission('analytics.read')
  async updatedProjection(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Query('year') yearRaw?: string,
  ): Promise<UpdatedProjectionView> {
    const project = await this.projects.findScoped(id, orgId);
    const year = parseYear(yearRaw);
    this.actuals.assertValidPeriod(year, 1);
    const plan = await this.latestApprovedPlan(orgId, String(project._id));
    const periods = await this.actuals.listByYear(orgId, String(project._id), year);
    return {
      year,
      planVersion: plan.version,
      monthsClosed: periods.filter((p) => p.status === 'closed').map((p) => p.month),
      convention: 'annuel/12',
      lines: computeUpdatedProjection(plan.result.lines, periods, year),
    };
  }

  /**
   * Dernier plan au statut `approved` — la seule référence légitime des écarts
   * (docs/08 : le plan est la référence validée et immuable). Requête ciblée :
   * un snapshot embarque un résultat moteur complet, on n'en charge qu'un.
   */
  private async latestApprovedPlan(
    orgId: string,
    projectId: string,
  ): Promise<FinancialPlanDocument> {
    const approved = await this.plans.findLatestApproved(orgId, projectId);
    if (!approved) {
      throw new ConflictException({
        code: 'NO_APPROVED_PLAN',
        message: 'Aucun plan validé — validez un plan avant de suivre le réalisé.',
      });
    }
    return approved;
  }
}

/** Année d'exercice depuis la query string — défaut : année 1. */
function parseYear(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 1;
  return Number(raw);
}

function toPeriodView(doc: ActualPeriodDocument): ActualPeriodView {
  return {
    id: String(doc._id),
    projectId: doc.projectId,
    year: doc.year,
    month: doc.month,
    status: doc.status,
    values: doc.values,
    closedAt: doc.closedAt ? doc.closedAt.toISOString() : null,
    closedBy: doc.closedBy ?? null,
    reopenedLog: doc.reopenedLog.map((e) => ({
      reopenedAt: e.reopenedAt.toISOString(),
      reopenedBy: e.reopenedBy,
      reason: e.reason,
    })),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
