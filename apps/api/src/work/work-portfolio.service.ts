// Accueil des projets (portefeuille) — ADR-0058.
//
// LECTURE SEULE de `work_projects`, `work_tasks` et `customers`. Visibilité :
// celle d'ADR-0039 (`visibility: 'organization'`) — tout détenteur de `work.read`
// voit tous les projets de son organisation ; « Mes projets » restreint aux
// projets dont l'appelant est responsable, ou assigné ou abonné d'une tâche.
//
// Les règles (santé, avancement, semaine) sont les fonctions pures de
// `@lalanda/shared/work` (portfolio.ts) : l'API ne fait que compter.

import {
  WORK_PORTFOLIO_AVATARS,
  WORK_PORTFOLIO_MAX,
  kinshasaDayOf,
  kinshasaDayStartInstant,
  kinshasaWeekStart,
  progressPercent,
  projectColor,
  projectHealth,
  type WorkMemberRef,
  type WorkPortfolioProject,
  type WorkPortfolioQuery,
  type WorkPortfolioStats,
  type WorkPortfolioView,
} from '@lalanda/shared/work';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { isWorkId, oid } from './work.common.js';
import { WorkMembersService } from './work-members.service.js';
import {
  WorkProject,
  WorkTask,
  type WorkProjectDocument,
  type WorkProjectLean,
  type WorkTaskDocument,
} from './work.schemas.js';

const CUSTOMERS = 'customers';

interface TaskCounters {
  _id: string;
  total: number;
  done: number;
  open: number;
  overdue: number;
  overdueMilestones: number;
  /** Assignés des tâches, avec leur nombre de tâches. */
  assignees: (string | null)[];
  mine: number;
}

@Injectable()
export class WorkPortfolioService {
  constructor(
    @InjectModel(WorkProject.name) private readonly projects: Model<WorkProjectDocument>,
    @InjectModel(WorkTask.name) private readonly tasks: Model<WorkTaskDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
  ) {}

  async portfolio(
    organizationId: string,
    userId: string,
    query: WorkPortfolioQuery,
    now: Date = new Date(),
  ): Promise<WorkPortfolioView> {
    const today = kinshasaDayOf(now);
    const archived = query.scope === 'archived';
    const docs = await this.projects
      .find({ organizationId, status: archived ? 'archived' : { $ne: 'archived' } })
      .sort({ updatedAt: -1, _id: -1 })
      .limit(WORK_PORTFOLIO_MAX + 1)
      .lean<WorkProjectLean[]>()
      .exec();
    const truncated = docs.length > WORK_PORTFOLIO_MAX;
    const page = docs.slice(0, WORK_PORTFOLIO_MAX);
    const ids = page.map((d) => String(d._id));

    const [counters, stats] = await Promise.all([
      this.counters(organizationId, ids, userId, today),
      this.stats(organizationId, today),
    ]);
    const countBy = new Map(counters.map((c) => [c._id, c]));

    // Membres : responsable puis assignés, par nombre de tâches décroissant.
    const memberIdsBy = new Map<string, string[]>();
    for (const d of page) {
      const id = String(d._id);
      const freq = new Map<string, number>();
      for (const a of countBy.get(id)?.assignees ?? []) {
        if (a) freq.set(a, (freq.get(a) ?? 0) + 1);
      }
      const ordered = [...freq.entries()]
        .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
        .map(([u]) => u);
      const owner = d.ownerUserId ?? null;
      memberIdsBy.set(id, owner ? [owner, ...ordered.filter((u) => u !== owner)] : ordered);
    }
    const [refs, customers] = await Promise.all([
      this.members.refs(
        [...memberIdsBy.values()].flatMap((m) => m.slice(0, WORK_PORTFOLIO_AVATARS)),
      ),
      this.customerNames(
        organizationId,
        page.map((d) => d.links?.customerId ?? null),
      ),
    ]);

    let items: WorkPortfolioProject[] = page.map((d) => {
      const id = String(d._id);
      const c = countBy.get(id);
      const memberIds = memberIdsBy.get(id) ?? [];
      const total = c?.total ?? 0;
      const done = c?.done ?? 0;
      const members: WorkMemberRef[] = memberIds
        .slice(0, WORK_PORTFOLIO_AVATARS)
        .map((u) => WorkMembersService.refOf(refs, u));
      return {
        id,
        name: d.name,
        kind: d.kind,
        status: d.status,
        color: projectColor(id),
        health: projectHealth(
          {
            status: d.status,
            dueDate: d.dueDate ?? null,
            openTaskCount: c?.open ?? 0,
            doneTaskCount: done,
            overdueTaskCount: c?.overdue ?? 0,
            overdueMilestoneCount: c?.overdueMilestones ?? 0,
          },
          today,
        ),
        customerName: d.links?.customerId ? (customers.get(d.links.customerId) ?? null) : null,
        owner: d.ownerUserId ? WorkMembersService.refOf(refs, d.ownerUserId) : null,
        dueDate: d.dueDate ?? null,
        totalTaskCount: total,
        doneTaskCount: done,
        overdueTaskCount: c?.overdue ?? 0,
        overdueMilestoneCount: c?.overdueMilestones ?? 0,
        progressPercent: progressPercent(done, total),
        members,
        memberCount: memberIds.length,
        mine: d.ownerUserId === userId || (c?.mine ?? 0) > 0,
        updatedAt: new Date(d.updatedAt).toISOString(),
      };
    });
    if (query.scope === 'mine') items = items.filter((p) => p.mine);
    return { asOf: today, scope: query.scope, stats, items, truncated };
  }

