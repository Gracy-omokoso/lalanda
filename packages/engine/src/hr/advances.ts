// ─────────────────────────────────────────────────────────────────────────────
// Avances au personnel (ADR-0051 § 2.2, § 3.2, § 3.3, § 7.2, § 9)
//
// - `checkAdvanceRequest` : type éteint (`ADVANCE_KIND_DISABLED`), plafond
//   SAISI par l'organisation (`ADVANCE_ABOVE_ORGANIZATION_LIMIT`). Lalanda ne
//   pose AUCUN plafond, ne lit jamais le salaire (J1).
// - `advanceApprovalSteps` : avance de frais comme une note ; avance sur
//   salaire : étape `finance` seule (le manager n'est pas informé, d.o. n° 4).
// - `advanceOutstanding` : versé − Σ régularisations, jamais négatif ; un excès
//   éventuel des données est rendu à part (`overSettled`), jamais absorbé.
// - `checkAdvanceSettlement` : refuse une régularisation au-delà du reste dû.
// - `advanceSettlementPlan` : répartit une note liée entre l'avance (dépenses
//   sans compte) et le complément dû au collaborateur (`top_up`), au centime,
//   par la méthode du plus fort reste, de façon déterministe.
// - `advanceFindings` : constats `ADVANCE_OVERDUE`, `ADVANCE_SETTLED_ON_PAYROLL`.
//
// Aucune retenue sur salaire n'est calculée (paie exclue, O3) ; aucune
// régularisation n'est déclenchée par le temps.
// ─────────────────────────────────────────────────────────────────────────────

import { formatCents } from '../treasury/money.js';
import { byString, checkDay, checkId } from './days.js';
import {
  expenseApprovalSteps,
  isHrCurrency,
  positiveAmountCents,
  type ExpenseApprovalFlow,
  type ExpenseApprovalStepsResult,
  type ExpenseLineInput,
  type HrAmount,
  type HrCurrency,
} from './expenses.js';
import { HR_VERSION, type HrDay } from './types.js';

export const ADVANCE_KINDS = ['expenses', 'salary'] as const;
export type AdvanceKind = (typeof ADVANCE_KINDS)[number];

export const ADVANCE_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'disbursed',
  'partially_settled',
  'settled',
  'cancelled',
  'written_off',
] as const;
export type AdvanceStatus = (typeof ADVANCE_STATUSES)[number];

export const ADVANCE_SETTLEMENT_KINDS = [
  'expense_report',
  'cash_return',
  'declared_payroll',
  'top_up',
  'write_off',
] as const;
export type AdvanceSettlementKind = (typeof ADVANCE_SETTLEMENT_KINDS)[number];

/** Régularisations qui réduisent le reste dû (`top_up` est versé AU collaborateur). */
export const ADVANCE_REDUCING_SETTLEMENTS: readonly AdvanceSettlementKind[] = [
  'expense_report',
  'cash_return',
  'declared_payroll',
  'write_off',
];

/** Nombre maximal de régularisations d'une avance (ADR-0051 § 2.2). */
export const ADVANCE_MAX_SETTLEMENTS = 100;

export interface AdvanceSettlementInput {
  id: string;
  kind: AdvanceSettlementKind;
  amount: HrAmount;
  on: HrDay;
}

export interface AdvanceInput {
  kind: AdvanceKind;
  currency: HrCurrency;
  /** Montant demandé et validé. */
  amount: HrAmount;
  /** Versement ; `null` tant que l'avance n'est pas versée. */
  disbursement: { paidOn: HrDay } | null;
  settlements: readonly AdvanceSettlementInput[];
  /** Régularisation annoncée : `AAAA-MM-JJ` ou `AAAA-MM` ; informatif. */
  expectedSettlement?: string | null;
}

export interface AdvanceSettings {
  enabled: { expenses: boolean; salary: boolean };
  /** Plafond saisi par l'organisation, par devise ; `null` = aucun (défaut). */
  maxAmount: Readonly<Record<HrCurrency, HrAmount | null>>;
  allowDeclaredPayrollSettlement: boolean;
}

