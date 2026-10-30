// ─────────────────────────────────────────────────────────────────────────────
// Rapports RH et échéances (ADR-0045 § 3.3, § 6.4, § 7)
//
// Effectif, entrées et sorties, absentéisme, ancienneté, échéances. Aucune
// donnée salariale ni sensible en entrée ni en sortie. Les rapports lisent les
// DATES (entrée, sortie) et non le statut, si bien qu'un collaborateur
// anonymisé reste compté (ADR-0045 § 3.1, anonymisation). Définitions propres
// à Lalanda, pas des normes :
//   - présent un jour J : date d'entrée ≤ J ≤ date de sortie (incluse) ;
//   - taux de sortie = sorties ÷ effectif moyen (Σ effectifs quotidiens ÷ jours) ;
//   - absentéisme = jours d'absence approuvée des types `countsAsAbsenteeism`
//     ÷ jours travaillés théoriques, par service — jamais par personne.
// ─────────────────────────────────────────────────────────────────────────────

import {
  BOTH,
  addDays,
  byString,
  checkDay,
  checkIntegerIn,
  checkNullableDay,
  checkWorkPattern,
  clampedDay,
  countedCenti,
  dayNumber,
  dayOfNumber,
  divHalfUp,
  formatFixed2,
  fractionCenti,
  halvesOfDay,
  holidayIndex,
  maxDay,
  minDay,
  partsOf,
  percentOf,
  slotsOf,
  spanDays,
  weekdayOf,
  type Halves,
} from './days.js';
import {
  HR_VERSION,
  REMINDER_DAYS_BOUNDS,
  SENIORITY_BUCKETS,
  type AbsenteeismGroup,
  type AbsenteeismResult,
  type AbsenteeismTypeInput,
  type CountByKey,
  type DeadlineDocumentInput,
  type DeadlineHorizons,
  type DerivedEmployeeStatus,
  type ExitCategory,
  type HeadcountResult,
  type HolidayInput,
  type HrDay,
  type HrDeadline,
  type HrDeadlineKind,
  type HrDeadlinesResult,
  type HrEmployeeInput,
  type IdExpiryInput,
  type LeaveRequestInput,
  type MovementsResult,
  type SeniorityBucket,
  type SeniorityResult,
  type WorkPattern,
} from './types.js';

function employmentOf(e: HrEmployeeInput, i: number): { start: HrDay; end: HrDay | null } {
  const start = checkDay(e.startDate, `Collaborateur n° ${i + 1} (entrée)`);
  const end = checkNullableDay(e.endDate, `Collaborateur n° ${i + 1} (sortie)`);
  if (end !== null && end < start) {
    throw new RangeError(`Collaborateur n° ${i + 1} : sortie antérieure à l'entrée`);
  }
  return { start, end };
}

const presentOn = (emp: { start: HrDay; end: HrDay | null }, day: HrDay): boolean =>
  emp.start <= day && (emp.end === null || emp.end >= day);

function checkPeriod(from: HrDay, to: HrDay): void {
  checkDay(from, 'Début de période');
  checkDay(to, 'Fin de période');
  if (to < from) throw new RangeError('Période : la fin précède le début');
}

/**
 * Statut dérivé, jamais stocké (ADR-0045 § 2.1) : `upcoming` (entrée future),
 * `probation` (période d'essai saisie en cours), `active`, `exited` (sortie
 * passée ou statut `exited` sans date), `anonymized`.
 */
export function employeeStatusOf(employee: HrEmployeeInput, asOf: HrDay): DerivedEmployeeStatus {
  checkDay(asOf, 'Jour de référence');
  if (employee.status === 'anonymized') return 'anonymized';
  const emp = employmentOf(employee, 0);
  if (emp.end !== null && emp.end < asOf) return 'exited';
  if (employee.status === 'exited' && emp.end === null) return 'exited';
  if (emp.start > asOf) return 'upcoming';
  const probation = checkNullableDay(employee.probationEndDate, 'Fin de période d’essai');
  if (probation !== null && probation >= asOf) return 'probation';
  return 'active';
}

/** Effectif présent à `asOf`, total et par service ou type de contrat. */
export function headcount(
  employees: readonly HrEmployeeInput[],
  asOf: HrDay,
  groupBy: 'none' | 'department' | 'contract_type' = 'none',
): HeadcountResult {
  checkDay(asOf, 'Jour de référence');
  const counts = new Map<string | null, number>();
  let total = 0;
  for (const [i, e] of employees.entries()) {
    if (!presentOn(employmentOf(e, i), asOf)) continue;
    total += 1;
    if (groupBy === 'none') continue;
    const key = (groupBy === 'department' ? e.departmentId : e.contractType) ?? null;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return { version: HR_VERSION, asOf, groupBy, total, groups: sortedCounts(counts) };
}

function sortedCounts(counts: Map<string | null, number>): CountByKey[] {
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (a.key === null ? 1 : b.key === null ? -1 : byString(a.key, b.key)));
}

