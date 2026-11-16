// Statut déclaré d'un projet — ADR-0076 § 5.
//
// Le chef, l'adjoint (ou `work.manage`) publie « Dans les temps / À risque / En retard /
// Terminé », un texte et une date. En ajout seulement (`work_project_status_updates`) :
// l'historique ne se réécrit pas. Le dernier statut s'affiche à côté de la santé
// CALCULÉE (`overviewHealth`), sans la remplacer. Les personnes du projet sont
// notifiées selon leurs préférences (cloche, e-mail, Slack, WhatsApp).

import {
  WORK_COLLAB_LIMITS,
  WORK_PROJECT_STATUS_LABELS,
  kinshasaDayOf,
  type PostWorkProjectStatusBody,
  type WorkProjectStatusView,
} from '@lalanda/shared/work';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { projectArchived, type WorkActor } from './work.common.js';
import { WorkAccessService } from './work-access.service.js';
import { WorkActivityService } from './work-activity.service.js';
import { WorkMembersService } from './work-members.service.js';
import { WorkNotifier } from './work-notifier.js';
import { WorkProjectMembersService } from './work-project-members.service.js';
import { WorkProjectsService } from './work-projects.service.js';
import {
  WorkProjectStatusUpdate,
  type WorkProjectStatusUpdateDocument,
  type WorkProjectStatusUpdateLean,
} from './work.schemas.js';

@Injectable()
export class WorkProjectStatusService {
  constructor(
    @InjectModel(WorkProjectStatusUpdate.name)
    private readonly statuses: Model<WorkProjectStatusUpdateDocument>,
    @Inject(WorkProjectsService) private readonly projects: WorkProjectsService,
    @Inject(WorkProjectMembersService) private readonly projectMembers: WorkProjectMembersService,
    @Inject(WorkAccessService) private readonly access: WorkAccessService,
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
    @Inject(WorkActivityService) private readonly activity: WorkActivityService,
    @Inject(WorkNotifier) private readonly notifier: WorkNotifier,
  ) {}

  /** `GET /work/projects/:projectId/status-updates` — les 50 derniers, du plus récent. */
  async list(
    organizationId: string,
    projectId: string,
  ): Promise<{ items: WorkProjectStatusView[] }> {
    await this.projects.requireOwn(organizationId, projectId);
    const docs = await this.statuses
      .find({ organizationId, projectId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(WORK_COLLAB_LIMITS.statusHistoryMax)
      .lean<WorkProjectStatusUpdateLean[]>()
      .exec();
    const refs = await this.members.refs(docs.map((d) => d.authorUserId));
    return { items: docs.map((d) => WorkProjectsService.statusViewOf(d, refs)) };
  }

  /** `POST /work/projects/:projectId/status-updates` — chef, adjoint ou `work.manage`. */
  async post(
    organizationId: string,
    projectId: string,
    body: PostWorkProjectStatusBody,
    actor: WorkActor,
    now = new Date(),
  ): Promise<WorkProjectStatusView> {
    const project = await this.projects.requireOwn(organizationId, projectId);
    if (project.status === 'archived') projectArchived();
    await this.access.assertManage(organizationId, project, actor);
    const created = await this.statuses.create({
      organizationId,
      projectId,
      status: body.status,
      text: body.text,
      date: body.date ?? kinshasaDayOf(now),
      authorUserId: actor.userId,
      createdAt: now,
      _schemaVersion: 1,
    });
    await this.activity.record(organizationId, {
      projectId,
      actorUserId: actor.userId,
      kind: 'project.status_posted',
      data: { status: body.status, date: body.date ?? kinshasaDayOf(now) },
    });
    await this.projects.touch(organizationId, projectId);
    const refs = await this.members.refs([actor.userId]);
    const label = WORK_PROJECT_STATUS_LABELS[body.status];
    const author = WorkMembersService.refOf(refs, actor.userId).name;
    this.notifier.channelEvent({
      organizationId,
      projectId,
      eventLabel: 'Statut du projet',
      title: `${project.name} : ${label} — publié par ${author}`,
      href: `/projets/${projectId}`,
    });
    const audience = await this.projectMembers.audienceOf(organizationId, projectId);
    await this.notifier.projectEvent({
      organizationId,
      recipients: [...audience.members],
      kind: 'work.project_status_posted',
      projectId,
      title: `${project.name} : ${label} — ${author}`,
      actorUserId: actor.userId,
    });
    return WorkProjectsService.statusViewOf(
      created.toObject() as WorkProjectStatusUpdateLean,
      refs,
    );
  }
}
