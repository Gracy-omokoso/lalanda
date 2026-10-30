// ─────────────────────────────────────────────────────────────────────────────
// Marge encaissée d'un projet du RUN (ADR-0039 § 5)
//
//   marge(devise) = encaissé − remboursé − dépenses − coût du temps
//
// - Encaissé : par facture FINALE liée, part non `CREDIT` des paiements déclarés
//   au gel (réglé à l'émission) + lettrages des encaissements non annulés
//   (même somme que `received` de `computeSettlement`, ADR-0031 § 2).
// - Remboursé : part non `CREDIT` des avoirs finaux qui visent une facture liée
//   (décision ouverte n° 9 d'ADR-0039, recommandation retenue).
// - Dépenses : montant payé (TTC si une TVA a été payée, ADR-0034 § 5).
// - Coût du temps : Σ (minutes × taux en centimes) calculée EXACTEMENT, puis
//   divisée par 60 avec UN SEUL arrondi au centime (demi vers le haut) par
//   devise. Une saisie sans taux applicable n'est jamais valorisée à zéro : ses
//   minutes sont rendues à part (`minutesWithoutRate`, `TIME_WITHOUT_RATE`).
// - Aucune conversion : chaque devise a sa ligne (ADR-0031 décision n° 3).
// - Période facultative : jour d'émission (réglé à l'émission, avoirs, facturé),
//   jour de l'encaissement, de la dépense, du travail.
// - 1.1.0 (ADR-0044 § 6.1) : coûts engagés INFORMATIFS, rendus à part et JAMAIS
//   soustraits : `committed` = part du projet dans le reste à payer des factures
//   fournisseurs validées (répartie au prorata des imputations par
//   `splitAllocation`, plus fort reste, comme les dépenses d'un paiement) ;
//   `ordered` = reste à facturer HT des lignes de commande approuvées qui visent le
//   projet (`orderRemainingToInvoice`). Un paiement fournisseur entre déjà dans la
//   marge par sa dépense : rien n'est compté deux fois.
// ─────────────────────────────────────────────────────────────────────────────

import { orderRemainingToInvoice } from '../purchases/orders.js';
import { splitAllocation } from '../purchases/payables.js';
import { isCalendarDate } from '../receivables/calendar.js';
import { revenueBaseOf } from '../receivables/aggregation.js';
import {
  CENT,
  formatPositive,
  formatSigned,
  trustedAmount,
  type Fixed,
} from '../receivables/money.js';
import {
  PERSONNEL_EXPENSE_CATEGORY,
  WORK_MARGIN_CURRENCIES,
  WORK_MARGIN_VERSION,
  type ProjectMarginCurrency,
  type ProjectMarginFinding,
  type ProjectMarginInput,
  type ProjectMarginMemberCost,
  type ProjectMarginResult,
  type ProjectPurchasesCurrency,
  type ProjectPurchasesInput,
  type WorkMarginCurrency,
  type WorkMarginDay,
  type WorkMarginPayment,
  type WorkMarginRateInput,
} from './types.js';

interface Bucket {
  received: Fixed;
  refunded: Fixed;
  expenses: Fixed;
  /** Σ minutes × centimes horaires (centimes × minutes, pas encore ÷ 60). */
  timeCostMinuteCents: bigint;
  invoicedExclTax: Fixed;
  invoiceCount: number;
  expenseCount: number;
  /** ADR-0045 § 6.3 : dépenses `personnel` de la période (constat seulement). */
  personnelExpenseCount: number;
  timeMinutes: number;
  touched: boolean;
}

const emptyBucket = (): Bucket => ({
  received: 0n,
  refunded: 0n,
  expenses: 0n,
  timeCostMinuteCents: 0n,
  invoicedExclTax: 0n,
  invoiceCount: 0,
  expenseCount: 0,
  personnelExpenseCount: 0,
  timeMinutes: 0,
  touched: false,
});

function checkCurrency(value: string, what: string): WorkMarginCurrency {
  if (!(WORK_MARGIN_CURRENCIES as readonly string[]).includes(value)) {
    throw new RangeError(`${what} : devise inconnue ${JSON.stringify(value)}`);
  }
  return value as WorkMarginCurrency;
}

