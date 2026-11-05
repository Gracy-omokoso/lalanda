// Portée d'un appelant sur les projets — ADR-0060 § 3 et § 5.
//
// Calculée à chaque requête (aucun cache) : une équipe rejointe ou quittée, un
// membre ajouté ou retiré, une visibilité changée prennent effet immédiatement.
// Lit les équipes (`hr_teams`) en LECTURE SEULE par la connexion, sans importer le
// module RH (motif du CRM). Les règles sont dans `work-access.ts`.

import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { NotificationsService } from '../notifications/notifications.service.js';
import {
  ALL_PROJECTS,
  inScope,
  isProjectScopedRole,
  membershipClauses,
  type WorkProjectScope,
} from './work-access.js';
import {
  actorCan,
  isWorkId,
  oid,
  projectNotFound,
  taskNotFound,
  type WorkActor,
} from './work.common.js';
import {
  WorkAttachment,
  WorkComment,
  WorkProject,
  WorkTask,
  WorkTimeEntry,
  type WorkAttachmentDocument,
  type WorkCommentDocument,
  type WorkProjectDocument,
  type WorkTaskDocument,
  type WorkTimeEntryDocument,
} from './work.schemas.js';

/** Collection des équipes (ADR-0060 § 2), écrite par le module RH. */
export const HR_TEAMS_COLLECTION = 'hr_teams';

@Injectable()
export class WorkAccessService implements OnModuleInit {
  constructor(
    @InjectModel(WorkProject.name) private readonly projects: Model<WorkProjectDocument>,
    @InjectModel(WorkTask.name) private readonly tasks: Model<WorkTaskDocument>,
    @InjectModel(WorkComment.name) private readonly comments: Model<WorkCommentDocument>,
    @InjectModel(WorkAttachment.name) private readonly attachments: Model<WorkAttachmentDocument>,
    @InjectModel(WorkTimeEntry.name) private readonly time: Model<WorkTimeEntryDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Optional()
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService | null = null,
  ) {}

  /**
   * ADR-0060 § 5 : la boîte de notifications ne sert plus une notification d'un projet
   * privé que le destinataire ne voit pas (ou plus : retiré de l'équipe, projet passé
   * en privé). Les notifications des autres modules ne sont pas touchées.
   */
  onModuleInit(): void {
    this.notifications?.registerReadFilter(async (organizationId, userId, member) => {
      const scope = await this.scopeOf(organizationId, {
        userId,
        role: member.role,
        context: member.context,
      });
      if (scope.kind === 'all') return null;
      if (scope.kind === 'deny') {
        return scope.ids.length === 0 ? null : { 'source.projectId': { $nin: [...scope.ids] } };
      }
      return {
        $or: [
          { 'source.module': { $ne: 'work' } },
          { 'source.projectId': { $in: [...scope.ids] } },
        ],
      };
    });
  }

  /** Équipes dont l'utilisateur est membre ou responsable. */
  async teamIdsOf(organizationId: string, userId: string): Promise<string[]> {
    const docs = await this.connection
      .collection(HR_TEAMS_COLLECTION)
      .find(
        { organizationId, $or: [{ memberUserIds: userId }, { leadUserId: userId }] },
        { projection: { _id: 1 } },
      )
      .toArray();
    return docs.map((d) => String(d['_id']));
  }

  /** Portée de l'appelant (voir `work-access.ts`). */
  async scopeOf(organizationId: string, actor: WorkActor): Promise<WorkProjectScope> {
    const scoped = actor.role !== undefined && isProjectScopedRole(actor.role);
    if (!scoped && actorCan(actor, 'organization.manage')) return ALL_PROJECTS;
    const teams = await this.teamIdsOf(organizationId, actor.userId);
    const mine = membershipClauses(actor.userId, teams);
    if (scoped) {
      const docs = await this.projects
        .find({ organizationId, $or: mine }, { _id: 1 })
        .lean<{ _id: unknown }[]>()
        .exec();
      return { kind: 'allow', ids: docs.map((d) => String(d._id)) };
    }
    const hidden = await this.projects
      .find({ organizationId, visibility: 'private', $nor: mine }, { _id: 1 })
      .lean<{ _id: unknown }[]>()
      .exec();
    return hidden.length === 0
      ? ALL_PROJECTS
      : { kind: 'deny', ids: hidden.map((d) => String(d._id)) };
  }

  /**
   * Un utilisateur donné (pas l'appelant) voit-il ce projet ? Sert aux destinataires
   * des notifications et des e-mails : on n'écrit jamais à quelqu'un sur un projet
   * qu'il ne peut pas ouvrir.
   */
  async userSees(
    organizationId: string,
    userId: string,
    role: WorkActor['role'],
    context: WorkActor['context'],
    projectId: string,
  ): Promise<boolean> {
    const scope = await this.scopeOf(organizationId, { userId, role, context });
    return inScope(scope, projectId);
  }

  /** 404 `WORK_PROJECT_NOT_FOUND` si le projet est hors de la portée de l'appelant. */
  async assertProject(organizationId: string, projectId: string, actor: WorkActor): Promise<void> {
    if (!isWorkId(projectId)) return; // le service répondra 404
    const scope = await this.scopeOf(organizationId, actor);
    if (!inScope(scope, projectId)) projectNotFound();
  }

  /** Projet d'une ressource rattachée (tâche, commentaire, pièce, saisie), ou `null`. */
  private async projectOf(
    model: Model<never> | Model<WorkTaskDocument>,
    organizationId: string,
    id: string,
  ): Promise<string | null> {
    if (!isWorkId(id)) return null;
    const doc = await (model as Model<WorkTaskDocument>)
      .findOne({ _id: oid(id), organizationId }, { projectId: 1 })
      .lean<{ projectId: string }>()
      .exec();
    return doc?.projectId ?? null;
  }

  /** 404 `WORK_TASK_NOT_FOUND` si la tâche appartient à un projet hors portée. */
  async assertTask(organizationId: string, taskId: string, actor: WorkActor): Promise<void> {
    const projectId = await this.projectOf(this.tasks, organizationId, taskId);
    if (projectId === null) return;
    if (!inScope(await this.scopeOf(organizationId, actor), projectId)) taskNotFound();
  }

  /** Ressource rattachée à un projet hors portée : `notFound` (même 404 que l'absence). */
  async assertAttached(
    kind: 'comment' | 'attachment' | 'timeEntry',
    organizationId: string,
    id: string,
    actor: WorkActor,
    notFound: () => never,
  ): Promise<void> {
    const model =
      kind === 'comment' ? this.comments : kind === 'attachment' ? this.attachments : this.time;
    const projectId = await this.projectOf(model as never, organizationId, id);
    if (projectId === null) return;
    if (!inScope(await this.scopeOf(organizationId, actor), projectId)) notFound();
  }
}
