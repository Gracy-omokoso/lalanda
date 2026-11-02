// Avances au personnel : demande, circuit, versement, régularisations, motif sensible
// (ADR-0051 § 2.2, § 3.2, § 3.3, § 4, § 7.1, § 7.2). ADR-0051 — H10.
//
// - AUCUN plafond posé par Lalanda : un plafond SAISI par l'organisation refuse au-delà
//   (`checkAdvanceRequest`, moteur) ; une avance sur salaire NE LIT JAMAIS le salaire ;
//   elle est ÉTEINTE par défaut. AUCUNE retenue n'est calculée (paie exclue, O3) ; la
//   régularisation « sur la paie, hors Lalanda » est une DÉCLARATION, éteinte par défaut.
// - Reste dû, statut de l'argent, constats : moteur (`advanceOutstanding`,
//   `checkAdvanceSettlement`, `advanceFindings`). Rien n'est additionné ici.
// - Versement : un mouvement `other_out` possédé par les RH (`recordOwnedByAdvance`),
//   libellé neutre posé par la trésorerie, DANS la transaction ; retour en espèces : un
//   `other_in`. Une avance n'est pas une charge : aucune dépense, rien au réalisé.
// - Confidentialité : une avance sur salaire n'existe pas pour le manager ni pour
//   `hr.read` seul (404) ; le payeur en voit le numéro, le montant, la date — jamais la
//   nature ni le motif ; le motif est chiffré et sa lecture journalisée strictement.

import {
  advanceApprovalSteps,
  advanceFindings,
  advanceOutstanding,
  checkAdvanceRequest,
  checkAdvanceSettlement,
} from '@lalanda/engine';
import {
  type AdvancePage,
  type AdvanceReasonView,
  type AdvanceView,
  type CancelDisbursementBody,
  type CancelExpenseBody,
  type CreateAdvanceBody,
  type CreateAdvanceSettlementBody,
  type DisburseAdvanceBody,
  type ListAdvancesQuery,
  type RejectExpenseBody,
  type ApproveExpenseBody,
  type SubmitAdvanceBody,
  type UpdateAdvanceBody,
} from '@lalanda/shared/hr';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { AuthzService } from '../../authz/authz.service.js';
import { MASTER_KEYRING } from '../../integrations/keyring.provider.js';
import type { MasterKeyring } from '../../integrations/secrets-crypto.js';
import { conflict, invalidCursor, staleRevision } from '../../sales/sales.errors.js';
import { decodeCursor, encodeCursor } from '../../sales/search.js';
import { TreasuryMovementsService } from '../../treasury/treasury-movements.service.js';
import type { HrActor } from '../departments/hr-departments.service.js';
import type { EmployeeLean } from '../employees/employee.schema.js';
import { displayNameOf } from '../leave/display-name.js';
import {
  auditUnavailable,
  employeeNotFound,
  hrToday,
  inHrTransaction,
  privateUnreadable,
  secretsNotConfigured,
} from '../scope/hr-errors.js';
import type { HrViewer } from '../scope/hr-scope.service.js';
import {
  advanceNotFound,
  currentStepOf,
  expenseDecisionOn,
  financeApproverOf,
  forbiddenAction,
  managerUserIdOf,
  nextHrNumber,
  payerDecision,
  refuseApproval,
  resolveBeneficiary,
  unprocessable,
} from '../expenses/hr-expenses.common.js';
import {
  HR_EXPENSES_TO_APPROVE_HREF,
  HR_EXPENSES_TO_PAY_HREF,
  HR_MY_EXPENSES_HREF,
  HrExpensesNotifier,
} from '../expenses/hr-expenses-notifier.js';
import { HrExpensesSettingsService } from '../expenses/hr-expenses-settings.service.js';
import {
  EmployeeAdvance,
  type EmployeeAdvanceDocument,
  type EmployeeAdvanceLean,
  type StoredAdvanceApproval,
  type StoredSettlement,
} from './advance.schema.js';
import {
  advanceAccessOf,
  advanceInputOf,
  liveSettlements,
  moneyStatusOf,
  seesAdvance,
  type AdvanceAccess,
} from './advance-model.js';
import { openAdvanceReason, sealAdvanceReason } from './advance-reason-crypto.js';

const WORK_PROJECTS = 'work_projects';
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

@Injectable()
export class HrAdvancesService {
  constructor(
    @InjectModel(EmployeeAdvance.name) private readonly advances: Model<EmployeeAdvanceDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(HrExpensesSettingsService) private readonly settings: HrExpensesSettingsService,
    @Inject(TreasuryMovementsService) private readonly movements: TreasuryMovementsService,
    @Inject(HrExpensesNotifier) private readonly notifier: HrExpensesNotifier,
    @Inject(MASTER_KEYRING) private readonly keyring: MasterKeyring | null,
  ) {}

