// Résumé quotidien des Projets par e-mail — ADR-0061 § 2.
//
// Tâche récurrente `work.daily-digest`, toutes les 15 minutes. Un utilisateur qui l'a
// activé reçoit, à partir de SON heure (Kinshasa) et au plus une fois par jour, la liste
// de ses tâches en retard, du jour et à échéance proche (jours ouvrés de l'organisation),
// plus le nombre de ses notifications non lues des Projets. Projets archivés et projets
// privés hors de sa portée exclus. « Jours ouvrés seulement » : rien un jour fermé.
//
// Au plus une fois par jour : le jour est RÉCLAMÉ (`digestLastSentOn`) avant l'envoi,
// comme le brief du matin (un e-mail en double agace plus qu'un e-mail perdu). Droit
// revérifié avant chaque envoi : un ancien membre, ou qui a perdu `work.read`, ne reçoit
// rien. En local et en test, le transport de test journalise : aucun envoi réel.

import {
  dueSoonEnd,
  isWorkingDay,
  kinshasaDayOf,
  resolveWorkNotificationPreferences,
} from '@lalanda/shared/work';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import { can } from '../../authz/permissions.js';
import { MailService } from '../../mail/mail.service.js';
import { MembersService } from '../../organizations/members.service.js';
import { SchedulerService } from '../../scheduler/scheduler.service.js';
import { projectIdFilter } from '../work-access.js';
import { WorkAccessService } from '../work-access.service.js';
import { WorkMembersService } from '../work-members.service.js';
import { WorkProjectsService } from '../work-projects.service.js';
import { kinshasaHour } from '../work-reminders.job.js';
import { WorkSettingsService } from '../work-settings.service.js';
import { WorkTask, type WorkTaskDocument, type WorkTaskLean } from '../work.schemas.js';
import {
  WorkNotificationPreferencesDoc,
  type WorkNotificationPreferencesDocument,
  type WorkNotificationPreferencesLean,
} from './work-notification-preferences.schema.js';

export const WORK_DIGEST_JOB = 'work.daily-digest';
export const WORK_DIGEST_EVERY_MS = 15 * 60_000;
const DIGEST_LINES_MAX = 20;

export interface DigestReport {
  claimed: number;
  sent: number;
  skipped: number;
}

@Injectable()
export class WorkDigestJob implements OnModuleInit {
  private readonly logger = new Logger('WorkRésumé');

  constructor(
    @InjectModel(WorkNotificationPreferencesDoc.name)
    private readonly prefs: Model<WorkNotificationPreferencesDocument>,
    @InjectModel(WorkTask.name) private readonly tasks: Model<WorkTaskDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(WorkSettingsService) private readonly settings: WorkSettingsService,
    @Inject(WorkProjectsService) private readonly projects: WorkProjectsService,
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
    @Inject(WorkAccessService) private readonly access: WorkAccessService,
    @Inject(MembersService) private readonly identities: MembersService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
  ) {}

  onModuleInit(): void {
    this.scheduler.every(WORK_DIGEST_JOB, WORK_DIGEST_EVERY_MS, async (_p, ctx) => {
      await this.run(ctx.now);
    });
  }

  async run(now: Date = new Date()): Promise<DigestReport> {
    const report: DigestReport = { claimed: 0, sent: 0, skipped: 0 };
    const today = kinshasaDayOf(now);
    const hour = kinshasaHour(now);
    const candidates = await this.prefs
      .find({ digestEnabled: true, digestLastSentOn: { $ne: today } })
      .limit(500)
      .lean<WorkNotificationPreferencesLean[]>()
      .exec();
    for (const c of candidates) {
      const prefs = resolveWorkNotificationPreferences(c);
      if (!prefs.digest.enabled || hour < prefs.digest.hour) continue;
      const claim = await this.prefs
        .updateOne(
          { _id: c._id, digestLastSentOn: { $ne: today } },
          { $set: { digestLastSentOn: today } },
          { timestamps: false },
        )
        .exec();
      if (claim.modifiedCount !== 1) continue;
      report.claimed += 1;
      try {
        const sent = await this.serve(c.organizationId, c.userId, today, prefs.digest.workingDaysOnly);
        report[sent ? 'sent' : 'skipped'] += 1;
      } catch (err) {
        report.skipped += 1;
        this.logger.warn(
          `Résumé non envoyé (organisation ${c.organizationId}) : ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return report;
  }

  private async serve(
    organizationId: string,
    userId: string,
    today: string,
    workingDaysOnly: boolean,
  ): Promise<boolean> {
    const member = await this.members.permissionsOf(organizationId, userId);
    if (!member || !can(member.role, 'work.read', member.context)) return false;
    const settings = await this.settings.get(organizationId);
    if (workingDaysOnly && !isWorkingDay(today, settings.workingDays)) return false;
    const soonEnd = dueSoonEnd(today, settings.dueSoonDays, settings.workingDays);
    const [archived, scope] = await Promise.all([
      this.projects.archivedIds(organizationId),
      this.access.scopeOf(organizationId, { userId, role: member.role, context: member.context }),
    ]);
    const and: Record<string, unknown>[] = [
      { organizationId, assigneeUserId: userId, done: false, dueDate: { $ne: null, $lte: soonEnd } },
    ];
    if (archived.length > 0) and.push({ projectId: { $nin: archived } });
    const visible = projectIdFilter(scope);
    if (Object.keys(visible).length > 0) and.push(visible);
    const docs = await this.tasks
      .find({ $and: and }, { number: 1, title: 1, dueDate: 1, projectId: 1 })
      .sort({ dueDate: 1, _id: 1 })
      .limit(200)
      .lean<WorkTaskLean[]>()
      .exec();
    const names = await this.projects.namesOf(
      organizationId,
      docs.map((d) => d.projectId),
    );
    const line = (d: WorkTaskLean) =>
      `#${d.number} ${d.title} — ${names.get(d.projectId) ?? ''} (${d.dueDate})`;
    const overdue = docs.filter((d) => d.dueDate! < today).map(line);
    const dueToday = docs.filter((d) => d.dueDate === today).map(line);
    const soon = docs.filter((d) => d.dueDate! > today).map(line);
    const unread = await this.connection.collection('notifications').countDocuments({
      organizationId,
      recipientUserId: userId,
      readAt: null,
      'source.module': 'work',
      ...projectIdFilter(scope, 'source.projectId'),
    });
    const [who, org] = await Promise.all([
      this.identities.identitiesOf([userId]),
      Types.ObjectId.isValid(organizationId)
        ? this.connection
            .collection('organizations')
            .findOne({ _id: new Types.ObjectId(organizationId) }, { projection: { name: 1 } })
        : null,
    ]);
    const to = who.get(userId)?.email;
    if (!to) return false;
    const dateLabel = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeZone: 'UTC' }).format(
      new Date(`${today}T00:00:00Z`),
    );
    await this.mail.sendWorkDigest({
      to,
      organizationName: org ? String(org['name'] ?? '') : '',
      dateLabel,
      overdue: overdue.slice(0, DIGEST_LINES_MAX),
      today: dueToday.slice(0, DIGEST_LINES_MAX),
      soon: soon.slice(0, DIGEST_LINES_MAX),
      unread,
    });
    return true;
  }
}
