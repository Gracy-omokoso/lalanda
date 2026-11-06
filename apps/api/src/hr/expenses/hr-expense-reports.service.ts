// Notes de frais : brouillon, justificatifs, soumission, circuit, remboursement,
// régularisation par une avance, résumés (ADR-0051 § 2.1, § 3.1, § 3.3, § 4, § 6.1, § 7.1).
// ADR-0051 — H10.
//
// - Calculs au MOTEUR : contrôles (`checkExpenseReport`), totaux (`expenseReportTotals`),
//   étapes (`expenseApprovalSteps`), part couverte par une avance (`advanceSettlementPlan`),
//   reste dû (`advanceOutstanding`), résumé (`expenseSummary`). Rien n'est additionné ici.
// - Séparation des tâches : celui qui demande ne valide pas, l'auteur d'une saisie pour
//   autrui non plus (`expenseApprovalDecision`) ; deux étapes, deux personnes ; celui qui
//   valide l'étape `finance` ne rembourse pas quand un autre payeur existe
//   (`reimbursementDecision`) ; l'exception de l'approbateur unique est MARQUÉE et
//   journalisée.
// - Trésorerie (ADR-0034, lot H11) : le remboursement crée une dépense PAR LIGNE,
//   possédée par les RH, par `recordOwnedByExpenseReport`, DANS la transaction de la
//   note ; une note liée à une avance crée à l'approbation finale ses dépenses SANS compte
//   (l'argent est sorti au versement), puis le complément éventuel (`top_up`) avec compte,
//   au remboursement — deux appels.
// - Portée : le bénéficiaire et l'auteur ; le manager (équipe, hors brouillons) ; les
//   détenteurs d'`expenses.approve` et de `payables.pay` ; `hr.read` sans justificatif.
//   Hors portée, autre organisation : 404.
// - AUCUN barème, AUCUN seuil, AUCUN plafond : une ligne est un montant réellement payé.

import { createHash } from 'node:crypto';

import {
  EXPENSE_SUMMARY_STATUSES,
  advanceSettlementPlan,
  checkExpenseReport,
  expenseApprovalSteps,
  expenseReportTotals,
  expenseSummary,
  type ExpenseSummaryResult,
} from '@lalanda/engine';
import {
  EXPENSE_LIMITS,
  type ApproveExpenseBody,
  type CancelExpenseBody,
  type CancelReimbursementBody,
  type CreateExpenseReportBody,
  type ExpenseLineCategory,
  type ExpenseLineInput,
  type ExpenseReportPage,
  type ExpenseReportView,
  type ExpenseSummaryQuery,
  type HrToPayView,
  type ListExpenseReportsQuery,
  type ReimburseExpenseReportBody,
  type RejectExpenseBody,
  type SubmitExpenseReportBody,
  type UpdateExpenseReportBody,
} from '@lalanda/shared/hr';
import { PURCHASE_ATTACHMENT_LIMITS } from '@lalanda/shared/purchases';
import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  UnsupportedMediaTypeException,
  BadRequestException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { AuthzService } from '../../authz/authz.service.js';
import { MASTER_KEYRING } from '../../integrations/keyring.provider.js';
import type { MasterKeyring } from '../../integrations/secrets-crypto.js';
import {
  classifyPurchaseAttachment,
  type AcceptedPurchaseAttachment,
} from '../../purchases/attachments/purchase-attachments.js';
import { conflict, invalidCursor, staleRevision } from '../../sales/sales.errors.js';
import { decodeCursor, encodeCursor } from '../../sales/search.js';
import { sharedAttachmentsUsage } from '../../storage/attachments-usage.js';
import {
  ObjectStorageService,
  ObjectStorageUnavailableError,
} from '../../storage/object-storage.service.js';
import { newObjectId } from '../../storage/object-key.js';
import { TreasuryExpensesService } from '../../treasury/treasury-expenses.service.js';
import type { HrActor } from '../departments/hr-departments.service.js';
import { HrCounter, type HrCounterDocument } from './hr-counter.schema.js';
import type { EmployeeLean } from '../employees/employee.schema.js';
import { displayNameOf } from '../leave/display-name.js';
import { employeeNotFound, hrToday, inHrTransaction } from '../scope/hr-errors.js';
import type { HrViewer } from '../scope/hr-scope.service.js';
import {
  EmployeeAdvance,
  type EmployeeAdvanceDocument,
  type EmployeeAdvanceLean,
  type StoredSettlement,
} from '../advances/advance.schema.js';
import {
  LINKABLE_ADVANCE_STATUSES,
  advanceInputOf,
  moneyStatusOf,
} from '../advances/advance-model.js';
import {
  ExpenseReport,
  expenseReceiptObjectKey,
  type ExpenseReportDocument,
  type ExpenseReportLean,
  type StoredExpenseApproval,
  type StoredExpenseLine,
  type StoredReceipt,
} from './expense-report.schema.js';
import {
  currentStepOf,
  expenseDecisionOn,
  featureDisabled,
  financeApproverOf,
  forbiddenAction,
  managerUserIdOf,
  nextHrNumber,
  openReceipt,
  payerDecision,
  refuseApproval,
  reportNotFound,
  resolveBeneficiary,
  sealReceipt,
  unprocessable,
  type ExpenseApproverContext,
} from './hr-expenses.common.js';
import {
  HR_EXPENSES_TO_APPROVE_HREF,
  HR_EXPENSES_TO_PAY_HREF,
  HR_MY_EXPENSES_HREF,
  HrExpensesNotifier,
} from './hr-expenses-notifier.js';
import { teamLeadsOf } from '../teams/team-leads.js';
import { HrExpensesSettingsService } from './hr-expenses-settings.service.js';

const WORK_PROJECTS = 'work_projects';

/** Ce que le lecteur est pour une note. */
export interface ReportAccess {
  self: boolean;
  creator: boolean;
  manager: boolean;
  approver: boolean;
  payer: boolean;
  hrRead: boolean;
}

export function reportAccessOf(
  r: Pick<ExpenseReportLean, 'employeeId' | 'createdBy'>,
  viewer: Pick<HrViewer, 'userId' | 'actions' | 'scope'> &
    Partial<Pick<HrViewer, 'ledEmployeeIds'>>,
): ReportAccess {
  return {
    self: viewer.scope.selfEmployeeId === r.employeeId,
    creator: r.createdBy === viewer.userId,
    // Manager désigné (équipe hiérarchique) ou responsable d'équipe RH (ADR-0066 § 1).
    manager:
      viewer.scope.teamEmployeeIds.includes(r.employeeId) ||
      (viewer.ledEmployeeIds ?? []).includes(r.employeeId),
    approver: viewer.actions.has('expenses.approve'),
    payer: viewer.actions.has('payables.pay'),
    hrRead: viewer.actions.has('hr.read'),
  };
}

/** Un brouillon : le bénéficiaire et l'auteur seulement. */
export function seesReport(a: ReportAccess, status: string): boolean {
  if (a.self || a.creator) return true;
  if (status === 'draft') return false;
  return a.manager || a.approver || a.payer || a.hrRead;
}

/** `hr.read` seul ne voit jamais un justificatif (§ 4). */
export function seesReceipts(a: ReportAccess): boolean {
  return a.self || a.creator || a.manager || a.approver || a.payer;
}

