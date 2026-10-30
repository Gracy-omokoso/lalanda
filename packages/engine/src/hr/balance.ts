// ─────────────────────────────────────────────────────────────────────────────
// Soldes, acquisitions, report et expiration (ADR-0045 § 2.5, § 2.7, § 5)
//
// Le grand livre est partitionné par ANNÉE DE CONGÉ (`leaveYear`, année civile
// de son premier jour, début réglé par l'organisation). Le solde d'une année :
//   disponible = acquis + attribué + ajusté + reporté − expiré − pris − à venir
//                − en attente
// (une demande en attente réserve ses jours ; « à venir » = débits `taken` de
// l'année datés après `asOf`). Au changement d'année, `carryOverOf` rend le
// reporté (plafonné par `maxDays`) ; après `expiresAfterMonths`,
// `carryOverExpiryOf` rend la part reportée non prise, les prises de l'année
// consommant d'abord le reporté.
//
// Toutes les valeurs (jours par mois ou par an, plafonds, délais) viennent du
// paramétrage de l'organisation : le moteur n'en pose AUCUNE (ADR-0045 § 9).
// ─────────────────────────────────────────────────────────────────────────────

import {
  addDays,
  addMonths,
  byString,
  checkDay,
  checkId,
  checkIntegerIn,
  checkLeaveYearStart,
  checkNullableDay,
  clampedDay,
  divHalfUp,
  formatDays,
  leaveYearContaining,
  leaveYearStartDay,
  maxDay,
  minDay,
  nonNegativeCenti,
  partsOf,
  spanDays,
  trustedCenti,
} from './days.js';
import {
  HR_VERSION,
  LEAVE_LEDGER_KINDS,
  type AccrualDue,
  type AccrualEmployeeInput,
  type AccrualsDueResult,
  type CarryOverExpiryResult,
  type CarryOverResult,
  type HrDay,
  type HrDays,
  type LeaveAccrual,
  type LeaveBalance,
  type LeaveBalancesResult,
  type LeaveLedgerEntryInput,
  type LeaveLedgerKind,
  type LeaveTypePolicyInput,
  type LeaveYearStart,
  type PendingLeaveInput,
} from './types.js';

/** Bornes des jours d'une acquisition (ADR-0045 § 2.5). */
export const ACCRUAL_DAYS_BOUNDS = { min: '0', max: '60' } as const;
/** Bornes du report (ADR-0045 § 2.5). */
export const CARRY_OVER_BOUNDS = {
  maxDays: { min: 0, max: 365 },
  expiresAfterMonths: { min: 1, max: 36 },
} as const;

/** Année de congé qui contient `day` (ADR-0045 § 2.2, `leaveYearStart`). */
export function leaveYearOf(day: HrDay, leaveYearStart: LeaveYearStart = '01-01'): number {
  checkLeaveYearStart(leaveYearStart);
  return leaveYearContaining(checkDay(day, 'Date'), leaveYearStart);
}

/** Premier et dernier jour de l'année de congé `leaveYear`. */
export function leaveYearBounds(
  leaveYear: number,
  leaveYearStart: LeaveYearStart = '01-01',
): { start: HrDay; end: HrDay } {
  checkIntegerIn(leaveYear, 1900, 2998, 'Année de congé');
  return {
    start: leaveYearStartDay(leaveYear, leaveYearStart),
    end: addDays(leaveYearStartDay(leaveYear + 1, leaveYearStart), -1),
  };
}

/** Signe imposé par nature de mouvement : +1 crédit, −1 débit, 0 libre. */
const KIND_SIGN: Record<LeaveLedgerKind, 1 | -1 | 0> = {
  accrual: 1,
  allocation: 0,
  adjustment: 0,
  taken: -1,
  taken_reversal: 1,
  carry_over: 0, // un solde négatif peut être reporté
  expiry: -1,
};

function checkEntry(e: LeaveLedgerEntryInput, i: number): bigint {
  const what = `Mouvement n° ${i + 1}`;
  checkId(e.typeId, `${what} (type)`);
  if (!(LEAVE_LEDGER_KINDS as readonly string[]).includes(e.kind)) {
    throw new RangeError(`${what} : nature inconnue ${JSON.stringify(e.kind)}`);
  }
  checkDay(e.effectiveOn, `${what} (date d’effet)`);
  checkIntegerIn(e.leaveYear, 1900, 2998, `${what} (année de congé)`);
  const days = trustedCenti(e.days, `${what} (jours)`);
  const sign = KIND_SIGN[e.kind];
  if ((sign === 1 && days < 0n) || (sign === -1 && days > 0n)) {
    throw new RangeError(`${what} : signe incompatible avec la nature « ${e.kind} »`);
  }
  return days;
}

