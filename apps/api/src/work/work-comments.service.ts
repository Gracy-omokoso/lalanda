// Commentaires et mentions — ADR-0039 § 2.4 et § 6.6.
//
// Le client envoie la liste des mentionnés ; le serveur la vérifie : membres de
// l'organisation (404 sinon) détenant `work.read` (`400 WORK_MENTION_NOT_ELIGIBLE`
// sinon). Dans le texte, une mention s'écrit `@[userId]`.
//
// Modifier : l'auteur seul. Supprimer : l'auteur, ou un détenteur de
// `work.manage` (contrôle de ressource avec `can()`). La suppression est
// LOGIQUE : « Commentaire supprimé » reste dans le fil, texte effacé.
//
// Notifications (après l'écriture) : chaque mentionné (`work.mentioned`), puis
// les abonnés de la tâche hors auteur et hors mentionnés
// (`work.comment_on_followed`). L'auteur et les mentionnés deviennent abonnés.

import {
  type CreateWorkCommentBody,
  type UpdateWorkCommentBody,
  type WorkAttachmentView,
  type WorkCommentView,
  type WorkPage,
} from '@lalanda/shared/work';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { ObjectStorageService } from '../storage/object-storage.service.js';
import {
  actorCan,
  afterAscCursor,
  attachmentNotFound,
  commentNotFound,
  conflict,
  decodeAscCursor,
  encodeAscCursor,
  forbidden,
  invalidCursor,
  iso,
  isWorkId,
  oid,
  staleRevision,
  type WorkActor,
} from './work.common.js';
import { WorkActivityService } from './work-activity.service.js';
import { dropAttachmentObjects } from './work-attachments.storage.js';
import { WorkMembersService } from './work-members.service.js';
import { WorkNotifier } from './work-notifier.js';
import { WorkTasksService } from './work-tasks.service.js';
import {
  WorkAttachment,
  WorkComment,
  type WorkAttachmentDocument,
  type WorkAttachmentLean,
  type WorkCommentDocument,
  type WorkCommentLean,
  type WorkTaskLean,
} from './work.schemas.js';

/** Vue d'une pièce jointe (partagée avec le service des pièces jointes). */
export function attachmentViewOf(
  a: WorkAttachmentLean,
  refs: Map<string, { userId: string; name: string }>,
): WorkAttachmentView {
  return {
    id: String(a._id),
    taskId: a.taskId,
    commentId: a.commentId ?? null,
    fileName: a.fileName,
    contentType: a.contentType,
    size: a.size,
    sha256: a.sha256,
    uploadedBy: WorkMembersService.refOf(refs, a.uploadedBy),
    createdAt: new Date(a.createdAt).toISOString(),
  };
}

@Injectable()
export class WorkCommentsService {
  private readonly logger = new Logger('WorkComments');

  constructor(
    @InjectModel(WorkComment.name) private readonly comments: Model<WorkCommentDocument>,
    @InjectModel(WorkAttachment.name) private readonly attachments: Model<WorkAttachmentDocument>,
    @Inject(WorkTasksService) private readonly tasks: WorkTasksService,
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
    @Inject(WorkActivityService) private readonly activity: WorkActivityService,
    @Inject(WorkNotifier) private readonly notifier: WorkNotifier,
    @Inject(ObjectStorageService) private readonly storage: ObjectStorageService,
  ) {}

  private async requireOwn(organizationId: string, commentId: string): Promise<WorkCommentLean> {
    if (!isWorkId(commentId)) commentNotFound();
    const doc = await this.comments
      .findOne({ _id: oid(commentId), organizationId })
      .lean<WorkCommentLean>()
      .exec();
    if (!doc) commentNotFound();
    return doc;
  }