/**
 * Entrées et sorties de `from` à `to` inclus : entrée = date d'entrée dans la
 * période ; sortie = date de sortie dans la période, par catégorie.
 */
export function movements(
  employees: readonly HrEmployeeInput[],
  from: HrDay,
  to: HrDay,
): MovementsResult {
  checkPeriod(from, to);
  const days = spanDays(from, to);
  let entries = 0;
  let exits = 0;
  let presenceDays = 0n;
  const byCategory = new Map<ExitCategory | null, number>();
  for (const [i, e] of employees.entries()) {
    const emp = employmentOf(e, i);
    if (emp.start >= from && emp.start <= to) entries += 1;
    if (emp.end !== null && emp.end >= from && emp.end <= to) {
      exits += 1;
      const cat = e.exitCategory ?? null;
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
    }
    presenceDays += BigInt(
      spanDays(maxDay(emp.start, from), emp.end === null ? to : minDay(emp.end, to)),
    );
  }
  return {
    version: HR_VERSION,
    from,
    to,
    entries,
    exits,
    exitsByCategory: [...byCategory.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) =>
        a.category === null ? 1 : b.category === null ? -1 : byString(a.category, b.category),
      ),
    averageHeadcount: formatFixed2(divHalfUp(presenceDays * 100n, BigInt(days))),
    exitRatePercent: percentOf(BigInt(exits) * BigInt(days), presenceDays),
  };
}

/**
 * Absentéisme de `from` à `to` inclus, par service (ADR-0045 § 7). Jours
 * théoriques : semaine de travail du collaborateur (ou `defaultWorkPattern`,
 * celle de l'organisation) moins fériés, sur ses seuls jours d'emploi. Jours
 * d'absence : demandes `approved` des types `countsAsAbsenteeism`, réunies (un
 * recouvrement n'est compté qu'une fois). Le service est celui de la fiche.
 */
export function absenteeism(
  requests: readonly LeaveRequestInput[],
  types: readonly AbsenteeismTypeInput[],
  employees: readonly HrEmployeeInput[],
  holidays: readonly HolidayInput[],
  from: HrDay,
  to: HrDay,
  defaultWorkPattern: WorkPattern,
): AbsenteeismResult {
  checkPeriod(from, to);
  checkWorkPattern(defaultWorkPattern, 'Semaine de travail de l’organisation');
  const counting = new Set(types.filter((t) => t.countsAsAbsenteeism).map((t) => t.id));
  const index = holidayIndex(holidays);
  const fromN = dayNumber(from);
  const toN = dayNumber(to);

  const absentByEmployee = new Map<string, Map<number, Halves>>();
  for (const [i, r] of requests.entries()) {
    if (r.status !== 'approved' || !counting.has(r.typeId)) continue;
    const [first, last] = slotsOf(r.start, r.end, `Demande n° ${i + 1}`);
    const lo = Math.max(fromN, Math.floor(first / 2));
    const hi = Math.min(toN, Math.floor(last / 2));
    if (lo > hi) continue;
    const map = absentByEmployee.get(r.employeeId) ?? new Map<number, Halves>();
    for (let n = lo; n <= hi; n += 1) map.set(n, (map.get(n) ?? 0) | halvesOfDay(n, first, last));
    absentByEmployee.set(r.employeeId, map);
  }

  const groups = new Map<string | null, { employees: number; theo: bigint; absent: bigint }>();
  const total = { employees: 0, theo: 0n, absent: 0n };
  for (const [i, e] of employees.entries()) {
    const emp = employmentOf(e, i);
    const lo = dayNumber(maxDay(emp.start, from));
    const hi = dayNumber(emp.end === null ? to : minDay(emp.end, to));
    if (lo > hi) continue;
    const pattern = checkWorkPattern(e.workPattern ?? defaultWorkPattern);
    const absent = absentByEmployee.get(e.id);
    let theo = 0n;
    let abs = 0n;
    for (let n = lo; n <= hi; n += 1) {
      const date = dayOfNumber(n);
      const open = BOTH & ~index.halvesOn(date);
      const p = fractionCenti(pattern, weekdayOf(date));
      const w = countedCenti(p, open);
      theo += w;
      abs += w - countedCenti(p, open & ~(absent?.get(n) ?? 0));
    }
    const key = e.departmentId ?? null;
    const g = groups.get(key) ?? { employees: 0, theo: 0n, absent: 0n };
    g.employees += 1;
    g.theo += theo;
    g.absent += abs;
    groups.set(key, g);
    total.employees += 1;
    total.theo += theo;
    total.absent += abs;
  }
  const render = (g: { employees: number; theo: bigint; absent: bigint }) => ({
    employees: g.employees,
    theoreticalDays: formatFixed2(g.theo),
    absenceDays: formatFixed2(g.absent),
    ratePercent: percentOf(g.absent, g.theo),
  });
  const list: AbsenteeismGroup[] = [...groups.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : byString(a, b)))
    .map(([departmentId, g]) => ({ departmentId, ...render(g) }));
  return { version: HR_VERSION, from, to, groups: list, total: render(total) };
}

