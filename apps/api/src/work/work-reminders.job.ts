// Rappels d'échéance — ADR-0039 § 6.6, ADR-0080.
//
// Tâche récurrente `work.due-reminders` de l'ordonnanceur (ADR-0020), toutes les
// 5 minutes, 500 tâches au plus par passage. Tout se lit dans le FUSEAU DE
// L'ORGANISATION (ADR-0080 ; Kinshasa sans réglage) :
//
//   - `work.task_due_soon` : tâche non terminée dont l'échéance tombe dans
//     [aujourd'hui, aujourd'hui + dueSoonDays] (réglage de l'organisation) et
//     n'est pas encore dépassée ;
//   - `work.task_overdue`  : tâche non terminée dont l'échéance est dépassée —
//     le lendemain sans heure, à l'heure exacte (à 5 minutes près) avec heure ;
//   - `work.task_due_in_hour` (ADR-0080) : échéance AVEC heure qui tombe dans
//     l'heure qui vient.
//
// Les rappels « au jour » (échéance proche, retard d'une tâche sans heure)
// partent à partir de 7 h (alignés sur le brief du matin) ; les rappels « à
// l'heure » (dans 1 h, retard d'une tâche avec heure) partent à toute heure —
// les heures calmes de Slack et WhatsApp (ADR-0079 § 5) s'appliquent quand même.
//
// Destinataire : le responsable, s'il est encore membre et détient `work.read`.
// Une seule émission par (tâche, échéance, type) : la tâche est d'abord
// « réclamée » par une écriture conditionnelle (`reminders.<type>For`), puis la
// notification part avec `dedupeKey = <type>:<taskId>:<échéance>`. L'échéance
// vaut `AAAA-MM-JJ` sans heure (valeurs d'avant inchangées) et `AAAA-MM-JJTHH:mm`
// avec heure : changer le jour ou l'heure rouvre le rappel. Les tâches des
// projets archivés sont ignorées.

import {
  WORK_LIMITS,
  WORK_TIME_ZONES,
  addDays,
  dayIn,
  dueKey,
  dueSoonEnd,
  formatDayTime,
  formatTimeShort,
  hourIn,
  isPastDue,
  orgClock,
  type OrgClock,
} from '@lalanda/shared/work';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { can } from '../authz/permissions.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { WorkClockService } from './work-clock.service.js';
import { WorkMembersService } from './work-members.service.js';
import { WorkNotifier } from './work-notifier.js';
import { WorkProjectsService } from './work-projects.service.js';
import { WorkSettingsService } from './work-settings.service.js';
import { overdueFilter } from './work.common.js';
import { WorkTask, type WorkTaskDocument, type WorkTaskLean } from './work.schemas.js';

export const WORK_DUE_REMINDERS_JOB = 'work.due-reminders';
/** ADR-0080 : 5 minutes (15 avant), pour qu'un retard « à l'heure » parte à l'heure. */
export const WORK_DUE_REMINDERS_EVERY_MS = 5 * 60_000;
/** Heure (fuseau de l'organisation) à partir de laquelle les rappels « au jour » partent. */
export const WORK_DUE_REMINDERS_HOUR = 7;
/** Tâches au plus par passage. */
export const WORK_DUE_REMINDERS_BATCH = 500;
/** ADR-0080 : fenêtre du rappel « échéance dans 1 h ». */
export const WORK_DUE_IN_HOUR_MS = 60 * 60_000;

export interface DueRemindersReport {
  claimed: number;
  notified: number;
  skipped: number;
}

type Kind = 'work.task_due_soon' | 'work.task_overdue' | 'work.task_due_in_hour';

const FIELD: Record<Kind, 'dueSoonFor' | 'overdueFor' | 'dueInHourFor'> = {
  'work.task_due_soon': 'dueSoonFor',
  'work.task_overdue': 'overdueFor',
  'work.task_due_in_hour': 'dueInHourFor',
};

/** Heure civile de Kinshasa (UTC+1, sans heure d'été). */
export function kinshasaHour(now: Date): number {
  return new Date(now.getTime() + 3_600_000).getUTCHours();
}

/** Clé d'échéance en expression d'agrégation (même forme que `dueKey`). */
const DUE_KEY_EXPR = {
  $cond: [
    { $eq: [{ $ifNull: ['$dueTime', null] }, null] },
    '$dueDate',
    { $concat: ['$dueDate', 'T', '$dueTime'] },
  ],
};

