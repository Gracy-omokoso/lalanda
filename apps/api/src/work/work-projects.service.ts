// Projets du RUN — ADR-0039 § 2.2, § 4 et § 6.2.
//
// Un projet est client ou interne ; ses colonnes de statut font son Kanban. Les
// références client, opportunité et devis sont LUES en lecture seule
// (`customers`, `crm_opportunities`, `sales_quotes`) par la connexion, sans
// importer les modules propriétaires (motif du CRM) : 404 si elles relèvent
// d'une autre organisation. Bornes techniques : 500 projets non archivés par
// organisation (`WORK_PROJECT_LIMIT`).

import {
  WORK_LIMITS,
  kinshasaDayOf,
  type CreateWorkProjectBody,
  type ListWorkProjectsQuery,
  type UpdateWorkProjectBody,
  type WorkColumn,
  type WorkPage,
  type WorkProjectSummary,
  type WorkProjectView,
} from '@lalanda/shared/work';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { beforeTimeCursor, decodeTimeCursor, encodeTimeCursor } from '../crm/time-cursor.js';
import { escapeRegex, normalizeForSearch, searchKeyOf } from '../sales/search.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import {
  conflict,
  invalid,
  invalidCursor,
  iso,
  isWorkId,
  notFound,
  oid,
  projectArchived,
  projectNotFound,
  staleRevision,
  type WorkActor,
} from './work.common.js';
import { WorkActivityService } from './work-activity.service.js';
import { dropAttachmentObjects } from './work-attachments.storage.js';
import { WorkMembersService } from './work-members.service.js';
import { WorkSettingsService } from './work-settings.service.js';
import {
  WorkAttachment,
  WorkComment,
  WorkProject,
  WorkTask,
  WorkTimeEntry,
  projectSourceViewOf,
  type WorkAttachmentDocument,
  type WorkAttachmentLean,
  type WorkCommentDocument,
  type WorkProjectDocument,
  type WorkProjectLean,
  type WorkTaskDocument,
  type WorkTimeEntryDocument,
} from './work.schemas.js';

/** Collections d'autres modules lues en lecture seule. */
const CUSTOMERS = 'customers';
const OPPORTUNITIES = 'crm_opportunities';
const QUOTES = 'sales_quotes';
/** Lot L4a (`work/billing/**`) — lu pour refuser une suppression. */
const INVOICE_LINKS = 'work_invoice_links';
/** ADR-0034, champ `workProjectId` posé par le lot L4a — lu pour refuser une suppression. */
const EXPENSES = 'treasury_expenses';

interface Counters {
  open: number;
  done: number;
  overdue: number;
}

@Injectable()
export class WorkProjectsService {
  private readonly logger = new Logger('WorkProjects');