export interface AdvanceRequestCheck {
  version: string;
  ok: boolean;
  code: null | 'ADVANCE_KIND_DISABLED' | 'ADVANCE_AMOUNT_INVALID' | 'ADVANCE_ABOVE_ORGANIZATION_LIMIT';
}

export interface AdvanceOutstandingResult {
  version: string;
  currency: HrCurrency;
  /** Montant versé (« 0.00 » avant versement). */
  disbursed: HrAmount;
  /** Σ des régularisations qui réduisent le reste dû. */
  settled: HrAmount;
  /** Σ des compléments versés au collaborateur (`top_up`), hors reste dû. */
  toppedUp: HrAmount;
  /** max(0, versé − réglé). */
  outstanding: HrAmount;
  /** max(0, réglé − versé) : incohérence des données, signalée, jamais absorbée. */
  overSettled: HrAmount;
  bySettlementKind: { kind: AdvanceSettlementKind; amount: HrAmount; count: number }[];
  /** Statut dérivé de l'argent (le statut du circuit reste celui du document). */
  state: 'not_disbursed' | 'open' | 'partially_settled' | 'settled';
}

export type AdvanceSettlementCode =
  | 'ADVANCE_NOT_DISBURSED'
  | 'ADVANCE_SETTLEMENT_AMOUNT_INVALID'
  | 'ADVANCE_SETTLEMENT_KIND_MISMATCH'
  | 'ADVANCE_DECLARED_PAYROLL_DISABLED'
  | 'ADVANCE_SETTLEMENT_LIMIT_REACHED'
  | 'ADVANCE_SETTLEMENT_EXCEEDS_OUTSTANDING';

export interface AdvanceSettlementCheck {
  version: string;
  ok: boolean;
  code: AdvanceSettlementCode | null;
  outstandingBefore: HrAmount;
  /** Reste dû après la régularisation (inchangé si refusée). */
  outstandingAfter: HrAmount;
}

export interface AdvanceSettlementPlanLine {
  lineIndex: number;
  amount: HrAmount;
  /** Part couverte par l'avance : dépense SANS compte (§ 3.3). */
  fromAdvance: HrAmount;
  /** Part due au collaborateur : dépense avec compte, au remboursement. */
  topUp: HrAmount;
}

export type AdvanceSettlementPlan =
  | {
      version: string;
      ok: true;
      reportTotal: HrAmount;
      outstandingBefore: HrAmount;
      fromAdvance: HrAmount;
      topUp: HrAmount;
      outstandingAfter: HrAmount;
      lines: AdvanceSettlementPlanLine[];
      /** Régularisations à inscrire sur l'avance, dans cet ordre. */
      settlements: { kind: 'expense_report' | 'top_up'; amount: HrAmount }[];
    }
  | {
      version: string;
      ok: false;
      code:
        | 'ADVANCE_NOT_DISBURSED'
        | 'ADVANCE_SETTLEMENT_KIND_MISMATCH'
        | 'EXPENSE_REPORT_CURRENCY_MISMATCH'
        | 'ADVANCE_ALREADY_SETTLED';
    };

export type AdvanceFindingCode = 'ADVANCE_OVERDUE' | 'ADVANCE_SETTLED_ON_PAYROLL';

export interface AdvanceFinding {
  code: AdvanceFindingCode;
  /** `ADVANCE_OVERDUE` : dernier jour de l'échéance annoncée. */
  dueOn: HrDay | null;
  /** `ADVANCE_SETTLED_ON_PAYROLL` : mois déclaré `AAAA-MM`, montant, régularisation. */
  payrollMonth: string | null;
  amount: HrAmount | null;
  settlementId: string | null;
}

// ─── Internes ────────────────────────────────────────────────────────────────

function checkKind(kind: unknown): AdvanceKind {
  if (kind !== 'expenses' && kind !== 'salary') {
    throw new RangeError(`Avance : type inconnu ${JSON.stringify(kind)}`);
  }
  return kind;
}

function trustedPositive(value: unknown, what: string): bigint {
  const c = positiveAmountCents(value);
  if (c === null) throw new RangeError(`${what} : montant > 0 d’au plus deux décimales attendu`);
  return c;
}

interface Ledger {
  disbursed: bigint;
  settled: bigint;
  toppedUp: bigint;
  byKind: Map<AdvanceSettlementKind, { cents: bigint; count: number }>;
}

