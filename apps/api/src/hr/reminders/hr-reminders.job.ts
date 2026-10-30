// Tâche `hr.reminders` — rappels d'échéance RH (ADR-0045 § 6.4, critère 14).
// ADR-0045 — H4.
//
// Tâche récurrente de l'ordonnanceur (ADR-0020), motif de `purchases.due-reminders` :
// toutes les heures, à partir de 7 h à Kinshasa. Échéances calculées par le moteur
// (`hrDeadlines`) sous les délais des réglages (fin d'essai 15 jours, fin de contrat
// 30, document 30 par défaut, décision ouverte n° 11) :
//   - `hr.probation_ending`, `hr.contract_ending` : détenteurs EFFECTIFS de
//     `hr.manage` et le manager désigné (s'il a un compte membre) ;
//   - `hr.document_expiring` (document ou pièce d'identité) : détenteurs effectifs de
//     `hr.manage` seulement.
// UNE notification par échéance : réclamation par insertion sous index unique
// (`hr_reminder_claims`, clé = organisation + collaborateur + nature + date [+ document
// ou nature de pièce]), puis `dedupeKey` identique au port. Rejouer n'envoie rien de
// plus ; déplacer la date rouvre le rappel. Elle NE DÉCHIFFRE RIEN : les pièces
// d'identité se lisent sur `idExpiries` (en clair, sans numéro). Aucun titre ne porte un
// numéro, un libellé de document ni un montant.

import { NOTIFICATION_LIMITS } from '@lalanda/shared/notifications';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { Connection, HydratedDocument, Model } from 'mongoose';

import { holdersFilter } from '../../authz/authz.service.js';
import { SchedulerService } from '../../scheduler/scheduler.service.js';
import {
  HrChecklistsNotifier,
  type HrReminderNotice,
} from '../checklists/hr-checklists-notifier.js';
import { displayNameOf } from '../leave/display-name.js';
import { hrToday } from '../scope/hr-errors.js';
import { HrDeadlinesService } from './hr-deadlines.service.js';

export const HR_REMINDERS_JOB = 'hr.reminders';
export const HR_REMINDERS_EVERY_MS = 60 * 60_000;
/** Heure de Kinshasa à partir de laquelle les rappels partent (comme `work`, `crm`, achats). */
export const HR_REMINDERS_HOUR = 7;

/** Réclamation d'un rappel (une par échéance). */
@Schema({ collection: 'hr_reminder_claims', timestamps: false, strict: true })
export class HrReminderClaim {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  dedupeKey!: string;

  @Prop({ type: Date, required: true })
  claimedAt!: Date;
}
export type HrReminderClaimDocument = HydratedDocument<HrReminderClaim>;
export const HrReminderClaimSchema = SchemaFactory.createForClass(HrReminderClaim);
HrReminderClaimSchema.index(
  { organizationId: 1, dedupeKey: 1 },
  { unique: true, name: 'hr_reminder_claim_unique' },
);

export interface HrRemindersReport {
  organizations: number;
  claimed: number;
  notified: number;
}

const KIND = {
  probation_end: 'hr.probation_ending',
  contract_end: 'hr.contract_ending',
  document_expiry: 'hr.document_expiring',
  id_expiry: 'hr.document_expiring',
} as const;

function kinshasaHour(now: Date): number {
  return new Date(now.getTime() + 3_600_000).getUTCHours();
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number } | null)?.code === 11000;
}

@Injectable()
export class HrRemindersJob implements OnModuleInit {
  private readonly logger = new Logger('RhRappels');

  constructor(
    @InjectModel(HrReminderClaim.name) private readonly claims: Model<HrReminderClaimDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(HrDeadlinesService) private readonly deadlines: HrDeadlinesService,
    @Inject(HrChecklistsNotifier) private readonly notifier: HrChecklistsNotifier,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
  ) {}

