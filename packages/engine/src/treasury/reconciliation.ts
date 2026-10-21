// Rapprochement des dépenses avec le prévisionnel (ADR-0034 § 6).
//
// Pour chaque ligne de charge visée par la table de correspondance : prévu du
// plan (base annuelle ÷ 12, résolue par l'appelant selon docs/08 convention 2),
// réalisé des dépenses, valeur portée par `actual_periods`, écart et constats.
//
// Doctrine docs/08 : on ne fabrique jamais un chiffre. Sans base au plan, le
// prévu et l'écart valent `null` (`NO_PLAN_BASE`) ; un mois sans dépense n'a
// pas de réalisé (pas un zéro) ; le total ne couvre que les mois porteurs de
// dépenses (comparaison à périmètre identique, convention 8).

import { centsOf, centsOfPlanNumber, formatCents, trustedCents } from './money.js';
import {
  EXPENSE_CATEGORY_CODES,
  TREASURY_VERSION,
  type ExpenseCategory,
  type ExpenseReconciliation,
  type ReconcileExpensesInput,
  type ReconciliationFinding,
  type ReconciliationLine,
  type ReconciliationMonth,
  type VarianceStatus,
} from './types.js';

const TOP_EXPENSES = 3;

/** Statut d'un écart de CHARGE : sous le prévu = favorable (docs/08 § Écarts). */
function chargeStatus(ecart: bigint): VarianceStatus {
  if (ecart === 0n) return 'conforme';
  return ecart < 0n ? 'favorable' : 'defavorable';
}

function sourceOf(
  period: ReconcileExpensesInput['periods'][number] | undefined,
  lineId: string,
): ReconciliationMonth['storedSource'] {
  if (period === undefined || period.values[lineId] === undefined) return null;
  const s = period.sources[lineId]?.source;
  if (s === 'run.expenses' || s === 'run.sales') return s;
  // Absente (saisie antérieure à l'étiquetage) ou `manual` : saisie manuelle.
  return 'manual';
}

export function reconcileExpenses(input: ReconcileExpensesInput): ExpenseReconciliation {
  const periodByMonth = new Map(input.periods.map((p) => [p.month, p]));
  const expenseById = new Map(input.expenses.map((e) => [e.id, e]));

  const lines: ReconciliationLine[] = input.lines.map((line) => {
    const prevuMensuel = line.prevuMensuel === null ? null : centsOfPlanNumber(line.prevuMensuel);
    const months: ReconciliationMonth[] = [];
    const counted: number[] = [];
    let prevuCumule = 0n;
    let realiseCumule = 0n;
    const categories = new Map<ExpenseCategory, bigint>();
    const documents = new Set<string>();

    for (let month = 1; month <= 12; month += 1) {
      const cell = input.plan.cells.find(
        (c) => c.year === input.year && c.month === month && c.lineId === line.lineId,
      );
      const skippedCurrency = input.plan.skipped.some(
        (s) =>
          s.year === input.year &&
          s.month === month &&
          s.lineId === line.lineId &&
          s.reason === 'CURRENCY_NOT_CONVERTIBLE',
      );
      const period = periodByMonth.get(month);
      const storedValue = period?.values[line.lineId];
      const storedCents = storedValue === undefined ? null : centsOfPlanNumber(storedValue);
      const storedSource = sourceOf(period, line.lineId);
      const realise = cell === undefined ? null : trustedCents(cell.amount, 'Réalisé');

      const findings: ReconciliationFinding[] = [];
      if (prevuMensuel === null) findings.push('NO_PLAN_BASE');
      if (skippedCurrency) findings.push('CURRENCY_NOT_CONVERTIBLE');
      if (period?.status === 'closed') findings.push('PERIOD_CLOSED');
      if (storedSource === 'manual' || storedSource === 'run.sales') {
        findings.push('MANUAL_VALUE_PRESENT');
      }
      if (realise !== null || storedSource === 'run.expenses') {
        // Le réalisé porté doit égaler les dépenses ; un écart signale une
        // synchronisation à rejouer (ou impossible : période close, saisie manuelle).
        if (realise !== storedCents) findings.push('NOT_SYNCED');
      }

      let ecart: bigint | null = null;
      if (realise !== null && prevuMensuel !== null) {
        ecart = realise - prevuMensuel;
        counted.push(month);
        prevuCumule += prevuMensuel;
        realiseCumule += realise;
      }
      if (cell !== undefined) {
        for (const c of cell.categories) {
          categories.set(
            c.category,
            (categories.get(c.category) ?? 0n) + trustedCents(c.amount, 'Catégorie'),
          );
        }
        for (const d of cell.documents) documents.add(d);
      }

      months.push({
        month,
        prevu: prevuMensuel === null ? null : formatCents(prevuMensuel),
        realise: realise === null ? null : formatCents(realise),
        stored: storedCents === null ? null : formatCents(storedCents),
        storedSource,
        ecart: ecart === null ? null : formatCents(ecart),
        statut: ecart === null ? null : chargeStatus(ecart),
        findings,
      });
    }

    const comparable = prevuMensuel !== null;
    const hasTotal = comparable && counted.length > 0;
    const ecartTotal = hasTotal ? realiseCumule - prevuCumule : null;

    const top = [...documents]
      .map((id) => expenseById.get(id))
      .filter((e): e is NonNullable<typeof e> => e !== undefined)
      .sort((a, b) => {
        const diff = trustedCents(b.amount, 'Dépense') - trustedCents(a.amount, 'Dépense');
        if (diff !== 0n) return diff > 0n ? 1 : -1;
        return a.spentOn.localeCompare(b.spentOn) || a.id.localeCompare(b.id);
      })
      .slice(0, TOP_EXPENSES)
      .map((e) => ({
        id: e.id,
        label: e.label ?? '',
        spentOn: e.spentOn,
        amount: formatCents(centsOf(e.amount) ?? 0n),
      }));

    return {
      lineId: line.lineId,
      label: line.label,
      comparable,
      months,
      total: {
        monthsCounted: counted,
        prevuCumule: hasTotal ? formatCents(prevuCumule) : null,
        realiseCumule: hasTotal ? formatCents(realiseCumule) : null,
        ecart: ecartTotal === null ? null : formatCents(ecartTotal),
        ecartPct:
          ecartTotal === null || prevuCumule === 0n
            ? null
            : Math.round((Number(ecartTotal) / Number(prevuCumule)) * 10_000) / 10_000,
        statut: ecartTotal === null ? null : chargeStatus(ecartTotal),
      },
      categories: [...categories.entries()]
        .sort(([a], [b]) => EXPENSE_CATEGORY_CODES.indexOf(a) - EXPENSE_CATEGORY_CODES.indexOf(b))
        .map(([category, cents]) => ({ category, amount: formatCents(cents) })),
      topExpenses: top,
    };
  });

  return { version: TREASURY_VERSION, year: input.year, convention: 'annuel/12', lines };
}