function ledgerOf(advance: AdvanceInput): Ledger {
  checkKind(advance.kind);
  if (!isHrCurrency(advance.currency)) throw new RangeError('Avance : devise inconnue');
  const amount = trustedPositive(advance.amount, 'Avance');
  if (advance.disbursement !== null) checkDay(advance.disbursement.paidOn, 'Avance (versement)');
  if (advance.settlements.length > ADVANCE_MAX_SETTLEMENTS) {
    throw new RangeError(`Avance : ${ADVANCE_MAX_SETTLEMENTS} régularisations au plus`);
  }
  const byKind = new Map<AdvanceSettlementKind, { cents: bigint; count: number }>();
  let settled = 0n;
  let toppedUp = 0n;
  const ids = new Set<string>();
  for (const [i, s] of advance.settlements.entries()) {
    const what = `Régularisation n° ${i + 1}`;
    checkId(s.id, what);
    if (ids.has(s.id)) throw new RangeError(`${what} : identifiant en double`);
    ids.add(s.id);
    if (!(ADVANCE_SETTLEMENT_KINDS as readonly string[]).includes(s.kind)) {
      throw new RangeError(`${what} : nature inconnue ${JSON.stringify(s.kind)}`);
    }
    checkDay(s.on, what);
    const cents = trustedPositive(s.amount, what);
    if (ADVANCE_REDUCING_SETTLEMENTS.includes(s.kind)) settled += cents;
    else toppedUp += cents;
    const k = byKind.get(s.kind) ?? { cents: 0n, count: 0 };
    byKind.set(s.kind, { cents: k.cents + cents, count: k.count + 1 });
  }
  return {
    disbursed: advance.disbursement === null ? 0n : amount,
    settled,
    toppedUp,
    byKind,
  };
}

const outstandingOf = (l: Ledger): bigint =>
  l.disbursed > l.settled ? l.disbursed - l.settled : 0n;

// ─── Demande et circuit ──────────────────────────────────────────────────────

/** Contrôle d'une demande d'avance (ADR-0051 § 2.2, § 3.2 point 1). */
export function checkAdvanceRequest(
  request: { kind: AdvanceKind; currency: HrCurrency; amount: HrAmount },
  settings: AdvanceSettings,
): AdvanceRequestCheck {
  const kind = checkKind(request.kind);
  if (!isHrCurrency(request.currency)) throw new RangeError('Avance : devise inconnue');
  const no = (code: AdvanceRequestCheck['code']): AdvanceRequestCheck => ({
    version: HR_VERSION,
    ok: false,
    code,
  });
  if (settings.enabled[kind] !== true) return no('ADVANCE_KIND_DISABLED');
  const amount = positiveAmountCents(request.amount);
  if (amount === null) return no('ADVANCE_AMOUNT_INVALID');
  const max = settings.maxAmount[request.currency];
  if (max !== null && max !== undefined) {
    const limit = trustedPositive(max, `Plafond ${request.currency}`);
    if (amount > limit) return no('ADVANCE_ABOVE_ORGANIZATION_LIMIT');
  }
  return { version: HR_VERSION, ok: true, code: null };
}

/**
 * Étapes d'une avance (ADR-0051 § 2.2) : avance de frais comme une note de
 * frais ; avance sur salaire : `['finance']` seule, jamais le manager.
 */
export function advanceApprovalSteps(
  kind: AdvanceKind,
  settings: { approvalFlow: ExpenseApprovalFlow },
  employee: { managerEmployeeId: string | null; managerUserId: string | null },
  beneficiaryUserId: string | null,
): ExpenseApprovalStepsResult {
  if (checkKind(kind) === 'salary') {
    return { version: HR_VERSION, steps: ['finance'], managerReplacedBy: 'SALARY_ADVANCE' };
  }
  return expenseApprovalSteps(settings, employee, beneficiaryUserId);
}

// ─── Reste dû ────────────────────────────────────────────────────────────────