  constructor(
    @InjectModel(WorkProject.name) private readonly projects: Model<WorkProjectDocument>,
    @InjectModel(WorkTask.name) private readonly tasks: Model<WorkTaskDocument>,
    @InjectModel(WorkComment.name) private readonly comments: Model<WorkCommentDocument>,
    @InjectModel(WorkAttachment.name) private readonly attachments: Model<WorkAttachmentDocument>,
    @InjectModel(WorkTimeEntry.name) private readonly time: Model<WorkTimeEntryDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
    @Inject(WorkSettingsService) private readonly settings: WorkSettingsService,
    @Inject(WorkActivityService) private readonly activity: WorkActivityService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ObjectStorageService) private readonly storage: ObjectStorageService,
  ) {}

  // ── Lecture ──────────────────────────────────────────────────────────────

  async requireOwn(organizationId: string, projectId: string): Promise<WorkProjectLean> {
    if (!isWorkId(projectId)) projectNotFound();
    const doc = await this.projects
      .findOne({ _id: oid(projectId), organizationId })
      .lean<WorkProjectLean>()
      .exec();
    if (!doc) projectNotFound();
    return doc;
  }

  /** Projet de l'organisation, non archivé (toute écriture sur ses tâches). */
  async requireWritable(organizationId: string, projectId: string): Promise<WorkProjectLean> {
    const doc = await this.requireOwn(organizationId, projectId);
    if (doc.status === 'archived') projectArchived();
    return doc;
  }

  /** Identifiants des projets archivés de l'organisation (exclus de « Mes tâches »). */
  async archivedIds(organizationId: string): Promise<string[]> {
    const docs = await this.projects
      .find({ organizationId, status: 'archived' }, { _id: 1 })
      .lean<{ _id: unknown }[]>()
      .exec();
    return docs.map((d) => String(d._id));
  }

  /** Noms des projets, par identifiant. */
  async namesOf(organizationId: string, ids: readonly string[]): Promise<Map<string, string>> {
    const valid = [...new Set(ids.filter(isWorkId))];
    if (valid.length === 0) return new Map();
    const docs = await this.projects
      .find({ organizationId, _id: { $in: valid.map(oid) } }, { name: 1 })
      .lean<{ _id: unknown; name: string }[]>()
      .exec();
    return new Map(docs.map((d) => [String(d._id), d.name]));
  }

  async list(
    organizationId: string,
    query: ListWorkProjectsQuery,
  ): Promise<WorkPage<WorkProjectSummary>> {
    const and: Record<string, unknown>[] = [{ organizationId }];
    and.push(query.status ? { status: query.status } : { status: { $ne: 'archived' } });
    if (query.kind) and.push({ kind: query.kind });
    if (query.customerId) and.push({ 'links.customerId': query.customerId });
    if (query.opportunityId) and.push({ 'links.opportunityId': query.opportunityId });
    if (query.q !== undefined) {
      const term = normalizeForSearch(query.q);
      if (term !== '') and.push({ searchKey: { $regex: escapeRegex(term) } });
    }
    if (query.cursor !== undefined) {
      const cursor = decodeTimeCursor(query.cursor);
      if (cursor === null) invalidCursor();
      and.push(beforeTimeCursor('updatedAt', cursor));
    }
    const docs = await this.projects
      .find({ $and: and })
      .sort({ updatedAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean<WorkProjectLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: await this.summaries(organizationId, page),
      nextCursor:
        docs.length > query.limit && last
          ? encodeTimeCursor(new Date(last.updatedAt), String(last._id))
          : null,
    };
  }

  private async summaries(
    organizationId: string,
    docs: readonly WorkProjectLean[],
  ): Promise<WorkProjectSummary[]> {
    if (docs.length === 0) return [];
    const ids = docs.map((d) => String(d._id));
    const today = kinshasaDayOf(new Date());
    const [counters, milestones, owners, customers] = await Promise.all([
      this.tasks
        .aggregate<{ _id: string } & Counters>([
          { $match: { organizationId, projectId: { $in: ids } } },
          {
            $group: {
              _id: '$projectId',
              open: { $sum: { $cond: [{ $eq: ['$done', false] }, 1, 0] } },
              done: { $sum: { $cond: [{ $eq: ['$done', true] }, 1, 0] } },
              overdue: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$done', false] },
                        { $ne: ['$dueDate', null] },
                        { $lt: ['$dueDate', today] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ])
        .exec(),
      this.tasks
        .aggregate<{ _id: string; taskId: unknown; title: string; dueDate: string }>([
          {
            $match: {
              organizationId,
              projectId: { $in: ids },
              isMilestone: true,
              done: false,
              dueDate: { $ne: null },
            },
          },
          { $sort: { dueDate: 1, number: 1 } },
          {
            $group: {
              _id: '$projectId',
              taskId: { $first: '$_id' },
              title: { $first: '$title' },
              dueDate: { $first: '$dueDate' },
            },
          },
        ])
        .exec(),
      this.members.refs(docs.map((d) => d.ownerUserId)),
      this.customerNames(
        organizationId,
        docs.map((d) => d.links?.customerId ?? null),
      ),
    ]);
    const countBy = new Map(counters.map((c) => [c._id, c]));
    const milestoneBy = new Map(milestones.map((m) => [m._id, m]));
    return docs.map((d) => {
      const id = String(d._id);
      const c = countBy.get(id);
      const m = milestoneBy.get(id);
      return {
        id,
        name: d.name,
        kind: d.kind,
        status: d.status,
        owner: d.ownerUserId ? WorkMembersService.refOf(owners, d.ownerUserId) : null,
        customerName: d.links?.customerId ? (customers.get(d.links.customerId) ?? null) : null,
        startDate: d.startDate ?? null,
        dueDate: d.dueDate ?? null,
        openTaskCount: c?.open ?? 0,
        overdueTaskCount: c?.overdue ?? 0,
        doneTaskCount: c?.done ?? 0,
        nextMilestone: m ? { taskId: String(m.taskId), title: m.title, dueDate: m.dueDate } : null,
        updatedAt: new Date(d.updatedAt).toISOString(),
      };
    });
  }

  async get(organizationId: string, projectId: string): Promise<WorkProjectView> {
    return this.view(organizationId, await this.requireOwn(organizationId, projectId));
  }

  async view(organizationId: string, d: WorkProjectLean): Promise<WorkProjectView> {
    const links = d.links ?? { customerId: null, opportunityId: null, quoteIds: [] };
    const [owners, customers, opportunity, quotes] = await Promise.all([
      this.members.refs([d.ownerUserId]),
      this.customerNames(organizationId, [links.customerId]),
      links.opportunityId ? this.opportunityTitle(organizationId, links.opportunityId) : null,
      this.quoteNumbers(organizationId, links.quoteIds ?? []),
    ]);
    return {
      id: String(d._id),
      name: d.name,
      description: d.description ?? null,
      kind: d.kind,
      status: d.status,
      owner: d.ownerUserId ? WorkMembersService.refOf(owners, d.ownerUserId) : null,
      startDate: d.startDate ?? null,
      dueDate: d.dueDate ?? null,
      links: {
        customerId: links.customerId ?? null,
        customerName: links.customerId ? (customers.get(links.customerId) ?? null) : null,
        opportunityId: links.opportunityId ?? null,
        opportunityTitle: opportunity,
        quotes: (links.quoteIds ?? []).map((q) => ({ quoteId: q, number: quotes.get(q) ?? null })),
      },
      // ADR-0040 — C7 : origine devis ou opportunité.
      source: projectSourceViewOf(d.source),
      columns: d.columns.map((c) => ({ key: c.key, label: c.label, category: c.category })),
      visibility: 'organization',
      archivedAt: iso(d.archivedAt),
      completedAt: iso(d.completedAt),
      revision: d.revision,
      createdBy: d.createdBy,
      updatedBy: d.updatedBy,
      createdAt: new Date(d.createdAt).toISOString(),
      updatedAt: new Date(d.updatedAt).toISOString(),
    };
  }

  // ── Références d'autres modules (lecture seule) ──────────────────────────

  private async customerNames(
    organizationId: string,
    ids: readonly (string | null)[],
  ): Promise<Map<string, string>> {
    const valid = [...new Set(ids.filter(isWorkId))];
    if (valid.length === 0) return new Map();
    const docs = await this.connection
      .collection(CUSTOMERS)
      .find({ _id: { $in: valid.map(oid) }, organizationId }, { projection: { name: 1 } })
      .toArray();
    return new Map(docs.map((d) => [String(d['_id']), String(d['name'] ?? '')]));
  }

  private async opportunityTitle(organizationId: string, id: string): Promise<string | null> {
    if (!isWorkId(id)) return null;
    const doc = await this.connection
      .collection(OPPORTUNITIES)
      .findOne({ _id: oid(id), organizationId }, { projection: { title: 1 } });
    return doc ? String(doc['title'] ?? '') : null;
  }

  private async quoteNumbers(
    organizationId: string,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    const valid = [...new Set(ids.filter(isWorkId))];
    if (valid.length === 0) return new Map();
    const docs = await this.connection
      .collection(QUOTES)
      .find({ _id: { $in: valid.map(oid) }, organizationId }, { projection: { number: 1 } })
      .toArray();
    return new Map(docs.map((d) => [String(d['_id']), String(d['number'] ?? '')]));
  }

  /** Références client, opportunité, devis : 404 si l'une n'est pas de l'organisation. */
  private async checkLinks(
    organizationId: string,
    links: { customerId: string | null; opportunityId: string | null; quoteIds: string[] },
  ): Promise<void> {
    if (links.customerId !== null) {
      const ok = await this.connection
        .collection(CUSTOMERS)
        .countDocuments({ _id: oid(links.customerId), organizationId }, { limit: 1 });
      if (ok === 0) notFound('CUSTOMER_NOT_FOUND', 'Client introuvable.');
    }
    if (links.opportunityId !== null) {
      const ok = await this.connection
        .collection(OPPORTUNITIES)
        .countDocuments({ _id: oid(links.opportunityId), organizationId }, { limit: 1 });
      if (ok === 0) notFound('CRM_OPPORTUNITY_NOT_FOUND', 'Opportunité introuvable.');
    }
    if (links.quoteIds.length > 0) {
      const found = await this.connection
        .collection(QUOTES)
        .countDocuments({ _id: { $in: links.quoteIds.map(oid) }, organizationId });
      if (found !== links.quoteIds.length) notFound('QUOTE_NOT_FOUND', 'Devis introuvable.');
    }
  }

  // ── Écriture ─────────────────────────────────────────────────────────────

  private async assertLimit(organizationId: string): Promise<void> {
    const active = await this.projects
      .countDocuments({ organizationId, status: { $ne: 'archived' } })
      .exec();
    if (active >= WORK_LIMITS.activeProjectsPerOrganization) {
      conflict(
        'WORK_PROJECT_LIMIT',
        `Une organisation compte au plus ${WORK_LIMITS.activeProjectsPerOrganization} projets non archivés : archivez-en un.`,
        { limit: WORK_LIMITS.activeProjectsPerOrganization },
      );
    }
  }

  async create(
    organizationId: string,
    body: CreateWorkProjectBody,
    actor: WorkActor,
  ): Promise<WorkProjectView> {
    await this.assertLimit(organizationId);
    const ownerUserId = body.ownerUserId ?? null;
    if (ownerUserId) {
      await this.members.requireEligible(
        organizationId,
        [ownerUserId],
        'work.update',
        'WORK_ASSIGNEE_NOT_ELIGIBLE',
        'ownerUserId',
      );
    }
    const links = {
      customerId: body.links?.customerId ?? null,
      opportunityId: body.links?.opportunityId ?? null,
      quoteIds: body.links?.quoteIds ?? [],
    };
    await this.checkLinks(organizationId, links);
    const columns = body.columns ?? (await this.settings.get(organizationId)).defaultColumns;
    const created = await this.projects.create({
      organizationId,
      name: body.name,
      description: body.description ?? null,
      kind: body.kind,
      status: 'active',
      ownerUserId,
      startDate: body.startDate ?? null,
      dueDate: body.dueDate ?? null,
      links,
      source: null,
      columns,
      visibility: 'organization',
      taskSeq: 0,
      searchKey: searchKeyOf([body.name]),
      revision: 1,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
    });
    const projectId = String(created._id);
    await this.activity.record(organizationId, {
      projectId,
      actorUserId: actor.userId,
      kind: 'project.created',
      data: { name: body.name, kind: body.kind },
    });
    return this.get(organizationId, projectId);
  }

  async update(
    organizationId: string,
    projectId: string,
    body: UpdateWorkProjectBody,
    actor: WorkActor,
  ): Promise<WorkProjectView> {
    const current = await this.requireOwn(organizationId, projectId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    if (current.status === 'archived') projectArchived();

    const set: Record<string, unknown> = { updatedBy: actor.userId };
    const changed: string[] = [];
    const assign = (field: string, value: unknown): void => {
      set[field] = value;
      changed.push(field);
    };
    if (body.name !== undefined) {
      assign('name', body.name);
      set['searchKey'] = searchKeyOf([body.name]);
    }
    if (body.description !== undefined) assign('description', body.description);
    if (body.kind !== undefined) assign('kind', body.kind);
    if (body.ownerUserId !== undefined) {
      if (body.ownerUserId !== null) {
        await this.members.requireEligible(
          organizationId,
          [body.ownerUserId],
          'work.update',
          'WORK_ASSIGNEE_NOT_ELIGIBLE',
          'ownerUserId',
        );
      }
      assign('ownerUserId', body.ownerUserId);
    }
    const startDate = body.startDate !== undefined ? body.startDate : current.startDate;
    const dueDate = body.dueDate !== undefined ? body.dueDate : current.dueDate;
    if (startDate && dueDate && dueDate < startDate) {
      invalid('dueDate', 'WORK_DATES_INVERTED', 'L’échéance précède la date de début.');
    }
    if (body.startDate !== undefined) assign('startDate', body.startDate);
    if (body.dueDate !== undefined) assign('dueDate', body.dueDate);
    if (body.links !== undefined) {
      const links = {
        customerId:
          body.links.customerId !== undefined
            ? body.links.customerId
            : (current.links?.customerId ?? null),
        opportunityId:
          body.links.opportunityId !== undefined
            ? body.links.opportunityId
            : (current.links?.opportunityId ?? null),
        quoteIds: body.links.quoteIds ?? current.links?.quoteIds ?? [],
      };
      await this.checkLinks(organizationId, links);
      assign('links', links);
    }
    if (body.columns !== undefined) {
      await this.checkColumnChange(organizationId, projectId, current.columns, body.columns);
      assign('columns', body.columns);
    }
    let statusKind: 'project.completed' | null = null;
    if (body.status !== undefined && body.status !== current.status) {
      assign('status', body.status);
      set['completedAt'] = body.status === 'completed' ? new Date() : null;
      if (body.status === 'completed') statusKind = 'project.completed';
    }

    const res = await this.projects
      .updateOne(
        { _id: current._id, organizationId, revision: body.expectedRevision },
        { $set: set, $inc: { revision: 1 } },
      )
      .exec();
    if (res.matchedCount !== 1) {
      staleRevision((await this.requireOwn(organizationId, projectId)).revision);
    }
    if (changed.length > 0) {
      await this.activity.record(organizationId, {
        projectId,
        actorUserId: actor.userId,
        kind: statusKind ?? 'project.updated',
        data: {
          fields: changed,
          ...(body.status !== undefined && body.status !== current.status
            ? { from: current.status, to: body.status }
            : {}),
        },
      });
    }
    return this.get(organizationId, projectId);
  }

  /** Retirer une colonne qui porte des tâches, ou changer sa catégorie : refusé. */
  private async checkColumnChange(
    organizationId: string,
    projectId: string,
    before: readonly WorkColumn[],
    after: readonly WorkColumn[],
  ): Promise<void> {
    const next = new Map(after.map((c) => [c.key, c]));
    for (const col of before) {
      const replacement = next.get(col.key);
      if (replacement && replacement.category === col.category) continue;
      const count = await this.tasks
        .countDocuments({ organizationId, projectId, columnKey: col.key })
        .exec();
      if (count === 0) continue;
      if (!replacement) {
        conflict(
          'WORK_COLUMN_IN_USE',
          `La colonne « ${col.label} » porte ${count} tâche(s) : déplacez-les avant de la retirer.`,
          { columnKey: col.key, taskCount: count },
        );
      }
      conflict(
        'WORK_COLUMN_CATEGORY_CHANGED',
        `La colonne « ${col.label} » porte ${count} tâche(s) : sa catégorie ne change plus.`,
        { columnKey: col.key, taskCount: count },
      );
    }
  }

  async archive(
    organizationId: string,
    projectId: string,
    expectedRevision: number,
    actor: WorkActor,
  ): Promise<WorkProjectView> {
    const current = await this.requireOwn(organizationId, projectId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    if (current.status === 'archived') return this.view(organizationId, current);
    await this.setStatus(current, expectedRevision, {
      status: 'archived',
      archivedAt: new Date(),
      updatedBy: actor.userId,
    });
    await this.activity.record(organizationId, {
      projectId,
      actorUserId: actor.userId,
      kind: 'project.archived',
      data: { from: current.status, to: 'archived' },
    });
    return this.get(organizationId, projectId);
  }

  /** Restaurer : le projet redevient actif (ou terminé s'il l'était), dans la borne des 500. */
  async restore(
    organizationId: string,
    projectId: string,
    expectedRevision: number,
    actor: WorkActor,
  ): Promise<WorkProjectView> {
    const current = await this.requireOwn(organizationId, projectId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    if (current.status !== 'archived') return this.view(organizationId, current);
    await this.assertLimit(organizationId);
    const to = current.completedAt ? 'completed' : 'active';
    await this.setStatus(current, expectedRevision, {
      status: to,
      archivedAt: null,
      updatedBy: actor.userId,
    });
    await this.activity.record(organizationId, {
      projectId,
      actorUserId: actor.userId,
      kind: 'project.restored',
      data: { from: 'archived', to },
    });
    return this.get(organizationId, projectId);
  }

  private async setStatus(
    current: WorkProjectLean,
    expectedRevision: number,
    set: Record<string, unknown>,
  ): Promise<void> {
    const res = await this.projects
      .updateOne(
        { _id: current._id, organizationId: current.organizationId, revision: expectedRevision },
        { $set: set, $inc: { revision: 1 } },
      )
      .exec();
    if (res.matchedCount !== 1) {
      staleRevision((await this.requireOwn(current.organizationId, String(current._id))).revision);
    }
  }

  /**
   * Suppression : refusée si du temps est saisi, si une facture est liée ou si une
   * dépense est rattachée (`409 WORK_PROJECT_NOT_EMPTY` : archiver). Sinon tout
   * le contenu du projet part avec lui ; l'acte est journalisé dans `audit_events`.
   */
  async remove(organizationId: string, projectId: string, actor: WorkActor): Promise<void> {
    const current = await this.requireOwn(organizationId, projectId);
    const [timeEntries, invoices, expenses] = await Promise.all([
      this.time.countDocuments({ organizationId, projectId, deletedAt: null }).exec(),
      this.connection.collection(INVOICE_LINKS).countDocuments({ organizationId, projectId }),
      this.connection
        .collection(EXPENSES)
        .countDocuments({ organizationId, workProjectId: projectId }),
    ]);
    if (timeEntries + invoices + expenses > 0) {
      conflict(
        'WORK_PROJECT_NOT_EMPTY',
        'Ce projet porte du temps saisi, une facture liée ou une dépense rattachée : archivez-le plutôt.',
        { timeEntries, invoices, expenses },
      );
    }
    const attachments = await this.attachments
      .find({ organizationId, projectId, deletedAt: null }, { objectId: 1 })
      .lean<WorkAttachmentLean[]>()
      .exec();
    await this.projects.deleteOne({ _id: current._id, organizationId }).exec();
    await Promise.all([
      this.tasks.deleteMany({ organizationId, projectId }).exec(),
      this.comments.deleteMany({ organizationId, projectId }).exec(),
      this.attachments.deleteMany({ organizationId, projectId }).exec(),
      this.time.deleteMany({ organizationId, projectId }).exec(),
      this.activity.purgeProject(organizationId, projectId),
    ]);
    await dropAttachmentObjects(
      this.storage,
      attachments.map((a) => a.objectId),
      this.logger,
    );
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role ?? 'unknown',
      action: 'work.project.deleted',
      targetType: 'work_project',
      targetId: projectId,
      metadata: { name: current.name.slice(0, 120) },
    });
  }

  /** Numéro de tâche suivant (`$inc` atomique, jamais réutilisé). */
  async nextTaskNumber(organizationId: string, projectId: string): Promise<number> {
    const doc = await this.projects
      .findOneAndUpdate(
        { _id: oid(projectId), organizationId },
        { $inc: { taskSeq: 1 } },
        { new: true, projection: { taskSeq: 1 }, timestamps: false },
      )
      .lean<{ taskSeq: number }>()
      .exec();
    if (!doc) projectNotFound();
    return doc.taskSeq;
  }

  /** Une activité a eu lieu sur le projet : il remonte dans la liste. */
  async touch(organizationId: string, projectId: string): Promise<void> {
    await this.projects
      .updateOne({ _id: oid(projectId), organizationId }, { $set: { updatedAt: new Date() } })
      .exec();
  }
}