/** Reste à rembourser au collaborateur, selon le statut. */
function toReimburseOf(r: ExpenseReportLean, total: string): string | null {
  if (r.status === 'approved') return total;
  if (r.status === 'partially_settled') return r.settlement?.topUp ?? null;
  return null;
}

function receiptTypeRefused(): never {
  throw new UnsupportedMediaTypeException({
    code: 'EXPENSE_RECEIPT_TYPE',
    message: 'Justificatif refusé : seules les images PNG, JPEG, WebP et les PDF sont acceptés.',
  });
}

/** Classe le justificatif par son contenu (`415 EXPENSE_RECEIPT_TYPE` sinon). */
export function classifyReceipt(file: { buffer: Buffer } | undefined): AcceptedPurchaseAttachment {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new BadRequestException({
      code: 'EXPENSE_RECEIPT_FILE_MISSING',
      message: 'Fichier attendu dans la partie « file » du formulaire.',
    });
  }
  if (file.buffer.length > EXPENSE_LIMITS.receiptPdfMaxBytes) {
    throw new HttpException({ code: 'FILE_TOO_LARGE', message: 'Le fichier dépasse 10 Mio.' }, 413);
  }
  try {
    return classifyPurchaseAttachment(file.buffer);
  } catch (err) {
    if (err instanceof UnsupportedMediaTypeException) receiptTypeRefused();
    throw err;
  }
}

@Injectable()
export class HrExpenseReportsService {
  private readonly logger = new Logger('HrExpenseReports');

  constructor(
    @InjectModel(ExpenseReport.name) private readonly reports: Model<ExpenseReportDocument>,
    @InjectModel(EmployeeAdvance.name) private readonly advances: Model<EmployeeAdvanceDocument>,
    @InjectModel(HrCounter.name) private readonly counters: Model<HrCounterDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(HrExpensesSettingsService) private readonly settings: HrExpensesSettingsService,
    @Inject(TreasuryExpensesService) private readonly treasury: TreasuryExpensesService,
    @Inject(ObjectStorageService) private readonly storage: ObjectStorageService,
    @Inject(HrExpensesNotifier) private readonly notifier: HrExpensesNotifier,
    @Inject(MASTER_KEYRING) private readonly keyring: MasterKeyring | null,
  ) {}

  // ── Vues ─────────────────────────────────────────────────────────────────

  private async advanceNumbers(
    organizationId: string,
    ids: readonly (string | null)[],
  ): Promise<Map<string, string | null>> {
    const wanted = [...new Set(ids.filter((i): i is string => !!i && Types.ObjectId.isValid(i)))];
    if (wanted.length === 0) return new Map();
    const rows = await this.advances
      .find(
        { organizationId, _id: { $in: wanted.map((i) => new Types.ObjectId(i)) } },
        { number: 1 },
      )
      .lean<{ _id: Types.ObjectId; number: string | null }[]>()
      .exec();
    return new Map(rows.map((r) => [String(r._id), r.number]));
  }