function checkDay(value: unknown, what: string): WorkMarginDay {
  if (!isCalendarDate(value)) throw new RangeError(`${what} : date illisible ${String(value)}`);
  return value;
}

/**
 * Centimes × minutes → montant au centime : division par 60 arrondie au plus
 * proche, demi vers le haut (valeurs ≥ 0), puis passage en virgule fixe.
 */
function minuteCentsToCents(value: bigint): Fixed {
  return ((value + 30n) / 60n) * CENT;
}

/** Taux horaire en centimes entiers (deux décimales au plus, déjà vérifié). */
function hourlyCents(value: string): bigint {
  return trustedAmount(value, 'Taux horaire') / CENT;
}

/** Part non `CREDIT` d'une liste de paiements. */
function paidOutsideCredit(payments: readonly WorkMarginPayment[], what: string): Fixed {
  let total = 0n;
  for (const p of payments) {
    if (p.method === 'CREDIT') continue;
    total += trustedAmount(p.amount, what);
  }
  return total;
}

/** Index des taux par membre, triés par date d'effet croissante. */
function ratesByUser(rates: readonly WorkMarginRateInput[]): Map<string, WorkMarginRateInput[]> {
  const byUser = new Map<string, WorkMarginRateInput[]>();
  for (const rate of rates) {
    checkCurrency(rate.currency, 'Taux horaire');
    checkDay(rate.effectiveFrom, 'Taux horaire');
    if (trustedAmount(rate.hourlyCost, 'Taux horaire') <= 0n) {
      throw new RangeError(`Taux horaire : montant strictement positif attendu (${rate.userId})`);
    }
    const list = byUser.get(rate.userId) ?? [];
    if (list.some((r) => r.effectiveFrom === rate.effectiveFrom)) {
      throw new RangeError(`Taux horaire : deux taux pour ${rate.userId} au ${rate.effectiveFrom}`);
    }
    list.push(rate);
    byUser.set(rate.userId, list);
  }
  for (const list of byUser.values()) {
    list.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  }
  return byUser;
}

/** Taux en vigueur au jour travaillé : le plus récent dont `effectiveFrom ≤ workedOn`. */
function rateAt(
  list: readonly WorkMarginRateInput[] | undefined,
  day: WorkMarginDay,
): WorkMarginRateInput | null {
  let found: WorkMarginRateInput | null = null;
  for (const rate of list ?? []) {
    if (rate.effectiveFrom <= day) found = rate;
    else break;
  }
  return found;
}