interface Totals {
  accrued: bigint;
  allocated: bigint;
  adjusted: bigint;
  carriedOver: bigint;
  expired: bigint;
  taken: bigint;
  upcoming: bigint;
  pending: bigint;
}

const zeroTotals = (): Totals => ({
  accrued: 0n,
  allocated: 0n,
  adjusted: 0n,
  carriedOver: 0n,
  expired: 0n,
  taken: 0n,
  upcoming: 0n,
  pending: 0n,
});

/**
 * Soldes par type pour l'année de congé qui contient `asOf` (ADR-0045 § 2.7) :
 * mouvements de cette année datés au plus tard `asOf` ; débits `taken` (nets de
 * `taken_reversal`) datés après `asOf` rendus « à venir » ; demandes en attente
 * dont le premier jour tombe dans l'année. Jamais stocké.
 */
export function leaveBalance(
  ledger: readonly LeaveLedgerEntryInput[],
  pending: readonly PendingLeaveInput[],
  asOf: HrDay,
  leaveYearStart: LeaveYearStart = '01-01',
): LeaveBalancesResult {
  checkDay(asOf, 'Jour de référence');
  checkLeaveYearStart(leaveYearStart);
  const year = leaveYearContaining(asOf, leaveYearStart);
  const byType = new Map<string, Totals>();
  const totalsOf = (typeId: string): Totals => {
    let t = byType.get(typeId);
    if (t === undefined) {
      t = zeroTotals();
      byType.set(typeId, t);
    }
    return t;
  };

  for (const [i, e] of ledger.entries()) {
    const days = checkEntry(e, i);
    if (e.leaveYear !== year) continue;
    const t = totalsOf(e.typeId);
    const future = e.effectiveOn > asOf;
    if (e.kind === 'taken' || e.kind === 'taken_reversal') {
      if (future) t.upcoming -= days;
      else t.taken -= days;
      continue;
    }
    if (future) continue;
    switch (e.kind) {
      case 'accrual':
        t.accrued += days;
        break;
      case 'allocation':
        t.allocated += days;
        break;
      case 'adjustment':
        t.adjusted += days;
        break;
      case 'carry_over':
        t.carriedOver += days;
        break;
      case 'expiry':
        t.expired -= days;
        break;
    }
  }
  for (const [i, p] of pending.entries()) {
    checkId(p.typeId, `Demande en attente n° ${i + 1} (type)`);
    const start = checkDay(p.startDate, `Demande en attente n° ${i + 1} (début)`);
    const days = nonNegativeCenti(p.days, `Demande en attente n° ${i + 1} (jours)`);
    if (leaveYearContaining(start, leaveYearStart) !== year) continue;
    totalsOf(p.typeId).pending += days;
  }

  const balances: LeaveBalance[] = [...byType.entries()]
    .sort(([a], [b]) => byString(a, b))
    .map(([typeId, t]) => ({
      typeId,
      leaveYear: year,
      accrued: formatDays(t.accrued),
      allocated: formatDays(t.allocated),
      adjusted: formatDays(t.adjusted),
      carriedOver: formatDays(t.carriedOver),
      expired: formatDays(t.expired),
      taken: formatDays(t.taken),
      upcoming: formatDays(t.upcoming),
      pending: formatDays(t.pending),
      available: formatDays(
        t.accrued +
          t.allocated +
          t.adjusted +
          t.carriedOver -
          t.expired -
          t.taken -
          t.upcoming -
          t.pending,
      ),
    }));
  return { version: HR_VERSION, asOf, leaveYear: year, balances };
}

function checkAccrual(accrual: LeaveAccrual, what: string): LeaveAccrual {
  if (accrual.kind === 'none') return accrual;
  if (accrual.kind !== 'monthly' && accrual.kind !== 'yearly') {
    throw new RangeError(`${what} : acquisition inconnue`);
  }
  const days = nonNegativeCenti(accrual.days, `${what} (jours)`);
  if (days > 6_000n) throw new RangeError(`${what} : 60 jours au plus`);
  if (
    accrual.kind === 'yearly' &&
    accrual.on !== 'leave_year_start' &&
    accrual.on !== 'anniversary'
  ) {
    throw new RangeError(`${what} : « leave_year_start » ou « anniversary » attendu`);
  }
  return accrual;
}

