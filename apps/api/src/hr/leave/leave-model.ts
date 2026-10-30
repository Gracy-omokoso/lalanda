// Règles pures des demandes d'absence (ADR-0045 § 2.5, § 2.7, § 4.3). ADR-0045 — H3.
//
// Aucune lecture de base ici : l'étape en cours, la décision de séparation des tâches
// (`leaveApprovalDecision`, droits EFFECTIFS et relation, jamais un rôle), le manager
// désigné d'un collaborateur et le masquage d'un type confidentiel.

import {
  HR_CONFIDENTIAL_LEAVE_LABEL,
  type LeaveApprovalStepKey,
  type LeaveRequestStatus,
} from '@lalanda/shared/hr';

import { leaveApprovalDecision, type LeaveApprovalDecision } from '../../authz/permissions.js';
import type { EmployeeLean } from '../employees/employee.schema.js';
import type { StoredApproval } from './leave-request.schema.js';

export interface DecidableRequest {
  status: LeaveRequestStatus;
  steps: LeaveApprovalStepKey[];
  approvals: StoredApproval[];
}

/** Étape en attente d'une demande `pending`, sinon `null`. */
export function currentStepOf(r: DecidableRequest): LeaveApprovalStepKey | null {
  if (r.status !== 'pending') return null;
  const done = r.approvals.filter((a) => a.decision === 'approved').length;
  return r.steps[done] ?? null;
}

/** Compte du manager désigné, s'il est un collaborateur actif relié à un compte. */
export function managerUserIdOf(
  employee: Pick<EmployeeLean, 'managerEmployeeId'>,
  byId: ReadonlyMap<string, Pick<EmployeeLean, 'status' | 'userId'>>,
): string | null {
  const managerId = employee.managerEmployeeId ?? null;
  if (managerId === null) return null;
  const manager = byId.get(managerId);
  return manager && manager.status === 'active' && manager.userId ? manager.userId : null;
}

export interface ApproverContext {
  userId: string;
  /** `leave.approve` dans les droits EFFECTIFS de l'appelant. */
  holdsLeaveApprove: boolean;
  /** Détenteurs effectifs de `leave.approve` dans l'organisation (`countApprovers`). */
  approverCount: number;
  allowSoleApprover: boolean;
}

/** Décision de séparation des tâches pour l'étape en cours, `null` si rien n'est en attente. */
export function decisionOn(
  r: DecidableRequest,
  beneficiaryUserId: string | null,
  managerUserId: string | null,
  ctx: ApproverContext,
  decision: 'approve' | 'reject',
): LeaveApprovalDecision | null {
  const step = currentStepOf(r);
  if (step === null) return null;
  return leaveApprovalDecision({
    decision,
    approverUserId: ctx.userId,
    beneficiaryUserId,
    step,
    isDesignatedManager: managerUserId !== null && managerUserId === ctx.userId,
    holdsLeaveApprove: ctx.holdsLeaveApprove,
    priorApproverUserIds: r.approvals.filter((a) => a.decision === 'approved').map((a) => a.userId),
    approverCountInOrg: ctx.approverCount,
    allowSoleApprover: ctx.allowSoleApprover,
  });
}

/**
 * Le lecteur voit-il le type (et le motif) d'une absence ? (§ 2.5) Oui pour un type
 * ordinaire ; pour un type confidentiel : le collaborateur lui-même, les détenteurs
 * de `hr.sensitive.read` et ceux de `leave.approve` (l'étape RH qui la valide).
 */
export function seesLeaveType(input: {
  confidential: boolean;
  isSelf: boolean;
  seesConfidential: boolean;
  holdsLeaveApprove: boolean;
}): boolean {
  return !input.confidential || input.isSelf || input.seesConfidential || input.holdsLeaveApprove;
}

export const MASKED_LEAVE_LABEL = HR_CONFIDENTIAL_LEAVE_LABEL;
/** Libellé neutre de l'élément « Mes tâches » d'un type masqué (§ 6.1). */
export const MASKED_AGENDA_LABEL = 'Absence';
