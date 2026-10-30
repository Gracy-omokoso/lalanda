// Tâche `hr.leave-accruals` — acquisitions, reports et expirations (ADR-0045 § 2.7,
// § 5, § 6.4). ADR-0045 — H3.
//
// Tâche récurrente de l'ordonnanceur (ADR-0020), motif de `purchases.due-reminders`.
// Pour chaque organisation qui a au moins un type à acquisition (`accrual` mensuelle
// ou annuelle, paramétrée par ELLE : aucun droit n'est posé par Lalanda), pour chaque
// collaborateur actif ou sorti et chaque type :
//   - `accrual` : périodes closes depuis la dernière écrite (moteur `accrualsDue`,
//     prorata des jours civils d'activité, exceptions `leavePolicyOverrides`) ;
//   - `carry_over` : au changement d'année de congé, report du disponible de clôture
//     de l'année précédente (moteur `leaveBalance` puis `carryOverOf`) ;
//   - `expiry` : expiration du reporté non pris (moteur `carryOverExpiryOf`).
// IDEMPOTENTE : index uniques partiels du grand livre (une acquisition par période,
// un report et une expiration par année) ; rejouée, elle n'écrit rien de plus.

import {
  accrualsDue,
  carryOverExpiryOf,
  carryOverOf,
  leaveBalance,
  leaveYearBounds,
  leaveYearOf,
  type LeaveAccrual,
  type LeaveLedgerEntryInput,
  type LeaveTypePolicyInput,
} from '@lalanda/engine';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { SchedulerService } from '../../scheduler/scheduler.service.js';
import {
  Employee,
  type EmployeeDocument,
  type EmployeeLean,
} from '../employees/employee.schema.js';
import {
  LeaveLedgerEntry,
  type LeaveLedgerEntryDocument,
  type LeaveLedgerEntryLean,
} from '../leave/leave-ledger.schema.js';
import {
  LeaveType,
  type LeaveTypeDocument,
  type LeaveTypeLean,
} from '../leave/leave-type.schema.js';
import { hrToday } from '../scope/hr-errors.js';
import { hrSettingsViewOf } from '../settings/hr-settings.service.js';

export const HR_LEAVE_ACCRUALS_JOB = 'hr.leave-accruals';
/** Toutes les six heures : la période close d'un mois est écrite le lendemain au plus tard. */
export const HR_LEAVE_ACCRUALS_EVERY_MS = 6 * 3_600_000;

export interface HrLeaveAccrualsReport {
  organizations: number;
  accruals: number;
  carryOvers: number;
  expiries: number;
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number } | null)?.code === 11000;
}

function policyOf(t: LeaveTypeLean): LeaveTypePolicyInput {
  return {
    id: String(t._id),
    accrual: t.accrual as LeaveAccrual,
    proration: t.proration,
    carryOver: t.carryOver,
  };
}

@Injectable()
export class HrLeaveAccrualsJob implements OnModuleInit {
  private readonly logger = new Logger('RhAcquisitions');

  constructor(
    @InjectModel(LeaveType.name) private readonly types: Model<LeaveTypeDocument>,
    @InjectModel(Employee.name) private readonly employees: Model<EmployeeDocument>,
    @InjectModel(LeaveLedgerEntry.name) private readonly ledger: Model<LeaveLedgerEntryDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
  ) {}

  onModuleInit(): void {
    this.scheduler.every(HR_LEAVE_ACCRUALS_JOB, HR_LEAVE_ACCRUALS_EVERY_MS, async (_p, ctx) => {
      await this.run(ctx.now);
    });
  }

