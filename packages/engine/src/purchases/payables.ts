// ─────────────────────────────────────────────────────────────────────────────
// Dettes fournisseurs, échéances et paiements (ADR-0044 § 2.5, § 2.6, § 6.2, § 7)
//
// - `dueDateOf` : `immediate` = date de facture ; `net` = + N jours ;
//   `end_of_month` = dernier jour du mois de la facture + N jours.
// - `payableSettlement` : reste à payer = total − paiements − avoirs, jamais
//   négatif ; l'excédent est rendu à part, jamais compensé.
// - `payablesAging`, `payablesSchedule` : PAR DEVISE, litiges à part ; le jour
//   de référence est un paramètre (jour de Kinshasa calculé par l'appelant).
// - `splitAllocation` : répartition au prorata par la méthode du plus fort
//   reste, somme exacte au centime, égalités départagées par l'ordre d'entrée.
// - `checkSupplierPayment` : Σ imputations = montant, aucune imputation au-delà
//   du reste à payer.
// - `possibleDuplicateExpenses` : même fournisseur, même devise, même montant,
//   dates à trois jours ou moins (O3 c) — signalé, jamais annulé.
// ─────────────────────────────────────────────────────────────────────────────

import { addDays, dayNumber, daysInMonth, monthKeyOf, partsOf } from '../treasury/calendar.js';
import {
  byString,
  centsOf,
  checkCurrency,
  checkDay,
  formatCents,
  scaledOf,
  sumOf,
} from './money.js';
import {
  PURCHASES_VERSION,
  type AmountCount,
  type CurrencyAging,
  type CurrencySchedule,
  type DueDate,
  type DuplicateExpenseInput,
  type DuplicatePaymentInput,
  type PayableInput,
  type PayableSettlement,
  type PayablesAging,
  type PayablesSchedule,
  type PaymentTerms,
  type PossibleDuplicate,
  type PossibleDuplicates,
  type PurchaseCurrency,
  type SplitAllocation,
  type SupplierPaymentCheck,
  type SupplierPaymentCheckInput,
  type SupplierPaymentIssue,
} from './types.js';

/** Bornes des conditions de paiement (ADR-0044 § 2.1). */
export const PAYMENT_TERMS_BOUNDS = {
  net: { min: 1, max: 180 },
  end_of_month: { min: 0, max: 180 },
} as const;

/** Bornes de `dueSoonDays` (ADR-0044 § 2.2). */
export const DUE_SOON_DAYS_BOUNDS = { min: 1, max: 30 } as const;

/** Semaines glissantes de l'échéancier après la fenêtre « bientôt ». */
export const PAYABLES_SCHEDULE_WEEKS = 4;

/** Écart de dates maximal d'un doublon probable (O3 c). */
export const DUPLICATE_EXPENSE_WINDOW_DAYS = 3;

function checkDays(days: unknown, bounds: { min: number; max: number }, what: string): number {
  if (
    typeof days !== 'number' ||
    !Number.isInteger(days) ||
    days < bounds.min ||
    days > bounds.max
  ) {
    throw new RangeError(`${what} : entier de ${bounds.min} à ${bounds.max} attendu`);
  }
  return days;
}

export function dueDateOf(terms: PaymentTerms, invoiceDate: string): DueDate {
  const day = checkDay(invoiceDate, 'Date de facture');
  let dueDate: string;
  switch (terms.kind) {
    case 'immediate':
      dueDate = day;
      break;
    case 'net':
      dueDate = addDays(day, checkDays(terms.days, PAYMENT_TERMS_BOUNDS.net, 'Délai net'));
      break;
    case 'end_of_month': {
      const n = checkDays(terms.days, PAYMENT_TERMS_BOUNDS.end_of_month, 'Délai fin de mois');
      const { year, month } = partsOf(day);
      const last = `${day.slice(0, 8)}${String(daysInMonth(year, month)).padStart(2, '0')}`;
      dueDate = addDays(last, n);
      break;
    }
    default:
      throw new RangeError(`Conditions de paiement inconnues : ${JSON.stringify(terms)}`);
  }
  return { version: PURCHASES_VERSION, dueDate };
}

