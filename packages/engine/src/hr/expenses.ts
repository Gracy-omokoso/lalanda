// ─────────────────────────────────────────────────────────────────────────────
// Notes de frais (ADR-0051 § 2.1, § 3.1, § 6.1, § 9)
//
// - `checkExpenseReport` : contrôles d'une note avant soumission, rendus en
//   codes (`EXPENSE_IN_FUTURE`, `EXPENSE_LINE_CATEGORY_NOT_ALLOWED`, …) ; aucun
//   seuil de montant, aucun barème (kilométrique, repas, per diem : J5, C4).
// - `expenseReportTotals` : total de la note, par catégorie, par projet, en
//   CENTIMES exacts (`bigint`) ; la somme des groupes égale le total.
// - `expenseApprovalSteps` : étapes figées à la soumission.
// - `expenseSummary` : totaux des notes approuvées et réglées, par devise,
//   groupés par catégorie, service ou projet — jamais par personne.
//
// Une note a UNE devise (`CDF` ou `USD`) ; aucune conversion. La TVA déclarée
// est contrôlée (≤ montant) mais n'entre dans AUCUN calcul (ADR-0034, d.o. 1).
// ─────────────────────────────────────────────────────────────────────────────

import { centsOf, formatCents } from '../treasury/money.js';
import { EXPENSE_CATEGORY_CODES, type ExpenseCategory } from '../treasury/types.js';
import { byString, checkDay, checkId } from './days.js';
import { HR_VERSION, type HrDay } from './types.js';

/** Devises des pièces RH (ADR-0051 § 1) ; jamais de conversion. */
export const HR_CURRENCIES = ['CDF', 'USD'] as const;
export type HrCurrency = (typeof HR_CURRENCIES)[number];

/** Montant décimal à deux décimales (« 15.00 »). */
export type HrAmount = string;

/** Nombre de lignes d'une note (ADR-0051 § 2.1). */
export const EXPENSE_REPORT_LINES_BOUNDS = { min: 1, max: 50 } as const;

/** Catégories refusées sur une ligne : une immobilisation passe par les achats. */
export const EXPENSE_LINE_FORBIDDEN_CATEGORIES: readonly ExpenseCategory[] = [
  'investissement',
  'remboursement_emprunt',
];

export interface ExpenseLineInput {
  spentOn: HrDay;
  category: string;
  /** Payé par le collaborateur, > 0, deux décimales au plus. */
  amount: HrAmount;
  workProjectId?: string | null;
  /** TVA déclarée, conservée, jamais calculée. */
  deductibleVat?: HrAmount | null;
  rebillable?: boolean;
  /** Un justificatif est joint. */
  hasReceipt?: boolean;
  missingReceiptReason?: string | null;
}

export type ExpenseLineIssueCode =
  | 'EXPENSE_REPORT_EMPTY'
  | 'EXPENSE_REPORT_TOO_MANY_LINES'
  | 'EXPENSE_REPORT_CURRENCY_UNKNOWN'
  | 'EXPENSE_AMOUNT_INVALID'
  | 'EXPENSE_IN_FUTURE'
  | 'EXPENSE_DATE_INVALID'
  | 'EXPENSE_LINE_CATEGORY_UNKNOWN'
  | 'EXPENSE_LINE_CATEGORY_NOT_ALLOWED'
  | 'EXPENSE_VAT_INVALID'
  | 'EXPENSE_REBILLABLE_WITHOUT_PROJECT'
  | 'EXPENSE_RECEIPT_REASON_REQUIRED';

export interface ExpenseReportCheck {
  version: string;
  ok: boolean;
  /** `lineIndex` nul : contrôle de la note entière. Ordre : note, puis lignes. */
  issues: { lineIndex: number | null; code: ExpenseLineIssueCode }[];
}

export interface ExpenseReportTotals {
  version: string;
  lineCount: number;
  total: HrAmount;
  /** Ordre d'affichage des catégories (ADR-0034 § 1). */
  byCategory: { category: ExpenseCategory; total: HrAmount; lines: number }[];
  /** `workProjectId` nul en dernier, puis ordre des identifiants. */
  byProject: { workProjectId: string | null; total: HrAmount; lines: number }[];
  /** Lignes marquées refacturables (marque informative, § 7.3). */
  rebillable: HrAmount;
}

export type ExpenseApprovalFlow = 'manager_then_finance' | 'finance_only';
export type ExpenseApprovalStep = 'manager' | 'finance';

