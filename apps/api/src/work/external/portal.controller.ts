// Espace externe (contact client, consultant) — ADR-0078. Session de l'espace externe
// seulement (`ExternalAuthGuard`) : aucune permission d'organisation n'est en jeu, ces
// routes sont inscrites dans `SANS_PERMISSION` de `routes-coverage.test.ts`. Toute lecture
// part du compte de la session et de ses accès ouverts (`WorkPortalService`).
//
//   GET    /portal/me
//   GET    /portal/projects
//   GET    /portal/projects/:projectId
//   GET    /portal/tasks/:taskId
//   POST   /portal/tasks/:taskId/comments          (toujours partagé)
//   POST   /portal/tasks/:taskId/client-decision   (contact client)
//   POST   /portal/tasks/:taskId/time-entries      (consultant, ses tâches)
//   PUT    /portal/time-entries/:entryId           (consultant, ses saisies)
//   DELETE /portal/time-entries/:entryId           (consultant, ses saisies)
//   GET    /portal/timesheet?week=                 (consultant)
//   POST   /portal/timesheet/submit                (consultant)

import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
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
  PortalClientDecisionBody,
  PortalCommentBody,
  SubmitTimesheetBody,
  UpdateTimeEntryBody,
  WorkDay,
  type PortalCommentView,
  type PortalMeView,
  type PortalProjectSummary,
  type PortalProjectView,
  type PortalTaskView,
  type PortalTimeEntryView,
  type PortalTimesheetView,
} from '@lalanda/shared/work';

import { invalidRequest } from '../../sales/sales.errors.js';
import { WorkIdPipe } from '../work.common.js';
import { CurrentExternal, ExternalAuthGuard } from './external-auth.guard.js';
import { WorkExternalAuthService, type ExternalContext } from './work-external-auth.service.js';
import { WorkPortalService } from './work-portal.service.js';

/** Saisie d'un consultant : pour lui-même seulement (`userId` refusé). */
const PortalCreateTimeBody = CreateTimeEntryBody.omit({ userId: true });

@Controller('portal')
@UseGuards(ExternalAuthGuard)
export class PortalController {
  constructor(
    @Inject(WorkPortalService) private readonly portal: WorkPortalService,
    @Inject(WorkExternalAuthService) private readonly auth: WorkExternalAuthService,
  ) {}

  @Get('me')
  @Header('cache-control', 'no-store')
  async me(@CurrentExternal() ctx: ExternalContext): Promise<PortalMeView> {
    return this.auth.me(ctx);
  }

  @Get('projects')
  @Header('cache-control', 'no-store')
  async projects(
    @CurrentExternal() ctx: ExternalContext,
  ): Promise<{ items: PortalProjectSummary[] }> {
    return this.portal.projectList(ctx);
  }

  @Get('projects/:projectId')
  @Header('cache-control', 'no-store')
  async project(
    @CurrentExternal() ctx: ExternalContext,
    @Param('projectId', WorkIdPipe) projectId: string,
  ): Promise<PortalProjectView> {
    return this.portal.project(ctx, projectId);
  }

  @Get('tasks/:taskId')
  @Header('cache-control', 'no-store')
  async task(
    @CurrentExternal() ctx: ExternalContext,
    @Param('taskId', WorkIdPipe) taskId: string,
  ): Promise<PortalTaskView> {
    return this.portal.task(ctx, taskId);
  }

  @Post('tasks/:taskId/comments')
  async comment(
    @CurrentExternal() ctx: ExternalContext,
    @Param('taskId', WorkIdPipe) taskId: string,
    @Body() body: unknown,
  ): Promise<PortalCommentView> {
    const parsed = PortalCommentBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.portal.comment(ctx, taskId, parsed.data);
  }

  @Post('tasks/:taskId/client-decision')
  @HttpCode(200)
  async clientDecision(
    @CurrentExternal() ctx: ExternalContext,
    @Param('taskId', WorkIdPipe) taskId: string,
    @Body() body: unknown,
  ): Promise<PortalTaskView> {
    const parsed = PortalClientDecisionBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.portal.clientDecision(ctx, taskId, parsed.data);
  }

  @Post('tasks/:taskId/time-entries')
  async createTime(
    @CurrentExternal() ctx: ExternalContext,
    @Param('taskId', WorkIdPipe) taskId: string,
    @Body() body: unknown,
  ): Promise<PortalTimeEntryView> {
    const parsed = PortalCreateTimeBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.portal.createTime(ctx, taskId, parsed.data);
  }

  @Put('time-entries/:entryId')
  async updateTime(
    @CurrentExternal() ctx: ExternalContext,
    @Param('entryId', WorkIdPipe) entryId: string,
    @Body() body: unknown,
  ): Promise<PortalTimeEntryView> {
    const parsed = UpdateTimeEntryBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.portal.updateTime(ctx, entryId, parsed.data);
  }

  @Delete('time-entries/:entryId')
  @HttpCode(204)
  async removeTime(
    @CurrentExternal() ctx: ExternalContext,
    @Param('entryId', WorkIdPipe) entryId: string,
  ): Promise<void> {
    await this.portal.removeTime(ctx, entryId);
  }

  @Get('timesheet')
  @Header('cache-control', 'no-store')
  async timesheet(
    @CurrentExternal() ctx: ExternalContext,
    @Query('week') week: unknown,
  ): Promise<PortalTimesheetView> {
    const parsed = WorkDay.optional().safeParse(week);
    if (!parsed.success) invalidRequest(parsed.error, 'Semaine invalide.');
    return this.portal.timesheet(ctx, parsed.data);
  }

  @Post('timesheet/submit')
  @HttpCode(200)
  async submitTimesheet(
    @CurrentExternal() ctx: ExternalContext,
    @Body() body: unknown,
  ): Promise<PortalTimesheetView> {
    const parsed = SubmitTimesheetBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.portal.submitTimesheet(ctx, parsed.data);
  }
}
