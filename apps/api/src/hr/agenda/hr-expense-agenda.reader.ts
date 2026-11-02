// Frais, avances et corrections de pointage qui attendent l'appelant — ADR-0051 § 7.5,
// § 7.6. ADR-0051 — H14.
//
// LECTURE SEULE, partagée par « Mes tâches » (`HR_AGENDA_SOURCE`) et le brief du matin
// (`HR_SOURCE`, des nombres seulement). Aucun `HrViewer` ici : ce lecteur ne rend
// JAMAIS la liste d'une organisation, seulement les pièces sur lesquelles l'appelant
// peut agir, décidées par les MÊMES fonctions pures que les routes, sur ses droits
// EFFECTIFS et la relation de manager (jamais un rôle) :
//   - à valider : `expenseApprovalDecision` (étape en cours, séparation des tâches ;
//     une avance sur salaire exige `expenses.approve` ET `hr.sensitive.read`, le manager
//     n'en sait rien) ;
//   - à payer : `payables.pay` puis `reimbursementDecision` (jamais soi-même, jamais ce
//     qu'on a validé à l'étape finance, sauf payeur unique) ;
//   - avance à régulariser : versée, non soldée après l'échéance ANNONCÉE (moteur
//     `advanceFindings`) — pour son bénéficiaire, et pour les validateurs habilités ;
//   - correction de pointage : `attendanceCorrectionDecision` (manager désigné ou
//     `hr.manage`, jamais le demandeur), seulement si le pointage est activé.
// Toujours dans l'organisation de la session ; aucun montant ne sort d'ici.

import { advanceFindings } from '@lalanda/engine';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import { AuthzService } from '../../authz/authz.service.js';
import {
  attendanceCorrectionDecision,
  reimbursementDecision,
  type Action,
} from '../../authz/permissions.js';
import { advanceInputOf } from '../advances/advance-model.js';
import type { EmployeeAdvanceLean } from '../advances/advance.schema.js';
import { presenceSettingsViewOf } from '../attendance/hr-presence-settings.js';
import type { EmployeeLean } from '../employees/employee.schema.js';
import type { ExpenseReportLean } from '../expenses/expense-report.schema.js';
import { expensesSettingsOf } from '../expenses/hr-expenses-settings.service.js';
import {
  expenseDecisionOn,
  financeApproverOf,
  managerUserIdOf,
  type ApprovalStep,
} from '../expenses/hr-expenses.common.js';

/** Pièces lues au plus par nature et par organisation (borne de sûreté). */
export const HR_LINKS_SCAN_MAX = 2_000;

/** Ce que le lecteur sait de l'appelant : son compte et ses droits EFFECTIFS. */
export interface HrLinksActor {
  userId: string;
  actions: ReadonlySet<Action>;
}

/** Pièce de frais (note ou avance) visée par un élément. */
export interface HrLinkPiece {
  entityType: 'expense_report' | 'advance';
  id: string;
  number: string | null;
  employeeId: string;
  /** Instant de référence (soumission, validation, ou échéance annoncée). */
  at: Date;
  /** Échéance annoncée d'une avance à régulariser (`AAAA-MM-JJ`). */
  dueOn: string | null;
}

/** Correction de pointage à décider. */
export interface HrLinkCorrection {
  id: string;
  employeeId: string;
  /** Jour corrigé. */
  date: string;
  at: Date;
}

export interface HrLinksResult {
  approvals: HrLinkPiece[];
  toPay: HrLinkPiece[];
  toSettle: HrLinkPiece[];
  corrections: HrLinkCorrection[];
  employees: ReadonlyMap<string, EmployeeLean>;
  /** Vrai si une lecture a atteint sa borne. */
  truncated: boolean;
}

type Raw = Record<string, unknown>;

const EMPLOYEE_PROJECTION = {
  firstName: 1,
  lastName: 1,
  preferredName: 1,
  userId: 1,
  status: 1,
  managerEmployeeId: 1,
} as const;

