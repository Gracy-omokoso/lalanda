// Rappels d'échéance — ADR-0039 § 6.6.
//
// Tâche récurrente `work.due-reminders` de l'ordonnanceur (ADR-0020), toutes les
// 15 minutes, active à partir de 7 h à Kinshasa (alignée sur le brief du matin),
// 500 tâches au plus par passage :
//
//   - `work.task_due_soon` : tâche non terminée dont l'échéance tombe dans
//     [aujourd'hui, aujourd'hui + dueSoonDays] (réglage de l'organisation) ;
//   - `work.task_overdue`  : tâche non terminée dont l'échéance est dépassée.
//
// Destinataire : le responsable, s'il est encore membre et détient `work.read`.
// Une seule émission par (tâche, échéance, type) : la tâche est d'abord
// « réclamée » par une écriture conditionnelle (`reminders.<type>For`), puis la
// notification part avec `dedupeKey = <type>:<taskId>:<dueDate>`. Rejouer la
// tâche ne crée donc pas de doublon ; changer l'échéance rouvre le rappel. Les
// tâches des projets archivés sont ignorées.

import { WORK_LIMITS, addDays, kinshasaDayOf } from '@lalanda/shared/work';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { can } from '../authz/permissions.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { WorkMembersService } from './work-members.service.js';
import { WorkNotifier } from './work-notifier.js';
import { WorkProjectsService } from './work-projects.service.js';
import { WorkSettingsService } from './work-settings.service.js';
import { WorkTask, type WorkTaskDocument, type WorkTaskLean } from './work.schemas.js';

export const WORK_DUE_REMINDERS_JOB = 'work.due-reminders';
export const WORK_DUE_REMINDERS_EVERY_MS = 15 * 60_000;
/** Heure de Kinshasa à partir de laquelle les rappels partent. */
export const WORK_DUE_REMINDERS_HOUR = 7;
/** Tâches au plus par passage. */
export const WORK_DUE_REMINDERS_BATCH = 500;

export interface DueRemindersReport {
  claimed: number;
  notified: number;
  skipped: number;
}

type Kind = 'work.task_due_soon' | 'work.task_overdue';

/** Heure civile de Kinshasa (UTC+1, sans heure d'été). */
export function kinshasaHour(now: Date): number {
  return new Date(now.getTime() + 3_600_000).getUTCHours();
}

@Injectable()
export class WorkDueRemindersJob implements OnModuleInit {
  private readonly logger = new Logger('WorkRappels');

  constructor(
    @InjectModel(WorkTask.name) private readonly tasks: Model<WorkTaskDocument>,
    @Inject(WorkSettingsService) private readonly settings: WorkSettingsService,
    @Inject(WorkProjectsService) private readonly projects: WorkProjectsService,
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
    @Inject(WorkNotifier) private readonly notifier: WorkNotifier,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
  ) {}

  onModuleInit(): void {
    this.scheduler.every(WORK_DUE_REMINDERS_JOB, WORK_DUE_REMINDERS_EVERY_MS, async (_p, ctx) => {
      await this.run(ctx.now);
    });
  }

  async run(now: Date = new Date()): Promise<DueRemindersReport> {
    const report: DueRemindersReport = { claimed: 0, notified: 0, skipped: 0 };
    if (kinshasaHour(now) < WORK_DUE_REMINDERS_HOUR) return report;
    const today = kinshasaDayOf(now);
    const horizon = addDays(today, WORK_LIMITS.dueSoonDaysMax);
    const pending = (soonEnd: string) => ({
      done: false,
      assigneeUserId: { $ne: null },
      $or: [
        {
          dueDate: { $ne: null, $lt: today },
          $expr: { $ne: ['$reminders.overdueFor', '$dueDate'] },
        },
        {
          dueDate: { $gte: today, $lte: soonEnd },
          $expr: { $ne: ['$reminders.dueSoonFor', '$dueDate'] },
        },
      ],
    });

    const orgs = (await this.tasks.distinct('organizationId', pending(horizon)).exec()) as string[];
    const dueSoon = await this.settings.dueSoonDaysOf(orgs);
    for (const organizationId of orgs) {
      if (report.claimed >= WORK_DUE_REMINDERS_BATCH) break;
      const archived = await this.projects.archivedIds(organizationId);
      const soonEnd = addDays(today, dueSoon.get(organizationId) ?? WORK_LIMITS.dueSoonDaysDefault);
      const docs = await this.tasks
        .find(
          {
            organizationId,
            ...pending(soonEnd),
            ...(archived.length > 0 ? { projectId: { $nin: archived } } : {}),
          },
          { projectId: 1, number: 1, title: 1, assigneeUserId: 1, dueDate: 1, reminders: 1 },
        )
        .sort({ dueDate: 1, _id: 1 })
        .limit(WORK_DUE_REMINDERS_BATCH - report.claimed)
        .lean<WorkTaskLean[]>()
        .exec();
      if (docs.length === 0) continue;
      const roles = await this.members.roles(
        organizationId,
        docs.map((d) => d.assigneeUserId!),
      );
      for (const task of docs) {
        const kind: Kind = task.dueDate! < today ? 'work.task_overdue' : 'work.task_due_soon';
        const field = kind === 'work.task_overdue' ? 'overdueFor' : 'dueSoonFor';
        // Réclamer d'abord : deux passages concurrents ne servent jamais deux fois.
        const claim = await this.tasks
          .updateOne(
            {
              _id: task._id,
              organizationId,
              done: false,
              dueDate: task.dueDate,
              [`reminders.${field}`]: { $ne: task.dueDate },
            },
            { $set: { [`reminders.${field}`]: task.dueDate } },
            { timestamps: false },
          )
          .exec();
        if (claim.modifiedCount !== 1) continue;
        report.claimed += 1;
        const role = roles.get(task.assigneeUserId!);
        if (role === undefined || !can(role, 'work.read')) {
          report.skipped += 1;
          continue;
        }
        const taskId = String(task._id);
        await this.notifier.taskEvent({
          organizationId,
          recipients: [task.assigneeUserId],
          kind,
          projectId: task.projectId,
          taskId,
          title:
            kind === 'work.task_overdue'
              ? `En retard : #${task.number} ${task.title} (échéance ${task.dueDate})`
              : task.dueDate === today
                ? `À rendre aujourd’hui : #${task.number} ${task.title}`
                : `Échéance proche : #${task.number} ${task.title} (${task.dueDate})`,
          actorUserId: null,
          dedupeKey: `${kind}:${taskId}:${task.dueDate}`,
        });
        report.notified += 1;
      }
    }
    if (report.claimed > 0) {
      this.logger.log(
        `Rappels d’échéance ${today} : ${report.notified} émis, ${report.skipped} ignoré(s).`,
      );
    }
    return report;
  }
}
