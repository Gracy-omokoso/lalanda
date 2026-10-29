// Projets du RUN — ADR-0039 § 4.
//
//   GET    /work/projects                         work.read   (filtres, curseur, compteurs)
//   POST   /work/projects                         work.manage
//   GET    /work/projects/:projectId              work.read
//   PUT    /work/projects/:projectId              work.manage (révision attendue)
//   POST   /work/projects/:projectId/archive      work.manage
//   POST   /work/projects/:projectId/restore      work.manage
//   DELETE /work/projects/:projectId              work.manage (409 si non vide)
//   GET    /work/projects/:projectId/activity     work.read   (curseur)
//
// `POST /work/projects/from-quote` appartient au lot L4a (`work/billing/**`).
// Un projet d'une autre organisation répond 404.

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
  CreateWorkProjectBody,
  ListWorkProjectsQuery,
  UpdateWorkProjectBody,
  WorkCursorQuery,
  WorkExpectedRevisionBody,
  type WorkActivityView,
  type WorkPage,
  type WorkProjectSummary,
  type WorkProjectView,
} from '@lalanda/shared/work';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { CurrentOrgRole } from '../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import type { OrgRole } from '../authz/permissions.js';
import { invalidRequest } from '../sales/sales.errors.js';
import { WorkIdPipe, workActorOf } from './work.common.js';
import { WorkActivityService } from './work-activity.service.js';
import { WorkProjectsService } from './work-projects.service.js';

type User = { id: string };

@Controller('work/projects')
@UseGuards(AuthGuard, PermissionsGuard)
export class WorkProjectsController {
  constructor(
    @Inject(WorkProjectsService) private readonly projects: WorkProjectsService,
    @Inject(WorkActivityService) private readonly activity: WorkActivityService,
  ) {}

  @Get()
  @RequirePermission('work.read')
  async list(
    @CurrentOrgId() orgId: string,
    @Query() query: unknown,
  ): Promise<WorkPage<WorkProjectSummary>> {
    const parsed = ListWorkProjectsQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.projects.list(orgId, parsed.data);
  }

  @Post()
  @RequirePermission('work.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<WorkProjectView> {
    const parsed = CreateWorkProjectBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.projects.create(orgId, parsed.data, workActorOf(user, role));
  }

  @Get(':projectId')
  @RequirePermission('work.read')
  async get(
    @CurrentOrgId() orgId: string,
    @Param('projectId', WorkIdPipe) projectId: string,
  ): Promise<WorkProjectView> {
    return this.projects.get(orgId, projectId);
  }

  @Put(':projectId')
  @RequirePermission('work.manage')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('projectId', WorkIdPipe) projectId: string,
    @Body() body: unknown,
  ): Promise<WorkProjectView> {
    const parsed = UpdateWorkProjectBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.projects.update(orgId, projectId, parsed.data, workActorOf(user, role));
  }

  @Post(':projectId/archive')
  @HttpCode(200)
  @RequirePermission('work.manage')
  async archive(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('projectId', WorkIdPipe) projectId: string,
    @Body() body: unknown,
  ): Promise<WorkProjectView> {
    const parsed = WorkExpectedRevisionBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.projects.archive(
      orgId,
      projectId,
      parsed.data.expectedRevision,
      workActorOf(user, role),
    );
  }

  @Post(':projectId/restore')
  @HttpCode(200)
  @RequirePermission('work.manage')
  async restore(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('projectId', WorkIdPipe) projectId: string,
    @Body() body: unknown,
  ): Promise<WorkProjectView> {
    const parsed = WorkExpectedRevisionBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.projects.restore(
      orgId,
      projectId,
      parsed.data.expectedRevision,
      workActorOf(user, role),
    );
  }

  @Delete(':projectId')
  @HttpCode(204)
  @RequirePermission('work.manage')
  async remove(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('projectId', WorkIdPipe) projectId: string,
  ): Promise<void> {
    await this.projects.remove(orgId, projectId, workActorOf(user, role));
  }

  @Get(':projectId/activity')
  @RequirePermission('work.read')
  async activityOf(
    @CurrentOrgId() orgId: string,
    @Param('projectId', WorkIdPipe) projectId: string,
    @Query() query: unknown,
  ): Promise<WorkPage<WorkActivityView>> {
    const parsed = WorkCursorQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    await this.projects.requireOwn(orgId, projectId);
    return this.activity.list(orgId, { projectId }, parsed.data.limit, parsed.data.cursor);
  }
}