/** Reste dû d'une avance (ADR-0051 § 2.2) : versé − Σ régularisations. */
export function advanceOutstanding(advance: AdvanceInput): AdvanceOutstandingResult {
  const l = ledgerOf(advance);
  const outstanding = outstandingOf(l);
  const overSettled = l.settled > l.disbursed ? l.settled - l.disbursed : 0n;
  let state: AdvanceOutstandingResult['state'];
  if (advance.disbursement === null) state = 'not_disbursed';
  else if (outstanding === 0n) state = 'settled';
  else if (l.settled > 0n) state = 'partially_settled';
  else state = 'open';
  return {
    version: HR_VERSION,
    currency: advance.currency,
    disbursed: formatCents(l.disbursed),
    settled: formatCents(l.settled),
    toppedUp: formatCents(l.toppedUp),
    outstanding: formatCents(outstanding),
    overSettled: formatCents(overSettled),
    bySettlementKind: ADVANCE_SETTLEMENT_KINDS.filter((k) => l.byKind.has(k)).map((kind) => {
      const k = l.byKind.get(kind) as { cents: bigint; count: number };
      return { kind, amount: formatCents(k.cents), count: k.count };
    }),
    state,
  };
}

/**
 * Une régularisation est-elle recevable (ADR-0051 § 3.3) ? Refuse avant
 * versement, au-delà du reste dû (`409 ADVANCE_SETTLEMENT_EXCEEDS_OUTSTANDING`),
 * une régularisation par note ou complément sur une avance sur salaire, et la
 * régularisation déclarée sur la paie tant que le réglage est éteint.
 */
export function checkAdvanceSettlement(
  advance: AdvanceInput,
  settlement: { kind: AdvanceSettlementKind; amount: HrAmount },
  settings: Pick<AdvanceSettings, 'allowDeclaredPayrollSettlement'>,
): AdvanceSettlementCheck {
  const l = ledgerOf(advance);
  const before = outstandingOf(l);
  const verdict = (code: AdvanceSettlementCode | null, after: bigint): AdvanceSettlementCheck => ({
    version: HR_VERSION,
    ok: code === null,
    code,
    outstandingBefore: formatCents(before),
    outstandingAfter: formatCents(after),
  });
  if (!(ADVANCE_SETTLEMENT_KINDS as readonly string[]).includes(settlement.kind)) {
    throw new RangeError(`Régularisation : nature inconnue ${JSON.stringify(settlement.kind)}`);
  }
  if (advance.disbursement === null) return verdict('ADVANCE_NOT_DISBURSED', before);
  const amount = positiveAmountCents(settlement.amount);
  if (amount === null) return verdict('ADVANCE_SETTLEMENT_AMOUNT_INVALID', before);
  if (
    advance.kind === 'salary' &&
    (settlement.kind === 'expense_report' || settlement.kind === 'top_up')
  ) {
    return verdict('ADVANCE_SETTLEMENT_KIND_MISMATCH', before);
  }
  if (settlement.kind === 'declared_payroll' && !settings.allowDeclaredPayrollSettlement) {
    return verdict('ADVANCE_DECLARED_PAYROLL_DISABLED', before);
  }
  if (advance.settlements.length >= ADVANCE_MAX_SETTLEMENTS) {
    return verdict('ADVANCE_SETTLEMENT_LIMIT_REACHED', before);
  }
  if (settlement.kind === 'top_up') return verdict(null, before);
  if (amount > before) return verdict('ADVANCE_SETTLEMENT_EXCEEDS_OUTSTANDING', before);
  return verdict(null, before - amount);
}

/**
 * Répartition d'une note de frais liée à une avance de frais (ADR-0051 § 3.3).
 * La part de l'avance vaut min(reste dû, total de la note) ; elle est répartie
 * entre les lignes au prorata de leur montant, au centime, les centimes restants
 * allant aux plus forts restes (à égalité, à la ligne de plus petit rang). Le
 * complément de chaque ligne est dû au collaborateur.
 */