/** Dernier jour couvert par une période déjà écrite (`AAAA-MM` ou `AAAA-MM-JJ` annuelle). */
function coveredUntil(lastPeriod: string | null): HrDay | null {
  if (lastPeriod === null) return null;
  if (/^\d{4}-\d{2}$/.test(lastPeriod)) {
    const { year, month } = partsOf(`${lastPeriod}-01`);
    return clampedDay(year, month, 31);
  }
  const start = checkDay(lastPeriod, 'Dernière période écrite');
  return addDays(addMonths(start, 12), -1);
}

/**
 * Acquisitions à créditer (ADR-0045 § 5) : pour chaque période close depuis la
 * dernière écrite (`lastPeriod`), jusqu'à `asOf`.
 *
 * - Mensuelle : période = mois civil, due quand le mois est clos (`asOf` après
 *   son dernier jour), écrite à son dernier jour.
 * - Annuelle `leave_year_start` : période = année de congé ; `anniversary` :
 *   période = année d'ancienneté (date d'entrée + n ans). Créditée d'avance,
 *   due dès son premier jour d'activité, écrite ce jour-là.
 * - Prorata `calendar_days` (défaut) : jours civils d'activité (entre la date
 *   d'entrée et la date de sortie connue) ÷ jours civils de la période, arrondi
 *   au centième, demi vers le haut. `none` : montant entier dès un jour d'activité.
 *
 * Idempotente : rejouée avec la dernière période rendue, elle ne rend rien.
 */
export function accrualsDue(
  type: LeaveTypePolicyInput,
  employee: AccrualEmployeeInput,
  lastPeriod: string | null,
  asOf: HrDay,
  leaveYearStart: LeaveYearStart = '01-01',
): AccrualsDueResult {
  const typeId = checkId(type.id, 'Type d’absence');
  checkDay(asOf, 'Jour de référence');
  checkLeaveYearStart(leaveYearStart);
  const startDate = checkDay(employee.startDate, 'Date d’entrée');
  const endDate = checkNullableDay(employee.endDate, 'Date de sortie');
  if (endDate !== null && endDate < startDate) {
    throw new RangeError('Date de sortie : antérieure à la date d’entrée');
  }
  const accrual = checkAccrual(
    employee.leavePolicyOverrides?.[typeId]?.accrual ?? type.accrual,
    'Acquisition',
  );
  const proration = type.proration ?? 'calendar_days';
  if (proration !== 'calendar_days' && proration !== 'none') {
    throw new RangeError('Prorata : « calendar_days » ou « none » attendu');
  }
  const entries: AccrualDue[] = [];
  if (accrual.kind === 'none') return { version: HR_VERSION, typeId, entries };

  const amount = nonNegativeCenti(accrual.days, 'Acquisition (jours)');
  const covered = coveredUntil(lastPeriod);
  const lastActive = endDate === null ? asOf : minDay(endDate, asOf);

  const push = (period: string, pStart: HrDay, pEnd: HrDay, effectiveOn: HrDay): void => {
    const activeFrom = maxDay(pStart, startDate);
    const activeTo = endDate === null ? pEnd : minDay(pEnd, endDate);
    const activeDays = spanDays(activeFrom, activeTo);
    if (activeDays === 0) return;
    const periodDays = spanDays(pStart, pEnd);
    const days =
      proration === 'none' ? amount : divHalfUp(amount * BigInt(activeDays), BigInt(periodDays));
    entries.push({
      period,
      periodStart: pStart,
      periodEnd: pEnd,
      effectiveOn,
      leaveYear: leaveYearContaining(effectiveOn, leaveYearStart),
      days: formatDays(days),
      activeDays,
      periodDays,
    });
  };

  if (accrual.kind === 'monthly') {
    let { year, month } = partsOf(startDate);
    for (;;) {
      const pStart = clampedDay(year, month, 1);
      const pEnd = clampedDay(year, month, 31);
      if (pEnd >= asOf || pStart > lastActive) break; // mois non clos, ou après la sortie
      if (covered === null || pStart > covered) {
        push(pStart.slice(0, 7), pStart, pEnd, pEnd);
      }
      month += 1;
      if (month === 13) {
        month = 1;
        year += 1;
      }
    }
    return { version: HR_VERSION, typeId, entries };
  }

  // Annuelle : périodes d'un an, créditées d'avance.
  let pStart =
    accrual.on === 'anniversary'
      ? startDate
      : leaveYearStartDay(leaveYearContaining(startDate, leaveYearStart), leaveYearStart);
  for (let n = 1; ; n += 1) {
    const pEnd = addDays(
      accrual.on === 'anniversary'
        ? addMonths(startDate, 12 * n)
        : leaveYearStartDay(leaveYearContaining(pStart, leaveYearStart) + 1, leaveYearStart),
      -1,
    );
    const effectiveOn = maxDay(pStart, startDate);
    if (effectiveOn > lastActive) break;
    if (covered === null || pStart > covered) push(pStart, pStart, pEnd, effectiveOn);
    pStart = addDays(pEnd, 1);
  }
  return { version: HR_VERSION, typeId, entries };
}