  private async views(
    organizationId: string,
    docs: readonly WorkCommentLean[],
  ): Promise<WorkCommentView[]> {
    const attachmentIds = docs
      .filter((d) => !d.deletedAt)
      .flatMap((d) => d.attachmentIds ?? [])
      .filter(isWorkId);
    const attachments =
      attachmentIds.length === 0
        ? []
        : await this.attachments
            .find({ organizationId, _id: { $in: attachmentIds.map(oid) }, deletedAt: null })
            .lean<WorkAttachmentLean[]>()
            .exec();
    const refs = await this.members.refs([
      ...docs.flatMap((d) => [d.authorUserId, ...(d.mentionedUserIds ?? [])]),
      ...attachments.map((a) => a.uploadedBy),
    ]);
    const byId = new Map(attachments.map((a) => [String(a._id), a]));
    return docs.map((d) => ({
      id: String(d._id),
      taskId: d.taskId,
      author: WorkMembersService.refOf(refs, d.authorUserId),
      body: d.deletedAt ? '' : d.body,
      mentions: d.deletedAt
        ? []
        : (d.mentionedUserIds ?? []).map((u) => WorkMembersService.refOf(refs, u)),
      attachments: d.deletedAt
        ? []
        : (d.attachmentIds ?? [])
            .map((id) => byId.get(id))
            .filter((a): a is WorkAttachmentLean => a !== undefined)
            .map((a) => attachmentViewOf(a, refs)),
      editedAt: iso(d.editedAt),
      deletedAt: iso(d.deletedAt),
      revision: d.revision,
      createdAt: new Date(d.createdAt).toISOString(),
    }));
  }

