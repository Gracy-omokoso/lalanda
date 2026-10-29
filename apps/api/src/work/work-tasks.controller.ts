// Tâches — ADR-0039 § 4.
//
//   GET    /work/projects/:projectId/tasks                       work.read   (tout le projet)
//   POST   /work/projects/:projectId/tasks                       work.update
//   GET    /work/tasks                                           work.read   (transverse, curseur)
//   GET    /work/my-tasks                                        work.read
//   GET    /work/tasks/:taskId                                   work.read   (détail)
//   PATCH  /work/tasks/:taskId                                   work.update (révision attendue)
//   POST   /work/tasks/:taskId/move                              work.update
//   POST   /work/tasks/:taskId/complete · …/reopen               work.update
//   DELETE /work/tasks/:taskId                                   work.manage
//   POST   /work/tasks/:taskId/dependencies                      work.update
//   DELETE /work/tasks/:taskId/dependencies/:predecessorTaskId   work.update
//   GET    /work/tasks/:taskId/activity                          work.read   (curseur)
//
// Les écritures rendent `{ task, warnings, suggestions }` (`WorkTaskWriteResult`).

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AddDependencyBody,
  CreateWorkTaskBody,
  ListProjectTasksQuery,
  ListWorkTasksQuery,
  MoveWorkTaskBody,
  PatchWorkTaskBody,
  WorkCursorQuery,
  WorkExpectedRevisionBody,
  type MyTaskItem,
  type MyTasksView,
  type WorkActivityView,
  type WorkPage,
  type WorkTaskDetail,
  type WorkTaskView,
  type WorkTaskWriteResult,
} from '@lalanda/shared/work';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { CurrentOrgRole } from '../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import type { OrgRole } from '../authz/permissions.js';
import { invalidRequest } from '../sales/sales.errors.js';
import { workActorOf } from './work.common.js';
import { WorkActivityService } from './work-activity.service.js';
import { WorkTasksService } from './work-tasks.service.js';

type User = { id: string };

@Controller('work')
@UseGuards(AuthGuard, PermissionsGuard)
export class WorkTasksController {
  constructor(
    @Inject(WorkTasksService) private readonly tasks: WorkTasksService,
    @Inject(WorkActivityService) private readonly activity: WorkActivityService,
  ) {}

  @Get('projects/:projectId/tasks')
  @RequirePermission('work.read')
  async listProject(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('projectId') projectId: string,
    @Query() query: unknown,
  ): Promise<{ items: WorkTaskView[] }> {
    const parsed = ListProjectTasksQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.tasks.listProject(orgId, projectId, parsed.data, workActorOf(user, role));
  }

  @Post('projects/:projectId/tasks')
  @RequirePermission('work.update')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<WorkTaskWriteResult> {
    const parsed = CreateWorkTaskBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.tasks.create(orgId, projectId, parsed.data, workActorOf(user, role));
  }

  @Get('tasks')
  @RequirePermission('work.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Query() query: unknown,
  ): Promise<WorkPage<MyTaskItem>> {
    const parsed = ListWorkTasksQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.tasks.listTransverse(orgId, parsed.data, workActorOf(user, role));
  }

  @Get('my-tasks')
  @RequirePermission('work.read')
  async myTasks(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
  ): Promise<MyTasksView> {
    return this.tasks.myTasks(orgId, workActorOf(user, role));
  }

  @Get('tasks/:taskId')
  @RequirePermission('work.read')
  async get(
    @CurrentOrgId() orgId: string,
    @Param('taskId') taskId: string,
  ): Promise<WorkTaskDetail> {
    return this.tasks.detail(orgId, taskId);
  }

  @Patch('tasks/:taskId')
  @RequirePermission('work.update')
  async patch(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<WorkTaskWriteResult> {
    const parsed = PatchWorkTaskBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.tasks.patch(orgId, taskId, parsed.data, workActorOf(user, role));
  }

  @Post('tasks/:taskId/move')
  @HttpCode(200)
  @RequirePermission('work.update')
  async move(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<WorkTaskWriteResult> {
    const parsed = MoveWorkTaskBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.tasks.move(orgId, taskId, parsed.data, workActorOf(user, role));
  }

  @Post('tasks/:taskId/complete')
  @HttpCode(200)
  @RequirePermission('work.update')
  async complete(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<WorkTaskWriteResult> {
    const parsed = WorkExpectedRevisionBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.tasks.complete(
      orgId,
      taskId,
      parsed.data.expectedRevision,
      workActorOf(user, role),
    );
  }

  @Post('tasks/:taskId/reopen')
  @HttpCode(200)
  @RequirePermission('work.update')
  async reopen(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<WorkTaskWriteResult> {
    const parsed = WorkExpectedRevisionBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.tasks.reopen(orgId, taskId, parsed.data.expectedRevision, workActorOf(user, role));
  }

  @Delete('tasks/:taskId')
  @HttpCode(204)
  @RequirePermission('work.manage')
  async remove(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('taskId') taskId: string,
  ): Promise<void> {
    await this.tasks.remove(orgId, taskId, workActorOf(user, role));
  }

  @Post('tasks/:taskId/dependencies')
  @HttpCode(200)
  @RequirePermission('work.update')
  async addDependency(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<WorkTaskWriteResult> {
    const parsed = AddDependencyBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.tasks.addDependency(
      orgId,
      taskId,
      parsed.data.predecessorTaskId,
      workActorOf(user, role),
    );
  }

  @Delete('tasks/:taskId/dependencies/:predecessorTaskId')
  @RequirePermission('work.update')
  async removeDependency(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('taskId') taskId: string,
    @Param('predecessorTaskId') predecessorTaskId: string,
  ): Promise<WorkTaskWriteResult> {
    return this.tasks.removeDependency(
      orgId,
      taskId,
      predecessorTaskId.toLowerCase(),
      workActorOf(user, role),
    );
  }

  @Get('tasks/:taskId/activity')
  @RequirePermission('work.read')
  async activityOf(
    @CurrentOrgId() orgId: string,
    @Param('taskId') taskId: string,
    @Query() query: unknown,
  ): Promise<WorkPage<WorkActivityView>> {
    const parsed = WorkCursorQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    const task = await this.tasks.requireOwn(orgId, taskId);
    return this.activity.list(
      orgId,
      { projectId: task.projectId, taskId },
      parsed.data.limit,
      parsed.data.cursor,
    );
  }
}