  private async namesOf(
    userIds: readonly string[],
    viewer: HrViewer,
  ): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    for (const e of viewer.employees) {
      if (e.userId && e.status !== 'anonymized') names.set(e.userId, displayNameOf(e));
    }
    const missing = [...new Set(userIds)].filter(
      (id) => !names.has(id) && Types.ObjectId.isValid(id),
    );
    if (missing.length > 0) {
      const users = await this.connection
        .collection('user')
        .find(
          { _id: { $in: missing.map((id) => new Types.ObjectId(id)) } },
          { projection: { name: 1 } },
        )
        .toArray();
      for (const u of users) names.set(String(u._id), String(u['name'] ?? ''));
    }
    return names;
  }

  async viewsOf(
    viewer: HrViewer,
    docs: readonly ExpenseReportLean[],
  ): Promise<ExpenseReportView[]> {
    if (docs.length === 0) return [];
    const organizationId = docs[0]!.organizationId;
    const [numbers, names] = await Promise.all([
      this.advanceNumbers(
        organizationId,
        docs.map((d) => d.advanceId),
      ),
      this.namesOf(
        docs.flatMap((d) => d.approvals.map((a) => a.userId)),
        viewer,
      ),
    ]);
    return docs.map((r) => {
      const access = reportAccessOf(r, viewer);
      const receipts = seesReceipts(access);
      const totals = expenseReportTotals(r.lines);
      const employee = viewer.byId.get(r.employeeId);
      const planLine = (i: number) => r.settlement?.lines.find((l) => l.lineIndex === i) ?? null;
      return {
        id: String(r._id),
        number: r.number ?? null,
        employeeId: r.employeeId,
        employeeName: employee ? displayNameOf(employee) : '',
        title: r.title,
        currency: r.currency,
        lines: r.lines.map((l, i) => ({
          id: l.id,
          spentOn: l.spentOn,
          category: l.category,
          label: l.label,
          amount: l.amount,
          merchant: l.merchant ?? null,
          deductibleVat: l.deductibleVat ?? null,
          workProjectId: l.workProjectId ?? null,
          rebillable: l.rebillable === true,
          hasReceipt: l.receipt !== null && l.receipt !== undefined,
          receipt:
            receipts && l.receipt
              ? {
                  contentType: l.receipt.contentType,
                  size: l.receipt.size,
                  uploadedAt: new Date(l.receipt.uploadedAt).toISOString(),
                  uploadedBy: l.receipt.uploadedBy,
                }
              : null,
          missingReceiptReason: l.missingReceiptReason ?? null,
          fromAdvance: planLine(i)?.fromAdvance ?? null,
          topUp: planLine(i)?.topUp ?? null,
        })),
        total: totals.total,
        byCategory: totals.byCategory.map((c) => ({
          ...c,
          category: c.category as ExpenseLineCategory,
        })),
        advanceId: r.advanceId ?? null,
        advanceNumber: r.advanceId ? (numbers.get(r.advanceId) ?? null) : null,
        status: r.status,
        steps: r.steps,
        currentStep: currentStepOf(r),
        approvals: r.approvals.map((a) => ({
          step: a.step,
          userId: a.userId,
          userName: names.get(a.userId) ?? null,
          decision: a.decision,
          at: new Date(a.at).toISOString(),
          comment: a.comment ?? null,
          soleApprover: a.soleApprover,
          onBehalfOfManager: a.onBehalfOfManager,
        })),
        settlement: r.settlement
          ? { fromAdvance: r.settlement.fromAdvance, topUp: r.settlement.topUp }
          : null,
        reimbursement: r.reimbursement
          ? {
              paidOn: r.reimbursement.paidOn,
              accountId: r.reimbursement.accountId ?? null,
              method: r.reimbursement.method,
              reference: r.reimbursement.reference ?? null,
              paidBy: r.reimbursement.paidBy,
              soleApprover: r.reimbursement.soleApprover,
              expenseIds: r.reimbursement.expenseIds,
            }
          : null,
        toReimburse: toReimburseOf(r, totals.total),
        submittedAt: r.submittedAt ? new Date(r.submittedAt).toISOString() : null,
        createdBy: r.createdBy,
        createdAt: new Date(r.createdAt).toISOString(),
        cancelReason: r.cancelReason ?? null,
        revision: r.revision,
      };
    });
  }

  // ── Lecture ──────────────────────────────────────────────────────────────

  private async requireOwn(organizationId: string, reportId: string): Promise<ExpenseReportLean> {
    if (!/^[0-9a-f]{24}$/i.test(reportId)) reportNotFound();
    const doc = await this.reports
      .findOne({ _id: new Types.ObjectId(reportId), organizationId })
      .lean<ExpenseReportLean>()
      .exec();
    if (!doc) reportNotFound();
    return doc;
  }

  /** Note visible du lecteur, sinon 404 (on ne confirme pas l'existence). */
  private async requireVisible(
    organizationId: string,
    viewer: HrViewer,
    reportId: string,
  ): Promise<{ r: ExpenseReportLean; access: ReportAccess; employee: EmployeeLean }> {
    const r = await this.requireOwn(organizationId, reportId);
    const employee = viewer.byId.get(r.employeeId);
    const access = reportAccessOf(r, viewer);
    if (!employee || !seesReport(access, r.status)) reportNotFound();
    return { r, access, employee };
  }

  async get(
    organizationId: string,
    viewer: HrViewer,
    reportId: string,
  ): Promise<ExpenseReportView> {
    const { r } = await this.requireVisible(organizationId, viewer, reportId);
    return (await this.viewsOf(viewer, [r]))[0]!;
  }

  async approverContext(organizationId: string, viewer: HrViewer): Promise<ExpenseApproverContext> {
    const [s, approverCount] = await Promise.all([
      this.settings.of(organizationId),
      this.authz.countApprovers(organizationId, 'expenses.approve'),
    ]);
    return {
      userId: viewer.userId,
      actions: viewer.actions,
      approverCount,
      allowSoleApprover: s.allowSoleApprover,
      ledUserIds: viewer.ledUserIds,
    };
  }

  async list(
    organizationId: string,
    viewer: HrViewer,
    query: ListExpenseReportsQuery,
  ): Promise<ExpenseReportPage> {
    const all =
      viewer.actions.has('expenses.approve') ||
      viewer.actions.has('payables.pay') ||
      viewer.actions.has('hr.read');
    const self = viewer.scope.selfEmployeeId;
    const mine: Record<string, unknown>[] = [{ createdBy: viewer.userId }];
    if (self) mine.push({ employeeId: self });
    const or: Record<string, unknown>[] = [...mine];
    if (all) or.push({ status: { $ne: 'draft' } });
    else {
      // Manager désigné et responsable d'équipe RH (ADR-0066 § 1) : hors brouillons.
      const team = new Set([...viewer.scope.teamEmployeeIds, ...viewer.ledEmployeeIds]);
      if (team.size > 0) or.push({ employeeId: { $in: [...team] }, status: { $ne: 'draft' } });
    }
    const and: Record<string, unknown>[] = [{ organizationId }, { $or: or }];
    if (query.employeeId !== undefined) {
      if (!viewer.byId.has(query.employeeId)) employeeNotFound();
      and.push({ employeeId: query.employeeId });
    }
    if (query.status !== undefined) and.push({ status: query.status });
    if (query.view === 'a-valider') and.push({ status: 'submitted' });
    if (query.view === 'a-payer') {
      if (!viewer.actions.has('payables.pay')) {
        forbiddenAction('payables.pay', viewer.role, 'Seuls les payeurs voient les notes à payer.');
      }
      and.push({ status: { $in: ['approved', 'partially_settled'] } });
    }
    if (query.from !== undefined) and.push({ 'lines.spentOn': { $gte: query.from } });
    if (query.to !== undefined) and.push({ 'lines.spentOn': { $lte: query.to } });
    if (query.cursor !== undefined) {
      const c = decodeCursor(query.cursor);
      if (c === null) invalidCursor();
      and.push({ _id: { $lt: c.id } });
    }
    let docs = await this.reports
      .find({ $and: and })
      .sort({ _id: -1 })
      .limit(query.view === 'a-valider' ? 2_000 : query.limit + 1)
      .lean<ExpenseReportLean[]>()
      .exec();
    if (query.view === 'a-valider') {
      const ctx = await this.approverContext(organizationId, viewer);
      docs = docs.filter((r) => {
        const employee = viewer.byId.get(r.employeeId);
        if (!employee) return false;
        const verdict = expenseDecisionOn(
          r,
          employee.userId ?? null,
          managerUserIdOf(employee, viewer.byId),
          ctx,
          'approve',
          false,
        );
        return verdict !== null && verdict.ok;
      });
    }
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: await this.viewsOf(viewer, page),
      nextCursor: docs.length > query.limit && last ? encodeCursor('', String(last._id)) : null,
    };
  }

  // ── Brouillon ────────────────────────────────────────────────────────────

  /** Contrôles de forme du moteur et projets RUN de l'organisation (non archivés). */
  private async checkLines(
    organizationId: string,
    currency: string,
    lines: readonly (ExpenseLineInput & { hasReceipt?: boolean })[],
    receiptRequired: boolean,
  ): Promise<void> {
    const check = checkExpenseReport(
      {
        currency,
        lines: lines.map((l) => ({
          spentOn: l.spentOn,
          category: l.category,
          amount: l.amount,
          workProjectId: l.workProjectId ?? null,
          deductibleVat: l.deductibleVat ?? null,
          rebillable: l.rebillable === true,
          hasReceipt: l.hasReceipt === true,
          missingReceiptReason: l.missingReceiptReason ?? null,
        })),
      },
      hrToday(),
      { receiptRequired },
    );
    if (!check.ok) {
      const first = check.issues[0]!;
      unprocessable(first.code, 'La note de frais ne peut pas être enregistrée en l’état.', {
        issues: check.issues,
      });
    }
    const projects = [
      ...new Set(lines.map((l) => l.workProjectId ?? null).filter((p): p is string => !!p)),
    ];
    if (projects.length === 0) return;
    const found = await this.connection
      .collection(WORK_PROJECTS)
      .find(
        {
          _id: { $in: projects.map((p) => new Types.ObjectId(p)) },
          organizationId,
          status: { $ne: 'archived' },
        },
        { projection: { _id: 1 } },
      )
      .toArray();
    if (found.length !== projects.length) {
      unprocessable('EXPENSE_WORK_PROJECT_UNKNOWN', 'Projet introuvable ou archivé.');
    }
  }

  /** Avance de frais liable : même collaborateur, même devise, versée, non soldée. */
  private async checkAdvanceLink(
    organizationId: string,
    advanceId: string,
    employeeId: string,
    currency: string,
  ): Promise<EmployeeAdvanceLean> {
    const a = Types.ObjectId.isValid(advanceId)
      ? await this.advances
          .findOne({ _id: new Types.ObjectId(advanceId), organizationId })
          .lean<EmployeeAdvanceLean>()
          .exec()
      : null;
    if (!a || a.employeeId !== employeeId || a.kind !== 'expenses') {
      conflict(
        'ADVANCE_NOT_LINKABLE',
        'Aucune avance de frais versée de ce collaborateur ne porte cet identifiant.',
      );
    }
    if (a.currency !== currency) {
      unprocessable(
        'EXPENSE_REPORT_CURRENCY_MISMATCH',
        'Une note et l’avance qu’elle justifie ont la même devise.',
      );
    }
    if (!LINKABLE_ADVANCE_STATUSES.includes(a.status)) {
      conflict('ADVANCE_NOT_LINKABLE', 'Cette avance n’est pas versée, ou elle est déjà soldée.');
    }
    return a;
  }

  private storedLines(
    lines: readonly ExpenseLineInput[],
    previous: readonly StoredExpenseLine[] = [],
  ): { lines: StoredExpenseLine[]; dropped: string[] } {
    const byId = new Map(previous.map((l) => [l.id, l]));
    const kept = new Set<string>();
    const out = lines.map((l) => {
      const old = l.id ? byId.get(l.id) : undefined;
      if (old) kept.add(old.id);
      return {
        id: old ? old.id : new Types.ObjectId().toHexString(),
        spentOn: l.spentOn,
        category: l.category,
        label: l.label,
        amount: l.amount,
        merchant: l.merchant ?? null,
        deductibleVat: l.deductibleVat ?? null,
        workProjectId: l.workProjectId ?? null,
        rebillable: l.rebillable === true,
        receipt: old?.receipt ?? null,
        missingReceiptReason: l.missingReceiptReason ?? null,
      };
    });
    const dropped = previous
      .filter((l) => !kept.has(l.id) && l.receipt)
      .map((l) => l.receipt!.objectId);
    return { lines: out, dropped };
  }

  async create(
    organizationId: string,
    viewer: HrViewer,
    body: CreateExpenseReportBody,
    actor: HrActor,
  ): Promise<ExpenseReportView> {
    const s = await this.settings.of(organizationId);
    if (!s.expenses.enabled) featureDisabled('Notes de frais');
    const employee = resolveBeneficiary(viewer, body.employeeId);
    const employeeId = String(employee._id);
    await this.checkLines(organizationId, body.currency, body.lines, false);
    if (body.advanceId) {
      await this.checkAdvanceLink(organizationId, body.advanceId, employeeId, body.currency);
    }
    const { lines } = this.storedLines(body.lines);
    const [doc] = await this.reports.create([
      {
        organizationId,
        number: null,
        employeeId,
        title: body.title,
        currency: body.currency,
        lines,
        advanceId: body.advanceId ?? null,
        status: 'draft',
        steps: [],
        approvals: [],
        settlement: null,
        reimbursement: null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        revision: 1,
        _schemaVersion: 1,
      },
    ]);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.expense_report.created',
      targetType: 'hr_expense_report',
      targetId: String(doc!._id),
      metadata: {
        employeeId,
        lines: lines.length,
        forOther: employeeId !== viewer.scope.selfEmployeeId,
      },
    });
    return this.get(organizationId, viewer, String(doc!._id));
  }

  /** Brouillon modifiable par son bénéficiaire ou son auteur. */
  private async requireOwnDraft(
    organizationId: string,
    viewer: HrViewer,
    reportId: string,
  ): Promise<ExpenseReportLean> {
    const { r, access } = await this.requireVisible(organizationId, viewer, reportId);
    if (!access.self && !access.creator) {
      forbiddenAction('expenses.claim', viewer.role, 'Seul le déclarant modifie sa note de frais.');
    }
    if (r.status !== 'draft') {
      conflict('EXPENSE_REPORT_NOT_DRAFT', 'Seul un brouillon se modifie.');
    }
    return r;
  }

  async update(
    organizationId: string,
    viewer: HrViewer,
    reportId: string,
    body: UpdateExpenseReportBody,
    actor: HrActor,
  ): Promise<ExpenseReportView> {
    const r = await this.requireOwnDraft(organizationId, viewer, reportId);
    if (body.expectedRevision !== r.revision) staleRevision(r.revision);
    const currency = body.currency ?? r.currency;
    const next = body.lines
      ? this.storedLines(body.lines, r.lines)
      : { lines: r.lines, dropped: [] };
    await this.checkLines(organizationId, currency, next.lines, false);
    const advanceId = body.advanceId === undefined ? r.advanceId : body.advanceId;
    if (advanceId) await this.checkAdvanceLink(organizationId, advanceId, r.employeeId, currency);
    const res = await this.reports
      .updateOne(
        { _id: r._id, organizationId, revision: r.revision, status: 'draft' },
        {
          $set: {
            title: body.title ?? r.title,
            currency,
            lines: next.lines,
            advanceId: advanceId ?? null,
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision(r.revision + 1);
    await this.dropObjects(next.dropped);
    return this.get(organizationId, viewer, reportId);
  }

  async remove(
    organizationId: string,
    viewer: HrViewer,
    reportId: string,
    actor: HrActor,
  ): Promise<void> {
    const r = await this.requireOwnDraft(organizationId, viewer, reportId);
    const res = await this.reports
      .deleteOne({ _id: r._id, organizationId, status: 'draft', number: null })
      .exec();
    if (res.deletedCount !== 1) staleRevision(r.revision + 1);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.expense_report.deleted',
      targetType: 'hr_expense_report',
      targetId: reportId,
      metadata: { employeeId: r.employeeId },
    });
    await this.dropObjects(r.lines.filter((l) => l.receipt).map((l) => l.receipt!.objectId));
  }

  // ── Justificatifs ────────────────────────────────────────────────────────

  /** Vérifie le droit de déposer AVANT de lire le corps. */
  async assertCanUpload(
    organizationId: string,
    viewer: HrViewer,
    reportId: string,
    lineId: string,
  ): Promise<void> {
    const r = await this.requireOwnDraft(organizationId, viewer, reportId);
    if (!r.lines.some((l) => l.id === lineId)) {
      conflict('EXPENSE_LINE_NOT_FOUND', 'Cette ligne n’existe pas dans la note.');
    }
  }

  async uploadReceipt(
    organizationId: string,
    viewer: HrViewer,
    reportId: string,
    lineId: string,
    file: AcceptedPurchaseAttachment,
    actor: HrActor,
  ): Promise<ExpenseReportView> {
    const r = await this.requireOwnDraft(organizationId, viewer, reportId);
    const line = r.lines.find((l) => l.id === lineId);
    if (!line) conflict('EXPENSE_LINE_NOT_FOUND', 'Cette ligne n’existe pas dans la note.');
    const objectId = newObjectId();
    const sealed = this.keyring
      ? sealReceipt({ organizationId, reportId, objectId }, file.bytes, this.keyring, actor.userId)
      : null;
    const stored = sealed ? sealed.blob : file.bytes;
    const used = await sharedAttachmentsUsage(this.connection, organizationId);
    if (used + stored.length > PURCHASE_ATTACHMENT_LIMITS.storagePerOrganizationBytes) {
      conflict(
        'HR_STORAGE_FULL',
        'L’espace des pièces jointes de l’organisation (1 Gio) est plein : supprimez des pièces.',
      );
    }
    await this.storage.putObject(
      this.bucket(),
      expenseReceiptObjectKey(objectId),
      stored,
      sealed ? 'application/octet-stream' : file.contentType,
    );
    const receipt: StoredReceipt = {
      objectId,
      contentType: file.contentType,
      size: file.bytes.length,
      storedSize: stored.length,
      encrypted: sealed !== null,
      wrappedKey: sealed ? sealed.wrappedKey : null,
      uploadedAt: new Date(),
      uploadedBy: actor.userId,
    };
    const res = await this.reports
      .updateOne(
        { _id: r._id, organizationId, status: 'draft', 'lines.id': lineId },
        {
          $set: { 'lines.$.receipt': receipt, updatedBy: actor.userId },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1) {
      await this.dropObjects([objectId]);
      staleRevision(r.revision + 1);
    }
    if (line.receipt) await this.dropObjects([line.receipt.objectId]);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.expense_receipt.uploaded',
      targetType: 'hr_expense_report',
      targetId: reportId,
      metadata: {
        lineId,
        size: file.bytes.length,
        encrypted: sealed !== null,
        sha256: createHash('sha256').update(stored).digest('hex').slice(0, 16),
      },
    });
    return this.get(organizationId, viewer, reportId);
  }

  async downloadReceipt(
    organizationId: string,
    viewer: HrViewer,
    reportId: string,
    lineId: string,
    actor: HrActor,
  ): Promise<{ contentType: string; fileName: string; body: Buffer }> {
    const { r, access } = await this.requireVisible(organizationId, viewer, reportId);
    const line = r.lines.find((l) => l.id === lineId);
    // `hr.read` seul : le justificatif n'existe pas pour lui (404, sans le confirmer).
    if (!seesReceipts(access) || !line?.receipt) {
      throw new HttpException(
        { code: 'EXPENSE_RECEIPT_NOT_FOUND', message: 'Aucun justificatif.' },
        404,
      );
    }
    if (line.receipt.encrypted && !this.keyring) {
      throw new HttpException(
        {
          code: 'SECRETS_NOT_CONFIGURED',
          message:
            'Le coffre de chiffrement n’est pas configuré : le justificatif ne peut pas être lu.',
        },
        503,
      );
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.expense_receipt.downloaded',
      targetType: 'hr_expense_report',
      targetId: reportId,
      metadata: { lineId, self: access.self },
    });
    const object = await this.storage.getObject(
      this.bucket(),
      expenseReceiptObjectKey(line.receipt.objectId),
    );
    if (!object) {
      throw new HttpException(
        { code: 'EXPENSE_RECEIPT_NOT_FOUND', message: 'Aucun justificatif.' },
        404,
      );
    }
    const ext =
      line.receipt.contentType === 'application/pdf'
        ? 'pdf'
        : line.receipt.contentType.split('/')[1];
    const fileName = `justificatif-${r.number ?? 'brouillon'}-${r.lines.indexOf(line) + 1}.${ext}`;
    if (!line.receipt.encrypted) {
      return { contentType: line.receipt.contentType, fileName, body: object.body };
    }
    try {
      return {
        contentType: line.receipt.contentType,
        fileName,
        body: openReceipt(
          { organizationId, reportId, objectId: line.receipt.objectId },
          object.body,
          line.receipt.wrappedKey!,
          this.keyring!,
        ),
      };
    } catch {
      throw new HttpException(
        {
          code: 'EXPENSE_RECEIPT_UNREADABLE',
          message: 'Ce justificatif ne peut pas être déchiffré.',
        },
        500,
      );
    }
  }

  // ── Soumission et circuit ────────────────────────────────────────────────

  async submit(
    organizationId: string,
    viewer: HrViewer,
    reportId: string,
    body: SubmitExpenseReportBody,
    actor: HrActor,
  ): Promise<ExpenseReportView> {
    const r = await this.requireOwnDraft(organizationId, viewer, reportId);
    if (body.expectedRevision !== r.revision) staleRevision(r.revision);
    const s = await this.settings.of(organizationId);
    if (!s.expenses.enabled) featureDisabled('Notes de frais');
    await this.checkLines(
      organizationId,
      r.currency,
      r.lines.map((l) => ({ ...l, hasReceipt: l.receipt !== null })),
      s.expenses.receiptRequired,
    );
    if (r.advanceId) {
      await this.checkAdvanceLink(organizationId, r.advanceId, r.employeeId, r.currency);
    }
    const employee = viewer.byId.get(r.employeeId)!;
    if (employee.status !== 'active') {
      conflict('EMPLOYEE_NOT_ACTIVE', 'Ce collaborateur n’est plus actif.');
    }
    const steps = expenseApprovalSteps(
      { approvalFlow: s.expenses.approvalFlow },
      {
        managerEmployeeId: employee.managerEmployeeId ?? null,
        managerUserId: managerUserIdOf(employee, viewer.byId),
      },
      employee.userId ?? null,
    );
    const now = new Date();
    await inHrTransaction(this.connection, async (session) => {
      const number = await nextHrNumber(this.counters, organizationId, 'NF', now, session);
      const res = await this.reports
        .updateOne(
          { _id: r._id, organizationId, revision: r.revision, status: 'draft' },
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
      if (res.matchedCount !== 1) staleRevision(r.revision + 1);
      await this.audit.record(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'hr.expense_report.submitted',
          targetType: 'hr_expense_report',
          targetId: reportId,
          metadata: { number, steps: steps.steps, managerReplacedBy: steps.managerReplacedBy },
        },
        { session },
      );
    });
    const after = await this.requireOwn(organizationId, reportId);
    await this.notifyStep(organizationId, viewer, after, employee, actor.userId);
    return (await this.viewsOf(viewer, [after]))[0]!;
  }

  /** `hr.expense_submitted` : les validateurs de l'étape en attente (jamais le bénéficiaire). */
  private async notifyStep(
    organizationId: string,
    viewer: HrViewer,
    r: ExpenseReportLean,
    employee: EmployeeLean,
    actorUserId: string,
  ): Promise<void> {
    const step = currentStepOf(r);
    if (step === null) return;
    let recipients: string[];
    if (step === 'manager') {
      // Manager désigné et responsables des équipes du bénéficiaire (ADR-0066 § 1).
      const m = managerUserIdOf(employee, viewer.byId);
      const leads = await teamLeadsOf(this.connection, organizationId, employee.userId ?? null);
      recipients = [...new Set([...(m ? [m] : []), ...leads])].filter(
        (u) => u !== employee.userId && u !== r.createdBy,
      );
    } else {
      const prior = new Set(r.approvals.map((a) => a.userId));
      recipients = (await this.notifier.holdersOf(organizationId, 'expenses.approve')).filter(
        (u) => u !== employee.userId && u !== r.createdBy && !prior.has(u),
      );
    }
    await this.notifier.send({
      organizationId,
      entityType: 'expense_report',
      entityId: String(r._id),
      kind: 'hr.expense_submitted',
      recipients,
      title: `Note de frais ${r.number ?? ''} à valider : ${displayNameOf(employee)}`,
      href: HR_EXPENSES_TO_APPROVE_HREF,
      actorUserId,
    });
  }

  async approve(
    organizationId: string,
    viewer: HrViewer,
    reportId: string,
    body: ApproveExpenseBody,
    actor: HrActor,
  ): Promise<ExpenseReportView> {
    return this.decide(organizationId, viewer, reportId, 'approve', body, actor);
  }

  async reject(
    organizationId: string,
    viewer: HrViewer,
    reportId: string,
    body: RejectExpenseBody,
    actor: HrActor,
  ): Promise<ExpenseReportView> {
    return this.decide(organizationId, viewer, reportId, 'reject', body, actor);
  }

  private async decide(
    organizationId: string,
    viewer: HrViewer,
    reportId: string,
    decision: 'approve' | 'reject',
    body: { expectedRevision?: number; comment?: string | null },
    actor: HrActor,
  ): Promise<ExpenseReportView> {
    const { r, employee } = await this.requireVisible(organizationId, viewer, reportId);
    if (r.status !== 'submitted') {
      conflict('EXPENSE_NOT_PENDING', 'Cette note a déjà été traitée.');
    }
    if (body.expectedRevision !== undefined && body.expectedRevision !== r.revision) {
      staleRevision(r.revision);
    }
    const ctx = await this.approverContext(organizationId, viewer);
    const verdict = expenseDecisionOn(
      r,
      employee.userId ?? null,
      managerUserIdOf(employee, viewer.byId),
      ctx,
      decision,
      false,
    );
    if (verdict === null) conflict('EXPENSE_NOT_PENDING', 'Cette note a déjà été traitée.');
    if (!verdict.ok) refuseApproval(verdict);
    const step = currentStepOf(r)!;
    const approval: StoredExpenseApproval = {
      step,
      userId: viewer.userId,
      decision: decision === 'approve' ? 'approved' : 'rejected',
      at: new Date(),
      comment: body.comment ?? null,
      soleApprover: verdict.soleApprover,
      onBehalfOfManager: verdict.onBehalfOfManager,
    };
    const approvedSoFar = r.approvals.filter((a) => a.decision === 'approved').length;
    const final = decision === 'reject' || approvedSoFar + 1 === r.steps.length;
    let status: ExpenseReportLean['status'] =
      decision === 'reject' ? 'rejected' : final ? 'approved' : 'submitted';
    const today = hrToday();
    await inHrTransaction(this.connection, async (session) => {
      const set: Record<string, unknown> = { status, updatedBy: actor.userId };
      if (status === 'approved') set['approvedAt'] = new Date();
      if (status === 'approved' && r.advanceId) {
        const settled = await this.settleByAdvance(session, organizationId, r, today, actor);
        status = settled.topUp === '0.00' ? 'settled_by_advance' : 'partially_settled';
        set['status'] = status;
        set['settlement'] = settled;
      }
      const res = await this.reports
        .updateOne(
          { _id: r._id, organizationId, revision: r.revision, status: 'submitted' },
          { $push: { approvals: approval }, $set: set, $inc: { revision: 1 } },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision(r.revision + 1);
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action:
            decision === 'approve' ? 'hr.expense_report.approved' : 'hr.expense_report.rejected',
          targetType: 'hr_expense_report',
          targetId: reportId,
          metadata: {
            step,
            final,
            status,
            soleApprover: verdict.soleApprover,
            onBehalfOfManager: verdict.onBehalfOfManager,
          },
        },
        { session },
      );
    });
    const after = await this.requireOwn(organizationId, reportId);
    if (status === 'submitted') {
      await this.notifyStep(organizationId, viewer, after, employee, actor.userId);
    } else {
      const beneficiary = employee.userId ? [employee.userId] : [];
      await this.notifier.send({
        organizationId,
        entityType: 'expense_report',
        entityId: reportId,
        kind: decision === 'approve' ? 'hr.expense_approved' : 'hr.expense_rejected',
        recipients: [...beneficiary, r.createdBy],
        title: `Note de frais ${r.number ?? ''} ${decision === 'approve' ? 'validée' : 'refusée'}`,
        href: HR_MY_EXPENSES_HREF,
        actorUserId: actor.userId,
      });
      const settledStatus = status as ExpenseReportLean['status'];
      if (settledStatus === 'approved' || settledStatus === 'partially_settled') {
        const payers = await this.notifier.holdersOf(organizationId, 'payables.pay');
        await this.notifier.send({
          organizationId,
          entityType: 'expense_report',
          entityId: reportId,
          kind: 'hr.expense_approved',
          recipients: payers.filter((u) => u !== employee.userId),
          title: `Note de frais ${r.number ?? ''} à rembourser : ${displayNameOf(employee)}`,
          href: HR_EXPENSES_TO_PAY_HREF,
          actorUserId: actor.userId,
        });
      }
    }
    return (await this.viewsOf(viewer, [after]))[0]!;
  }

  /**
   * Approbation finale d'une note liée à une avance (§ 3.3) : répartition par le moteur,
   * régularisation `expense_report` sur l'avance, dépenses SANS compte pour la part
   * couverte (dans la transaction). Le complément éventuel attend le remboursement.
   */
  private async settleByAdvance(
    session: ClientSession,
    organizationId: string,
    r: ExpenseReportLean,
    today: string,
    actor: HrActor,
  ): Promise<NonNullable<ExpenseReportLean['settlement']>> {
    const advance = await this.advances
      .findOne({ _id: new Types.ObjectId(r.advanceId!), organizationId }, null, { session })
      .lean<EmployeeAdvanceLean>()
      .exec();
    if (!advance || advance.kind !== 'expenses' || advance.employeeId !== r.employeeId) {
      conflict('ADVANCE_NOT_LINKABLE', 'L’avance liée n’est plus utilisable.');
    }
    const plan = advanceSettlementPlan(advanceInputOf(advance), {
      currency: r.currency,
      lines: r.lines.map((l) => ({ amount: l.amount })),
    });
    if (!plan.ok) {
      if (plan.code === 'EXPENSE_REPORT_CURRENCY_MISMATCH') {
        unprocessable(plan.code, 'Une note et l’avance qu’elle justifie ont la même devise.');
      }
      conflict(plan.code, 'L’avance liée ne peut pas être régularisée par cette note.');
    }
    const settlementId = new Types.ObjectId().toHexString();
    const settlement: StoredSettlement = {
      id: settlementId,
      kind: 'expense_report',
      amount: plan.fromAdvance,
      on: today,
      reference: r.number,
      by: actor.userId,
      at: new Date(),
      note: null,
      movementId: null,
      expenseReportId: String(r._id),
      soleApprover: false,
      cancelledAt: null,
      cancelledBy: null,
    };
    const nextStatus = moneyStatusOf(advanceInputOf(advance, [settlement]));
    const res = await this.advances
      .updateOne(
        { _id: advance._id, organizationId, revision: advance.revision },
        {
          $push: { settlements: settlement },
          $set: { status: nextStatus, updatedBy: actor.userId },
          $inc: { revision: 1 },
        },
        { session },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision(advance.revision + 1);
    const covered = plan.lines.filter((l) => l.fromAdvance !== '0.00');
    const docs = await this.treasury.recordOwnedByExpenseReport(session, {
      organizationId,
      reportId: String(r._id),
      reportNumber: r.number!,
      currency: r.currency,
      paidOn: today,
      accountId: null,
      settledByAdvanceId: String(advance._id),
      reference: advance.number,
      lines: covered.map((p) => {
        const l = r.lines[p.lineIndex]!;
        return {
          lineIndex: p.lineIndex,
          spentOn: l.spentOn,
          amount: p.fromAdvance,
          category: l.category,
          label: l.label,
          merchant: l.merchant ?? null,
          workProjectId: l.workProjectId ?? null,
          deductibleVat: l.deductibleVat ?? null,
        };
      }),
      actor,
    });
    await this.audit.record(
      {
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'hr.advance.settled',
        targetType: 'hr_advance',
        targetId: String(advance._id),
        metadata: { kind: 'expense_report', expenseReportId: String(r._id), status: nextStatus },
      },
      { session },
    );
    return {
      advanceId: String(advance._id),
      fromAdvance: plan.fromAdvance,
      topUp: plan.topUp,
      lines: plan.lines.map((l) => ({
        lineIndex: l.lineIndex,
        fromAdvance: l.fromAdvance,
        topUp: l.topUp,
      })),
      settlementId,
      expenseIds: docs.map((d) => String(d._id)),
    };
  }

  // ── Annulation, duplication ──────────────────────────────────────────────

  async cancel(
    organizationId: string,
    viewer: HrViewer,
    reportId: string,
    body: CancelExpenseBody,
    actor: HrActor,
  ): Promise<ExpenseReportView> {
    const { r, access } = await this.requireVisible(organizationId, viewer, reportId);
    if (body.expectedRevision !== undefined && body.expectedRevision !== r.revision) {
      staleRevision(r.revision);
    }
    const declarant = access.self || access.creator;
    const early = r.status === 'draft' || r.status === 'submitted';
    if (declarant && early) {
      // Le bénéficiaire ou l'auteur, tant que rien n'est décidé.
    } else if (access.approver && (r.status === 'submitted' || r.status === 'approved')) {
      if (!body.reason) {
        unprocessable(
          'EXPENSE_CANCEL_REASON_REQUIRED',
          'Une annulation par un validateur porte un motif.',
        );
      }
    } else if (!declarant && !access.approver) {
      forbiddenAction(
        'expenses.approve',
        viewer.role,
        'Annuler la note d’un autre exige de valider les notes de frais.',
      );
    } else {
      conflict(
        'EXPENSE_REPORT_NOT_CANCELLABLE',
        'Cette note ne s’annule plus : un remboursement ou une avance l’a déjà réglée.',
      );
    }
    const res = await this.reports
      .updateOne(
        { _id: r._id, organizationId, revision: r.revision, status: r.status },
        {
          $set: {
            status: 'cancelled',
            cancelReason: body.reason ?? null,
            cancelledAt: new Date(),
            cancelledBy: actor.userId,
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1) staleRevision(r.revision + 1);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.expense_report.cancelled',
      targetType: 'hr_expense_report',
      targetId: reportId,
      metadata: { from: r.status, byDeclarant: declarant && early },
    });
    return this.get(organizationId, viewer, reportId);
  }

  /** Copie d'une note refusée ou annulée en brouillon, sans justificatif ni avance. */
  async duplicate(
    organizationId: string,
    viewer: HrViewer,
    reportId: string,
    actor: HrActor,
  ): Promise<ExpenseReportView> {
    const { r, access } = await this.requireVisible(organizationId, viewer, reportId);
    if (!access.self && !access.creator) {
      forbiddenAction('expenses.claim', viewer.role, 'Seul le déclarant duplique sa note.');
    }
    if (r.status !== 'rejected' && r.status !== 'cancelled') {
      conflict('EXPENSE_REPORT_NOT_DUPLICABLE', 'Seule une note refusée ou annulée se duplique.');
    }
    const [doc] = await this.reports.create([
      {
        organizationId,
        number: null,
        employeeId: r.employeeId,
        title: r.title,
        currency: r.currency,
        lines: r.lines.map((l) => ({
          ...l,
          id: new Types.ObjectId().toHexString(),
          receipt: null,
        })),
        advanceId: null,
        status: 'draft',
        steps: [],
        approvals: [],
        settlement: null,
        reimbursement: null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        revision: 1,
        _schemaVersion: 1,
      },
    ]);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.expense_report.duplicated',
      targetType: 'hr_expense_report',
      targetId: String(doc!._id),
      metadata: { from: reportId },
    });
    return this.get(organizationId, viewer, String(doc!._id));
  }

  // ── Remboursement ────────────────────────────────────────────────────────

  async reimburse(
    organizationId: string,
    viewer: HrViewer,
    reportId: string,
    body: ReimburseExpenseReportBody,
    actor: HrActor,
  ): Promise<ExpenseReportView> {
    const { r, employee } = await this.requireVisible(organizationId, viewer, reportId);
    if (r.status !== 'approved' && r.status !== 'partially_settled') {
      conflict(
        'EXPENSE_NOT_REIMBURSABLE',
        'Seule une note approuvée, non remboursée, se rembourse.',
      );
    }
    if (body.expectedRevision !== r.revision) staleRevision(r.revision);
    const [s, payers] = await Promise.all([
      this.settings.of(organizationId),
      this.authz.holdersOf(organizationId, 'payables.pay'),
    ]);
    const verdict = payerDecision({
      payerUserId: viewer.userId,
      beneficiaryUserId: employee.userId ?? null,
      financeApproverUserId: financeApproverOf(r),
      payerCount: new Set(payers).size,
      allowSoleApprover: s.allowSoleApprover,
    });
    const partial = r.status === 'partially_settled';
    const lines = partial
      ? (r.settlement?.lines ?? [])
          .filter((p) => p.topUp !== '0.00')
          .map((p) => ({ index: p.lineIndex, amount: p.topUp }))
      : r.lines.map((l, index) => ({ index, amount: l.amount }));
    const accountId = body.accountId ?? null;
    await inHrTransaction(this.connection, async (session) => {
      const docs = await this.treasury.recordOwnedByExpenseReport(session, {
        organizationId,
        reportId,
        reportNumber: r.number!,
        currency: r.currency,
        paidOn: body.paidOn,
        accountId,
        settledByAdvanceId: null,
        reference: body.reference ?? null,
        lines: lines.map(({ index, amount }) => {
          const l = r.lines[index]!;
          return {
            lineIndex: index,
            spentOn: l.spentOn,
            amount,
            category: l.category,
            label: l.label,
            merchant: l.merchant ?? null,
            workProjectId: l.workProjectId ?? null,
            deductibleVat: partial ? null : (l.deductibleVat ?? null),
          };
        }),
        actor,
      });
      let topUpSettlementId: string | null = null;
      if (partial && r.settlement) {
        topUpSettlementId = await this.recordTopUp(session, organizationId, r, body.paidOn, actor);
      }
      const res = await this.reports
        .updateOne(
          { _id: r._id, organizationId, revision: r.revision, status: r.status },
          {
            $set: {
              status: 'reimbursed',
              reimbursement: {
                paidOn: body.paidOn,
                accountId,
                method: body.method,
                reference: body.reference ?? null,
                paidBy: actor.userId,
                paidAt: new Date(),
                soleApprover: verdict.soleApprover,
                expenseIds: docs.map((d) => String(d._id)),
                topUpSettlementId,
              },
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision(r.revision + 1);
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'hr.expense_report.reimbursed',
          targetType: 'hr_expense_report',
          targetId: reportId,
          metadata: {
            expenses: docs.length,
            accountId,
            method: body.method,
            topUp: partial,
            soleApprover: verdict.soleApprover,
          },
        },
        { session },
      );
    });
    await this.notifier.send({
      organizationId,
      entityType: 'expense_report',
      entityId: reportId,
      kind: 'hr.expense_reimbursed',
      recipients: [...(employee.userId ? [employee.userId] : []), r.createdBy],
      title: `Note de frais ${r.number ?? ''} remboursée`,
      href: HR_MY_EXPENSES_HREF,
      actorUserId: actor.userId,
    });
    return this.get(organizationId, viewer, reportId);
  }

  /** Complément `top_up` inscrit sur l'avance liée (n'en réduit pas le reste dû). */
  private async recordTopUp(
    session: ClientSession,
    organizationId: string,
    r: ExpenseReportLean,
    on: string,
    actor: HrActor,
  ): Promise<string> {
    const plan = r.settlement!;
    const id = new Types.ObjectId().toHexString();
    const res = await this.advances
      .updateOne(
        { _id: new Types.ObjectId(plan.advanceId), organizationId },
        {
          $push: {
            settlements: {
              id,
              kind: 'top_up',
              amount: plan.topUp,
              on,
              reference: r.number,
              by: actor.userId,
              at: new Date(),
              note: null,
              movementId: null,
              expenseReportId: String(r._id),
              soleApprover: false,
              cancelledAt: null,
              cancelledBy: null,
            } satisfies StoredSettlement,
          },
          $set: { updatedBy: actor.userId },
          $inc: { revision: 1 },
        },
        { session },
      )
      .exec();
    if (res.matchedCount !== 1) conflict('ADVANCE_NOT_LINKABLE', 'L’avance liée est introuvable.');
    return id;
  }

  async cancelReimbursement(
    organizationId: string,
    viewer: HrViewer,
    reportId: string,
    body: CancelReimbursementBody,
    actor: HrActor,
  ): Promise<ExpenseReportView> {
    const { r } = await this.requireVisible(organizationId, viewer, reportId);
    if (r.status !== 'reimbursed' || !r.reimbursement) {
      conflict('EXPENSE_NOT_REIMBURSED', 'Cette note n’a pas été remboursée.');
    }
    if (body.expectedRevision !== r.revision) staleRevision(r.revision);
    const back = r.settlement ? 'partially_settled' : 'approved';
    const topUpId = r.reimbursement.topUpSettlementId ?? null;
    await inHrTransaction(this.connection, async (session) => {
      const n = await this.treasury.cancelOwnedByExpenseReport(
        session,
        organizationId,
        reportId,
        { settledByAdvanceId: null },
        body.reason,
        actor,
      );
      if (topUpId && r.settlement) {
        await this.advances
          .updateOne(
            {
              _id: new Types.ObjectId(r.settlement.advanceId),
              organizationId,
              'settlements.id': topUpId,
            },
            {
              $set: {
                'settlements.$.cancelledAt': new Date(),
                'settlements.$.cancelledBy': actor.userId,
                updatedBy: actor.userId,
              },
              $inc: { revision: 1 },
            },
            { session },
          )
          .exec();
      }
      const res = await this.reports
        .updateOne(
          { _id: r._id, organizationId, revision: r.revision, status: 'reimbursed' },
          {
            $set: { status: back, reimbursement: null, updatedBy: actor.userId },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision(r.revision + 1);
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'hr.expense_report.reimbursement_cancelled',
          targetType: 'hr_expense_report',
          targetId: reportId,
          metadata: { cancelledExpenses: n, reason: body.reason.slice(0, 200), status: back },
        },
        { session },
      );
    });
    return this.get(organizationId, viewer, reportId);
  }

  // ── Résumés ──────────────────────────────────────────────────────────────

  async summary(
    organizationId: string,
    viewer: HrViewer,
    query: ExpenseSummaryQuery,
  ): Promise<ExpenseSummaryResult> {
    if (!viewer.actions.has('expenses.approve') && !viewer.actions.has('hr.read')) {
      forbiddenAction(
        'hr.read',
        viewer.role,
        'Le résumé des frais est réservé aux validateurs et aux RH.',
      );
    }
    const docs = await this.reports
      .find(
        {
          organizationId,
          status: { $in: [...EXPENSE_SUMMARY_STATUSES] },
          lines: { $elemMatch: { spentOn: { $gte: query.from, $lte: query.to } } },
        },
        { currency: 1, status: 1, employeeId: 1, lines: 1 },
      )
      .lean<ExpenseReportLean[]>()
      .exec();
    return expenseSummary(
      docs.map((d) => ({
        id: String(d._id),
        currency: d.currency,
        status: d.status,
        departmentId: viewer.byId.get(d.employeeId)?.departmentId ?? null,
        lines: d.lines.map((l) => ({
          spentOn: l.spentOn,
          category: l.category,
          amount: l.amount,
          workProjectId: l.workProjectId ?? null,
        })),
      })),
      query.from,
      query.to,
      query.groupBy,
    );
  }

  /** `GET /hr/expenses/to-pay` — notes à rembourser, avances à verser (§ 7.2). */
  async toPay(organizationId: string, viewer: HrViewer): Promise<HrToPayView> {
    const [reports, advances] = await Promise.all([
      this.reports
        .find({ organizationId, status: { $in: ['approved', 'partially_settled'] } })
        .sort({ approvedAt: 1, _id: 1 })
        .limit(500)
        .lean<ExpenseReportLean[]>()
        .exec(),
      this.advances
        .find({ organizationId, status: 'approved' })
        .sort({ approvedAt: 1, _id: 1 })
        .limit(500)
        .lean<EmployeeAdvanceLean[]>()
        .exec(),
    ]);
    const nameOf = (employeeId: string) => {
      const e = viewer.byId.get(employeeId);
      return e ? displayNameOf(e) : '';
    };
    return {
      items: [
        ...reports.map((r) => {
          const total = expenseReportTotals(r.lines).total;
          return {
            kind: 'expense_report' as const,
            id: String(r._id),
            number: r.number,
            label: `Note de frais ${r.number ?? ''}`.trim(),
            employeeName: nameOf(r.employeeId),
            currency: r.currency,
            amount: toReimburseOf(r, total) ?? total,
            approvedAt: r.approvedAt ? new Date(r.approvedAt).toISOString() : null,
          };
        }),
        ...advances.map((a) => ({
          kind: 'advance' as const,
          id: String(a._id),
          number: a.number,
          // Jamais « sur salaire » : une avance est « Avance AV… » pour le payeur.
          label: `Avance ${a.number ?? ''}`.trim(),
          employeeName: nameOf(a.employeeId),
          currency: a.currency,
          amount: a.amount,
          approvedAt: a.approvedAt ? new Date(a.approvedAt).toISOString() : null,
        })),
      ],
    };
  }

  // ── Interne ──────────────────────────────────────────────────────────────

  private bucket(): string {
    const bucket = this.storage.uploadsBucket();
    if (!bucket) {
      const a = this.storage.availability();
      throw new ObjectStorageUnavailableError(a.available ? 'Bucket absent.' : a.reason);
    }
    return bucket;
  }

  /** Efface des objets au mieux ; un échec est journalisé (sans contenu), jamais remonté. */
  private async dropObjects(objectIds: readonly string[]): Promise<void> {
    const bucket = this.storage.uploadsBucket();
    if (!bucket) return;
    for (const objectId of objectIds) {
      try {
        await this.storage.deleteObject(bucket, expenseReceiptObjectKey(objectId));
      } catch (err) {
        this.logger.warn(`Justificatif ${objectId} non supprimé : ${(err as Error).message}`);
      }
    }
  }
}