  onModuleInit(): void {
    this.scheduler.every(HR_REMINDERS_JOB, HR_REMINDERS_EVERY_MS, async (_p, ctx) => {
      await this.run(ctx.now);
    });
  }

  async run(now: Date = new Date()): Promise<HrRemindersReport> {
    const report: HrRemindersReport = { organizations: 0, claimed: 0, notified: 0 };
    if (kinshasaHour(now) < HR_REMINDERS_HOUR) return report;
    const today = hrToday(now);
    const orgs = (await this.connection
      .collection('hr_employees')
      .distinct('organizationId', { status: 'active' })) as string[];
    for (const organizationId of orgs.sort()) {
      try {
        await this.runOrg(organizationId, today, now, report);
        report.organizations += 1;
      } catch (err) {
        this.logger.warn(
          `Rappels RH non émis (organisation ${organizationId}) : ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return report;
  }

  private async runOrg(
    organizationId: string,
    today: string,
    now: Date,
    report: HrRemindersReport,
  ): Promise<void> {
    const d = await this.deadlines.of(organizationId, today);
    if (d.result.deadlines.length === 0) return;
    const holders = await this.connection
      .collection('memberships')
      .find(holdersFilter(organizationId, 'hr.manage'), { projection: { userId: 1 } })
      .toArray();
    const hr = [...new Set(holders.map((m) => String(m['userId'])).filter(Boolean))].sort();

    for (const x of d.result.deadlines) {
      const dedupeKey = `${KIND[x.kind]}:${x.dedupeKey}`.slice(0, NOTIFICATION_LIMITS.dedupeKeyMax);
      // Réclamer d'abord : deux passages concurrents ne servent jamais deux fois.
      try {
        await this.claims.create({ organizationId, dedupeKey, claimedAt: now });
      } catch (err) {
        if (isDuplicateKey(err)) continue;
        throw err;
      }
      report.claimed += 1;
      const employee = d.employees.get(x.employeeId);
      if (!employee) continue;
      const name = displayNameOf(employee);
      const recipients: { userId: string; manager: boolean }[] = hr.map((userId) => ({
        userId,
        manager: false,
      }));
      if (x.kind === 'probation_end' || x.kind === 'contract_end') {
        const managerUserId = await this.managerUserIdOf(
          organizationId,
          employee.managerEmployeeId,
          d,
        );
        if (managerUserId && !hr.includes(managerUserId)) {
          recipients.push({ userId: managerUserId, manager: true });
        }
      }
      const title =
        x.kind === 'probation_end'
          ? `Fin de période d’essai le ${x.date} : ${name}`
          : x.kind === 'contract_end'
            ? `Fin de contrat le ${x.date} : ${name}`
            : x.kind === 'id_expiry'
              ? `Pièce d’identité qui expire le ${x.date} : ${name}`
              : `Document qui expire le ${x.date} : ${name}`;
      for (const r of recipients) {
        const notice: HrReminderNotice = {
          organizationId,
          recipientUserId: r.userId,
          kind: KIND[x.kind],
          requiredAction: r.manager ? 'analytics.read' : 'hr.read',
          employeeId: x.employeeId,
          documentId: x.documentId,
          title,
          href: r.manager ? '/rh/equipe' : '/rh/echeances',
          dedupeKey,
        };
        if (await this.notifier.reminder(notice)) report.notified += 1;
      }
    }
  }

  /** Compte du manager désigné, s'il est membre de l'organisation (lien inerte sinon). */
  private async managerUserIdOf(
    organizationId: string,
    managerEmployeeId: string | null,
    d: Awaited<ReturnType<HrDeadlinesService['of']>>,
  ): Promise<string | null> {
    if (!managerEmployeeId) return null;
    const manager = d.employees.get(managerEmployeeId);
    if (!manager?.userId) return null;
    const member = await this.connection
      .collection('memberships')
      .findOne({ organizationId, userId: manager.userId }, { projection: { _id: 1 } });
    return member ? manager.userId : null;
  }
}
