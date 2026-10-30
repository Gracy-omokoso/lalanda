// Demandes d'absence que l'appelant peut traiter (ADR-0045 § 3.2, § 4.3, § 6.1).
// ADR-0045 — H3.
//
// LECTURE SEULE, partagée par `GET /hr/leave-approvals/pending` et par la source
// « Mes tâches » (`HR_AGENDA_SOURCE`). Une demande y figure si la séparation des
// tâches (`leaveApprovalDecision`) laisse l'appelant la VALIDER à l'étape en cours :
// manager désigné, ou détenteur effectif de `leave.approve` ; jamais la sienne, sauf
// approbateur unique ; jamais une étape RH après avoir tenu l'étape manager.

import { HR_SETTINGS_DEFAULTS } from '@lalanda/shared/hr';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { AuthzService } from '../../authz/authz.service.js';
import {
  Employee,
  type EmployeeDocument,
  type EmployeeLean,
} from '../employees/employee.schema.js';
import { decisionOn, managerUserIdOf, type ApproverContext } from '../leave/leave-model.js';
import {
  LeaveRequest,
  type LeaveRequestDocument,
  type LeaveRequestLean,
} from '../leave/leave-request.schema.js';
import {
  LeaveType,
  type LeaveTypeDocument,
  type LeaveTypeLean,
} from '../leave/leave-type.schema.js';

/** Demandes en attente lues au plus par organisation (borne de sûreté). */
const PENDING_SCAN_MAX = 2_000;

export interface PendingApprovals {
  requests: LeaveRequestLean[];
  employees: ReadonlyMap<string, EmployeeLean>;
  types: ReadonlyMap<string, LeaveTypeLean>;
  context: ApproverContext;
}

@Injectable()
export class HrLeaveApprovalsReader {
  constructor(
    @InjectModel(LeaveRequest.name) private readonly requests: Model<LeaveRequestDocument>,
    @InjectModel(Employee.name) private readonly employees: Model<EmployeeDocument>,
    @InjectModel(LeaveType.name) private readonly types: Model<LeaveTypeDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(AuthzService) private readonly authz: AuthzService,
  ) {}

  /** Contexte d'approbation de l'appelant (réglage, nombre de validateurs). */
  async contextOf(
    organizationId: string,
    userId: string,
    holdsLeaveApprove: boolean,
  ): Promise<ApproverContext> {
    const [settings, approverCount] = await Promise.all([
      this.connection
        .collection('hr_settings')
        .findOne({ organizationId }, { projection: { allowSoleApprover: 1 } }),
      this.authz.countApprovers(organizationId, 'leave.approve'),
    ]);
    const allow =
      typeof settings?.['allowSoleApprover'] === 'boolean'
        ? (settings['allowSoleApprover'] as boolean)
        : HR_SETTINGS_DEFAULTS.allowSoleApprover;
    return { userId, holdsLeaveApprove, approverCount, allowSoleApprover: allow };
  }

  async pendingFor(
    organizationId: string,
    userId: string,
    holdsLeaveApprove: boolean,
  ): Promise<PendingApprovals> {
    const [context, pending] = await Promise.all([
      this.contextOf(organizationId, userId, holdsLeaveApprove),
      this.requests
        .find({ organizationId, status: 'pending' })
        .sort({ createdAt: 1, _id: 1 })
        .limit(PENDING_SCAN_MAX)
        .lean<LeaveRequestLean[]>()
        .exec(),
    ]);
    if (pending.length === 0) {
      return { requests: [], employees: new Map(), types: new Map(), context };
    }
    const [employees, types] = await Promise.all([
      this.employees
        .find(
          { organizationId },
          {
            firstName: 1,
            lastName: 1,
            preferredName: 1,
            userId: 1,
            status: 1,
            managerEmployeeId: 1,
            departmentId: 1,
          },
        )
        .lean<EmployeeLean[]>()
        .exec(),
      this.types.find({ organizationId }).lean<LeaveTypeLean[]>().exec(),
    ]);
    const byId = new Map(employees.map((e) => [String(e._id), e]));
    const requests = pending.filter((r) => {
      const employee = byId.get(r.employeeId);
      if (!employee) return false;
      const verdict = decisionOn(
        r,
        employee.userId ?? null,
        managerUserIdOf(employee, byId),
        context,
        'approve',
      );
      return verdict !== null && verdict.ok;
    });
    return {
      requests,
      employees: byId,
      types: new Map(types.map((t) => [String(t._id), t])),
      context,
    };
  }
}