  // ── Portée et vues ───────────────────────────────────────────────────────

  private accessOf(viewer: HrViewer, a: EmployeeAdvanceLean): AdvanceAccess {
    return advanceAccessOf(a, {
      userId: viewer.userId,
      actions: viewer.actions,
      selfEmployeeId: viewer.scope.selfEmployeeId,
      teamEmployeeIds: viewer.scope.teamEmployeeIds,
    });
  }

  viewOf(viewer: HrViewer, a: EmployeeAdvanceLean): AdvanceView {
    const access = this.accessOf(viewer, a);
    const input = advanceInputOf(a);
    const o = advanceOutstanding(input);
    const employee = viewer.byId.get(a.employeeId);
    const detail = access.sensitive;
    const live = liveSettlements(a);
    const findings = detail
      ? advanceFindings(input, hrToday()).map((f) => {
          const s = f.settlementId ? live.find((x) => x.id === f.settlementId) : undefined;
          return {
            code: f.code,
            dueOn: f.dueOn,
            // Le mois DÉCLARÉ (référence `AAAA-MM`) prime la date de saisie.
            payrollMonth: s?.reference && MONTH.test(s.reference) ? s.reference : f.payrollMonth,
          };
        })
      : [];
    return {
      id: String(a._id),
      number: a.number ?? null,
      employeeId: a.employeeId,
      employeeName: employee ? displayNameOf(employee) : '',
      kind: detail ? a.kind : null,
      label: detail && a.kind === 'salary' ? 'Avance sur salaire' : 'Avance',
      amount: a.amount,
      currency: a.currency,
      // Motif d'une avance sur salaire : jamais dans une vue (route `reveal-reason`).
      reason: a.kind === 'expenses' ? (a.reason ?? null) : null,
      hasReason: a.kind === 'expenses' ? Boolean(a.reason) : a.reasonSealed !== null,
      purpose: a.purpose ?? null,
      workProjectId: a.workProjectId ?? null,
      expectedSettlement: detail ? (a.expectedSettlement ?? null) : null,
      status: a.status,
      steps: a.steps,
      currentStep: currentStepOf(a),
      approvals: detail
        ? a.approvals.map((x) => ({
            step: x.step,
            userId: x.userId,
            decision: x.decision,
            at: new Date(x.at).toISOString(),
            comment: x.comment ?? null,
            soleApprover: x.soleApprover,
            onBehalfOfManager: x.onBehalfOfManager,
          }))
        : [],
      disbursement: a.disbursement
        ? {
            paidOn: a.disbursement.paidOn,
            accountId: a.disbursement.accountId,
            method: a.disbursement.method,
            reference: a.disbursement.reference ?? null,
            paidBy: a.disbursement.paidBy,
            movementId: a.disbursement.movementId,
            soleApprover: a.disbursement.soleApprover,
          }
        : null,
      settlements: detail
        ? (a.settlements ?? []).map((s) => ({
            id: s.id,
            kind: s.kind,
            amount: s.amount,
            on: s.on,
            reference: s.reference ?? null,
            note: s.note ?? null,
            by: s.by,
            at: new Date(s.at).toISOString(),
            expenseReportId: s.expenseReportId ?? null,
            movementId: s.movementId ?? null,
            cancelledAt: s.cancelledAt ? new Date(s.cancelledAt).toISOString() : null,
          }))
        : [],
      disbursed: o.disbursed,
      settled: detail ? o.settled : '0.00',
      outstanding: detail ? o.outstanding : '0.00',
      findings,
      submittedAt: a.submittedAt ? new Date(a.submittedAt).toISOString() : null,
      createdBy: a.createdBy,
      createdAt: new Date(a.createdAt).toISOString(),
      cancelReason: detail ? (a.cancelReason ?? null) : null,
      revision: a.revision,
    };
  }

  private async requireOwn(
    organizationId: string,
    advanceId: string,
  ): Promise<EmployeeAdvanceLean> {
    if (!/^[0-9a-f]{24}$/i.test(advanceId)) advanceNotFound();
    const a = await this.advances
      .findOne({ _id: new Types.ObjectId(advanceId), organizationId })
      .lean<EmployeeAdvanceLean>()
      .exec();
    if (!a) advanceNotFound();
    return a;
  }

  private async requireVisible(
    organizationId: string,
    viewer: HrViewer,
    advanceId: string,
  ): Promise<{ a: EmployeeAdvanceLean; access: AdvanceAccess; employee: EmployeeLean }> {
    const a = await this.requireOwn(organizationId, advanceId);
    const employee = viewer.byId.get(a.employeeId);
    const access = this.accessOf(viewer, a);
    if (!employee || !seesAdvance(access, a.status)) advanceNotFound();
    return { a, access, employee };
  }

