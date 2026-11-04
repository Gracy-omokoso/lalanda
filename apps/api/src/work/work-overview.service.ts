// Aperçu d'un projet — ADR-0057. Lecture seule : charge les tâches et les
// commentaires du projet (organisation active), puis délègue TOUT le calcul à
// `computeWorkProjectOverview` (`@lalanda/shared/work`, fonction pure testée).

import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  WORK_LIMITS,
  computeWorkProjectOverview,
  type WorkProjectOverview,
} from '@lalanda/shared/work';
import type { Model } from 'mongoose';

import { WorkMembersService } from './work-members.service.js';
import { WorkProjectsService } from './work-projects.service.js';
import {
  WorkComment,
  type WorkCommentDocument,
  WorkTask,
  type WorkTaskDocument,
  type WorkTaskLean,
} from './work.schemas.js';

type TaskRow = Pick<
  WorkTaskLean,
  | '_id'
  | 'number'
  | 'title'
  | 'parentTaskId'
  | 'done'
  | 'completedAt'
  | 'dueDate'
  | 'isMilestone'
  | 'assigneeUserId'
> & { createdAt?: Date };

@Injectable()
export class WorkOverviewService {
  constructor(
    @InjectModel(WorkTask.name) private readonly tasks: Model<WorkTaskDocument>,
    @InjectModel(WorkComment.name) private readonly comments: Model<WorkCommentDocument>,
    @Inject(WorkProjectsService) private readonly projects: WorkProjectsService,
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
  ) {}

  async overview(
    organizationId: string,
    projectId: string,
    now = new Date(),
  ): Promise<WorkProjectOverview> {
    // 404 pour un projet d'une autre organisation (même règle que `GET /work/projects/:id`).
    const project = await this.projects.requireOwn(organizationId, projectId);
    const [rows, comments] = await Promise.all([
      this.tasks
        .find(
          { organizationId, projectId },
          {
            number: 1,
            title: 1,
            parentTaskId: 1,
            done: 1,
            completedAt: 1,
            dueDate: 1,
            isMilestone: 1,
            assigneeUserId: 1,
            createdAt: 1,
          },
        )
        .limit(WORK_LIMITS.tasksPerProject)
        .lean<TaskRow[]>()
        .exec(),
      this.comments
        .find({ organizationId, projectId, deletedAt: null }, { taskId: 1 })
        .lean<{ taskId: string }[]>()
        .exec(),
    ]);
    const refs = await this.members.refs(rows.map((r) => r.assigneeUserId));
    return computeWorkProjectOverview({
      projectId,
      status: project.status,
      projectDueDate: project.dueDate ?? null,
      tasks: rows.map((r) => ({
        id: String(r._id),
        number: r.number,
        title: r.title,
        parentTaskId: r.parentTaskId ?? null,
        done: r.done,
        completedAt: r.completedAt ?? null,
        createdAt: r.createdAt ?? now,
        dueDate: r.dueDate ?? null,
        isMilestone: r.isMilestone,
        assignee: r.assigneeUserId ? (refs.get(r.assigneeUserId) ?? null) : null,
      })),
      commentTaskIds: comments.map((c) => c.taskId),
      now,
    });
  }
}
