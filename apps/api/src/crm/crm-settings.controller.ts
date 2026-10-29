// Réglages du pipeline et tableau du CRM — ADR-0035 § 4.
//
// `crm.read` pour lire le tableau (Kanban, indicateurs) et les réglages ;
// `crm.manage` pour modifier les réglages. Organisation active seulement.

import { Body, Controller, Get, Inject, Put, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { CurrentOrgRole } from '../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import type { OrgRole } from '../authz/permissions.js';
import { invalidRequest } from '../sales/sales.errors.js';
import { crmActorOf } from './crm-actor.js';
import { CrmSettingsService, type CrmSettingsView } from './crm-settings.service.js';
import { PipelineQuerySchema, PutCrmSettingsSchema } from './crm.dto.js';
import { OpportunitiesService, type PipelineView } from './opportunities.service.js';

@Controller('crm')
@UseGuards(AuthGuard, PermissionsGuard)
export class CrmSettingsController {
  constructor(
    @Inject(CrmSettingsService) private readonly settings: CrmSettingsService,
    @Inject(OpportunitiesService) private readonly opportunities: OpportunitiesService,
  ) {}

  @Get('settings')
  @RequirePermission('crm.read')
  async get(@CurrentOrgId() orgId: string): Promise<CrmSettingsView> {
    return this.settings.get(orgId);
  }

  @Put('settings')
  @RequirePermission('crm.manage')
  async put(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<CrmSettingsView> {
    const parsed = PutCrmSettingsSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.settings.put(
      orgId,
      parsed.data.expectedRevision,
      parsed.data.settings,
      crmActorOf(user, role),
    );
  }

  @Get('pipeline')
  @RequirePermission('crm.read')
  async pipeline(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @Query() query: unknown,
  ): Promise<PipelineView> {
    // ADR-0040 — C2 : `?ownerId=me|<id>` (confort ; tout `crm.read` voit tout le pipeline).
    const parsed = PipelineQuerySchema.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    const ownerId = parsed.data.ownerId === 'me' ? user.id : (parsed.data.ownerId ?? null);
    return this.opportunities.pipeline(orgId, new Date(), ownerId);
  }
}