/** Années complètes d'ancienneté à `asOf` (anniversaire du 29 février ramené au 28). */
export function seniorityYears(startDate: HrDay, asOf: HrDay): number {
  const s = partsOf(checkDay(startDate, 'Date d’entrée'));
  const a = partsOf(checkDay(asOf, 'Jour de référence'));
  if (asOf < startDate) return 0;
  const years = a.year - s.year;
  return clampedDay(a.year, s.month, s.day) > asOf ? years - 1 : years;
}

const bucketOf = (years: number): SeniorityBucket =>
  years < 1 ? 'lt1' : years < 3 ? '1to3' : years < 5 ? '3to5' : years < 10 ? '5to10' : 'gte10';

/** Ancienneté des présents à `asOf` par tranches : < 1 an, [1, 3), [3, 5), [5, 10), ≥ 10. */
export function seniority(employees: readonly HrEmployeeInput[], asOf: HrDay): SeniorityResult {
  checkDay(asOf, 'Jour de référence');
  const counts = new Map<SeniorityBucket, number>(SENIORITY_BUCKETS.map((b) => [b, 0]));
  let total = 0;
  for (const [i, e] of employees.entries()) {
    const emp = employmentOf(e, i);
    if (!presentOn(emp, asOf)) continue;
    total += 1;
    const b = bucketOf(seniorityYears(emp.start, asOf));
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  return {
    version: HR_VERSION,
    asOf,
    total,
    buckets: SENIORITY_BUCKETS.map((bucket) => ({ bucket, count: counts.get(bucket) ?? 0 })),
  };
}

/**
 * Échéances RH (ADR-0045 § 6.4) entre `today` et `today + horizon` inclus :
 * fins d'essai, fins de contrat, documents qui expirent, pièces d'identité
 * (`idExpiries`, en clair sans numéro). Seuls les collaborateurs `active` et
 * pas encore sortis à `today` sont suivis ; un document supprimé est ignoré.
 */
export function hrDeadlines(
  employees: readonly HrEmployeeInput[],
  documents: readonly DeadlineDocumentInput[],
  idExpiries: readonly IdExpiryInput[],
  today: HrDay,
  horizons: DeadlineHorizons,
): HrDeadlinesResult {
  checkDay(today, 'Jour de référence');
  const { min, max } = REMINDER_DAYS_BOUNDS;
  const limit = {
    probation_end: addDays(
      today,
      checkIntegerIn(horizons.probationEnd, min, max, 'Rappel fin d’essai'),
    ),
    contract_end: addDays(
      today,
      checkIntegerIn(horizons.contractEnd, min, max, 'Rappel fin de contrat'),
    ),
    document_expiry: addDays(
      today,
      checkIntegerIn(horizons.documentExpiry, min, max, 'Rappel document'),
    ),
  };
  const tracked = new Set<string>();
  for (const [i, e] of employees.entries()) {
    const emp = employmentOf(e, i);
    if (e.status === 'active' && (emp.end === null || emp.end >= today)) tracked.add(e.id);
  }
  const deadlines: HrDeadline[] = [];
  const add = (
    kind: HrDeadlineKind,
    employeeId: string,
    date: HrDay,
    until: HrDay,
    documentId: string | null = null,
    idKind: string | null = null,
  ): void => {
    if (!tracked.has(employeeId) || date < today || date > until) return;
    deadlines.push({
      kind,
      employeeId,
      date,
      daysLeft: dayNumber(date) - dayNumber(today),
      documentId,
      idKind,
      dedupeKey: [employeeId, kind, date, documentId ?? idKind].filter((p) => p !== null).join(':'),
    });
  };
  for (const e of employees) {
    const probation = checkNullableDay(e.probationEndDate, 'Fin de période d’essai');
    if (probation !== null) add('probation_end', e.id, probation, limit.probation_end);
    const contract = checkNullableDay(e.contractEndDate, 'Fin de contrat');
    if (contract !== null) add('contract_end', e.id, contract, limit.contract_end);
  }
  for (const [i, d] of documents.entries()) {
    if (d.deleted === true) continue;
    const exp = checkNullableDay(d.expiresOn, `Document n° ${i + 1} (expiration)`);
    if (exp !== null) add('document_expiry', d.employeeId, exp, limit.document_expiry, d.id);
  }
  for (const [i, x] of idExpiries.entries()) {
    const exp = checkDay(x.expiresOn, `Pièce n° ${i + 1} (expiration)`);
    add('id_expiry', x.employeeId, exp, limit.document_expiry, null, x.kind);
  }
  deadlines.sort(
    (a, b) =>
      byString(a.date, b.date) ||
      byString(a.kind, b.kind) ||
      byString(a.employeeId, b.employeeId) ||
      byString(a.dedupeKey, b.dedupeKey),
  );
  const counts: Record<HrDeadlineKind, number> = {
    probation_end: 0,
    contract_end: 0,
    document_expiry: 0,
    id_expiry: 0,
  };
  for (const d of deadlines) counts[d.kind] += 1;
  return { version: HR_VERSION, today, deadlines, counts, total: deadlines.length };
}