export function payableSettlement(
  invoice: { total: string },
  allocations: readonly string[],
  creditNotes: readonly string[],
): PayableSettlement {
  const total = centsOf(invoice.total, 'Total de la facture');
  const paid = sumOf(allocations.map((a, i) => centsOf(a, `Imputation ${i + 1}`)));
  const credited = sumOf(creditNotes.map((a, i) => centsOf(a, `Avoir ${i + 1}`)));
  const rest = total - paid - credited;
  const remaining = rest > 0n ? rest : 0n;
  const settled = paid + credited;
  let status: PayableSettlement['status'];
  if (remaining === 0n) status = 'paid';
  else if (settled > 0n) status = 'partially_paid';
  else status = 'unpaid';
  return {
    version: PURCHASES_VERSION,
    status,
    total: formatCents(total),
    paid: formatCents(paid),
    credited: formatCents(credited),
    remaining: formatCents(remaining),
    overpaid: formatCents(rest < 0n ? -rest : 0n),
  };
}

// ─── Ancienneté et échéancier ────────────────────────────────────────────────

interface Counter {
  amount: bigint;
  count: number;
}
const counter = (): Counter => ({ amount: 0n, count: 0 });
const add = (c: Counter, amount: bigint): void => {
  c.amount += amount;
  c.count += 1;
};
const out = (c: Counter): AmountCount => ({ amount: formatCents(c.amount), count: c.count });

/** Factures au reste non nul, validées, groupées par devise (ordre alphabétique). */
function openByCurrency(
  invoices: readonly PayableInput[],
): [PurchaseCurrency, { dueDate: string; remaining: bigint; disputed: boolean }[]][] {
  const groups = new Map<
    PurchaseCurrency,
    { dueDate: string; remaining: bigint; disputed: boolean }[]
  >();
  invoices.forEach((inv, i) => {
    const currency = checkCurrency(inv.currency, `Facture ${i + 1}`);
    const dueDate = checkDay(inv.dueDate, `Facture ${i + 1} : échéance`);
    const remaining = centsOf(inv.remaining, `Facture ${i + 1} : reste à payer`);
    if (remaining === 0n) return;
    const list = groups.get(currency) ?? [];
    list.push({ dueDate, remaining, disputed: inv.disputed === true });
    groups.set(currency, list);
  });
  return [...groups.entries()].sort(([a], [b]) => byString(a, b));
}

export function payablesAging(invoices: readonly PayableInput[], today: string): PayablesAging {
  const asOf = checkDay(today, 'Jour de référence');
  const todayN = dayNumber(asOf);
  const byCurrency: CurrencyAging[] = openByCurrency(invoices).map(([currency, list]) => {
    const b = {
      notDue: counter(),
      days1To30: counter(),
      days31To60: counter(),
      days61To90: counter(),
      over90: counter(),
      open: counter(),
      disputed: counter(),
    };
    for (const inv of list) {
      if (inv.disputed) {
        add(b.disputed, inv.remaining);
        continue;
      }
      add(b.open, inv.remaining);
      const late = todayN - dayNumber(inv.dueDate);
      if (late <= 0) add(b.notDue, inv.remaining);
      else if (late <= 30) add(b.days1To30, inv.remaining);
      else if (late <= 60) add(b.days31To60, inv.remaining);
      else if (late <= 90) add(b.days61To90, inv.remaining);
      else add(b.over90, inv.remaining);
    }
    return {
      currency,
      notDue: out(b.notDue),
      days1To30: out(b.days1To30),
      days31To60: out(b.days31To60),
      days61To90: out(b.days61To90),
      over90: out(b.over90),
      open: out(b.open),
      disputed: out(b.disputed),
    };
  });
  return { version: PURCHASES_VERSION, asOf, byCurrency };
}

