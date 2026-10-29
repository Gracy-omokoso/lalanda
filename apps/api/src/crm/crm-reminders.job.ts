// Rappels d'échéance des relances CRM — ADR-0040 — C4 § 5.4.
//
// Tâche récurrente `crm.due-reminders` de l'ordonnanceur (ADR-0020), mêmes
// paramètres que `work.due-reminders` : toutes les 15 minutes, à partir de 7 h à
// Kinshasa, 500 activités au plus par passage, et le MÊME `dueSoonDays`
// (`work_settings`) : une seule notion d'« échéance proche » par organisation.
//
//   - `crm.activity_due_soon` : activité non faite, `dueDay` dans
//     [aujourd'hui, aujourd'hui + dueSoonDays] ;
//   - `crm.activity_overdue`  : activité non faite, `dueDay` < aujourd'hui.
//
// Destinataire : l'assigné, s'il est encore membre et détient `crm.read`. Une
// seule émission par (activité, échéance, type) : réclamation par écriture
// conditionnelle sur `reminders.<type>For`, puis `dedupeKey =
// <type>:<activityId>:<dueDay>`. Rejouer ne crée pas de doublon ; changer
// l'échéance rouvre le rappel. Émission par le port, hors de toute transaction.

import { crmAgendaHref } from '@lalanda/shared/crm';
import { WORK_LIMITS, addDays, kinshasaDayOf } from '@lalanda/shared/work';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, Types } from 'mongoose';

import { can } from '../authz/permissions.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { WorkMembersService } from '../work/work-members.service.js';
import { WorkSettingsService } from '../work/work-settings.service.js';
import { ACTIVITY_KIND_LABELS, type ActivityKind } from './crm-model.js';
import { CrmNotifier } from './crm-notifier.js';
import { CrmActivity, type CrmActivityDocument } from './crm.schemas.js';

export const CRM_DUE_REMINDERS_JOB = 'crm.due-reminders';
export const CRM_DUE_REMINDERS_EVERY_MS = 15 * 60_000;
/** Heure de Kinshasa à partir de laquelle les rappels partent (comme `work`). */
export const CRM_DUE_REMINDERS_HOUR = 7;
/** Activités au plus par passage. */
export const CRM_DUE_REMINDERS_BATCH = 500;

export interface CrmDueRemindersReport {
  claimed: number;
  notified: number;
  skipped: number;
}

type Kind = 'crm.activity_due_soon' | 'crm.activity_overdue';

interface Row {
  _id: Types.ObjectId;
  kind: ActivityKind;
  subject: string;
  dueDay: string;
  assigneeUserId: string;
  opportunityId: string | null;
  contactId: string | null;
  accountId?: string | null;
}

function kinshasaHour(now: Date): number {
  return new Date(now.getTime() + 3_600_000).getUTCHours();
}

@Injectable()
export class CrmDueRemindersJob implements OnModuleInit {
  private readonly logger = new Logger('CrmRappels');

  constructor(
    @InjectModel(CrmActivity.name) private readonly activities: Model<CrmActivityDocument>,
    @Inject(WorkSettingsService) private readonly settings: WorkSettingsService,
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
    @Inject(CrmNotifier) private readonly notifier: CrmNotifier,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
  ) {}

  onModuleInit(): void {
    this.scheduler.every(CRM_DUE_REMINDERS_JOB, CRM_DUE_REMINDERS_EVERY_MS, async (_p, ctx) => {
      await this.run(ctx.now);
    });
  }

  async run(now: Date = new Date()): Promise<CrmDueRemindersReport> {
    const report: CrmDueRemindersReport = { claimed: 0, notified: 0, skipped: 0 };
    if (kinshasaHour(now) < CRM_DUE_REMINDERS_HOUR) return report;
    const today = kinshasaDayOf(now);
    const horizon = addDays(today, WORK_LIMITS.dueSoonDaysMax);
    const pending = (soonEnd: string) => ({
      done: false,
      assigneeUserId: { $ne: null },
      $or: [
        {
          dueDay: { $ne: null, $lt: today },
          $expr: { $ne: ['$reminders.overdueFor', '$dueDay'] },
        },
        {
          dueDay: { $gte: today, $lte: soonEnd },
          $expr: { $ne: ['$reminders.dueSoonFor', '$dueDay'] },
        },
      ],
    });

    const orgs = (await this.activities
      .distinct('organizationId', pending(horizon))
      .exec()) as string[];
    const dueSoon = await this.settings.dueSoonDaysOf(orgs);
    for (const organizationId of orgs) {
      if (report.claimed >= CRM_DUE_REMINDERS_BATCH) break;
      const soonEnd = addDays(today, dueSoon.get(organizationId) ?? WORK_LIMITS.dueSoonDaysDefault);
      const rows = (await this.activities
        .find(
          { organizationId, ...pending(soonEnd) },
          {
            kind: 1,
            subject: 1,
            dueDay: 1,
            assigneeUserId: 1,
            opportunityId: 1,
            contactId: 1,
            accountId: 1,
          },
        )
        .sort({ dueDay: 1, _id: 1 })
        .limit(CRM_DUE_REMINDERS_BATCH - report.claimed)
        .lean()
        .exec()) as unknown as Row[];
      if (rows.length === 0) continue;
      const roles = await this.members.roles(
        organizationId,
        rows.map((r) => r.assigneeUserId),
      );
      for (const a of rows) {
        const kind: Kind = a.dueDay < today ? 'crm.activity_overdue' : 'crm.activity_due_soon';
        const field = kind === 'crm.activity_overdue' ? 'overdueFor' : 'dueSoonFor';
        // Réclamer d'abord : deux passages concurrents ne servent jamais deux fois.
        const claim = await this.activities
          .updateOne(
            {
              _id: a._id,
              organizationId,
              done: false,
              dueDay: a.dueDay,
              [`reminders.${field}`]: { $ne: a.dueDay },
            },
            { $set: { [`reminders.${field}`]: a.dueDay } },
            { timestamps: false },
          )
          .exec();
        if (claim.modifiedCount !== 1) continue;
        report.claimed += 1;
        const role = roles.get(a.assigneeUserId);
        if (role === undefined || !can(role, 'crm.read')) {
          report.skipped += 1;
          continue;
        }
        const activityId = String(a._id);
        const label = ACTIVITY_KIND_LABELS[a.kind];
        await this.notifier.activityEvent({
          organizationId,
          recipients: [a.assigneeUserId],
          kind,
          activityId,
          title:
            kind === 'crm.activity_overdue'
              ? `${label} en retard : ${a.subject} (échéance ${a.dueDay})`
              : a.dueDay === today
                ? `${label} aujourd’hui : ${a.subject}`
                : `${label} proche : ${a.subject} (${a.dueDay})`,
          href: crmAgendaHref({
            activityId,
            opportunityId: a.opportunityId ?? null,
            accountId: a.accountId ?? null,
            contactId: a.contactId ?? null,
          }),
          actorUserId: null,
          dedupeKey: `${kind}:${activityId}:${a.dueDay}`,
        });
        report.notified += 1;
      }
    }
    if (report.claimed > 0) {
      this.logger.log(
        `Rappels de relances ${today} : ${report.notified} émis, ${report.skipped} ignoré(s).`,
      );
    }
    return report;
  }
}