function carryOverPolicy(type: LeaveTypePolicyInput): {
  maxDays: bigint | null;
  expiresAfterMonths: number | null;
} {
  const c = type.carryOver ?? { maxDays: null, expiresAfterMonths: null };
  const maxDays = c.maxDays === null ? null : nonNegativeCenti(c.maxDays, 'Report (plafond)');
  if (maxDays !== null && maxDays > 36_500n)
    throw new RangeError('Report (plafond) : 365 jours au plus');
  const months =
    c.expiresAfterMonths === null
      ? null
      : checkIntegerIn(c.expiresAfterMonths, 1, 36, 'Report (expiration en mois)');
  return { maxDays, expiresAfterMonths: months };
}

/**
 * Report au début de l'année de congé `leaveYear` (ADR-0045 § 5) : `balance`
 * est le disponible de clôture de l'année précédente (`leaveBalance`). Reporté
 * = min(disponible, plafond) ; un disponible négatif est reporté tel quel (la
 * dette ne se perd pas) ; le reste est perdu (`lapsed`, pour information).
 */
export function carryOverOf(
  balance: HrDays,
  type: LeaveTypePolicyInput,
  leaveYear: number,
  leaveYearStart: LeaveYearStart = '01-01',
): CarryOverResult {
  const typeId = checkId(type.id, 'Type d’absence');
  const available = trustedCenti(balance, 'Disponible de clôture');
  const { start } = leaveYearBounds(leaveYear, leaveYearStart);
  const policy = carryOverPolicy(type);
  let carried = available;
  if (available > 0n && policy.maxDays !== null && policy.maxDays < available) {
    carried = policy.maxDays;
  }
  return {
    version: HR_VERSION,
    typeId,
    leaveYear,
    carried: formatDays(carried),
    lapsed: formatDays(available - carried),
    expiresOn:
      policy.expiresAfterMonths === null ? null : addMonths(start, policy.expiresAfterMonths),
  };
}

/**
 * Expiration du reporté non pris (ADR-0045 § 5) : à `expiresOn` (début de
 * l'année + `expiresAfterMonths`), expiré = max(0, reporté − prises de l'année
 * datées avant `expiresOn` − expirations déjà écrites). Les prises consomment
 * d'abord le reporté. Rien n'est dû avant `expiresOn` ni sans expiration.
 */
export function carryOverExpiryOf(
  ledger: readonly LeaveLedgerEntryInput[],
  type: LeaveTypePolicyInput,
  leaveYear: number,
  asOf: HrDay,
  leaveYearStart: LeaveYearStart = '01-01',
): CarryOverExpiryResult {
  const typeId = checkId(type.id, 'Type d’absence');
  checkDay(asOf, 'Jour de référence');
  const { start } = leaveYearBounds(leaveYear, leaveYearStart);
  const policy = carryOverPolicy(type);
  const expiresOn =
    policy.expiresAfterMonths === null ? null : addMonths(start, policy.expiresAfterMonths);
  let carried = 0n;
  let takenBefore = 0n;
  let alreadyExpired = 0n;
  for (const [i, e] of ledger.entries()) {
    const days = checkEntry(e, i);
    if (e.typeId !== typeId || e.leaveYear !== leaveYear) continue;
    if (e.kind === 'carry_over') carried += days;
    else if (e.kind === 'expiry') alreadyExpired -= days;
    else if (
      (e.kind === 'taken' || e.kind === 'taken_reversal') &&
      expiresOn !== null &&
      e.effectiveOn < expiresOn
    ) {
      takenBefore -= days;
    }
  }
  const due = expiresOn !== null && asOf >= expiresOn;
  let expired = due ? carried - takenBefore - alreadyExpired : 0n;
  if (expired < 0n) expired = 0n;
  return { version: HR_VERSION, typeId, leaveYear, due, expiresOn, expired: formatDays(expired) };
}