export function payablesSchedule(
  invoices: readonly PayableInput[],
  today: string,
  dueSoonDays: number,
): PayablesSchedule {
  const asOf = checkDay(today, 'Jour de référence');
  const soon = checkDays(dueSoonDays, DUE_SOON_DAYS_BOUNDS, 'Fenêtre « bientôt »');
  const todayN = dayNumber(asOf);
  const soonEndN = todayN + soon;
  const weeksEndN = soonEndN + 7 * PAYABLES_SCHEDULE_WEEKS;
  const byCurrency: CurrencySchedule[] = openByCurrency(invoices).map(([currency, list]) => {
    const overdue = counter();
    const dueSoon = counter();
    const open = counter();
    const disputed = counter();
    const weeks = Array.from({ length: PAYABLES_SCHEDULE_WEEKS }, counter);
    const months = new Map<string, Counter>();
    for (const inv of list) {
      if (inv.disputed) {
        add(disputed, inv.remaining);
        continue;
      }
      add(open, inv.remaining);
      const n = dayNumber(inv.dueDate);
      if (n < todayN) add(overdue, inv.remaining);
      else if (n <= soonEndN) add(dueSoon, inv.remaining);
      else if (n <= weeksEndN)
        add(weeks[Math.floor((n - soonEndN - 1) / 7)] as Counter, inv.remaining);
      else {
        const key = monthKeyOf(inv.dueDate);
        const c = months.get(key) ?? counter();
        add(c, inv.remaining);
        months.set(key, c);
      }
    }
    return {
      currency,
      overdue: out(overdue),
      dueSoon: out(dueSoon),
      weeks: weeks.map((c, k) => ({
        from: addDays(asOf, soon + 1 + 7 * k),
        to: addDays(asOf, soon + 7 * (k + 1)),
        ...out(c),
      })),
      months: [...months.entries()]
        .sort(([a], [b]) => byString(a, b))
        .map(([month, c]) => ({ month, ...out(c) })),
      open: out(open),
      disputed: out(disputed),
    };
  });
  return {
    version: PURCHASES_VERSION,
    asOf,
    dueSoonDays: soon,
    dueSoonUntil: addDays(asOf, soon),
    byCurrency,
  };
}

// ─── Paiements ───────────────────────────────────────────────────────────────

/**
 * Répartit `amount` au prorata des poids `costAllocations[i].amount` : parts
 * planchers, puis les centimes restants un à un aux plus forts restes (égalité :
 * l'ordre d'entrée). Σ des parts = montant, exactement ; chaque part ≥ 0.
 */
export function splitAllocation(
  amount: string,
  costAllocations: readonly { amount: string }[],
): SplitAllocation {
  const total = centsOf(amount, 'Montant à répartir');
  const weights = costAllocations.map((a, i) => centsOf(a.amount, `Poids ${i + 1}`));
  const weightSum = sumOf(weights);
  if (weights.length === 0 || weightSum === 0n) {
    throw new RangeError('Répartition impossible : aucun poids positif.');
  }
  const floors = weights.map((w) => (total * w) / weightSum);
  const rests = weights.map((w, i) => ({ i, rest: (total * w) % weightSum }));
  let left = total - sumOf(floors);
  rests.sort((a, b) => (a.rest === b.rest ? a.i - b.i : a.rest > b.rest ? -1 : 1));
  for (const { i } of rests) {
    if (left === 0n) break;
    floors[i] = (floors[i] ?? 0n) + 1n;
    left -= 1n;
  }
  return { version: PURCHASES_VERSION, shares: floors.map(formatCents) };
}

