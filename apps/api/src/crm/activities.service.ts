// Activités : appels, réunions, notes et relances — ADR-0035 § 2.
//
// Une activité peut viser une opportunité, un contact et/ou un client de
// l'organisation. Une note est faite dès sa création et n'a pas d'échéance ;
// une relance en a toujours une. « En retard » : non faite, échéance passée.
// Créer ou terminer une activité rattachée à une opportunité met à jour son
// `lastActivityAt` (indicateur « inactive »).
//
// ADR-0040 — C4 § 2.4 et § 5 : l'activité a un ASSIGNÉ (membre détenant
// `crm.manage`, le créateur par défaut, jamais `null` pour une activité à échéance
// non faite) et un JOUR d'échéance `dueDay` (jour de Kinshasa de `dueAt`), écrit
// dans la même mise à jour. Elle entre ainsi dans « Mes tâches » de l'assigné, sa
// cloche et son brief. Assigner quelqu'un d'autre que soi le notifie, APRÈS
// l'écriture et par le port. Décocher : `reopen`.

import { crmAgendaHref } from '@lalanda/shared/crm';
import { kinshasaDayOf } from '@lalanda/shared/work';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { can, NO_OVERRIDES } from '../authz/permissions.js';
import { Customer, type CustomerDocument } from '../sales/customer.schema.js';
import { conflict, invalidCursor, invalidRequestOf, staleRevision } from '../sales/sales.errors.js';
import { WorkMembersService } from '../work/work-members.service.js';
import { isObjectIdHex } from '../sales/search.js';
import { ContactsService, requireCustomer } from './contacts.service.js';
import { ACTIVITY_KIND_LABELS, isOverdue, type ActivityKind } from './crm-model.js';
import type { CrmActor } from './crm-settings.service.js';
import type { ActivityInput, ListActivitiesQuery } from './crm.dto.js';
import { CrmNotifier } from './crm-notifier.js';
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
  // ADR-0040 — C4
  accountId: string | null;
  assigneeUserId: string | null;
  dueDay: string | null;
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
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
    @Inject(CrmNotifier) private readonly notifier: CrmNotifier,
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
      accountId: d.accountId ?? null,
      assigneeUserId: d.assigneeUserId ?? null,
      dueDay: d.dueDay ?? null,
      revision: d.revision,
      createdAt: new Date(d.createdAt).toISOString(),
      updatedAt: new Date(d.updatedAt).toISOString(),
    };
  }

  async list(
    organizationId: string,
    query: ListActivitiesQuery,
    actorUserId = '',
  ): Promise<ActivityPage> {
    const now = new Date();
    const and: Record<string, unknown>[] = [{ organizationId }];
    if (query.opportunityId) and.push({ opportunityId: query.opportunityId.toLowerCase() });
    if (query.contactId) and.push({ contactId: query.contactId.toLowerCase() });
    if (query.customerId) and.push({ customerId: query.customerId.toLowerCase() });
    if (query.status === 'open') and.push({ done: false });
    if (query.status === 'done') and.push({ done: true });
    if (query.status === 'overdue') and.push({ done: false, dueAt: { $ne: null, $lt: now } });
    // ADR-0040 — C4 § 3.5 : assigné, compte, échéance en jours de Kinshasa.
    if (query.assignee) {
      and.push({
        assigneeUserId: query.assignee === 'me' ? actorUserId : query.assignee.toLowerCase(),
      });
    }
    if (query.accountId) and.push({ accountId: query.accountId.toLowerCase() });
    if (query.dueFrom) and.push({ dueDay: { $ne: null, $gte: query.dueFrom } });
    if (query.dueTo) and.push({ dueDay: { $ne: null, $lte: query.dueTo } });
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
    const { assigneeUserId: wanted, ...fields } = input;
    const assigneeUserId = await this.resolveAssignee(
      organizationId,
      wanted === undefined ? actor.userId : wanted,
      input.dueAt,
      done,
    );
    const doc = await this.activities.create({
      organizationId,
      ...fields,
      assigneeUserId,
      dueDay: input.dueAt ? kinshasaDayOf(input.dueAt) : null,
      reminders: { dueSoonFor: null, overdueFor: null },
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
    const created = doc.toObject() as ActivityLean;
    await this.notifyAssigned(organizationId, created, null, actor);
    return this.view(created, now);
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
    const { assigneeUserId: wanted, ...fields } = input;
    const assigneeUserId = await this.resolveAssignee(
      organizationId,
      wanted === undefined ? (current.assigneeUserId ?? actor.userId) : wanted,
      input.dueAt,
      isDone,
    );
    const updated = await this.activities
      .findOneAndUpdate(
        { _id: current._id, organizationId, revision: expectedRevision },
        {
          $set: {
            ...fields,
            assigneeUserId,
            dueDay: input.dueAt ? kinshasaDayOf(input.dueAt) : null,
            done: isDone,
            doneAt,
            updatedBy: actor.userId,
          },
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
    await this.notifyAssigned(organizationId, updated, current.assigneeUserId ?? null, actor);
    return this.view(updated, now);
  }

  /**
   * Décoche une activité (ADR-0040 — C4 § 3.5, symétrie avec `work`). Idempotent
   * sur une activité non faite ; une note est toujours faite (`409`). Une
   * activité ancienne sans assigné reçoit l'auteur du geste.
   */
  async reopen(
    organizationId: string,
    activityId: string,
    expectedRevision: number,
    actor: CrmActor,
  ): Promise<ActivityView> {
    const current = await this.requireOwn(organizationId, activityId);
    const now = new Date();
    if (current.kind === 'note') {
      conflict('CRM_NOTE_ALWAYS_DONE', 'Une note est toujours faite : elle ne se rouvre pas.');
    }
    if (!current.done) return this.view(current, now);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    const set: Record<string, unknown> = { done: false, doneAt: null, updatedBy: actor.userId };
    if (!current.assigneeUserId && current.dueAt) set['assigneeUserId'] = actor.userId;
    if (current.dueAt && !current.dueDay) set['dueDay'] = kinshasaDayOf(new Date(current.dueAt));
    const updated = await this.activities
      .findOneAndUpdate(
        { _id: current._id, organizationId, revision: expectedRevision },
        { $set: set, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<ActivityLean>()
      .exec();
    if (!updated) staleRevision((await this.requireOwn(organizationId, activityId)).revision);
    return this.view(updated, now);
  }

  /**
   * Assigné retenu (ADR-0040 — C4 § 2.4) : membre de l'organisation (404 sinon,
   * identifiant forgé compris) détenant `crm.manage` (`CRM_ASSIGNEE_NOT_ELIGIBLE`) ;
   * `null` seulement pour une activité sans échéance ou faite.
   */
  private async resolveAssignee(
    organizationId: string,
    userId: string | null,
    dueAt: Date | null,
    done: boolean,
  ): Promise<string | null> {
    if (userId === null) {
      if (dueAt !== null && !done) {
        invalidRequestOf([
          {
            path: 'assigneeUserId',
            code: 'CRM_ASSIGNEE_REQUIRED',
            message: 'Une activité à échéance non faite a un assigné.',
          },
        ]);
      }
      return null;
    }
    const role = await this.members.roleOf(organizationId, userId);
    if (role === undefined) {
      throw new NotFoundException({
        code: 'CRM_MEMBER_NOT_FOUND',
        message: 'Membre introuvable dans cette organisation.',
      });
    }
    // ADR-0041 A3 : passer aux droits effectifs du membre
    if (!can(role, 'crm.manage', NO_OVERRIDES)) {
      invalidRequestOf([
        {
          path: 'assigneeUserId',
          code: 'CRM_ASSIGNEE_NOT_ELIGIBLE',
          message: 'Ce membre ne gère pas le CRM : il ne peut pas être assigné.',
        },
      ]);
    }
    return userId;
  }

  /** `crm.activity_assigned` au nouvel assigné, jamais à l'auteur du geste. */
  private async notifyAssigned(
    organizationId: string,
    activity: ActivityLean,
    previousAssignee: string | null,
    actor: CrmActor,
  ): Promise<void> {
    const assignee = activity.assigneeUserId ?? null;
    if (assignee === null || assignee === previousAssignee || activity.done) return;
    const activityId = String(activity._id);
    await this.notifier.activityEvent({
      organizationId,
      recipients: [assignee],
      kind: 'crm.activity_assigned',
      activityId,
      title: `${ACTIVITY_KIND_LABELS[activity.kind]} à faire : ${activity.subject}`,
      href: crmAgendaHref({
        activityId,
        opportunityId: activity.opportunityId ?? null,
        accountId: activity.accountId ?? null,
        contactId: activity.contactId ?? null,
      }),
      actorUserId: actor.userId,
    });
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