export function advanceSettlementPlan(
  advance: AdvanceInput,
  report: { currency: HrCurrency; lines: readonly Pick<ExpenseLineInput, 'amount'>[] },
): AdvanceSettlementPlan {
  const l = ledgerOf(advance);
  const no = (
    code: Extract<AdvanceSettlementPlan, { ok: false }>['code'],
  ): AdvanceSettlementPlan => ({ version: HR_VERSION, ok: false, code });
  if (!isHrCurrency(report.currency)) throw new RangeError('Note de frais : devise inconnue');
  if (report.lines.length === 0) throw new RangeError('Note de frais : au moins une ligne');
  const amounts = report.lines.map((line, i) => trustedPositive(line.amount, `Ligne n° ${i + 1}`));
  if (advance.kind !== 'expenses') return no('ADVANCE_SETTLEMENT_KIND_MISMATCH');
  if (advance.currency !== report.currency) return no('EXPENSE_REPORT_CURRENCY_MISMATCH');
  if (advance.disbursement === null) return no('ADVANCE_NOT_DISBURSED');
  const before = outstandingOf(l);
  if (before === 0n) return no('ADVANCE_ALREADY_SETTLED');

  const total = amounts.reduce((s, a) => s + a, 0n);
  const covered = before < total ? before : total;
  const shares = amounts.map((a) => (covered * a) / total);
  const remainders = amounts.map((a, i) => ({ i, r: (covered * a) % total }));
  let left = covered - shares.reduce((s, x) => s + x, 0n);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (left === 0n) break;
    shares[i] = (shares[i] ?? 0n) + 1n;
    left -= 1n;
  }
  const lines = amounts.map((a, i) => {
    const fromAdvance = shares[i] ?? 0n;
    return {
      lineIndex: i,
      amount: formatCents(a),
      fromAdvance: formatCents(fromAdvance),
      topUp: formatCents(a - fromAdvance),
    };
  });
  const topUp = total - covered;
  return {
    version: HR_VERSION,
    ok: true,
    reportTotal: formatCents(total),
    outstandingBefore: formatCents(before),
    fromAdvance: formatCents(covered),
    topUp: formatCents(topUp),
    outstandingAfter: formatCents(before - covered),
    lines,
    settlements: [
      { kind: 'expense_report', amount: formatCents(covered) },
      ...(topUp > 0n ? [{ kind: 'top_up' as const, amount: formatCents(topUp) }] : []),
    ],
  };
}

// ─── Constats ────────────────────────────────────────────────────────────────

const MONTH = /^(\d{4})-(\d{2})$/;

/** Dernier jour d'une échéance annoncée (`AAAA-MM-JJ`, ou fin du mois `AAAA-MM`). */
function dueDayOf(expected: string): HrDay {
  const m = MONTH.exec(expected);
  if (m !== null) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12) throw new RangeError('Échéance annoncée : mois invalide');
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return checkDay(`${m[1]}-${m[2]}-${String(last).padStart(2, '0')}`, 'Échéance annoncée');
  }
  return checkDay(expected, 'Échéance annoncée');
}

/**
 * Constats d'une avance (ADR-0051 § 7.2) : `ADVANCE_OVERDUE` (versée, reste dû
 * après l'échéance annoncée — un rappel, jamais une régularisation) ;
 * `ADVANCE_SETTLED_ON_PAYROLL` pour chaque régularisation déclarée sur la paie
 * (mois tiré de sa date) : rien n'est retranché d'une dépense de salaire.
 */
export function advanceFindings(advance: AdvanceInput, today: HrDay): AdvanceFinding[] {
  checkDay(today, 'Aujourd’hui');
  const l = ledgerOf(advance);
  const findings: AdvanceFinding[] = [];
  const expected = advance.expectedSettlement ?? null;
  if (expected !== null && advance.disbursement !== null && outstandingOf(l) > 0n) {
    const dueOn = dueDayOf(expected);
    if (today > dueOn) {
      findings.push({
        code: 'ADVANCE_OVERDUE',
        dueOn,
        payrollMonth: null,
        amount: formatCents(outstandingOf(l)),
        settlementId: null,
      });
    }
  }
  const payroll = advance.settlements
    .filter((s) => s.kind === 'declared_payroll')
    .sort((a, b) => (a.on === b.on ? byString(a.id, b.id) : byString(a.on, b.on)));
  for (const s of payroll) {
    findings.push({
      code: 'ADVANCE_SETTLED_ON_PAYROLL',
      dueOn: null,
      payrollMonth: s.on.slice(0, 7),
      amount: formatCents(trustedPositive(s.amount, 'Régularisation')),
      settlementId: s.id,
    });
  }
  return findings;
}