  /** Compteurs par projet, en une agrégation (index `organizationId, projectId, …`). */
  private async counters(
    organizationId: string,
    projectIds: readonly string[],
    userId: string,
    today: string,
  ): Promise<TaskCounters[]> {
    if (projectIds.length === 0) return [];
    const overdue = {
      $and: [{ $eq: ['$done', false] }, { $ne: ['$dueDate', null] }, { $lt: ['$dueDate', today] }],
    };
    return this.tasks
      .aggregate<TaskCounters>([
        { $match: { organizationId, projectId: { $in: [...projectIds] } } },
        {
          $group: {
            _id: '$projectId',
            total: { $sum: 1 },
            done: { $sum: { $cond: [{ $eq: ['$done', true] }, 1, 0] } },
            open: { $sum: { $cond: [{ $eq: ['$done', false] }, 1, 0] } },
            overdue: { $sum: { $cond: [overdue, 1, 0] } },
            overdueMilestones: {
              $sum: { $cond: [{ $and: [overdue, { $eq: ['$isMilestone', true] }] }, 1, 0] },
            },
            assignees: { $push: '$assigneeUserId' },
            mine: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $eq: ['$assigneeUserId', userId] },
                      { $in: [userId, { $ifNull: ['$followerUserIds', []] }] },
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
      .exec();
  }

  /** Chiffres de l'organisation, projets non archivés (quel que soit le filtre). */
  private async stats(organizationId: string, today: string): Promise<WorkPortfolioStats> {
    const weekStart = kinshasaWeekStart(today);
    const open = await this.projects
      .find({ organizationId, status: { $ne: 'archived' } }, { _id: 1, status: 1 })
      .lean<{ _id: unknown; status: string }[]>()
      .exec();
    const ids = open.map((p) => String(p._id));
    if (ids.length === 0) {
      return { activeProjects: 0, overdueTasks: 0, completedThisWeek: 0, weekStart };
    }
    const [overdueTasks, completedThisWeek] = await Promise.all([
      this.tasks
        .countDocuments({
          organizationId,
          projectId: { $in: ids },
          done: false,
          dueDate: { $ne: null, $lt: today },
        })
        .exec(),
      this.tasks
        .countDocuments({
          organizationId,
          projectId: { $in: ids },
          done: true,
          completedAt: { $gte: kinshasaDayStartInstant(weekStart) },
        })
        .exec(),
    ]);
    return {
      activeProjects: open.filter((p) => p.status === 'active').length,
      overdueTasks,
      completedThisWeek,
      weekStart,
    };
  }

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
}