  async run(now: Date = new Date()): Promise<HrLeaveAccrualsReport> {
    const report: HrLeaveAccrualsReport = {
      organizations: 0,
      accruals: 0,
      carryOvers: 0,
      expiries: 0,
    };
    const today = hrToday(now);
    const orgs = (await this.types
      .distinct('organizationId', {
        active: true,
        $or: [{ 'accrual.kind': { $in: ['monthly', 'yearly'] } }, { deductsFromBalance: true }],
      })
      .exec()) as string[];
    for (const organizationId of orgs.sort()) {
      try {
        await this.runOrg(organizationId, today, report);
        report.organizations += 1;
      } catch (err) {
        this.logger.warn(
          `Acquisitions non écrites (organisation ${organizationId}) : ${
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
    report: HrLeaveAccrualsReport,
  ): Promise<void> {
    const settingsDoc = await this.connection.collection('hr_settings').findOne({ organizationId });
    const leaveYearStart = hrSettingsViewOf(
      settingsDoc as Record<string, unknown> | null,
    ).leaveYearStart;
    const [types, employees] = await Promise.all([
      this.types.find({ organizationId, active: true }).lean<LeaveTypeLean[]>().exec(),
      this.employees
        .find({ organizationId, status: { $in: ['active', 'exited'] } })
        .lean<EmployeeLean[]>()
        .exec(),
    ]);
    const year = leaveYearOf(today, leaveYearStart);
    const previous = leaveYearBounds(year - 1, leaveYearStart);
    for (const employee of employees) {
      const employeeId = String(employee._id);
      if (employee.startDate > today) continue;
      const ledger = await this.ledger
        .find({ organizationId, employeeId })
        .lean<LeaveLedgerEntryLean[]>()
        .exec();
      for (const type of types) {
        const typeId = String(type._id);
        const own = ledger.filter((e) => e.typeId === typeId);
        const policy = policyOf(type);
        const overrides = (employee.leavePolicyOverrides ?? null) as Readonly<
          Record<string, { accrual: LeaveAccrual }>
        > | null;
        const accrualKind = overrides?.[typeId]?.accrual.kind ?? type.accrual.kind;

        // 1. Acquisitions des périodes closes.
        if (accrualKind !== 'none') {
          const last = own
            .filter((e) => e.kind === 'accrual' && e.period)
            .map((e) => e.period!)
            .sort()
            .pop();
          const due = accrualsDue(
            policy,
            {
              startDate: employee.startDate,
              endDate: employee.endDate ?? null,
              leavePolicyOverrides: overrides,
            },
            last ?? null,
            today,
            leaveYearStart,
          );
          for (const a of due.entries) {
            if (
              await this.insert({
                organizationId,
                employeeId,
                typeId,
                kind: 'accrual',
                days: a.days,
                effectiveOn: a.effectiveOn,
                leaveYear: a.leaveYear,
                period: a.period,
                note: null,
              })
            ) {
              report.accruals += 1;
              own.push({
                typeId,
                kind: 'accrual',
                days: a.days,
                effectiveOn: a.effectiveOn,
                leaveYear: a.leaveYear,
              } as LeaveLedgerEntryLean);
            }
          }
        }

        // 2. Report au changement d'année (types qui débitent un solde seulement).
        if (!type.deductsFromBalance) continue;
        const asEngine = (rows: readonly LeaveLedgerEntryLean[]): LeaveLedgerEntryInput[] =>
          rows.map((e) => ({
            typeId: e.typeId,
            kind: e.kind,
            days: e.days,
            effectiveOn: e.effectiveOn,
            leaveYear: e.leaveYear,
          }));
        const hasPrevious = own.some((e) => e.leaveYear === year - 1);
        const hasCarry = own.some((e) => e.kind === 'carry_over' && e.leaveYear === year);
        if (hasPrevious && !hasCarry && employee.startDate <= previous.end) {
          const closing =
            leaveBalance(asEngine(own), [], previous.end, leaveYearStart).balances.find(
              (b) => b.typeId === typeId,
            )?.available ?? '0';
          const carry = carryOverOf(closing, policy, year, leaveYearStart);
          if (
            await this.insert({
              organizationId,
              employeeId,
              typeId,
              kind: 'carry_over',
              days: carry.carried,
              effectiveOn: leaveYearBounds(year, leaveYearStart).start,
              leaveYear: year,
              period: null,
              note: null,
            })
          ) {
            report.carryOvers += 1;
            own.push({
              typeId,
              kind: 'carry_over',
              days: carry.carried,
              effectiveOn: leaveYearBounds(year, leaveYearStart).start,
              leaveYear: year,
            } as LeaveLedgerEntryLean);
          }
        }

        // 3. Expiration du reporté non pris.
        const expiry = carryOverExpiryOf(asEngine(own), policy, year, today, leaveYearStart);
        if (expiry.due && Number(expiry.expired) > 0) {
          if (
            await this.insert({
              organizationId,
              employeeId,
              typeId,
              kind: 'expiry',
              days: `-${expiry.expired}`,
              effectiveOn: expiry.expiresOn!,
              leaveYear: year,
              period: null,
              note: null,
            })
          ) {
            report.expiries += 1;
          }
        }
      }
    }
  }

  /** Vrai si le mouvement est nouveau ; un doublon (rejeu) n'écrit rien. */
  private async insert(
    entry: Omit<
      LeaveLedgerEntryLean,
      '_id' | 'createdAt' | '_schemaVersion' | 'requestId' | 'createdBy'
    >,
  ): Promise<boolean> {
    try {
      await this.ledger.create({
        ...entry,
        requestId: null,
        createdBy: 'system',
        _schemaVersion: 1,
      });
      return true;
    } catch (err) {
      if (isDuplicateKey(err)) return false;
      throw err;
    }
  }
}