  /** Fil d'une tâche, du plus ancien au plus récent, paginé par curseur. */
  async list(
    organizationId: string,
    taskId: string,
    limit: number,
    cursor: string | undefined,
  ): Promise<WorkPage<WorkCommentView>> {
    const task = await this.tasks.requireOwn(organizationId, taskId);
    const and: Record<string, unknown>[] = [{ organizationId, taskId: String(task._id) }];
    if (cursor !== undefined) {
      const c = decodeAscCursor(cursor);
      if (c === null) invalidCursor();
      and.push(afterAscCursor('createdAt', c));
    }
    const docs = await this.comments
      .find({ $and: and })
      .sort({ createdAt: 1, _id: 1 })
      .limit(limit + 1)
      .lean<WorkCommentLean[]>()
      .exec();
    const page = docs.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: await this.views(organizationId, page),
      nextCursor:
        docs.length > limit && last
          ? encodeAscCursor(new Date(last.createdAt), String(last._id))
          : null,
    };
  }

  /** Pièces de la même tâche, non supprimées, non encore rattachées à un commentaire. */
  private async requireFreeAttachments(
    organizationId: string,
    taskId: string,
    ids: readonly string[],
  ): Promise<void> {
    if (ids.length === 0) return;
    const found = await this.attachments
      .countDocuments({
        organizationId,
        taskId,
        _id: { $in: ids.map(oid) },
        deletedAt: null,
        commentId: null,
      })
      .exec();
    if (found !== ids.length) attachmentNotFound();
  }

  async create(
    organizationId: string,
    taskId: string,
    body: CreateWorkCommentBody,
    actor: WorkActor,
  ): Promise<WorkCommentView> {
    const { task } = await this.tasks.requireWritable(organizationId, taskId);
    const id = String(task._id);
    const mentions = body.mentionedUserIds ?? [];
    await this.members.requireEligible(
      organizationId,
      mentions,
      'work.read',
      'WORK_MENTION_NOT_ELIGIBLE',
      'mentionedUserIds',
    );
    const attachmentIds = body.attachmentIds ?? [];
    await this.requireFreeAttachments(organizationId, id, attachmentIds);

    const created = await this.comments.create({
      organizationId,
      projectId: task.projectId,
      taskId: id,
      authorUserId: actor.userId,
      body: body.body,
      mentionedUserIds: mentions,
      attachmentIds,
      editedAt: null,
      deletedAt: null,
      revision: 1,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
    });
    const commentId = String(created._id);
    if (attachmentIds.length > 0) {
      await this.attachments
        .updateMany(
          { organizationId, _id: { $in: attachmentIds.map(oid) }, commentId: null },
          { $set: { commentId } },
        )
        .exec();
    }
    await this.tasks.addFollowers(organizationId, task, [actor.userId, ...mentions]);
    await this.activity.record(organizationId, {
      projectId: task.projectId,
      taskId: id,
      actorUserId: actor.userId,
      kind: 'comment.added',
      data: { commentId, mentions: mentions.length, attachments: attachmentIds.length },
    });
    await this.notify(organizationId, task, mentions, actor, true);
    const [view] = await this.views(organizationId, [
      await this.requireOwn(organizationId, commentId),
    ]);
    return view!;
  }

  private async notify(
    organizationId: string,
    task: WorkTaskLean,
    mentions: readonly string[],
    actor: WorkActor,
    newComment: boolean,
  ): Promise<void> {
    const taskId = String(task._id);
    const who = WorkMembersService.refOf(await this.members.refs([actor.userId]), actor.userId);
    const label = `#${task.number} ${task.title}`;
    await this.notifier.taskEvent({
      organizationId,
      recipients: mentions,
      kind: 'work.mentioned',
      projectId: task.projectId,
      taskId,
      title: `${who.name} vous a mentionné sur ${label}`,
      actorUserId: actor.userId,
    });
    if (!newComment) return;
    const mentioned = new Set(mentions);
    await this.notifier.taskEvent({
      organizationId,
      recipients: (task.followerUserIds ?? []).filter((u) => !mentioned.has(u)),
      kind: 'work.comment_on_followed',
      projectId: task.projectId,
      taskId,
      title: `${who.name} a commenté ${label}`,
      actorUserId: actor.userId,
    });
  }

  async update(
    organizationId: string,
    commentId: string,
    body: UpdateWorkCommentBody,
    actor: WorkActor,
  ): Promise<WorkCommentView> {
    const current = await this.requireOwn(organizationId, commentId);
    if (current.authorUserId !== actor.userId) {
      forbidden('WORK_COMMENT_NOT_AUTHOR', 'Seul l’auteur modifie son commentaire.');
    }
    if (current.deletedAt) {
      conflict('WORK_COMMENT_DELETED', 'Ce commentaire est supprimé.');
    }
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const { task } = await this.tasks.requireWritable(organizationId, current.taskId);
    const mentions = body.mentionedUserIds ?? [];
    await this.members.requireEligible(
      organizationId,
      mentions,
      'work.read',
      'WORK_MENTION_NOT_ELIGIBLE',
      'mentionedUserIds',
    );
    const res = await this.comments
      .updateOne(
        { _id: current._id, organizationId, revision: body.expectedRevision, deletedAt: null },
        {
          $set: {
            body: body.body,
            mentionedUserIds: mentions,
            editedAt: new Date(),
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1) {
      staleRevision((await this.requireOwn(organizationId, commentId)).revision);
    }
    const previously = new Set(current.mentionedUserIds ?? []);
    const added = mentions.filter((m) => !previously.has(m));
    await this.tasks.addFollowers(organizationId, task, added);
    await this.activity.record(organizationId, {
      projectId: current.projectId,
      taskId: current.taskId,
      actorUserId: actor.userId,
      kind: 'comment.edited',
      data: { commentId },
    });
    if (added.length > 0) await this.notify(organizationId, task, added, actor, false);
    const [view] = await this.views(organizationId, [
      await this.requireOwn(organizationId, commentId),
    ]);
    return view!;
  }

  async remove(organizationId: string, commentId: string, actor: WorkActor): Promise<void> {
    const current = await this.requireOwn(organizationId, commentId);
    if (current.authorUserId !== actor.userId && !actorCan(actor, 'work.manage')) {
      forbidden(
        'WORK_COMMENT_NOT_AUTHOR',
        'Seul l’auteur, ou un gestionnaire des projets, supprime un commentaire.',
      );
    }
    if (current.deletedAt) return;
    await this.tasks.requireWritable(organizationId, current.taskId);
    const now = new Date();
    await this.comments
      .updateOne(
        { _id: current._id, organizationId },
        {
          $set: {
            body: '',
            mentionedUserIds: [],
            deletedAt: now,
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
      )
      .exec();
    // Les pièces du commentaire partent avec son texte.
    const attachments = await this.attachments
      .find({ organizationId, commentId, deletedAt: null }, { objectId: 1 })
      .lean<WorkAttachmentLean[]>()
      .exec();
    if (attachments.length > 0) {
      await this.attachments
        .updateMany({ organizationId, commentId, deletedAt: null }, { $set: { deletedAt: now } })
        .exec();
      await dropAttachmentObjects(
        this.storage,
        attachments.map((a) => a.objectId),
        this.logger,
      );
    }
    await this.activity.record(organizationId, {
      projectId: current.projectId,
      taskId: current.taskId,
      actorUserId: actor.userId,
      kind: 'comment.deleted',
      data: { commentId, byAuthor: current.authorUserId === actor.userId },
    });
  }
}