export interface ExpenseApprovalStepsResult {
  version: string;
  steps: ExpenseApprovalStep[];
  /** Raison du retrait de l'étape `manager`, sinon `null`. */
  managerReplacedBy:
    | null
    | 'FINANCE_ONLY_FLOW'
    | 'NO_MANAGER'
    | 'MANAGER_WITHOUT_ACCOUNT'
    | 'MANAGER_IS_BENEFICIARY'
    | 'SALARY_ADVANCE';
}

export const EXPENSE_REPORT_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'reimbursed',
  'settled_by_advance',
  'partially_settled',
  'cancelled',
] as const;
export type ExpenseReportStatus = (typeof EXPENSE_REPORT_STATUSES)[number];

/** Statuts comptés dans les totaux (approuvée, et au-delà) — § 6.1. */
export const EXPENSE_SUMMARY_STATUSES: readonly ExpenseReportStatus[] = [
  'approved',
  'reimbursed',
  'settled_by_advance',
  'partially_settled',
];

export interface ExpenseSummaryReportInput {
  id: string;
  currency: HrCurrency;
  status: ExpenseReportStatus;
  /** Service du bénéficiaire, pour `groupBy = department`. */
  departmentId?: string | null;
  lines: readonly Pick<ExpenseLineInput, 'spentOn' | 'category' | 'amount' | 'workProjectId'>[];
}

export type ExpenseSummaryGroupBy = 'category' | 'department' | 'project';

export interface ExpenseSummaryGroup {
  /** Catégorie, service ou projet ; `null` : sans service, sans projet. */
  key: string | null;
  currency: HrCurrency;
  total: HrAmount;
  lines: number;
  reports: number;
}

export interface ExpenseSummaryResult {
  version: string;
  from: HrDay;
  to: HrDay;
  groupBy: ExpenseSummaryGroupBy;
  /** Devise, puis clé. Aucun nom de personne. */
  groups: ExpenseSummaryGroup[];
  /** Par devise : total, et part des notes encore à rembourser (`approved`). */
  totals: { currency: HrCurrency; total: HrAmount; awaitingReimbursement: HrAmount }[];
}

// ─── Internes ────────────────────────────────────────────────────────────────

export function isHrCurrency(value: unknown): value is HrCurrency {
  return value === 'CDF' || value === 'USD';
}

/** Centimes d'un montant strictement positif, sinon `null`. */
export function positiveAmountCents(value: unknown): bigint | null {
  const c = centsOf(value);
  return c !== null && c > 0n ? c : null;
}

function trustedPositive(value: unknown, what: string): bigint {
  const c = positiveAmountCents(value);
  if (c === null) {
    throw new RangeError(`${what} : montant > 0 d’au plus deux décimales attendu`);
  }
  return c;
}

function checkCategory(value: unknown, what: string): ExpenseCategory {
  if (
    typeof value !== 'string' ||
    !(EXPENSE_CATEGORY_CODES as readonly string[]).includes(value) ||
    (EXPENSE_LINE_FORBIDDEN_CATEGORIES as readonly string[]).includes(value)
  ) {
    throw new RangeError(`${what} : catégorie de frais refusée ${JSON.stringify(value)}`);
  }
  return value as ExpenseCategory;
}

const projectOf = (value: string | null | undefined): string | null =>
  value === undefined || value === null ? null : value;

// ─── Contrôles ───────────────────────────────────────────────────────────────

/**
 * Contrôles d'une note (ADR-0051 § 2.1). `today` : jour civil de Kinshasa de
 * l'appelant. `receiptRequired` : réglage `hr_settings.expenses.receiptRequired`
 * — une ligne sans justificatif exige alors un motif ; aucun seuil de montant.
 */