function idOf(doc: { _id: unknown }): string {
  return String(doc._id);
}

function dateOf(value: unknown, fallback: Date): Date {
  return value instanceof Date ? value : fallback;
}

@Injectable()
export class HrExpenseAgendaReader {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(AuthzService) private readonly authz: AuthzService,
  ) {}

  /** Tout ce qui attend l'appelant (`today` : jour de Kinshasa). */
  async linksOf(
    organizationId: string,
    actor: HrLinksActor,
    today: string,
  ): Promise<HrLinksResult> {
    const has = (a: Action) => actor.actions.has(a);
    const [settingsDoc, employeeRows] = await Promise.all([
      this.connection.collection('hr_settings').findOne({ organizationId }),
      this.connection
        .collection('hr_employees')
        .find({ organizationId }, { projection: EMPLOYEE_PROJECTION })
        .toArray() as unknown as Promise<EmployeeLean[]>,
    ]);
    const employees = new Map(employeeRows.map((e) => [idOf(e), e]));
    const self = employeeRows.find((e) => e.userId === actor.userId && e.status !== 'anonymized');
    const selfId = self ? idOf(self) : null;
    const isManager = employeeRows.some(
      (e) => e.managerEmployeeId !== null && e.managerEmployeeId === selfId,
    );
    const expenses = expensesSettingsOf(settingsDoc as Raw | null);
    const presence = presenceSettingsViewOf(settingsDoc as Raw | null);

    // Chaque lecture derrière sa garde : rien n'est lu pour qui ne peut pas agir.
    const approvable = isManager || has('expenses.approve');
    const payer = has('payables.pay');
    const settleRead = selfId !== null || has('expenses.approve');
    const decider = presence.attendance.enabled && (isManager || has('hr.manage'));

    const [approvals, toPay, toSettle, corrections] = await Promise.all([
      approvable
        ? this.approvalsOf(organizationId, actor, employees, expenses.allowSoleApprover)
        : Promise.resolve({ items: [] as HrLinkPiece[], truncated: false }),
      payer
        ? this.toPayOf(organizationId, actor, employees, expenses.allowSoleApprover)
        : Promise.resolve({ items: [] as HrLinkPiece[], truncated: false }),
      settleRead
        ? this.toSettleOf(organizationId, actor, selfId, today)
        : Promise.resolve({ items: [] as HrLinkPiece[], truncated: false }),
      decider
        ? this.correctionsOf(organizationId, actor, employees, expenses.allowSoleApprover)
        : Promise.resolve({ items: [] as HrLinkCorrection[], truncated: false }),
    ]);
    return {
      approvals: approvals.items,
      toPay: toPay.items,
      toSettle: toSettle.items,
      corrections: corrections.items,
      employees,
      truncated:
        approvals.truncated || toPay.truncated || toSettle.truncated || corrections.truncated,
    };
  }

  private async approvalsOf(
    organizationId: string,
    actor: HrLinksActor,
    employees: ReadonlyMap<string, EmployeeLean>,
    allowSoleApprover: boolean,
  ): Promise<{ items: HrLinkPiece[]; truncated: boolean }> {
    const projection = {
      number: 1,
      employeeId: 1,
      status: 1,
      steps: 1,
      approvals: 1,
      createdBy: 1,
      submittedAt: 1,
      createdAt: 1,
      kind: 1,
    };
    const [reports, advances, approverCount] = await Promise.all([
      this.connection
        .collection('hr_expense_reports')
        .find({ organizationId, status: 'submitted' }, { projection })
        .sort({ submittedAt: 1, _id: 1 })
        .limit(HR_LINKS_SCAN_MAX + 1)
        .toArray() as unknown as Promise<ExpenseReportLean[]>,
      this.connection
        .collection('hr_advances')
        .find({ organizationId, status: 'submitted' }, { projection })
        .sort({ submittedAt: 1, _id: 1 })
        .limit(HR_LINKS_SCAN_MAX + 1)
        .toArray() as unknown as Promise<EmployeeAdvanceLean[]>,
      this.authz.countApprovers(organizationId, 'expenses.approve'),
    ]);
    const ctx = {
      userId: actor.userId,
      actions: actor.actions,
      approverCount,
      allowSoleApprover,
    };
    const items: HrLinkPiece[] = [];
    const consider = (
      entityType: HrLinkPiece['entityType'],
      d: {
        _id: unknown;
        number: string | null;
        employeeId: string;
        status: string;
        steps: ApprovalStep[];
        approvals: { step: ApprovalStep; userId: string; decision: 'approved' | 'rejected' }[];
        createdBy: string;
        submittedAt?: Date | null;
        createdAt?: Date;
      },
      salary: boolean,
    ) => {
      const employee = employees.get(d.employeeId);
      if (!employee) return;
      const verdict = expenseDecisionOn(
        d,
        employee.userId ?? null,
        managerUserIdOf(employee, employees),
        ctx,
        'approve',
        salary,
      );
      if (verdict === null || !verdict.ok) return;
      items.push({
        entityType,
        id: idOf(d),
        number: d.number ?? null,
        employeeId: d.employeeId,
        at: dateOf(d.submittedAt, dateOf(d.createdAt, new Date(0))),
        dueOn: null,
      });
    };
    for (const r of reports.slice(0, HR_LINKS_SCAN_MAX)) consider('expense_report', r, false);
    for (const a of advances.slice(0, HR_LINKS_SCAN_MAX)) {
      consider('advance', a, a.kind === 'salary');
    }
    return {
      items,
      truncated: reports.length > HR_LINKS_SCAN_MAX || advances.length > HR_LINKS_SCAN_MAX,
    };
  }

  private async toPayOf(
    organizationId: string,
    actor: HrLinksActor,
    employees: ReadonlyMap<string, EmployeeLean>,
    allowSoleApprover: boolean,
  ): Promise<{ items: HrLinkPiece[]; truncated: boolean }> {
    const projection = {
      number: 1,
      employeeId: 1,
      status: 1,
      steps: 1,
      approvals: 1,
      approvedAt: 1,
      createdAt: 1,
    };
    const [reports, advances, payers] = await Promise.all([
      this.connection
        .collection('hr_expense_reports')
        .find(
          { organizationId, status: { $in: ['approved', 'partially_settled'] } },
          { projection },
        )
        .sort({ approvedAt: 1, _id: 1 })
        .limit(HR_LINKS_SCAN_MAX + 1)
        .toArray() as unknown as Promise<ExpenseReportLean[]>,
      this.connection
        .collection('hr_advances')
        .find({ organizationId, status: 'approved' }, { projection })
        .sort({ approvedAt: 1, _id: 1 })
        .limit(HR_LINKS_SCAN_MAX + 1)
        .toArray() as unknown as Promise<EmployeeAdvanceLean[]>,
      this.authz.holdersOf(organizationId, 'payables.pay'),
    ]);
    const payerCount = new Set(payers).size;
    const items: HrLinkPiece[] = [];
    const consider = (
      entityType: HrLinkPiece['entityType'],
      d: ExpenseReportLean | EmployeeAdvanceLean,
    ) => {
      const employee = employees.get(d.employeeId);
      if (!employee) return;
      const verdict = reimbursementDecision({
        payerUserId: actor.userId,
        beneficiaryUserId: employee.userId ?? null,
        financeApproverUserId: financeApproverOf(d),
        payerCountInOrg: payerCount,
        allowSoleApprover,
      });
      if (!verdict.ok) return;
      items.push({
        entityType,
        id: idOf(d),
        number: d.number ?? null,
        employeeId: d.employeeId,
        at: dateOf(d.approvedAt, dateOf(d.createdAt, new Date(0))),
        dueOn: null,
      });
    };
    for (const r of reports.slice(0, HR_LINKS_SCAN_MAX)) consider('expense_report', r);
    for (const a of advances.slice(0, HR_LINKS_SCAN_MAX)) consider('advance', a);
    return {
      items,
      truncated: reports.length > HR_LINKS_SCAN_MAX || advances.length > HR_LINKS_SCAN_MAX,
    };
  }

  private async toSettleOf(
    organizationId: string,
    actor: HrLinksActor,
    selfId: string | null,
    today: string,
  ): Promise<{ items: HrLinkPiece[]; truncated: boolean }> {
    const approver = actor.actions.has('expenses.approve');
    const sensitive = actor.actions.has('hr.sensitive.read');
    const filter: Raw = {
      organizationId,
      status: { $in: ['disbursed', 'partially_settled'] },
      expectedSettlement: { $type: 'string' },
    };
    // Sans droit de validation : ses propres avances seulement.
    if (!approver) filter['employeeId'] = selfId;
    const rows = (await this.connection
      .collection('hr_advances')
      .find(filter)
      .sort({ expectedSettlement: 1, _id: 1 })
      .limit(HR_LINKS_SCAN_MAX + 1)
      .toArray()) as unknown as EmployeeAdvanceLean[];
    const items: HrLinkPiece[] = [];
    for (const a of rows.slice(0, HR_LINKS_SCAN_MAX)) {
      const own = selfId !== null && a.employeeId === selfId;
      // Une avance sur salaire n'existe que pour son bénéficiaire et les validateurs
      // habilités aux données sensibles (§ 4) : jamais pour le manager.
      if (!own && !(approver && (a.kind !== 'salary' || sensitive))) continue;
      const overdue = advanceFindings(advanceInputOf(a), today).find(
        (f) => f.code === 'ADVANCE_OVERDUE',
      );
      if (!overdue) continue;
      items.push({
        entityType: 'advance',
        id: idOf(a),
        number: a.number ?? null,
        employeeId: a.employeeId,
        at: new Date(`${overdue.dueOn}T00:00:00Z`),
        dueOn: overdue.dueOn,
      });
    }
    return { items, truncated: rows.length > HR_LINKS_SCAN_MAX };
  }

  private async correctionsOf(
    organizationId: string,
    actor: HrLinksActor,
    employees: ReadonlyMap<string, EmployeeLean>,
    allowSoleApprover: boolean,
  ): Promise<{ items: HrLinkCorrection[]; truncated: boolean }> {
    const holdsHrManage = actor.actions.has('hr.manage');
    const [rows, hrManagers] = await Promise.all([
      this.connection
        .collection('hr_attendance_corrections')
        .find(
          { organizationId, status: 'pending' },
          { projection: { employeeId: 1, date: 1, requestedBy: 1, createdAt: 1 } },
        )
        .sort({ createdAt: 1, _id: 1 })
        .limit(HR_LINKS_SCAN_MAX + 1)
        .toArray() as unknown as Promise<
        { _id: unknown; employeeId: string; date: string; requestedBy: string; createdAt?: Date }[]
      >,
      holdsHrManage ? this.authz.holdersOf(organizationId, 'hr.manage') : Promise.resolve([]),
    ]);
    const items: HrLinkCorrection[] = [];
    for (const c of rows.slice(0, HR_LINKS_SCAN_MAX)) {
      const employee = employees.get(c.employeeId);
      if (!employee) continue;
      const manager = managerUserIdOf(employee, employees);
      const verdict = attendanceCorrectionDecision({
        decision: 'approve',
        deciderUserId: actor.userId,
        beneficiaryUserId: employee.userId ?? null,
        requestedBy: c.requestedBy,
        isDesignatedManager: manager !== null && manager === actor.userId,
        hasOtherDesignatedManager: manager !== null && manager !== actor.userId,
        holdsHrManage,
        hrManagerCountInOrg: new Set(hrManagers).size,
        allowSoleApprover,
      });
      if (!verdict.ok) continue;
      items.push({
        id: idOf(c),
        employeeId: c.employeeId,
        date: c.date,
        at: dateOf(c.createdAt, new Date(0)),
      });
    }
    return { items, truncated: rows.length > HR_LINKS_SCAN_MAX };
  }
}
