// GROW — santé, indicateurs investisseurs, parcours (ADR-0032 § 6).
//
//   GET    /grow/profile          analytics.read   fiche GROW + projets sélectionnables
//   GET    /grow/journey          analytics.read   étape suggérée, conditions, checklists
//   GET    /grow/health           analytics.read   score de santé          (forfait : actualsEnabled)
//   GET    /grow/indicators       analytics.read   indicateurs investisseurs (forfait : actualsEnabled)
//   PUT    /grow/profile          inputs.update    projet de référence, étape, articles récurrents
//   PUT    /grow/checklist/:itemId inputs.update   point de checklist manuel
//   PUT    /grow/declared-cash    actuals.import   solde de trésorerie déclaré
//   DELETE /grow/declared-cash    actuals.import
//
// Organisation active seulement (cookie). GROW lit BUILD et RUN, n'y écrit jamais.

import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import type { HealthScoreResult, GrowIndicatorsResult, JourneyResult } from '@lalanda/engine';
import { PLAN_CATALOG } from '@lalanda/shared/pricing';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { CurrentOrgRole } from '../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { can, type OrgRole } from '../authz/permissions.js';
import { BillingService } from '../billing/billing.service.js';
import {
  GrowProfileService,
  type GrowActor,
  type GrowProfileView,
} from './grow-profile.service.js';
import { GrowReaderService } from './grow-reader.service.js';
import { withoutCustomerNames } from './grow-sources.js';
import {
  invalidRequest,
  PutChecklistSchema,
  PutDeclaredCashSchema,
  PutGrowProfileSchema,
} from './grow.dto.js';

/** Code du refus de forfait (ADR-0032 § 6). */
export const GROW_PLAN_ERROR_CODE = 'PLAN_FEATURE_UNAVAILABLE' as const;

export interface GrowProfileResponse extends GrowProfileView {
  projects: { id: string; name: string; currency: string }[];
  /** Le forfait ouvre-t-il la santé et les indicateurs ? (l'API l'impose de toute façon) */
  planAllowsGrow: boolean;
  plan: string;
}

export interface GrowHealthResponse {
  asOf: string;
  health: HealthScoreResult;
  faits: GrowIndicatorsResult['faits'];
}

export interface GrowJourneyResponse {
  asOf: string;
  journey: JourneyResult;
}

function actorOf(user: { id: string }, role: OrgRole | undefined): GrowActor {
  return { userId: user.id, role: role ?? 'unknown' };
}

@Controller('grow')
@UseGuards(AuthGuard, PermissionsGuard)
export class GrowController {
  constructor(
    @Inject(GrowReaderService) private readonly reader: GrowReaderService,
    @Inject(GrowProfileService) private readonly profiles: GrowProfileService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  /**
   * Santé et indicateurs relèvent du suivi du réalisé (`actualsEnabled`, docs/13) :
   * l'interface l'explique, l'API l'impose. Le parcours reste ouvert à toutes les offres.
   */
  private async assertPlanAllowsGrow(orgId: string): Promise<void> {
    const { plan, entitlements } = await this.billing.getPlanEntitlements(orgId);
    if (entitlements.actualsEnabled) return;
    throw new ForbiddenException({
      code: GROW_PLAN_ERROR_CODE,
      feature: 'grow',
      plan,
      message: `La santé de l’entreprise et les indicateurs investisseurs se calculent sur le suivi du réalisé, non inclus dans l’offre ${PLAN_CATALOG[plan].name}. Votre parcours reste accessible.`,
      upgradeUrl: '/pricing',
    });
  }

  @Get('profile')
  @RequirePermission('analytics.read')
  async getProfile(@CurrentOrgId() orgId: string): Promise<GrowProfileResponse> {
    const [profile, projects, { plan, entitlements }] = await Promise.all([
      this.profiles.get(orgId),
      this.reader.listProjects(orgId),
      this.billing.getPlanEntitlements(orgId),
    ]);
    return {
      ...profile,
      projects: projects.map((p) => ({
        id: String(p._id),
        name: p.name,
        currency: p.deviseAffichage,
      })),
      planAllowsGrow: entitlements.actualsEnabled,
      plan,
    };
  }

  @Get('journey')
  @RequirePermission('analytics.read')
  async getJourney(@CurrentOrgId() orgId: string): Promise<GrowJourneyResponse> {
    const s = await this.reader.snapshot(orgId);
    return { asOf: s.asOf, journey: s.journey };
  }

  @Get('health')
  @RequirePermission('analytics.read')
  async getHealth(@CurrentOrgId() orgId: string): Promise<GrowHealthResponse> {
    await this.assertPlanAllowsGrow(orgId);
    const s = await this.reader.snapshot(orgId);
    return { asOf: s.asOf, health: s.health, faits: s.indicators.faits };
  }

  @Get('indicators')
  @RequirePermission('analytics.read')
  async getIndicators(
    @CurrentOrgId() orgId: string,
    @CurrentOrgRole() role: OrgRole | undefined,
  ): Promise<GrowIndicatorsResult> {
    await this.assertPlanAllowsGrow(orgId);
    const s = await this.reader.snapshot(orgId);
    // Noms des clients : seulement pour qui lit le fichier clients (`sales.read`).
    return role !== undefined && can(role, 'sales.read')
      ? s.indicators
      : withoutCustomerNames(s.indicators);
  }

  @Put('profile')
  @RequirePermission('inputs.update')
  async putProfile(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<GrowProfileView> {
    const parsed = PutGrowProfileSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.profiles.update(orgId, parsed.data, actorOf(user, role));
  }

  @Put('checklist/:itemId')
  @RequirePermission('inputs.update')
  async putChecklist(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ): Promise<GrowProfileView> {
    const parsed = PutChecklistSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.profiles.setChecklistItem(orgId, itemId, parsed.data.done, actorOf(user, role));
  }

  @Put('declared-cash')
  @RequirePermission('actuals.import')
  async putDeclaredCash(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<GrowProfileView> {
    const parsed = PutDeclaredCashSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.profiles.setDeclaredCash(orgId, parsed.data, actorOf(user, role));
  }

  @Delete('declared-cash')
  @RequirePermission('actuals.import')
  async deleteDeclaredCash(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
  ): Promise<GrowProfileView> {
    return this.profiles.clearDeclaredCash(orgId, actorOf(user, role));
  }
}