  async get(organizationId: string, viewer: HrViewer, advanceId: string): Promise<AdvanceView> {
    const { a } = await this.requireVisible(organizationId, viewer, advanceId);
    return this.viewOf(viewer, a);
  }

  async list(
    organizationId: string,
    viewer: HrViewer,
    query: ListAdvancesQuery,
  ): Promise<AdvancePage> {
    const and: Record<string, unknown>[] = [{ organizationId }];
    if (query.employeeId !== undefined) {
      if (!viewer.byId.has(query.employeeId)) employeeNotFound();
      and.push({ employeeId: query.employeeId });
    }
    if (query.status !== undefined) and.push({ status: query.status });
    if (query.kind !== undefined) and.push({ kind: query.kind });
    if (query.cursor !== undefined) {
      const c = decodeCursor(query.cursor);
      if (c === null) invalidCursor();
      and.push({ _id: { $lt: c.id } });
    }
    // Portée large en base, filtrée ensuite par `seesAdvance` (une avance sur salaire n'est
    // jamais montrée au manager ni à `hr.read` seul) ; page bornée.
    const out: EmployeeAdvanceLean[] = [];
    let cursor: Types.ObjectId | null = null;
    for (let round = 0; round < 10 && out.length <= query.limit; round += 1) {
      const filter: Record<string, unknown> = {
        $and: [...and, ...(cursor ? [{ _id: { $lt: cursor } }] : [])],
      };
      const batch = await this.advances
        .find(filter)
        .sort({ _id: -1 })
        .limit(200)
        .lean<EmployeeAdvanceLean[]>()
        .exec();
      for (const a of batch) {
        if (viewer.byId.has(a.employeeId) && seesAdvance(this.accessOf(viewer, a), a.status)) {
          out.push(a);
        }
      }
      if (batch.length < 200) break;
      cursor = batch[batch.length - 1]!._id;
    }
    const page = out.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((a) => this.viewOf(viewer, a)),
      nextCursor: out.length > query.limit && last ? encodeCursor('', String(last._id)) : null,
    };
  }

  // ── Demande ──────────────────────────────────────────────────────────────

  private async checkRequest(
    organizationId: string,
    req: { kind: 'expenses' | 'salary'; currency: 'CDF' | 'USD'; amount: string },
  ): Promise<void> {
    const s = await this.settings.of(organizationId);
    const check = checkAdvanceRequest(req, s.advances);
    if (check.ok) return;
    if (check.code === 'ADVANCE_KIND_DISABLED') {
      conflict(
        'ADVANCE_KIND_DISABLED',
        req.kind === 'salary'
          ? 'Les avances sur salaire ne sont pas ouvertes dans cette organisation.'
          : 'Les avances de frais ne sont pas ouvertes dans cette organisation.',
      );
    }
    unprocessable(
      check.code ?? 'ADVANCE_AMOUNT_INVALID',
      'Ce montant dépasse le plafond saisi par votre organisation.',
    );
  }

  private async checkProject(organizationId: string, workProjectId: string | null): Promise<void> {
    if (!workProjectId) return;
    const p = await this.connection
      .collection(WORK_PROJECTS)
      .findOne(
        { _id: new Types.ObjectId(workProjectId), organizationId, status: { $ne: 'archived' } },
        { projection: { _id: 1 } },
      );
    if (!p) unprocessable('EXPENSE_WORK_PROJECT_UNKNOWN', 'Projet introuvable ou archivé.');
  }

  private sealReason(organizationId: string, advanceId: string, reason: string, actor: HrActor) {
    if (!this.keyring) secretsNotConfigured();
    return sealAdvanceReason({
      organizationId,
      advanceId,
      reason,
      keyring: this.keyring,
      updatedBy: actor.userId,
    });
  }

  async create(
    organizationId: string,
    viewer: HrViewer,
    body: CreateAdvanceBody,
    actor: HrActor,
  ): Promise<AdvanceView> {
    await this.checkRequest(organizationId, body);
    const employee = resolveBeneficiary(viewer, body.employeeId);
    await this.checkProject(organizationId, body.workProjectId ?? null);
    const _id = new Types.ObjectId();
    const salary = body.kind === 'salary';
    const reason = body.reason ?? null;
    await this.advances.create({
      _id,
      organizationId,
      number: null,
      employeeId: String(employee._id),
      kind: body.kind,
      amount: body.amount,
      currency: body.currency,
      reason: salary ? null : reason,
      reasonSealed:
        salary && reason ? this.sealReason(organizationId, String(_id), reason, actor) : null,
      purpose: salary ? null : (body.purpose ?? null),
      workProjectId: salary ? null : (body.workProjectId ?? null),
      expectedSettlement: body.expectedSettlement ?? null,
      status: 'draft',
      steps: [],
      approvals: [],
      disbursement: null,
      settlements: [],
      createdBy: actor.userId,
      updatedBy: actor.userId,
      revision: 1,
      _schemaVersion: 1,
    });
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.advance.created',
      targetType: 'hr_advance',
      targetId: String(_id),
      // Jamais le motif ni le montant d'une avance sur salaire.
      metadata: { employeeId: String(employee._id), kind: body.kind },
    });
    return this.get(organizationId, viewer, String(_id));
  }

  private async requireOwnDraft(
    organizationId: string,
    viewer: HrViewer,
    advanceId: string,
  ): Promise<EmployeeAdvanceLean> {
    const { a, access } = await this.requireVisible(organizationId, viewer, advanceId);
    if (!access.self && !access.creator) {
      forbiddenAction('expenses.claim', viewer.role, 'Seul le demandeur modifie sa demande.');
    }
    if (a.status !== 'draft') conflict('ADVANCE_NOT_DRAFT', 'Seul un brouillon se modifie.');
    return a;
  }

  async update(
    organizationId: string,
    viewer: HrViewer,
    advanceId: string,
    body: UpdateAdvanceBody,
    actor: HrActor,
  ): Promise<AdvanceView> {
    const a = await this.requireOwnDraft(organizationId, viewer, advanceId);
    if (body.expectedRevision !== a.revision) staleRevision(a.revision);
    const salary = a.kind === 'salary';
    if (salary && ((body.purpose ?? null) !== null || (body.workProjectId ?? null) !== null)) {
      unprocessable(
        'ADVANCE_SALARY_NO_PURPOSE',
        'Une avance sur salaire ne porte ni objet de mission ni projet.',
      );
    }
    const amount = body.amount ?? a.amount;
    const currency = body.currency ?? a.currency;
    await this.checkRequest(organizationId, { kind: a.kind, currency, amount });
    const workProjectId = body.workProjectId === undefined ? a.workProjectId : body.workProjectId;
    if (!salary) await this.checkProject(organizationId, workProjectId ?? null);
    const set: Record<string, unknown> = { amount, currency, updatedBy: actor.userId };
    if (body.reason !== undefined) {
      if (salary) {
        set['reasonSealed'] = body.reason
          ? this.sealReason(organizationId, advanceId, body.reason, actor)
          : null;
      } else set['reason'] = body.reason;
    }
    if (!salary) {
      if (body.purpose !== undefined) set['purpose'] = body.purpose;
      set['workProjectId'] = workProjectId ?? null;
    }
    if (body.expectedSettlement !== undefined) set['expectedSettlement'] = body.expectedSettlement;
    const res = await this.advances
      .updateOne(
        { _id: a._id, organizationId, revision: a.revision, status: 'draft' },
        { $set: set, $inc: { revision: 1 } },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision(a.revision + 1);
    return this.get(organizationId, viewer, advanceId);
  }

  // ── Soumission et circuit ────────────────────────────────────────────────

  async submit(
    organizationId: string,
    viewer: HrViewer,
    advanceId: string,
    body: SubmitAdvanceBody,
    actor: HrActor,
  ): Promise<AdvanceView> {
    const a = await this.requireOwnDraft(organizationId, viewer, advanceId);
    if (body.expectedRevision !== a.revision) staleRevision(a.revision);
    await this.checkRequest(organizationId, a);
    const employee = viewer.byId.get(a.employeeId)!;
    if (employee.status !== 'active') {
      conflict('EMPLOYEE_NOT_ACTIVE', 'Ce collaborateur n’est plus actif.');
    }
    const s = await this.settings.of(organizationId);
    const steps = advanceApprovalSteps(
      a.kind,
      { approvalFlow: s.expenses.approvalFlow },
      {
        managerEmployeeId: employee.managerEmployeeId ?? null,
        managerUserId: managerUserIdOf(employee, viewer.byId),
      },
      employee.userId ?? null,
    );
    const now = new Date();
    await inHrTransaction(this.connection, async (session) => {
      const number = await nextHrNumber(this.connection, organizationId, 'AV', now, session);
      const res = await this.advances
        .updateOne(
          { _id: a._id, organizationId, revision: a.revision, status: 'draft' },
          {
            $set: {
              number,
              status: 'submitted',
              steps: steps.steps,
              approvals: [],
              submittedAt: now,
              submittedBy: actor.userId,
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision(a.revision + 1);
      await this.audit.record(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'hr.advance.submitted',
          targetType: 'hr_advance',
          targetId: advanceId,
          metadata: { number, steps: steps.steps, kind: a.kind },
        },
        { session },
      );
    });
    const after = await this.requireOwn(organizationId, advanceId);
    await this.notifyStep(organizationId, viewer, after, employee, actor.userId);
    return this.viewOf(viewer, after);
  }

  /** Validateurs de l'étape : manager (avance de frais) ou détenteurs effectifs. */
  private async stepRecipients(
    organizationId: string,
    viewer: HrViewer,
    a: EmployeeAdvanceLean,
    employee: EmployeeLean,
  ): Promise<string[]> {
    const step = currentStepOf(a);
    if (step === null) return [];
    if (step === 'manager') {
      const m = managerUserIdOf(employee, viewer.byId);
      return m ? [m] : [];
    }
    let holders = await this.notifier.holdersOf(organizationId, 'expenses.approve');
    if (a.kind === 'salary') {
      const sensitive = new Set(await this.notifier.holdersOf(organizationId, 'hr.sensitive.read'));
      holders = holders.filter((u) => sensitive.has(u));
    }
    const prior = new Set(a.approvals.map((x) => x.userId));
    return holders.filter((u) => u !== employee.userId && u !== a.createdBy && !prior.has(u));
  }

  private async notifyStep(
    organizationId: string,
    viewer: HrViewer,
    a: EmployeeAdvanceLean,
    employee: EmployeeLean,
    actorUserId: string,
  ): Promise<void> {
    await this.notifier.send({
      organizationId,
      entityType: 'advance',
      entityId: String(a._id),
      kind: 'hr.advance_submitted',
      recipients: await this.stepRecipients(organizationId, viewer, a, employee),
      // Jamais « sur salaire », jamais de montant ; le nom seulement pour une avance de frais.
      title:
        a.kind === 'salary'
          ? `Avance ${a.number ?? ''} à valider`
          : `Avance ${a.number ?? ''} à valider : ${displayNameOf(employee)}`,
      href: HR_EXPENSES_TO_APPROVE_HREF,
      actorUserId,
    });
  }

  async approve(
    organizationId: string,
    viewer: HrViewer,
    advanceId: string,
    body: ApproveExpenseBody,
    actor: HrActor,
  ): Promise<AdvanceView> {
    return this.decide(organizationId, viewer, advanceId, 'approve', body, actor);
  }

  async reject(
    organizationId: string,
    viewer: HrViewer,
    advanceId: string,
    body: RejectExpenseBody,
    actor: HrActor,
  ): Promise<AdvanceView> {
    return this.decide(organizationId, viewer, advanceId, 'reject', body, actor);
  }

  private async decide(
    organizationId: string,
    viewer: HrViewer,
    advanceId: string,
    decision: 'approve' | 'reject',
    body: { expectedRevision?: number; comment?: string | null },
    actor: HrActor,
  ): Promise<AdvanceView> {
    const { a, employee } = await this.requireVisible(organizationId, viewer, advanceId);
    if (a.status !== 'submitted')
      conflict('ADVANCE_NOT_PENDING', 'Cette avance a déjà été traitée.');
    if (body.expectedRevision !== undefined && body.expectedRevision !== a.revision) {
      staleRevision(a.revision);
    }
    const [s, approverCount] = await Promise.all([
      this.settings.of(organizationId),
      this.authz.countApprovers(organizationId, 'expenses.approve'),
    ]);
    const verdict = expenseDecisionOn(
      a,
      employee.userId ?? null,
      managerUserIdOf(employee, viewer.byId),
      {
        userId: viewer.userId,
        actions: viewer.actions,
        approverCount,
        allowSoleApprover: s.allowSoleApprover,
      },
      decision,
      a.kind === 'salary',
    );
    if (verdict === null) conflict('ADVANCE_NOT_PENDING', 'Cette avance a déjà été traitée.');
    if (!verdict.ok) refuseApproval(verdict);
    const step = currentStepOf(a)!;
    const approval: StoredAdvanceApproval = {
      step,
      userId: viewer.userId,
      decision: decision === 'approve' ? 'approved' : 'rejected',
      at: new Date(),
      comment: body.comment ?? null,
      soleApprover: verdict.soleApprover,
      onBehalfOfManager: verdict.onBehalfOfManager,
    };
    const done = a.approvals.filter((x) => x.decision === 'approved').length;
    const final = decision === 'reject' || done + 1 === a.steps.length;
    const status = decision === 'reject' ? 'rejected' : final ? 'approved' : 'submitted';
    await inHrTransaction(this.connection, async (session) => {
      const res = await this.advances
        .updateOne(
          { _id: a._id, organizationId, revision: a.revision, status: 'submitted' },
          {
            $push: { approvals: approval },
            $set: {
              status,
              updatedBy: actor.userId,
              ...(status === 'approved' ? { approvedAt: new Date() } : {}),
            },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision(a.revision + 1);
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: decision === 'approve' ? 'hr.advance.approved' : 'hr.advance.rejected',
          targetType: 'hr_advance',
          targetId: advanceId,
          metadata: {
            step,
            final,
            soleApprover: verdict.soleApprover,
            onBehalfOfManager: verdict.onBehalfOfManager,
          },
        },
        { session },
      );
    });
    const after = await this.requireOwn(organizationId, advanceId);
    if (status === 'submitted') {
      await this.notifyStep(organizationId, viewer, after, employee, actor.userId);
    } else {
      await this.notifier.send({
        organizationId,
        entityType: 'advance',
        entityId: advanceId,
        kind: 'hr.advance_decided',
        recipients: [...(employee.userId ? [employee.userId] : []), a.createdBy],
        title: `Votre avance ${a.number ?? ''} a été ${status === 'approved' ? 'validée' : 'refusée'}`,
        href: HR_MY_EXPENSES_HREF,
        actorUserId: actor.userId,
      });
      if (status === 'approved') {
        const payers = await this.notifier.holdersOf(organizationId, 'payables.pay');
        await this.notifier.send({
          organizationId,
          entityType: 'advance',
          entityId: advanceId,
          kind: 'hr.advance_decided',
          recipients: payers.filter((u) => u !== employee.userId),
          // « Avance AV… à verser », sans nature ni nom pour une avance sur salaire.
          title:
            a.kind === 'salary'
              ? `Avance ${a.number ?? ''} à verser`
              : `Avance ${a.number ?? ''} à verser : ${displayNameOf(employee)}`,
          href: HR_EXPENSES_TO_PAY_HREF,
          actorUserId: actor.userId,
        });
      }
    }
    return this.viewOf(viewer, after);
  }

  async cancel(
    organizationId: string,
    viewer: HrViewer,
    advanceId: string,
    body: CancelExpenseBody,
    actor: HrActor,
  ): Promise<AdvanceView> {
    const { a, access } = await this.requireVisible(organizationId, viewer, advanceId);
    if (body.expectedRevision !== undefined && body.expectedRevision !== a.revision) {
      staleRevision(a.revision);
    }
    const declarant = access.self || access.creator;
    const early = a.status === 'draft' || a.status === 'submitted';
    if (declarant && early) {
      // Le demandeur, tant que rien n'est décidé.
    } else if (access.approver && (a.status === 'submitted' || a.status === 'approved')) {
      if (!body.reason) {
        unprocessable(
          'ADVANCE_CANCEL_REASON_REQUIRED',
          'Une annulation par un validateur porte un motif.',
        );
      }
    } else if (!declarant && !access.approver) {
      forbiddenAction(
        'expenses.approve',
        viewer.role,
        'Annuler l’avance d’un autre exige de valider les avances.',
      );
    } else {
      conflict('ADVANCE_NOT_CANCELLABLE', 'Une avance versée ne s’annule plus : régularisez-la.');
    }
    const res = await this.advances
      .updateOne(
        { _id: a._id, organizationId, revision: a.revision, status: a.status },
        {
          $set: { status: 'cancelled', cancelReason: body.reason ?? null, updatedBy: actor.userId },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision(a.revision + 1);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.advance.cancelled',
      targetType: 'hr_advance',
      targetId: advanceId,
      metadata: { from: a.status },
    });
    return this.get(organizationId, viewer, advanceId);
  }

  // ── Versement ────────────────────────────────────────────────────────────

  private async payersCount(organizationId: string): Promise<number> {
    return new Set(await this.authz.holdersOf(organizationId, 'payables.pay')).size;
  }

  async disburse(
    organizationId: string,
    viewer: HrViewer,
    advanceId: string,
    body: DisburseAdvanceBody,
    actor: HrActor,
  ): Promise<AdvanceView> {
    const { a, employee } = await this.requireVisible(organizationId, viewer, advanceId);
    if (a.status !== 'approved')
      conflict('ADVANCE_NOT_APPROVED', 'Seule une avance validée se verse.');
    if (body.expectedRevision !== a.revision) staleRevision(a.revision);
    const [s, payerCount] = await Promise.all([
      this.settings.of(organizationId),
      this.payersCount(organizationId),
    ]);
    const verdict = payerDecision({
      payerUserId: viewer.userId,
      beneficiaryUserId: employee.userId ?? null,
      financeApproverUserId: financeApproverOf(a),
      payerCount,
      allowSoleApprover: s.allowSoleApprover,
    });
    await inHrTransaction(this.connection, async (session) => {
      const movement = await this.movements.recordOwnedByAdvance(session, {
        organizationId,
        kind: 'other_out',
        advanceId,
        advanceNumber: a.number!,
        settlementId: null,
        accountId: body.accountId,
        currency: a.currency,
        date: body.paidOn,
        amount: a.amount,
        reference: body.reference ?? null,
        actor,
      });
      const res = await this.advances
        .updateOne(
          { _id: a._id, organizationId, revision: a.revision, status: 'approved' },
          {
            $set: {
              status: 'disbursed',
              disbursement: {
                paidOn: body.paidOn,
                accountId: body.accountId,
                method: body.method,
                reference: body.reference ?? null,
                paidBy: actor.userId,
                paidAt: new Date(),
                movementId: movement.id,
                soleApprover: verdict.soleApprover,
              },
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision(a.revision + 1);
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'hr.advance.disbursed',
          targetType: 'hr_advance',
          targetId: advanceId,
          metadata: {
            movementId: movement.id,
            accountId: body.accountId,
            soleApprover: verdict.soleApprover,
          },
        },
        { session },
      );
    });
    await this.notifier.send({
      organizationId,
      entityType: 'advance',
      entityId: advanceId,
      kind: 'hr.advance_disbursed',
      recipients: employee.userId ? [employee.userId] : [],
      title: `Votre avance ${a.number ?? ''} a été versée`,
      href: HR_MY_EXPENSES_HREF,
      actorUserId: actor.userId,
    });
    return this.get(organizationId, viewer, advanceId);
  }

  async cancelDisbursement(
    organizationId: string,
    viewer: HrViewer,
    advanceId: string,
    body: CancelDisbursementBody,
    actor: HrActor,
  ): Promise<AdvanceView> {
    const { a } = await this.requireVisible(organizationId, viewer, advanceId);
    if (a.status !== 'disbursed' || !a.disbursement) {
      conflict('ADVANCE_NOT_DISBURSED', 'Cette avance n’est pas versée.');
    }
    if (liveSettlements(a).length > 0) {
      conflict(
        'ADVANCE_ALREADY_SETTLED',
        'Cette avance a déjà des régularisations : son versement ne s’annule plus.',
      );
    }
    if (body.expectedRevision !== a.revision) staleRevision(a.revision);
    await inHrTransaction(this.connection, async (session) => {
      const n = await this.movements.cancelOwnedByAdvance(
        session,
        organizationId,
        advanceId,
        { settlementId: null },
        body.reason,
        actor,
      );
      const res = await this.advances
        .updateOne(
          { _id: a._id, organizationId, revision: a.revision, status: 'disbursed' },
          {
            $set: { status: 'approved', disbursement: null, updatedBy: actor.userId },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision(a.revision + 1);
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'hr.advance.disbursement_cancelled',
          targetType: 'hr_advance',
          targetId: advanceId,
          metadata: { cancelledMovements: n, reason: body.reason.slice(0, 200) },
        },
        { session },
      );
    });
    return this.get(organizationId, viewer, advanceId);
  }

  // ── Régularisations saisies ──────────────────────────────────────────────

  async addSettlement(
    organizationId: string,
    viewer: HrViewer,
    advanceId: string,
    body: CreateAdvanceSettlementBody,
    actor: HrActor,
  ): Promise<AdvanceView> {
    const { a, employee } = await this.requireVisible(organizationId, viewer, advanceId);
    if (body.expectedRevision !== a.revision) staleRevision(a.revision);
    if (body.on > hrToday()) {
      unprocessable('SETTLEMENT_IN_FUTURE', 'Une régularisation ne se date pas dans le futur.');
    }
    const s = await this.settings.of(organizationId);
    const beneficiaryUserId = employee.userId ?? null;
    let soleApprover = false;
    if (body.kind === 'cash_return') {
      if (!viewer.actions.has('payables.pay') || !viewer.actions.has('treasury.read')) {
        forbiddenAction(
          viewer.actions.has('payables.pay') ? 'treasury.read' : 'payables.pay',
          viewer.role,
          'Enregistrer un retour d’espèces exige de payer et de lire la trésorerie.',
        );
      }
      soleApprover = payerDecision({
        payerUserId: viewer.userId,
        beneficiaryUserId,
        financeApproverUserId: null,
        payerCount: await this.payersCount(organizationId),
        allowSoleApprover: s.allowSoleApprover,
      }).soleApprover;
    } else {
      const needsSensitive = body.kind === 'declared_payroll' || a.kind === 'salary';
      if (!viewer.actions.has('expenses.approve')) {
        forbiddenAction(
          'expenses.approve',
          viewer.role,
          'Cette régularisation exige de valider les avances.',
        );
      }
      if (needsSensitive && !viewer.actions.has('hr.sensitive.read')) {
        forbiddenAction(
          'hr.sensitive.read',
          viewer.role,
          'Cette régularisation exige les données sensibles du personnel.',
        );
      }
      const isSelf = beneficiaryUserId !== null && beneficiaryUserId === viewer.userId;
      if (isSelf) {
        const count = await this.authz.countApprovers(organizationId, 'expenses.approve');
        if (!(s.allowSoleApprover && count <= 1)) {
          conflict('SELF_APPROVAL_FORBIDDEN', 'On ne régularise pas sa propre avance.');
        }
        soleApprover = true;
      }
    }
    const check = checkAdvanceSettlement(advanceInputOf(a), body, s.advances);
    if (!check.ok) {
      const messages: Record<string, string> = {
        ADVANCE_NOT_DISBURSED: 'Cette avance n’est pas versée.',
        ADVANCE_SETTLEMENT_EXCEEDS_OUTSTANDING: 'Ce montant dépasse le reste dû de l’avance.',
        ADVANCE_DECLARED_PAYROLL_DISABLED:
          'La régularisation déclarée sur la paie n’est pas ouverte dans cette organisation.',
        ADVANCE_SETTLEMENT_KIND_MISMATCH: 'Cette régularisation ne convient pas à cette avance.',
        ADVANCE_SETTLEMENT_LIMIT_REACHED: 'Cette avance porte déjà cent régularisations.',
      };
      if (check.code === 'ADVANCE_SETTLEMENT_AMOUNT_INVALID') {
        unprocessable(check.code, 'Montant invalide.');
      }
      conflict(check.code!, messages[check.code!] ?? 'Régularisation refusée.');
    }
    if (a.status !== 'disbursed' && a.status !== 'partially_settled') {
      conflict('ADVANCE_NOT_DISBURSED', 'Cette avance n’est pas en cours de régularisation.');
    }
    const id = new Types.ObjectId().toHexString();
    await inHrTransaction(this.connection, async (session) => {
      let movementId: string | null = null;
      if (body.kind === 'cash_return') {
        const m = await this.movements.recordOwnedByAdvance(session, {
          organizationId,
          kind: 'other_in',
          advanceId,
          advanceNumber: a.number!,
          settlementId: id,
          accountId: body.accountId!,
          currency: a.currency,
          date: body.on,
          amount: body.amount,
          reference: body.reference ?? null,
          actor,
        });
        movementId = m.id;
      }
      const settlement: StoredSettlement = {
        id,
        kind: body.kind,
        amount: body.amount,
        on: body.on,
        reference: body.reference ?? null,
        by: actor.userId,
        at: new Date(),
        note: body.note ?? null,
        movementId,
        expenseReportId: null,
        soleApprover,
        cancelledAt: null,
        cancelledBy: null,
      };
      const status = moneyStatusOf(advanceInputOf(a, [settlement]));
      const res = await this.advances
        .updateOne(
          { _id: a._id, organizationId, revision: a.revision },
          {
            $push: { settlements: settlement },
            $set: { status, updatedBy: actor.userId },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision(a.revision + 1);
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: body.kind === 'write_off' ? 'hr.advance.written_off' : 'hr.advance.settled',
          targetType: 'hr_advance',
          targetId: advanceId,
          // Jamais le motif d'abandon ni le montant d'une avance sur salaire.
          metadata: { kind: body.kind, status, movementId, soleApprover },
        },
        { session },
      );
    });
    return this.get(organizationId, viewer, advanceId);
  }

  // ── Motif sensible ───────────────────────────────────────────────────────

  async revealReason(
    organizationId: string,
    viewer: HrViewer,
    advanceId: string,
    actor: HrActor,
  ): Promise<AdvanceReasonView> {
    const { a, access } = await this.requireVisible(organizationId, viewer, advanceId);
    const allowed =
      access.self ||
      (viewer.actions.has('expenses.approve') && viewer.actions.has('hr.sensitive.read'));
    if (!allowed) {
      if (a.kind === 'salary') advanceNotFound();
      forbiddenAction(
        'hr.sensitive.read',
        viewer.role,
        'Le motif d’une avance se lit par son bénéficiaire ou un validateur habilité.',
      );
    }
    if (a.kind === 'expenses') return { reason: a.reason ?? null };
    if (!a.reasonSealed) return { reason: null };
    if (!this.keyring) secretsNotConfigured();
    try {
      // Audit STRICT écrit AVANT de répondre : sans trace, rien n'est révélé.
      await this.audit.recordStrict({
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'hr.advance.reason_revealed',
        targetType: 'hr_advance',
        targetId: advanceId,
        metadata: { self: access.self },
      });
    } catch {
      auditUnavailable();
    }
    try {
      return {
        reason: openAdvanceReason({
          organizationId,
          advanceId,
          record: a.reasonSealed,
          keyring: this.keyring,
        }),
      };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      privateUnreadable();
    }
  }
}