/** « Dans l'heure qui vient » : échéance avec heure dans ]maintenant, maintenant + 1 h]. */
function inHourFilter(clock: OrgClock, end: OrgClock): Record<string, unknown> {
  if (end.today === clock.today) {
    return { dueDate: clock.today, dueTime: { $ne: null, $gt: clock.time, $lte: end.time } };
  }
  return {
    $or: [
      { dueDate: clock.today, dueTime: { $ne: null, $gt: clock.time } },
      { dueDate: end.today, dueTime: { $ne: null, $lte: end.time } },
    ],
  };
}

function isInHour(
  t: { dueDate: string | null; dueTime?: string | null },
  clock: OrgClock,
  end: OrgClock,
): boolean {
  if (!t.dueDate || !t.dueTime) return false;
  const k = `${t.dueDate}T${t.dueTime}`;
  return k > `${clock.today}T${clock.time}` && k <= `${end.today}T${end.time}`;
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
    // ADR-0080 : fuseau de chaque organisation.
    @Inject(WorkClockService) private readonly clock: WorkClockService,
  ) {}

  onModuleInit(): void {
    this.scheduler.every(WORK_DUE_REMINDERS_JOB, WORK_DUE_REMINDERS_EVERY_MS, async (_p, ctx) => {
      await this.run(ctx.now);
    });
  }

  async run(now: Date = new Date()): Promise<DueRemindersReport> {
    const report: DueRemindersReport = { claimed: 0, notified: 0, skipped: 0 };
    // Organisations candidates : borne large couvrant tous les fuseaux proposés.
    const days = WORK_TIME_ZONES.map((tz) => dayIn(now, tz)).sort();
    const lo = days[0]!;
    const hi = days[days.length - 1]!;
    // ADR-0061 § 3 : « échéance proche » compte des JOURS OUVRÉS ; borne large (un
    // week-end et des jours fermés allongent la fenêtre calendaire).
    const horizon = addDays(hi, WORK_LIMITS.dueSoonDaysMax * 7);
    const candidates = {
      done: false,
      assigneeUserId: { $ne: null },
      $or: [
        {
          dueDate: { $ne: null, $lte: addDays(hi, 1) },
          $expr: { $ne: ['$reminders.overdueFor', DUE_KEY_EXPR] },
        },
        {
          dueDate: { $gte: lo, $lte: horizon },
          $expr: { $ne: ['$reminders.dueSoonFor', '$dueDate'] },
        },
        {
          dueDate: { $gte: lo, $lte: addDays(hi, 1) },
          dueTime: { $ne: null },
          $expr: { $ne: ['$reminders.dueInHourFor', DUE_KEY_EXPR] },
        },
      ],
    };

    const orgs = (await this.tasks.distinct('organizationId', candidates).exec()) as string[];
    if (orgs.length === 0) return report;
    const [dueSoon, behaviors, zones] = await Promise.all([
      this.settings.dueSoonDaysOf(orgs),
      this.settings.behaviorsOf(orgs),
      this.clock.timeZonesOf(orgs),
    ]);
    for (const organizationId of orgs) {
      if (report.claimed >= WORK_DUE_REMINDERS_BATCH) break;
      const timeZone = zones.get(organizationId)!;
      const clock = orgClock(now, timeZone);
      const end = orgClock(new Date(now.getTime() + WORK_DUE_IN_HOUR_MS), timeZone);
      const today = clock.today;
      const dayGate = hourIn(now, timeZone) >= WORK_DUE_REMINDERS_HOUR;
      const soonEnd = dueSoonEnd(
        today,
        dueSoon.get(organizationId) ?? WORK_LIMITS.dueSoonDaysDefault,
        behaviors.get(organizationId)?.workingDays ?? [1, 2, 3, 4, 5],
      );
      const branches: Record<string, unknown>[] = [
        {
          $and: [
            overdueFilter(clock),
            // Avant 7 h : seules les échéances À L'HEURE passent en retard.
            ...(dayGate ? [] : [{ dueTime: { $ne: null } }]),
            { $expr: { $ne: ['$reminders.overdueFor', DUE_KEY_EXPR] } },
          ],
        },
        {
          $and: [
            inHourFilter(clock, end),
            { $expr: { $ne: ['$reminders.dueInHourFor', DUE_KEY_EXPR] } },
          ],
        },
      ];
      if (dayGate) {
        branches.push({
          dueDate: { $gte: today, $lte: soonEnd },
          $nor: [{ dueDate: today, dueTime: { $ne: null, $lte: clock.time } }],
          $expr: { $ne: ['$reminders.dueSoonFor', '$dueDate'] },
        });
      }
      const archived = await this.projects.archivedIds(organizationId);
      const docs = await this.tasks
        .find(
          {
            organizationId,
            done: false,
            assigneeUserId: { $ne: null },
            $or: branches,
            ...(archived.length > 0 ? { projectId: { $nin: archived } } : {}),
          },
          {
            projectId: 1,
            number: 1,
            title: 1,
            assigneeUserId: 1,
            dueDate: 1,
            dueTime: 1,
            reminders: 1,
          },
        )
        .sort({ dueDate: 1, _id: 1 })
        .limit(WORK_DUE_REMINDERS_BATCH - report.claimed)
        .lean<WorkTaskLean[]>()
        .exec();
      if (docs.length === 0) continue;
      const members = await this.members.permissions(
        organizationId,
        docs.map((d) => d.assigneeUserId!),
      );
      for (const task of docs) {
        const dueDate = task.dueDate!;
        const dueTime = task.dueTime ?? null;
        const key = dueKey(dueDate, dueTime);
        const reminders = task.reminders ?? { dueSoonFor: null, overdueFor: null };
        const kinds: Kind[] = [];
        if (isPastDue({ dueDate, dueTime }, clock)) {
          if ((dayGate || dueTime !== null) && reminders.overdueFor !== key) {
            kinds.push('work.task_overdue');
          }
        } else {
          if (isInHour({ dueDate, dueTime }, clock, end) && reminders.dueInHourFor !== key) {
            kinds.push('work.task_due_in_hour');
          }
          if (
            dayGate &&
            dueDate >= today &&
            dueDate <= soonEnd &&
            reminders.dueSoonFor !== dueDate
          ) {
            kinds.push('work.task_due_soon');
          }
        }
        for (const kind of kinds) {
          const field = FIELD[kind];
          const value = kind === 'work.task_due_soon' ? dueDate : key;
          // Réclamer d'abord : deux passages concurrents ne servent jamais deux fois.
          const claim = await this.tasks
            .updateOne(
              {
                _id: task._id,
                organizationId,
                done: false,
                dueDate,
                dueTime,
                [`reminders.${field}`]: { $ne: value },
              },
              { $set: { [`reminders.${field}`]: value } },
              { timestamps: false },
            )
            .exec();
          if (claim.modifiedCount !== 1) continue;
          report.claimed += 1;
          // ADR-0041 § 9.4 (A3) : droits effectifs de l'assigné (titre + écart).
          const member = members.get(task.assigneeUserId!);
          if (member === undefined || !can(member.role, 'work.read', member.context)) {
            report.skipped += 1;
            continue;
          }
          const taskId = String(task._id);
          const due = formatDayTime(dueDate, dueTime, timeZone);
          await this.notifier.taskEvent({
            organizationId,
            recipients: [task.assigneeUserId],
            kind,
            projectId: task.projectId,
            taskId,
            title:
              kind === 'work.task_overdue'
                ? `En retard : #${task.number} ${task.title} (échéance ${due})`
                : kind === 'work.task_due_in_hour'
                  ? `Échéance dans moins d’une heure : #${task.number} ${task.title} (${formatTimeShort(dueTime!, timeZone)})`
                  : dueDate === today
                    ? `À rendre aujourd’hui${dueTime ? ` à ${formatTimeShort(dueTime, timeZone)}` : ''} : #${task.number} ${task.title}`
                    : `Échéance proche : #${task.number} ${task.title} (${due})`,
            actorUserId: null,
            dedupeKey: `${kind}:${taskId}:${value}`,
          });
          // ADR-0079 § 3 : le chef et l'adjoint voient les retards de leur projet (une fois
          // par tâche et par échéance), sauf s'ils sont eux-mêmes le responsable.
          if (kind === 'work.task_overdue') {
            await this.notifier.taskEvent({
              organizationId,
              recipients: (await this.notifier.leads(organizationId, task.projectId)).filter(
                (u) => u !== task.assigneeUserId,
              ),
              kind: 'work.project_task_overdue',
              projectId: task.projectId,
              taskId,
              title: `En retard : #${task.number} ${task.title} (échéance ${due})`,
              actorUserId: null,
              dedupeKey: `work.project_task_overdue:${taskId}:${key}`,
            });
          }
          report.notified += 1;
        }
      }
    }
    if (report.claimed > 0) {
      this.logger.log(`Rappels d’échéance : ${report.notified} émis, ${report.skipped} ignoré(s).`);
    }
    return report;
  }
}