export function computeProjectMargin(input: ProjectMarginInput): ProjectMarginResult {
  const from = input.from === null ? null : checkDay(input.from, 'Début de période');
  const to = input.to === null ? null : checkDay(input.to, 'Fin de période');
  if (from !== null && to !== null && to < from) {
    throw new RangeError(`Période inversée : ${from} → ${to}`);
  }
  // Dates canoniques AAAA-MM-JJ : l'ordre lexicographique est celui du calendrier.
  const inPeriod = (day: WorkMarginDay): boolean =>
    (from === null || day >= from) && (to === null || day <= to);

  const buckets = new Map<WorkMarginCurrency, Bucket>();
  const bucketOf = (currency: WorkMarginCurrency): Bucket => {
    const b = buckets.get(currency) ?? emptyBucket();
    buckets.set(currency, b);
    return b;
  };

  // ── Factures liées ────────────────────────────────────────────────────────
  let ignoredInvoices = 0;
  for (const invoice of input.invoices) {
    const currency = checkCurrency(invoice.currency, `Facture ${invoice.id}`);
    if (!invoice.final) {
      ignoredInvoices += 1;
      continue;
    }
    const issuedOn = checkDay(invoice.issuedOn, `Facture ${invoice.id}`);
    const b = bucketOf(currency);
    b.touched = true;
    b.invoiceCount += 1;
    if (inPeriod(issuedOn)) {
      b.received += paidOutsideCredit(invoice.payments, `Paiement de ${invoice.id}`);
      b.invoicedExclTax += trustedAmount(revenueBaseOf(invoice.taxGroups), 'Base HT');
    }
    for (const allocation of invoice.allocations) {
      const day = checkDay(allocation.receivedOn, `Encaissement de ${invoice.id}`);
      if (inPeriod(day)) b.received += trustedAmount(allocation.amount, 'Lettrage');
    }
  }

  // ── Avoirs : argent rendu ─────────────────────────────────────────────────
  for (const note of input.creditNotes) {
    const currency = checkCurrency(note.currency, `Avoir ${note.id}`);
    if (!note.final) continue;
    const issuedOn = checkDay(note.issuedOn, `Avoir ${note.id}`);
    if (!inPeriod(issuedOn)) continue;
    const b = bucketOf(currency);
    b.touched = true;
    b.refunded += paidOutsideCredit(note.payments, `Paiement de l'avoir ${note.id}`);
    b.invoicedExclTax -= trustedAmount(revenueBaseOf(note.taxGroups), 'Base HT');
  }

  // ── Dépenses rattachées ───────────────────────────────────────────────────
  for (const expense of input.expenses) {
    const currency = checkCurrency(expense.currency, `Dépense ${expense.id}`);
    const day = checkDay(expense.spentOn, `Dépense ${expense.id}`);
    if (!inPeriod(day)) continue;
    const b = bucketOf(currency);
    b.touched = true;
    b.expenses += trustedAmount(expense.amount, `Dépense ${expense.id}`);
    b.expenseCount += 1;
    if (expense.category === PERSONNEL_EXPENSE_CATEGORY) b.personnelExpenseCount += 1;
  }

  // ── Coût du temps ─────────────────────────────────────────────────────────
  const rates = ratesByUser(input.rates);
  let minutesWithoutRate = 0;
  const members = new Map<
    string,
    { userId: string; currency: WorkMarginCurrency; minutes: number; minuteCents: bigint }
  >();
  for (const entry of input.timeEntries) {
    const day = checkDay(entry.workedOn, 'Saisie de temps');
    if (!Number.isSafeInteger(entry.minutes) || entry.minutes <= 0) {
      throw new RangeError(
        `Saisie de temps : minutes entières positives attendues (${entry.minutes})`,
      );
    }
    if (!inPeriod(day)) continue;
    const rate = rateAt(rates.get(entry.userId), day);
    if (rate === null) {
      minutesWithoutRate += entry.minutes;
      continue;
    }
    const minuteCents = BigInt(entry.minutes) * hourlyCents(rate.hourlyCost);
    const b = bucketOf(rate.currency);
    b.touched = true;
    b.timeCostMinuteCents += minuteCents;
    b.timeMinutes += entry.minutes;
    const key = `${entry.userId}|${rate.currency}`;
    const m = members.get(key) ?? {
      userId: entry.userId,
      currency: rate.currency,
      minutes: 0,
      minuteCents: 0n,
    };
    m.minutes += entry.minutes;
    m.minuteCents += minuteCents;
    members.set(key, m);
  }

  // ── Résultat ──────────────────────────────────────────────────────────────
  const currencies: ProjectMarginCurrency[] = [];
  for (const currency of WORK_MARGIN_CURRENCIES) {
    const b = buckets.get(currency);
    if (!b || !b.touched) continue;
    const timeCost = minuteCentsToCents(b.timeCostMinuteCents);
    currencies.push({
      currency,
      received: formatPositive(b.received),
      refunded: formatPositive(b.refunded),
      expenses: formatPositive(b.expenses),
      timeCost: formatPositive(timeCost),
      margin: formatSigned(b.received - b.refunded - b.expenses - timeCost),
      invoicedExclTax: formatSigned(b.invoicedExclTax),
      invoiceCount: b.invoiceCount,
      expenseCount: b.expenseCount,
      timeMinutes: b.timeMinutes,
    });
  }

  const findings: ProjectMarginFinding[] = [];
  if (currencies.length > 1) findings.push({ code: 'MULTI_CURRENCY', count: currencies.length });
  if (minutesWithoutRate > 0) {
    findings.push({ code: 'TIME_WITHOUT_RATE', minutes: minutesWithoutRate });
  }
  if (input.invoices.length === 0) findings.push({ code: 'NO_INVOICE_LINKED' });
  if (ignoredInvoices > 0)
    findings.push({ code: 'DRAFT_INVOICES_IGNORED', count: ignoredInvoices });
  // Encaissements et dépenses sont des montants payés, TVA comprise (décision ouverte n° 8).
  findings.push({ code: 'AMOUNTS_INCLUDE_TAX' });
  // ADR-0045 § 6.3 (1.2.0) : un salaire rattaché au projet ET du temps valorisé dans la
  // même devise comptent peut-être deux fois la même personne. Signalé, rien retranché.
  for (const currency of WORK_MARGIN_CURRENCIES) {
    const b = buckets.get(currency);
    if (!b || b.personnelExpenseCount === 0 || b.timeCostMinuteCents === 0n) continue;
    findings.push({
      code: 'PERSONNEL_EXPENSES_AND_TIME_COST',
      currency,
      count: b.personnelExpenseCount,
    });
  }

  const byMember: ProjectMarginMemberCost[] = [...members.values()]
    .sort((a, b) =>
      a.userId === b.userId ? (a.currency < b.currency ? -1 : 1) : a.userId < b.userId ? -1 : 1,
    )
    .map((m) => ({
      userId: m.userId,
      currency: m.currency,
      minutes: m.minutes,
      cost: formatPositive(minuteCentsToCents(m.minuteCents)),
    }));

  return {
    version: WORK_MARGIN_VERSION,
    from,
    to,
    currencies,
    findings,
    minutesWithoutRate,
    byMember,
    ...(input.purchases === undefined ? {} : { purchases: projectPurchases(input.purchases) }),
  };
}

