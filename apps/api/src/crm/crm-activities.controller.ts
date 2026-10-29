// Activités (appels, réunions, notes, relances) — ADR-0035 § 4.
//
// `crm.read` pour lire ; `crm.manage` pour écrire. Une activité d'une autre
// organisation répond 404.
//
// ADR-0040 — C4 : `assignee=me|<id>`, `accountId`, `dueFrom`, `dueTo` en liste ;
// `POST …/reopen` décoche (« Mes tâches » coche et décoche par ces routes).

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { CurrentOrgRole } from '../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import type { OrgRole } from '../authz/permissions.js';
import { invalidRequest } from '../sales/sales.errors.js';
import { ActivitiesService, type ActivityPage, type ActivityView } from './activities.service.js';
import { crmActorOf } from './crm-actor.js';
import {
  CreateActivitySchema,
  ExpectedRevisionSchema,
  ListActivitiesQuerySchema,
  PutActivitySchema,
} from './crm.dto.js';

type User = { id: string };

@Controller('crm/activities')
@UseGuards(AuthGuard, PermissionsGuard)
export class CrmActivitiesController {
  constructor(@Inject(ActivitiesService) private readonly activities: ActivitiesService) {}

  @Get()
  @RequirePermission('crm.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @Query() query: unknown,
  ): Promise<ActivityPage> {
    const parsed = ListActivitiesQuerySchema.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.activities.list(orgId, parsed.data, user.id);
  }

  @Post()
  @RequirePermission('crm.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<ActivityView> {
    const parsed = CreateActivitySchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.activities.create(orgId, parsed.data, crmActorOf(user, role));
  }

  @Put(':activityId')
  @RequirePermission('crm.manage')
  async put(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('activityId') activityId: string,
    @Body() body: unknown,
  ): Promise<ActivityView> {
    const parsed = PutActivitySchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.activities.put(
      orgId,
      activityId,
      parsed.data.expectedRevision,
      parsed.data.activity,
      parsed.data.done,
      crmActorOf(user, role),
    );
  }

  @Post(':activityId/complete')
  @HttpCode(200)
  @RequirePermission('crm.manage')
  async complete(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('activityId') activityId: string,
    @Body() body: unknown,
  ): Promise<ActivityView> {
    const parsed = ExpectedRevisionSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.activities.complete(
      orgId,
      activityId,
      parsed.data.expectedRevision,
      crmActorOf(user, role),
    );
  }

  // ADR-0040 — C4 § 3.5 : décocher (symétrie avec `POST /work/tasks/:id/reopen`).
  @Post(':activityId/reopen')
  @HttpCode(200)
  @RequirePermission('crm.manage')
  async reopen(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('activityId') activityId: string,
    @Body() body: unknown,
  ): Promise<ActivityView> {
    const parsed = ExpectedRevisionSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.activities.reopen(
      orgId,
      activityId,
      parsed.data.expectedRevision,
      crmActorOf(user, role),
    );
  }

  @Delete(':activityId')
  @HttpCode(204)
  @RequirePermission('crm.manage')
  async remove(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('activityId') activityId: string,
  ): Promise<void> {
    await this.activities.remove(orgId, activityId, crmActorOf(user, role));
  }
}
