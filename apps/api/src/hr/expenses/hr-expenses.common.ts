// Briques communes des notes de frais et des avances (ADR-0051 § 1, § 3). ADR-0051 — H10.
//
// - Numérotation `NF{AA}{MM}-NNNNNN` et `AV{AA}{MM}-NNNNNN` : compteur ANNUEL par
//   organisation et par nature (`hr_counters`), dans la transaction de l'appelant, trous
//   admis — motif des pièces `PF…` des achats (ADR-0044).
// - Circuit : étape en cours, décision de séparation des tâches
//   (`expenseApprovalDecision`, droits EFFECTIFS et relation, jamais un rôle).
// - Erreurs HTTP nommées par l'ADR.
// - Justificatifs : chiffrement par enveloppe (motif des documents RH d'ADR-0045 § 2.8,
//   AAD = organisation + note + objet), quand le trousseau est configuré.

import { ForbiddenException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import type { ClientSession, Model } from 'mongoose';

import {
  openEnvelopeBlob,
  sealEnvelopeBlob,
  type EnvelopeIdentity,
} from '../../integrations/envelope-blob-crypto.js';
import type {
  EncryptedValue,
  MasterKeyring,
  SecretLocation,
} from '../../integrations/secrets-crypto.js';
import {
  expenseApprovalDecision,
  reimbursementDecision,
  type Action,
  type ExpenseApprovalDecision,
  type ReimbursementDecision,
} from '../../authz/permissions.js';
import { conflict, isDuplicateKey } from '../../sales/sales.errors.js';
import { employeeNotFound } from '../scope/hr-errors.js';
import type { HrViewer } from '../scope/hr-scope.service.js';
import { fiscalYearOf, periodInYear } from '../../sales/invoices/invoice-numbering.js';
import type { EmployeeLean } from '../employees/employee.schema.js';
import type { HrCounter, HrCounterDocument } from './hr-counter.schema.js';

// ── Numérotation ────────────────────────────────────────────────────────────

/** Numéro suivant `NF…` ou `AV…`, au jour de Kinshasa, dans la transaction. */
export async function nextHrNumber(
  counters: Model<HrCounterDocument>,
  organizationId: string,
  prefix: 'NF' | 'AV',
  now: Date,
  session: ClientSession,
): Promise<string> {
  const year = fiscalYearOf(now);
  const bump = () =>
    counters
      .findOneAndUpdate(
        { organizationId, kind: prefix, year },
        { $inc: { last: 1 }, $setOnInsert: { _schemaVersion: 1 } },
        { upsert: true, new: true, session },
      )
      .lean<HrCounter>()
      .exec();
  let counter: HrCounter | null;
  try {
    counter = await bump();
  } catch (err) {
    // Première création concurrente du compteur : la seconde bute sur l'index unique.
    if (!isDuplicateKey(err)) throw err;
    counter = await bump();
  }
  const period = periodInYear(year, now);
  const yy = String(period.year % 100).padStart(2, '0');
  const mm = String(period.month).padStart(2, '0');
  return `${prefix}${yy}${mm}-${String(counter!.last).padStart(6, '0')}`;
}

// ── Circuit ─────────────────────────────────────────────────────────────────

export type ApprovalStep = 'manager' | 'finance';

export interface Decidable {
  status: string;
  steps: ApprovalStep[];
  approvals: { step: ApprovalStep; userId: string; decision: 'approved' | 'rejected' }[];
}

/** Étape en attente d'une pièce `submitted`, sinon `null`. */
export function currentStepOf(d: Decidable): ApprovalStep | null {
  if (d.status !== 'submitted') return null;
  const done = d.approvals.filter((a) => a.decision === 'approved').length;
  return d.steps[done] ?? null;
}

/** Celui qui a tenu l'étape `finance` (approbation finale), sinon `null`. */
export function financeApproverOf(d: Decidable): string | null {
  return d.approvals.find((a) => a.step === 'finance' && a.decision === 'approved')?.userId ?? null;
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

export interface ExpenseApproverContext {
  userId: string;
  actions: ReadonlySet<Action>;
  /** Détenteurs effectifs d'`expenses.approve` (`countApprovers`). */
  approverCount: number;
  allowSoleApprover: boolean;
}

/** Décision de séparation des tâches pour l'étape en cours ; `null` si rien n'attend. */
export function expenseDecisionOn(
  d: Decidable & { createdBy: string },
  beneficiaryUserId: string | null,
  managerUserId: string | null,
  ctx: ExpenseApproverContext,
  decision: 'approve' | 'reject',
  salaryAdvance: boolean,
): ExpenseApprovalDecision | null {
  const step = currentStepOf(d);
  if (step === null) return null;
  return expenseApprovalDecision({
    decision,
    approverUserId: ctx.userId,
    beneficiaryUserId,
    createdBy: d.createdBy,
    step,
    salaryAdvance,
    isDesignatedManager: managerUserId !== null && managerUserId === ctx.userId,
    holdsExpensesApprove: ctx.actions.has('expenses.approve'),
    holdsHrSensitiveRead: ctx.actions.has('hr.sensitive.read'),
    priorApproverUserIds: d.approvals.filter((a) => a.decision === 'approved').map((a) => a.userId),
    approverCountInOrg: ctx.approverCount,
    allowSoleApprover: ctx.allowSoleApprover,
  });
}

/** Refus de la séparation des tâches → réponse HTTP (codes nommés par l'ADR § 3). */
export function refuseApproval(decision: Extract<ExpenseApprovalDecision, { ok: false }>): never {
  if (decision.code === 'ADVANCE_SALARY_NOT_YOUR_STEP') {
    throw new ForbiddenException({
      code: 'ADVANCE_SALARY_NOT_YOUR_STEP',
      message:
        'Une avance sur salaire se valide par un détenteur de « Valider les notes de frais et les avances » et des données sensibles du personnel.',
    });
  }
  if (decision.code === 'EXPENSE_NOT_YOUR_STEP') {
    throw new ForbiddenException({
      code: 'EXPENSE_NOT_YOUR_STEP',
      message: 'Cette étape de validation ne vous revient pas.',
    });
  }
  if (decision.code === 'SELF_APPROVAL_FORBIDDEN') {
    conflict('SELF_APPROVAL_FORBIDDEN', 'On ne valide pas sa propre demande.');
  }
  if (decision.code === 'CREATOR_APPROVAL_FORBIDDEN') {
    conflict(
      'CREATOR_APPROVAL_FORBIDDEN',
      'Vous avez saisi cette demande pour un collaborateur : une autre personne la valide.',
    );
  }
  conflict(
    'APPROVER_ALREADY_APPROVED',
    'Vous avez déjà validé une étape : une autre personne valide la suivante.',
  );
}

/** Payeur : `reimbursementDecision` ; refus → 409 nommé. */
export function payerDecision(input: {
  payerUserId: string;
  beneficiaryUserId: string | null;
  financeApproverUserId: string | null;
  payerCount: number;
  allowSoleApprover: boolean;
}): Extract<ReimbursementDecision, { ok: true }> {
  const verdict = reimbursementDecision({
    payerUserId: input.payerUserId,
    beneficiaryUserId: input.beneficiaryUserId,
    financeApproverUserId: input.financeApproverUserId,
    payerCountInOrg: input.payerCount,
    allowSoleApprover: input.allowSoleApprover,
  });
  if (verdict.ok) return verdict;
  if (verdict.code === 'SELF_PAYMENT_FORBIDDEN') {
    conflict('SELF_PAYMENT_FORBIDDEN', 'On ne se rembourse pas soi-même.');
  }
  conflict(
    'APPROVER_CANNOT_PAY',
    'Vous avez validé cette demande : une autre personne habilitée la paie.',
  );
}

// ── Bénéficiaire ────────────────────────────────────────────────────────────

/**
 * Bénéficiaire d'une note ou d'une avance (§ 2.1) : la fiche reliée à l'appelant
 * (`409 EMPLOYEE_NOT_LINKED` sinon), ou — avec `hr.manage` — un collaborateur SANS compte
 * (chauffeur). Une fiche hors portée : 404 ; un manager ou un lecteur RH sans
 * `hr.manage` : 403.
 */
export function resolveBeneficiary(viewer: HrViewer, employeeId: string | undefined): EmployeeLean {
  const self = viewer.scope.selfEmployeeId;
  if (employeeId === undefined || employeeId === self) {
    if (!self) notLinked();
    const e = viewer.byId.get(self)!;
    if (e.status !== 'active') conflict('EMPLOYEE_NOT_ACTIVE', 'Votre dossier n’est plus actif.');
    return e;
  }
  const e = viewer.byId.get(employeeId);
  if (!e) employeeNotFound();
  if (!viewer.actions.has('hr.manage')) {
    if (viewer.scope.teamEmployeeIds.includes(employeeId) || viewer.actions.has('hr.read')) {
      forbiddenAction(
        'hr.manage',
        viewer.role,
        'Saisir pour un collaborateur exige la gestion du personnel.',
      );
    }
    employeeNotFound();
  }
  if (e.status !== 'active') conflict('EMPLOYEE_NOT_ACTIVE', 'Ce collaborateur n’est plus actif.');
  if (e.userId) {
    conflict(
      'EMPLOYEE_HAS_ACCOUNT',
      'Ce collaborateur a un compte : il déclare lui-même ses frais.',
    );
  }
  return e;
}

// ── Erreurs ─────────────────────────────────────────────────────────────────

export function featureDisabled(what: string): never {
  conflict('HR_FEATURE_DISABLED', `${what} : fonction désactivée par les réglages RH.`);
}

export function notLinked(): never {
  conflict(
    'EMPLOYEE_NOT_LINKED',
    'Aucun dossier collaborateur n’est relié à votre compte : demandez aux RH de le créer.',
  );
}

export function unprocessable(code: string, message: string, details?: object): never {
  throw new HttpException(
    { code, message, ...(details ? { details } : {}) },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

export function forbiddenAction(action: Action, role: string | null, message: string): never {
  throw new ForbiddenException({ code: 'FORBIDDEN', action, role, customized: false, message });
}

export function reportNotFound(): never {
  throw new NotFoundException({
    code: 'EXPENSE_REPORT_NOT_FOUND',
    message: 'Note de frais introuvable.',
  });
}

export function advanceNotFound(): never {
  throw new NotFoundException({ code: 'ADVANCE_NOT_FOUND', message: 'Avance introuvable.' });
}

export function wrongStatus(code: string, message: string): never {
  conflict(code, message);
}

// ── Justificatifs chiffrés ──────────────────────────────────────────────────

const RECEIPT_MAGIC = Buffer.from('LHR1', 'latin1');

export interface ReceiptIdentity {
  organizationId: string;
  reportId: string;
  objectId: string;
}

/** Emplacement cryptographique de la clé enveloppée d'un justificatif. */
export function expenseReceiptKeyLocation(id: ReceiptIdentity): SecretLocation {
  const triple = `${id.organizationId}:${id.reportId}:${id.objectId}`;
  return { documentId: triple, provider: 'org:hr_expense_receipts', secretName: triple };
}

function receiptEnvelope(id: ReceiptIdentity): EnvelopeIdentity {
  return {
    magic: RECEIPT_MAGIC,
    aad: Buffer.from(`hr_expense_receipts:${id.organizationId}:${id.reportId}:${id.objectId}`),
    location: expenseReceiptKeyLocation(id),
  };
}

export function sealReceipt(
  id: ReceiptIdentity,
  bytes: Buffer,
  keyring: MasterKeyring,
  updatedBy: string,
): { blob: Buffer; wrappedKey: EncryptedValue } {
  return sealEnvelopeBlob(receiptEnvelope(id), bytes, keyring, updatedBy);
}

export function openReceipt(
  id: ReceiptIdentity,
  blob: Buffer,
  wrappedKey: EncryptedValue,
  keyring: MasterKeyring,
): Buffer {
  return openEnvelopeBlob(receiptEnvelope(id), blob, wrappedKey, keyring);
}