export function checkExpenseReport(
  report: { currency: unknown; lines: readonly ExpenseLineInput[] },
  today: HrDay,
  options: { receiptRequired: boolean },
): ExpenseReportCheck {
  checkDay(today, 'Aujourd’hui');
  const issues: ExpenseReportCheck['issues'] = [];
  if (!isHrCurrency(report.currency)) {
    issues.push({ lineIndex: null, code: 'EXPENSE_REPORT_CURRENCY_UNKNOWN' });
  }
  if (report.lines.length < EXPENSE_REPORT_LINES_BOUNDS.min) {
    issues.push({ lineIndex: null, code: 'EXPENSE_REPORT_EMPTY' });
  }
  if (report.lines.length > EXPENSE_REPORT_LINES_BOUNDS.max) {
    issues.push({ lineIndex: null, code: 'EXPENSE_REPORT_TOO_MANY_LINES' });
  }
  for (const [i, line] of report.lines.entries()) {
    const push = (code: ExpenseLineIssueCode): void => {
      issues.push({ lineIndex: i, code });
    };
    let dateOk = true;
    try {
      checkDay(line.spentOn, 'Date');
    } catch {
      dateOk = false;
      push('EXPENSE_DATE_INVALID');
    }
    if (dateOk && line.spentOn > today) push('EXPENSE_IN_FUTURE');
    if (
      typeof line.category !== 'string' ||
      !(EXPENSE_CATEGORY_CODES as readonly string[]).includes(line.category)
    ) {
      push('EXPENSE_LINE_CATEGORY_UNKNOWN');
    } else if ((EXPENSE_LINE_FORBIDDEN_CATEGORIES as readonly string[]).includes(line.category)) {
      push('EXPENSE_LINE_CATEGORY_NOT_ALLOWED');
    }
    const amount = positiveAmountCents(line.amount);
    if (amount === null) push('EXPENSE_AMOUNT_INVALID');
    if (line.deductibleVat !== undefined && line.deductibleVat !== null) {
      const vat = centsOf(line.deductibleVat);
      if (vat === null || vat < 0n || (amount !== null && vat > amount)) {
        push('EXPENSE_VAT_INVALID');
      }
    }
    if (line.rebillable === true && projectOf(line.workProjectId) === null) {
      push('EXPENSE_REBILLABLE_WITHOUT_PROJECT');
    }
    const reason = line.missingReceiptReason?.trim() ?? '';
    if (options.receiptRequired && line.hasReceipt !== true && reason === '') {
      push('EXPENSE_RECEIPT_REASON_REQUIRED');
    }
  }
  return { version: HR_VERSION, ok: issues.length === 0, issues };
}

// ─── Totaux ──────────────────────────────────────────────────────────────────

/**
 * Totaux d'une note (ADR-0051 § 9). Lignes déjà contrôlées : une ligne
 * illisible lève une `RangeError`. Σ `byCategory` = Σ `byProject` = `total`.
 */
export function expenseReportTotals(
  lines: readonly Pick<
    ExpenseLineInput,
    'category' | 'amount' | 'workProjectId' | 'rebillable'
  >[],
): ExpenseReportTotals {
  if (lines.length > EXPENSE_REPORT_LINES_BOUNDS.max) {
    throw new RangeError(`Note de frais : ${EXPENSE_REPORT_LINES_BOUNDS.max} lignes au plus`);
  }
  let total = 0n;
  let rebillable = 0n;
  const byCategory = new Map<ExpenseCategory, { cents: bigint; lines: number }>();
  const byProject = new Map<string | null, { cents: bigint; lines: number }>();
  for (const [i, line] of lines.entries()) {
    const what = `Ligne n° ${i + 1}`;
    const cents = trustedPositive(line.amount, what);
    const category = checkCategory(line.category, what);
    const project = projectOf(line.workProjectId);
    if (project !== null) checkId(project, `${what} (projet)`);
    total += cents;
    if (line.rebillable === true && project !== null) rebillable += cents;
    const c = byCategory.get(category) ?? { cents: 0n, lines: 0 };
    byCategory.set(category, { cents: c.cents + cents, lines: c.lines + 1 });
    const p = byProject.get(project) ?? { cents: 0n, lines: 0 };
    byProject.set(project, { cents: p.cents + cents, lines: p.lines + 1 });
  }
  return {
    version: HR_VERSION,
    lineCount: lines.length,
    total: formatCents(total),
    byCategory: EXPENSE_CATEGORY_CODES.filter((code) => byCategory.has(code)).map((category) => {
      const g = byCategory.get(category) as { cents: bigint; lines: number };
      return { category, total: formatCents(g.cents), lines: g.lines };
    }),
    byProject: [...byProject.entries()]
      .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : byString(a, b)))
      .map(([workProjectId, g]) => ({
        workProjectId,
        total: formatCents(g.cents),
        lines: g.lines,
      })),
    rebillable: formatCents(rebillable),
  };
}

// ─── Circuit ─────────────────────────────────────────────────────────────────

/**
 * Étapes d'une note (ADR-0051 § 3.1) : `manager_then_finance` →
 * `['manager', 'finance']`, `finance_only` → `['finance']`. L'étape `manager`
 * tombe sans manager, si le manager n'a pas de compte, ou s'il est lui-même le
 * bénéficiaire (celui qui demande ne valide pas).
 */
