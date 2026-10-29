// Points d'API du business plan au niveau de l'organisation (ADR-0037 § 8, § 9).
//
//   GET /business-plan            projets et état de leur business plan     project.read
//   GET /business-plan/settings   IA du business plan permise ?             project.read
//   PUT /business-plan/settings   activer / désactiver l'IA                 organization.manage
//
// L'organisation est TOUJOURS celle de la session (`@CurrentOrgId`).

import { BadRequestException, Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { AuditService } from '../authz/audit.service.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { CurrentOrgRole } from '../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { can, NO_OVERRIDES, type OrgRole } from '../authz/permissions.js';
import { ProjectsService } from '../projects/projects.service.js';
import {
  BusinessPlanOverviewService,
  type BusinessPlanOverviewItem,
} from './business-plan-overview.service.js';
import { BusinessPlanService } from './business-plan.service.js';

export const SettingsRequestSchema = z.object({ aiEnabled: z.boolean() }).strict();

export interface BusinessPlanSettingsView {
  aiEnabled: boolean;
  disabledBy: 'organization' | 'platform' | null;
  canManage: boolean;
}

@Controller('business-plan')
@UseGuards(AuthGuard, PermissionsGuard)
export class BusinessPlanOrgController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(BusinessPlanService) private readonly service: BusinessPlanService,
    @Inject(BusinessPlanOverviewService) private readonly overview: BusinessPlanOverviewService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('project.read')
  async list(@CurrentOrgId() orgId: string): Promise<{ projects: BusinessPlanOverviewItem[] }> {
    const projects = await this.projects.listByOrg(orgId);
    return { projects: await this.overview.of(orgId, projects) };
  }

  @Get('settings')
  @RequirePermission('project.read')
  async getSettings(
    @CurrentOrgId() orgId: string,
    @CurrentOrgRole() role: OrgRole | undefined,
  ): Promise<BusinessPlanSettingsView> {
    const disabledBy = await this.service.aiDisabledBy(orgId);
    return {
      aiEnabled: disabledBy === null,
      disabledBy,
      canManage: can(role ?? 'viewer', 'organization.manage', NO_OVERRIDES),
    };
  }

  @Put('settings')
  @RequirePermission('organization.manage')
  async putSettings(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<BusinessPlanSettingsView> {
    const parsed = SettingsRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    await this.service.setAiEnabled(orgId, parsed.data.aiEnabled, user.id);
    await this.audit.record({
      organizationId: orgId,
      actorUserId: user.id,
      actorRole: role ?? 'unknown',
      action: 'business_plan.settings.updated',
      targetType: 'organization',
      targetId: orgId,
      metadata: { aiEnabled: parsed.data.aiEnabled },
    });
    return this.getSettings(orgId, role);
  }
}
