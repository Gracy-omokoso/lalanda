// Commentaires — ADR-0039 § 4.
//
//   GET    /work/tasks/:taskId/comments   work.read   (du plus ancien au plus récent, curseur)
//   POST   /work/tasks/:taskId/comments   work.update
//   PUT    /work/comments/:commentId      work.update (auteur seul, révision attendue)
//   DELETE /work/comments/:commentId      work.update (auteur, ou détenteur de work.manage)

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
  CreateWorkCommentBody,
  UpdateWorkCommentBody,
  WorkCursorQuery,
  type WorkCommentView,
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
import { WorkCommentsService } from './work-comments.service.js';

type User = { id: string };

@Controller('work')
@UseGuards(AuthGuard, PermissionsGuard)
export class WorkCommentsController {
  constructor(@Inject(WorkCommentsService) private readonly comments: WorkCommentsService) {}

  @Get('tasks/:taskId/comments')
  @RequirePermission('work.read')
  async list(
    @CurrentOrgId() orgId: string,
    @Param('taskId', WorkIdPipe) taskId: string,
    @Query() query: unknown,
  ): Promise<WorkPage<WorkCommentView>> {
    const parsed = WorkCursorQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.comments.list(orgId, taskId, parsed.data.limit, parsed.data.cursor);
  }

  @Post('tasks/:taskId/comments')
  @RequirePermission('work.update')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('taskId', WorkIdPipe) taskId: string,
    @Body() body: unknown,
  ): Promise<WorkCommentView> {
    const parsed = CreateWorkCommentBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.comments.create(orgId, taskId, parsed.data, workActorOf(user, perms));
  }

  @Put('comments/:commentId')
  @RequirePermission('work.update')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('commentId', WorkIdPipe) commentId: string,
    @Body() body: unknown,
  ): Promise<WorkCommentView> {
    const parsed = UpdateWorkCommentBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.comments.update(orgId, commentId, parsed.data, workActorOf(user, perms));
  }

  @Delete('comments/:commentId')
  @HttpCode(204)
  @RequirePermission('work.update')
  async remove(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('commentId', WorkIdPipe) commentId: string,
  ): Promise<void> {
    await this.comments.remove(orgId, commentId, workActorOf(user, perms));
  }
}