export function expenseApprovalSteps(
  settings: { approvalFlow: ExpenseApprovalFlow },
  employee: { managerEmployeeId: string | null; managerUserId: string | null },
  beneficiaryUserId: string | null,
): ExpenseApprovalStepsResult {
  if (
    settings.approvalFlow !== 'manager_then_finance' &&
    settings.approvalFlow !== 'finance_only'
  ) {
    throw new RangeError(`Circuit inconnu ${JSON.stringify(settings.approvalFlow)}`);
  }
  let managerReplacedBy: ExpenseApprovalStepsResult['managerReplacedBy'] = null;
  if (settings.approvalFlow === 'finance_only') managerReplacedBy = 'FINANCE_ONLY_FLOW';
  else if (employee.managerEmployeeId === null) managerReplacedBy = 'NO_MANAGER';
  else if (employee.managerUserId === null) managerReplacedBy = 'MANAGER_WITHOUT_ACCOUNT';
  else if (beneficiaryUserId !== null && employee.managerUserId === beneficiaryUserId) {
    managerReplacedBy = 'MANAGER_IS_BENEFICIARY';
  }
  return {
    version: HR_VERSION,
    steps: managerReplacedBy === null ? ['manager', 'finance'] : ['finance'],
    managerReplacedBy,
  };
}

// ─── Résumé ──────────────────────────────────────────────────────────────────

/**
 * Totaux des notes approuvées et au-delà (ADR-0051 § 6.1), lignes datées de
 * `from` à `to` (date de la ligne : date de la charge, d.o. n° 13), par devise.
 * Les brouillons, notes soumises, refusées ou annulées sont ignorés.
 */
export function expenseSummary(
  reports: readonly ExpenseSummaryReportInput[],
  from: HrDay,
  to: HrDay,
  groupBy: ExpenseSummaryGroupBy,
): ExpenseSummaryResult {
  checkDay(from, 'Début');
  checkDay(to, 'Fin');
  if (to < from) throw new RangeError('Résumé des frais : la fin précède le début');
  if (groupBy !== 'category' && groupBy !== 'department' && groupBy !== 'project') {
    throw new RangeError(`Regroupement inconnu ${JSON.stringify(groupBy)}`);
  }
  const groups = new Map<
    string,
    { key: string | null; currency: HrCurrency; cents: bigint; lines: number; reports: Set<string> }
  >();
  const totals = new Map<HrCurrency, { cents: bigint; awaiting: bigint }>();
  for (const [r, report] of reports.entries()) {
    const what = `Note n° ${r + 1}`;
    checkId(report.id, what);
    if (!isHrCurrency(report.currency)) throw new RangeError(`${what} : devise inconnue`);
    if (!(EXPENSE_REPORT_STATUSES as readonly string[]).includes(report.status)) {
      throw new RangeError(`${what} : statut inconnu ${JSON.stringify(report.status)}`);
    }
    if (!EXPENSE_SUMMARY_STATUSES.includes(report.status)) continue;
    for (const [i, line] of report.lines.entries()) {
      const lineWhat = `${what}, ligne n° ${i + 1}`;
      const day = checkDay(line.spentOn, lineWhat);
      const cents = trustedPositive(line.amount, lineWhat);
      const category = checkCategory(line.category, lineWhat);
      if (day < from || day > to) continue;
      const key =
        groupBy === 'category'
          ? category
          : groupBy === 'department'
            ? (report.departmentId ?? null)
            : projectOf(line.workProjectId);
      const id = `${report.currency}\u0000${key === null ? '\u0001' : `\u0002${key}`}`;
      const g = groups.get(id) ?? {
        key,
        currency: report.currency,
        cents: 0n,
        lines: 0,
        reports: new Set<string>(),
      };
      g.cents += cents;
      g.lines += 1;
      g.reports.add(report.id);
      groups.set(id, g);
      const t = totals.get(report.currency) ?? { cents: 0n, awaiting: 0n };
      t.cents += cents;
      if (report.status === 'approved') t.awaiting += cents;
      totals.set(report.currency, t);
    }
  }
  const categoryRank = (key: string | null): number =>
    key === null ? Number.MAX_SAFE_INTEGER : (EXPENSE_CATEGORY_CODES as readonly string[]).indexOf(key);
  return {
    version: HR_VERSION,
    from,
    to,
    groupBy,
    groups: [...groups.values()]
      .sort((a, b) => {
        if (a.currency !== b.currency) return byString(a.currency, b.currency);
        if (groupBy === 'category') return categoryRank(a.key) - categoryRank(b.key);
        if (a.key === null) return b.key === null ? 0 : 1;
        if (b.key === null) return -1;
        return byString(a.key, b.key);
      })
      .map((g) => ({
        key: g.key,
        currency: g.currency,
        total: formatCents(g.cents),
        lines: g.lines,
        reports: g.reports.size,
      })),
    totals: HR_CURRENCIES.filter((c) => totals.has(c)).map((currency) => {
      const t = totals.get(currency) as { cents: bigint; awaiting: bigint };
      return {
        currency,
        total: formatCents(t.cents),
        awaitingReimbursement: formatCents(t.awaiting),
      };
    }),
  };
}
