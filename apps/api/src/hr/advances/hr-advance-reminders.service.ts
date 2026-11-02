// Rappels d'avance (ADR-0051 § 3.3, § 7.2, § 7.5). ADR-0051 — H10.
//
// Appelé par la tâche `hr.reminders` (une passe par organisation). Une avance VERSÉE
// dont le reste dû n'est pas nul après la date de régularisation ANNONCÉE lève le constat
// `ADVANCE_OVERDUE` (moteur `advanceFindings`) : un RAPPEL, jamais une régularisation,
// jamais une retenue. UNE notification par avance et par échéance : réclamation sous
// index unique (`hr_reminder_claims`), puis `dedupeKey` identique au port.
// Destinataires : le bénéficiaire (s'il a un compte) et les validateurs — pour une
// avance SUR SALAIRE, les seuls détenteurs d'`expenses.approve` ET `hr.sensitive.read`
// (le manager n'en sait rien). Aucun titre ne porte un montant, un motif ni « sur salaire ».

import { advanceFindings } from '@lalanda/engine';
import { NOTIFICATION_LIMITS } from '@lalanda/shared/notifications';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

// Type seul : le modèle est nommé par chaîne, la tâche `hr.reminders` important ce service.
import type { HrReminderClaimDocument } from '../reminders/hr-reminders.job.js';
import { HR_MY_EXPENSES_HREF, HrExpensesNotifier } from '../expenses/hr-expenses-notifier.js';
import {
  EmployeeAdvance,
  type EmployeeAdvanceDocument,
  type EmployeeAdvanceLean,
} from './advance.schema.js';
import { advanceInputOf } from './advance-model.js';

export interface HrAdvanceRemindersReport {
  claimed: number;
  notified: number;
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number } | null)?.code === 11000;
}

@Injectable()
export class HrAdvanceRemindersService {
  constructor(
    @InjectModel(EmployeeAdvance.name) private readonly advances: Model<EmployeeAdvanceDocument>,
    @InjectModel('HrReminderClaim') private readonly claims: Model<HrReminderClaimDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(HrExpensesNotifier) private readonly notifier: HrExpensesNotifier,
  ) {}

  async run(organizationId: string, today: string, now: Date): Promise<HrAdvanceRemindersReport> {
    const report: HrAdvanceRemindersReport = { claimed: 0, notified: 0 };
    const open = await this.advances
      .find({
        organizationId,
        status: { $in: ['disbursed', 'partially_settled'] },
        expectedSettlement: { $type: 'string' },
      })
      .lean<EmployeeAdvanceLean[]>()
      .exec();
    if (open.length === 0) return report;
    let approvers: string[] | null = null;
    let sensitive: Set<string> | null = null;
    for (const a of open) {
      const overdue = advanceFindings(advanceInputOf(a), today).find(
        (f) => f.code === 'ADVANCE_OVERDUE',
      );
      if (!overdue) continue;
      const dedupeKey = `hr.advance_overdue:${String(a._id)}:${overdue.dueOn}`.slice(
        0,
        NOTIFICATION_LIMITS.dedupeKeyMax,
      );
      try {
        await this.claims.create({ organizationId, dedupeKey, claimedAt: now });
      } catch (err) {
        if (isDuplicateKey(err)) continue;
        throw err;
      }
      report.claimed += 1;
      approvers ??= await this.notifier.holdersOf(organizationId, 'expenses.approve');
      let toApprovers = approvers;
      if (a.kind === 'salary') {
        sensitive ??= new Set(await this.notifier.holdersOf(organizationId, 'hr.sensitive.read'));
        const s = sensitive;
        toApprovers = approvers.filter((u) => s.has(u));
      }
      const beneficiary = await this.beneficiaryUserId(organizationId, a.employeeId);
      if (beneficiary) {
        report.notified += await this.notifier.send({
          organizationId,
          entityType: 'advance',
          entityId: String(a._id),
          kind: 'hr.advance_overdue',
          recipients: [beneficiary],
          title: `Votre avance ${a.number ?? ''} attend sa régularisation`,
          href: HR_MY_EXPENSES_HREF,
          actorUserId: null,
          dedupeKey,
        });
      }
      report.notified += await this.notifier.send({
        organizationId,
        entityType: 'advance',
        entityId: String(a._id),
        kind: 'hr.advance_overdue',
        recipients: toApprovers.filter((u) => u !== beneficiary),
        title: `Avance ${a.number ?? ''} non régularisée à l’échéance annoncée`,
        href: '/rh/frais?vue=toutes',
        actorUserId: null,
        dedupeKey,
      });
    }
    return report;
  }

  /** Compte relié à la fiche, s'il est membre de l'organisation (lien inerte sinon). */
  private async beneficiaryUserId(
    organizationId: string,
    employeeId: string,
  ): Promise<string | null> {
    if (!Types.ObjectId.isValid(employeeId)) return null;
    const e = await this.connection
      .collection('hr_employees')
      .findOne(
        { _id: new Types.ObjectId(employeeId), organizationId, status: 'active' },
        { projection: { userId: 1 } },
      );
    const userId = e?.['userId'] ? String(e['userId']) : null;
    if (!userId) return null;
    const member = await this.connection
      .collection('memberships')
      .findOne({ organizationId, userId }, { projection: { _id: 1 } });
    return member ? userId : null;
  }
}
