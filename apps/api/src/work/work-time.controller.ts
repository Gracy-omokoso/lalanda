// Temps et coûts horaires — ADR-0039 § 4.
//
//   GET    /work/time-entries                        work.read (minutes seulement, curseur)
//   POST   /work/tasks/:taskId/time-entries          work.update (pour autrui : work.manage)
//   PUT    /work/time-entries/:entryId               work.update (les siennes ; autrui : work.manage)
//   DELETE /work/time-entries/:entryId               work.update (idem)
//   GET    /work/projects/:projectId/time-summary    work.read
//   GET    /work/rates                               work.read + treasury.manage
//   POST   /work/rates                               work.manage + treasury.manage
//   DELETE /work/rates/:rateId                       work.manage + treasury.manage

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
import {
  CreateTimeEntryBody,
  ListTimeEntriesQuery,
  SetMemberRateBody,
  UpdateTimeEntryBody,
  type TimeEntryView,
  type TimeSummaryView,
  type WorkMemberRateView,
  type WorkPage,
} from '@lalanda/shared/work';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../authz/current-org-permissions.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { invalidRequest } from '../sales/sales.errors.js';
import { WorkIdPipe, workActorOf } from './work.common.js';
import { WorkTimeService } from './work-time.service.js';

type User = { id: string };

@Controller('work')
@UseGuards(AuthGuard, PermissionsGuard)
export class WorkTimeController {
  constructor(@Inject(WorkTimeService) private readonly time: WorkTimeService) {}

  @Get('time-entries')
  @RequirePermission('work.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Query() query: unknown,
  ): Promise<WorkPage<TimeEntryView>> {
    const parsed = ListTimeEntriesQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.time.list(orgId, parsed.data, workActorOf(user, perms));
  }

  @Post('tasks/:taskId/time-entries')
  @RequirePermission('work.update')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('taskId', WorkIdPipe) taskId: string,
    @Body() body: unknown,
  ): Promise<TimeEntryView> {
    const parsed = CreateTimeEntryBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.time.create(orgId, taskId, parsed.data, workActorOf(user, perms));
  }

  @Put('time-entries/:entryId')
  @RequirePermission('work.update')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('entryId', WorkIdPipe) entryId: string,
    @Body() body: unknown,
  ): Promise<TimeEntryView> {
    const parsed = UpdateTimeEntryBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.time.update(orgId, entryId, parsed.data, workActorOf(user, perms));
  }

  @Delete('time-entries/:entryId')
  @HttpCode(204)
  @RequirePermission('work.update')
  async remove(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('entryId', WorkIdPipe) entryId: string,
  ): Promise<void> {
    await this.time.remove(orgId, entryId, workActorOf(user, perms));
  }

  @Get('projects/:projectId/time-summary')
  @RequirePermission('work.read')
  async summary(
    @CurrentOrgId() orgId: string,
    @Param('projectId', WorkIdPipe) projectId: string,
  ): Promise<TimeSummaryView> {
    return this.time.summary(orgId, projectId);
  }

  @Get('rates')
  @RequirePermission('work.read', 'treasury.manage')
  async listRates(@CurrentOrgId() orgId: string): Promise<{ items: WorkMemberRateView[] }> {
    return this.time.listRates(orgId);
  }

  @Post('rates')
  @RequirePermission('work.manage', 'treasury.manage')
  async setRate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Body() body: unknown,
  ): Promise<WorkMemberRateView> {
    const parsed = SetMemberRateBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.time.setRate(orgId, parsed.data, workActorOf(user, perms));
  }

  @Delete('rates/:rateId')
  @HttpCode(204)
  @RequirePermission('work.manage', 'treasury.manage')
  async removeRate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('rateId', WorkIdPipe) rateId: string,
  ): Promise<void> {
    await this.time.removeRate(orgId, rateId, workActorOf(user, perms));
  }
}
