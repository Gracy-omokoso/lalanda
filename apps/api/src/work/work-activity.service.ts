// Historique d'activité — ADR-0039 § 2.8.
//
// Journal APPEND-ONLY, distinct d'`audit_events` (journal de sécurité) : un
// petit différentiel `{ from, to }` par geste, jamais de texte de commentaire,
// 2 Kio au plus (au-delà, le différentiel est remplacé par `{ truncated: true }`).

import { WORK_LIMITS, type WorkActivityKind, type WorkActivityView } from '@lalanda/shared/work';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';

import { beforeTimeCursor, decodeTimeCursor, encodeTimeCursor } from '../crm/time-cursor.js';
import { invalidCursor, jsonBytes } from './work.common.js';
import { WorkMembersService } from './work-members.service.js';
import { WorkActivity, type WorkActivityDocument, type WorkActivityLean } from './work.schemas.js';

export interface ActivityInput {
  projectId: string;
  taskId?: string | null;
  actorUserId: string;
  kind: WorkActivityKind;
  data?: Record<string, unknown>;
}

/** Différentiel borné à 2 Kio. */
export function boundedData(data: Record<string, unknown> | undefined): Record<string, unknown> {
  const value = data ?? {};
  return jsonBytes(value) <= WORK_LIMITS.activityDataMaxBytes ? value : { truncated: true };
}

@Injectable()
export class WorkActivityService {
  constructor(
    @InjectModel(WorkActivity.name) private readonly activity: Model<WorkActivityDocument>,
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
  ) {}

  async record(
    organizationId: string,
    entries: ActivityInput | readonly ActivityInput[],
    session?: ClientSession,
  ): Promise<void> {
    const list = Array.isArray(entries) ? entries : [entries as ActivityInput];
    if (list.length === 0) return;
    const at = new Date();
    const docs = list.map((e) => ({
      organizationId,
      projectId: e.projectId,
      taskId: e.taskId ?? null,
      actorUserId: e.actorUserId,
      kind: e.kind,
      data: boundedData(e.data),
      at,
      _schemaVersion: 1,
    }));
    await this.activity.insertMany(docs, session ? { session } : {});
  }

  async list(
    organizationId: string,
    filter: { projectId: string; taskId?: string },
    limit: number,
    cursor: string | undefined,
  ): Promise<{ items: WorkActivityView[]; nextCursor: string | null }> {
    const and: Record<string, unknown>[] = [{ organizationId, projectId: filter.projectId }];
    if (filter.taskId) and.push({ taskId: filter.taskId });
    if (cursor !== undefined) {
      const c = decodeTimeCursor(cursor);
      if (c === null) invalidCursor();
      and.push(beforeTimeCursor('at', c));
    }
    const docs = await this.activity
      .find({ $and: and })
      .sort({ at: -1, _id: -1 })
      .limit(limit + 1)
      .lean<WorkActivityLean[]>()
      .exec();
    const page = docs.slice(0, limit);
    const refs = await this.members.refs(page.map((d) => d.actorUserId));
    const last = page[page.length - 1];
    return {
      items: page.map((d) => ({
        id: String(d._id),
        projectId: d.projectId,
        taskId: d.taskId ?? null,
        actor: WorkMembersService.refOf(refs, d.actorUserId),
        kind: d.kind,
        data: d.data ?? {},
        at: new Date(d.at).toISOString(),
      })),
      nextCursor:
        docs.length > limit && last ? encodeTimeCursor(new Date(last.at), String(last._id)) : null,
    };
  }

  /** Supprime l'historique d'un projet entier (suppression du projet). */
  async purgeProject(organizationId: string, projectId: string): Promise<void> {
    await this.activity.deleteMany({ organizationId, projectId }).exec();
  }
}
