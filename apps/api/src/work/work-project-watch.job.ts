// Veille des projets — ADR-0061 § 2 et § 3.
//
// Tâche récurrente `work.project-watch` (toutes les heures, à partir de 7 h à Kinshasa) :
//
//   1. « Projet passé à risque » : santé recalculée par la RÈGLE UNIQUE de l'accueil et
//      de l'Aperçu (`projectHealth`, ADR-0058). À l'ENTRÉE dans `at_risk` ou `late`, le
//      responsable et les membres (directs et équipes) sont notifiés — préférences et
//      visibilité appliquées par `WorkNotifier`. `healthAlert` retient l'état signalé :
//      rejouer la tâche ne renvoie rien ; redevenir sain réarme l'alerte.
//   2. Archivage automatique : un projet `completed` depuis plus de N jours
//      (`autoArchiveCompletedDays` des réglages ; `null` : jamais) est archivé, avec
//      son historique (`project.archived`, auteur `system`).

import { kinshasaDayOf, projectHealth } from '@lalanda/shared/work';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import { SchedulerService } from '../scheduler/scheduler.service.js';
import { HR_TEAMS_COLLECTION } from './work-access.service.js';
import { WorkActivityService } from './work-activity.service.js';
import { WorkNotifier } from './work-notifier.js';
import { kinshasaHour } from './work-reminders.job.js';
import { WorkSettingsService } from './work-settings.service.js';
import {
  WorkProject,
  WorkTask,
  type WorkProjectDocument,
  type WorkProjectLean,
  type WorkTaskDocument,
} from './work.schemas.js';

export const WORK_PROJECT_WATCH_JOB = 'work.project-watch';
export const WORK_PROJECT_WATCH_EVERY_MS = 60 * 60_000;
export const WORK_PROJECT_WATCH_HOUR = 7;
/** Acteur de l'historique pour un geste automatique. */
export const SYSTEM_ACTOR = 'system';
const DAY_MS = 86_400_000;

export interface ProjectWatchReport {
  alerted: number;
  archived: number;
}

interface Counters {
  _id: string;
  open: number;
  done: number;
  overdue: number;
}

@Injectable()
export class WorkProjectWatchJob implements OnModuleInit {
  private readonly logger = new Logger('WorkVeille');

  constructor(
    @InjectModel(WorkProject.name) private readonly projects: Model<WorkProjectDocument>,
    @InjectModel(WorkTask.name) private readonly tasks: Model<WorkTaskDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(WorkSettingsService) private readonly settings: WorkSettingsService,
    @Inject(WorkActivityService) private readonly activity: WorkActivityService,
    @Inject(WorkNotifier) private readonly notifier: WorkNotifier,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
  ) {}

  onModuleInit(): void {
    this.scheduler.every(WORK_PROJECT_WATCH_JOB, WORK_PROJECT_WATCH_EVERY_MS, async (_p, ctx) => {
      await this.run(ctx.now);
    });
  }

  async run(now: Date = new Date(), force = false): Promise<ProjectWatchReport> {
    const report: ProjectWatchReport = { alerted: 0, archived: 0 };
    if (!force && kinshasaHour(now) < WORK_PROJECT_WATCH_HOUR) return report;
    report.archived = await this.autoArchive(now);
    report.alerted = await this.healthAlerts(now);
    if (report.alerted + report.archived > 0) {
      this.logger.log(
        `Veille des projets : ${report.alerted} alerte(s), ${report.archived} archivé(s).`,
      );
    }
    return report;
  }