export function checkSupplierPayment(input: SupplierPaymentCheckInput): SupplierPaymentCheck {
  const issues: SupplierPaymentIssue[] = [];
  const amount = scaledOf(input.amount, 2);
  if (amount === null || amount === 0n) {
    issues.push({
      code: 'SUPPLIER_PAYMENT_AMOUNT_INVALID',
      allocationIndex: null,
      message: 'Le montant payé doit être positif, avec deux décimales au plus.',
    });
  }
  if (input.allocations.length === 0) {
    issues.push({
      code: 'SUPPLIER_PAYMENT_NO_ALLOCATION',
      allocationIndex: null,
      message: 'Imputez le paiement à au moins une facture validée.',
    });
  }
  const seen = new Set<string>();
  const parsed: (bigint | null)[] = [];
  input.allocations.forEach((allocation, index) => {
    const value = scaledOf(allocation.amount, 2);
    const valid = value !== null && value > 0n;
    parsed.push(valid ? value : null);
    if (!valid) {
      issues.push({
        code: 'SUPPLIER_PAYMENT_ALLOCATION_INVALID',
        allocationIndex: index,
        message: 'Chaque montant imputé doit être positif, avec deux décimales au plus.',
      });
    }
    if (seen.has(allocation.invoiceId)) {
      issues.push({
        code: 'SUPPLIER_PAYMENT_ALLOCATION_DUPLICATE',
        allocationIndex: index,
        message: 'Une même facture ne figure qu’une fois dans un paiement.',
        details: { invoiceId: allocation.invoiceId },
      });
    }
    seen.add(allocation.invoiceId);
    const remainingRaw = input.remainingByInvoice[allocation.invoiceId];
    if (remainingRaw === undefined) {
      // L'appelant résout chaque facture avant le contrôle (404 sinon).
      throw new RangeError(`Reste à payer inconnu pour la facture ${allocation.invoiceId}`);
    }
    const remaining = centsOf(remainingRaw, 'Reste à payer');
    if (valid && value > remaining) {
      issues.push({
        code: 'SUPPLIER_PAYMENT_EXCEEDS_REMAINING',
        allocationIndex: index,
        message: `Le montant imputé dépasse le reste à payer de la facture (${formatCents(remaining)}).`,
        details: { invoiceId: allocation.invoiceId, remaining: formatCents(remaining) },
      });
    }
  });
  if (amount !== null && parsed.length > 0 && parsed.every((v) => v !== null)) {
    const allocated = sumOf(parsed as bigint[]);
    if (allocated !== amount) {
      issues.push({
        code: 'SUPPLIER_PAYMENT_ALLOCATION_MISMATCH',
        allocationIndex: null,
        message: `La somme imputée (${formatCents(allocated)}) doit égaler le montant payé (${formatCents(amount)}).`,
        details: { allocated: formatCents(allocated), amount: formatCents(amount) },
      });
    }
  }
  return { version: PURCHASES_VERSION, ok: issues.length === 0, issues };
}

export function possibleDuplicateExpenses(
  payments: readonly DuplicatePaymentInput[],
  expenses: readonly DuplicateExpenseInput[],
): PossibleDuplicates {
  const duplicates: PossibleDuplicate[] = [];
  const parsedExpenses = expenses.map((e, i) => ({
    e,
    currency: checkCurrency(e.currency, `Dépense ${i + 1}`),
    amount: centsOf(e.amount, `Dépense ${i + 1} : montant`),
    day: dayNumber(checkDay(e.spentOn, `Dépense ${i + 1} : date`)),
  }));
  payments.forEach((p, i) => {
    const currency = checkCurrency(p.currency, `Paiement ${i + 1}`);
    const amount = centsOf(p.amount, `Paiement ${i + 1} : montant`);
    const day = dayNumber(checkDay(p.paidOn, `Paiement ${i + 1} : date`));
    for (const x of parsedExpenses) {
      if (x.e.supplierId === null || x.e.supplierId !== p.supplierId) continue;
      if (x.currency !== currency || x.amount !== amount) continue;
      const daysApart = Math.abs(day - x.day);
      if (daysApart > DUPLICATE_EXPENSE_WINDOW_DAYS) continue;
      duplicates.push({
        code: 'POSSIBLE_DUPLICATE_EXPENSE',
        paymentId: p.id,
        expenseId: x.e.id,
        supplierId: p.supplierId,
        currency,
        amount: formatCents(amount),
        daysApart,
      });
    }
  });
  duplicates.sort(
    (a, b) => byString(a.paymentId, b.paymentId) || byString(a.expenseId, b.expenseId),
  );
  return { version: PURCHASES_VERSION, windowDays: DUPLICATE_EXPENSE_WINDOW_DAYS, duplicates };
}
