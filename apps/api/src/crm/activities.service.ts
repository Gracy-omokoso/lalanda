// Activités : appels, réunions, notes et relances — ADR-0035 § 2.
//
// Une activité peut viser une opportunité, un contact et/ou un client de
// l'organisation. Une note est faite dès sa création et n'a pas d'échéance ;
// une relance en a toujours une. « En retard » : non faite, échéance passée.
// Créer ou terminer une activité rattachée à une opportunité met à jour son
// `lastActivityAt` (indicateur « inactive »).

import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { Customer, type CustomerDocument } from '../sales/customer.schema.js';
import { invalidCursor, staleRevision } from '../sales/sales.errors.js';
import { isObjectIdHex } from '../sales/search.js';
import { ContactsService, requireCustomer } from './contacts.service.js';
import { ACTIVITY_KIND_LABELS, isOverdue, type ActivityKind } from './crm-model.js';
import type { CrmActor } from './crm-settings.service.js';
import type { ActivityInput, ListActivitiesQuery } from './crm.dto.js';
import { activityNotFound } from './crm.errors.js';
import { CrmActivity, type CrmActivityDocument } from './crm.schemas.js';
import { OpportunitiesService } from './opportunities.service.js';
import { beforeTimeCursor, decodeTimeCursor, encodeTimeCursor } from './time-cursor.js';

type ActivityLean = CrmActivity & { _id: Types.ObjectId };

export interface ActivityView {
  id: string;
  kind: ActivityKind;
  kindLabel: string;
  subject: string;
  notes: string | null;
  dueAt: string | null;
  done: boolean;
  doneAt: string | null;
  overdue: boolean;
  opportunityId: string | null;
  contactId: string | null;
  customerId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityPage {
  items: ActivityView[];
  nextCursor: string | null;
}

@Injectable()
export class ActivitiesService {
  constructor(
    @InjectModel(CrmActivity.name) private readonly activities: Model<CrmActivityDocument>,
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    @Inject(ContactsService) private readonly contacts: ContactsService,
    @Inject(OpportunitiesService) private readonly opportunities: OpportunitiesService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private view(d: ActivityLean, now: Date): ActivityView {
    const dueAt = d.dueAt ? new Date(d.dueAt) : null;
    return {
      id: String(d._id),
      kind: d.kind,
      kindLabel: ACTIVITY_KIND_LABELS[d.kind],
      subject: d.subject,
      notes: d.notes ?? null,
      dueAt: dueAt ? dueAt.toISOString() : null,
      done: d.done,
      doneAt: d.doneAt ? new Date(d.doneAt).toISOString() : null,
      overdue: isOverdue(d.done, dueAt, now),
      opportunityId: d.opportunityId ?? null,
      contactId: d.contactId ?? null,
      customerId: d.customerId ?? null,
      revision: d.revision,
      createdAt: new Date(d.createdAt).toISOString(),
      updatedAt: new Date(d.updatedAt).toISOString(),
    };
  }

  async list(organizationId: string, query: ListActivitiesQuery): Promise<ActivityPage> {
    const now = new Date();
    const and: Record<string, unknown>[] = [{ organizationId }];
    if (query.opportunityId) and.push({ opportunityId: query.opportunityId.toLowerCase() });
    if (query.contactId) and.push({ contactId: query.contactId.toLowerCase() });
    if (query.customerId) and.push({ customerId: query.customerId.toLowerCase() });
    if (query.status === 'open') and.push({ done: false });
    if (query.status === 'done') and.push({ done: true });
    if (query.status === 'overdue') and.push({ done: false, dueAt: { $ne: null, $lt: now } });
    if (query.cursor !== undefined) {
      const cursor = decodeTimeCursor(query.cursor);
      if (cursor === null) invalidCursor();
      and.push(beforeTimeCursor('createdAt', cursor));
    }
    const docs = await this.activities
      .find({ $and: and })
      .sort({ createdAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean<ActivityLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((d) => this.view(d, now)),
      nextCursor:
        docs.length > query.limit && last
          ? encodeTimeCursor(new Date(last.createdAt), String(last._id))
          : null,
    };
  }

  private async requireOwn(organizationId: string, activityId: string): Promise<ActivityLean> {
    if (!isObjectIdHex(activityId)) activityNotFound();
    const doc = await this.activities
      .findOne({ _id: new Types.ObjectId(activityId), organizationId })
      .lean<ActivityLean>()
      .exec();
    if (!doc) activityNotFound();
    return doc;
  }

  private async checkRefs(organizationId: string, input: ActivityInput): Promise<void> {
    if (input.opportunityId !== null) {
      await this.opportunities.requireOwn(organizationId, input.opportunityId);
    }
    if (input.contactId !== null) await this.contacts.requireOwn(organizationId, input.contactId);
    await requireCustomer(this.customers, organizationId, input.customerId);
  }

  async create(
    organizationId: string,
    input: ActivityInput,
    actor: CrmActor,
  ): Promise<ActivityView> {
    await this.checkRefs(organizationId, input);
    const now = new Date();
    const done = input.kind === 'note';
    const doc = await this.activities.create({
      organizationId,
      ...input,
      done,
      doneAt: done ? now : null,
      revision: 1,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
    });
    if (input.opportunityId !== null) {
      await this.opportunities.touch(organizationId, input.opportunityId, now);
    }
    return this.view(doc.toObject() as ActivityLean, now);
  }

  async put(
    organizationId: string,
    activityId: string,
    expectedRevision: number,
    input: ActivityInput,
    done: boolean,
    actor: CrmActor,
  ): Promise<ActivityView> {
    const current = await this.requireOwn(organizationId, activityId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    await this.checkRefs(organizationId, input);
    const now = new Date();
    const isDone = input.kind === 'note' ? true : done;
    const doneAt = isDone ? (current.done ? current.doneAt : now) : null;
    const updated = await this.activities
      .findOneAndUpdate(
        { _id: current._id, organizationId, revision: expectedRevision },
        {
          $set: { ...input, done: isDone, doneAt, updatedBy: actor.userId },
          $inc: { revision: 1 },
        },
        { new: true },
      )
      .lean<ActivityLean>()
      .exec();
    if (!updated) staleRevision((await this.requireOwn(organizationId, activityId)).revision);
    if (isDone && !current.done && input.opportunityId !== null) {
      await this.opportunities.touch(organizationId, input.opportunityId, now);
    }
    return this.view(updated, now);
  }

  /** Marque l'activité faite (idempotent). */
  async complete(
    organizationId: string,
    activityId: string,
    expectedRevision: number,
    actor: CrmActor,
  ): Promise<ActivityView> {
    const current = await this.requireOwn(organizationId, activityId);
    const now = new Date();
    if (current.done) return this.view(current, now);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    const updated = await this.activities
      .findOneAndUpdate(
        { _id: current._id, organizationId, revision: expectedRevision },
        { $set: { done: true, doneAt: now, updatedBy: actor.userId }, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<ActivityLean>()
      .exec();
    if (!updated) staleRevision((await this.requireOwn(organizationId, activityId)).revision);
    if (current.opportunityId) {
      await this.opportunities.touch(organizationId, current.opportunityId, now);
    }
    return this.view(updated, now);
  }

  async remove(organizationId: string, activityId: string, actor: CrmActor): Promise<void> {
    const current = await this.requireOwn(organizationId, activityId);
    await this.activities.deleteOne({ _id: current._id, organizationId }).exec();
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'crm_activity.deleted',
      targetType: 'crm_activity',
      targetId: activityId,
    });
  }
}