  /** Archivage automatique des projets terminés depuis N jours. */
  async autoArchive(now: Date): Promise<number> {
    const orgs = (await this.projects
      .distinct('organizationId', { status: 'completed', completedAt: { $ne: null } })
      .exec()) as string[];
    if (orgs.length === 0) return 0;
    const behaviors = await this.settings.behaviorsOf(orgs);
    let archived = 0;
    for (const organizationId of orgs) {
      const days = behaviors.get(organizationId)?.autoArchiveCompletedDays ?? null;
      if (days === null) continue;
      const limit = new Date(now.getTime() - days * DAY_MS);
      const due = await this.projects
        .find(
          { organizationId, status: 'completed', completedAt: { $ne: null, $lte: limit } },
          { _id: 1 },
        )
        .lean<{ _id: unknown }[]>()
        .exec();
      for (const p of due) {
        const res = await this.projects
          .updateOne(
            { _id: p._id, organizationId, status: 'completed' },
            {
              $set: { status: 'archived', archivedAt: now, updatedBy: SYSTEM_ACTOR },
              $inc: { revision: 1 },
            },
          )
          .exec();
        if (res.modifiedCount !== 1) continue;
        archived += 1;
        await this.activity.record(organizationId, {
          projectId: String(p._id),
          actorUserId: SYSTEM_ACTOR,
          kind: 'project.archived',
          data: { from: 'completed', to: 'archived', automatic: true, afterDays: days },
        });
      }
    }
    return archived;
  }

  /** Alertes « projet passé à risque » (entrée dans `at_risk` ou `late`). */
  async healthAlerts(now: Date): Promise<number> {
    const today = kinshasaDayOf(now);
    const projects = await this.projects
      .find({ status: { $in: ['active', 'on_hold'] } })
      .lean<WorkProjectLean[]>()
      .exec();
    if (projects.length === 0) return 0;
    const counters = await this.tasks
      .aggregate<Counters>([
        { $match: { projectId: { $in: projects.map((p) => String(p._id)) } } },
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
      .exec();
    const byId = new Map(counters.map((c) => [c._id, c]));
    let alerted = 0;
    for (const p of projects) {
      const id = String(p._id);
      const c = byId.get(id);
      const health = projectHealth(
        {
          status: p.status,
          dueDate: p.dueDate ?? null,
          openTaskCount: c?.open ?? 0,
          doneTaskCount: c?.done ?? 0,
          overdueTaskCount: c?.overdue ?? 0,
          overdueMilestoneCount: 0,
        },
        today,
      );
      const alert = health === 'at_risk' || health === 'late' ? health : null;
      const previous = p.healthAlert ?? null;
      if (alert === previous) continue;
      // Réclamer d'abord : deux passages concurrents ne notifient qu'une fois.
      const claim = await this.projects
        .updateOne(
          { _id: p._id, organizationId: p.organizationId, healthAlert: previous },
          { $set: { healthAlert: alert } },
          { timestamps: false },
        )
        .exec();
      if (claim.modifiedCount !== 1 || alert === null) continue;
      // `late` après `at_risk` est une aggravation : on la signale aussi.
      const recipients = await this.membersOf(p);
      await this.notifier.projectEvent({
        organizationId: p.organizationId,
        recipients,
        kind: 'work.project_at_risk',
        projectId: id,
        title:
          alert === 'late'
            ? `Projet en retard : ${p.name}`
            : `Projet à risque : ${p.name}`,
        actorUserId: null,
        dedupeKey: `work.project_at_risk:${id}:${alert}:${today}`,
      });
      alerted += 1;
    }
    return alerted;
  }

  /** Responsable, membres directs et membres courants des équipes du projet. */
  private async membersOf(p: WorkProjectLean): Promise<string[]> {
    const ids = new Set<string>(p.memberUserIds ?? []);
    if (p.ownerUserId) ids.add(p.ownerUserId);
    const teamIds = p.memberTeamIds ?? [];
    if (teamIds.length > 0) {
      const teams = await this.connection
        .collection(HR_TEAMS_COLLECTION)
        .find(
          {
            organizationId: p.organizationId,
            _id: { $in: teamIds.filter((t) => Types.ObjectId.isValid(t)).map((t) => new Types.ObjectId(t)) },
          },
          { projection: { leadUserId: 1, memberUserIds: 1 } },
        )
        .toArray();
      for (const t of teams) {
        for (const u of (t['memberUserIds'] as string[] | undefined) ?? []) ids.add(u);
        if (typeof t['leadUserId'] === 'string') ids.add(t['leadUserId']);
      }
    }
    return [...ids];
  }
}