/** Coûts engagés non payés du projet, par devise (ADR-0044 § 6.1) — informatifs. */
export function projectPurchases(input: ProjectPurchasesInput): ProjectPurchasesCurrency[] {
  const sums = new Map<
    WorkMarginCurrency,
    { committed: Fixed; ordered: Fixed; invoiceCount: number; orderCount: number }
  >();
  const sumOf = (currency: WorkMarginCurrency) => {
    const s = sums.get(currency) ?? { committed: 0n, ordered: 0n, invoiceCount: 0, orderCount: 0 };
    sums.set(currency, s);
    return s;
  };

  for (const payable of input.payables) {
    const currency = checkCurrency(payable.currency, `Facture fournisseur ${payable.id}`);
    if (trustedAmount(payable.remaining, `Reste de ${payable.id}`) === 0n) continue;
    if (!payable.costAllocations.some((a) => a.workProjectId === input.projectId)) continue;
    const { shares } = splitAllocation(payable.remaining, payable.costAllocations);
    let mine = 0n;
    payable.costAllocations.forEach((a, i) => {
      if (a.workProjectId === input.projectId) {
        mine += trustedAmount(shares[i] ?? '0', `Part de ${payable.id}`);
      }
    });
    if (mine === 0n) continue;
    const s = sumOf(currency);
    s.committed += mine;
    s.invoiceCount += 1;
  }

  for (const order of input.orders) {
    const currency = checkCurrency(order.currency, `Commande ${order.id}`);
    const rest = orderRemainingToInvoice({ currency, lines: order.lines }, order.invoices);
    let mine = 0n;
    for (const line of rest.lines) {
      if (line.workProjectId !== input.projectId) continue;
      mine += trustedAmount(line.remainingAmount, `Ligne ${line.orderLineId}`);
    }
    if (mine === 0n) continue;
    const s = sumOf(currency);
    s.ordered += mine;
    s.orderCount += 1;
  }

  return WORK_MARGIN_CURRENCIES.flatMap((currency) => {
    const s = sums.get(currency);
    if (!s) return [];
    return [
      {
        currency,
        committed: formatPositive(s.committed),
        ordered: formatPositive(s.ordered),
        invoiceCount: s.invoiceCount,
        orderCount: s.orderCount,
      },
    ];
  });
}
