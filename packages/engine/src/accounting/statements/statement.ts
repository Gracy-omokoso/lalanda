// Projets d'états financiers (ADR-0049 § 10, § 12 `computeStatement`).
//
// - Le modèle (rubriques → plages de comptes) vient du pack ; ce module ne
//   connaît aucun numéro de compte.
// - Chaque projet porte `status: 'draft_unverified'`, le bandeau et ses
//   réserves ; une rubrique `to_confirm` reste marquée.
// - Tableau des flux : « non disponible » tant que son modèle n'est pas
//   entièrement relu (question E8) — jamais deviné.

import { byString, formatCents, signedCentsOf } from '../ledger/money.js';
import {
  ACCOUNTING_REPORTING_VERSION,
  type ReportingConfirmation,
  type ReportingCurrency,
  type ReportingDay,
} from '../ledger/types.js';
import type { TrialBalance } from '../ledger/ledger.js';
import { reserveOf, sortReserves, type Reserve } from './reserves.js';
import {
  STATEMENT_DISCLAIMER,
  STATEMENT_STATUS,
  TO_CONFIRM_NOTE,
  type StatementStatus,
} from './wording.js';

export const STATEMENT_KINDS = ['balance_sheet', 'income_statement', 'cash_flow'] as const;
export type StatementKind = (typeof STATEMENT_KINDS)[number];

/**
 * Plage de comptes : un numéro appartient à la plage si ses `from.length`
 * premiers chiffres sont compris entre `from` et `to` (inclus). `to` absent =
 * `from` (un préfixe).
 */
export interface AccountRange {
  from: string;
  to?: string;
}

export interface StatementRubricTemplate {
  code: string;
  label: string;
  confirmation: ReportingConfirmation;
  /** Sens d'affichage : `debit` → débit − crédit ; `credit` → crédit − débit. */
  normalBalance: 'debit' | 'credit';
  accounts: readonly AccountRange[];
}

export interface StatementTemplateView {
  kind: StatementKind;
  label: string;
  confirmation: ReportingConfirmation;
  sections: readonly {
    code: string;
    label: string;
    confirmation: ReportingConfirmation;
    rubrics: readonly StatementRubricTemplate[];
  }[];
  /** Plages que l'état doit couvrir : un compte soldé dans ces plages, hors rubrique, est signalé. */
  coverage?: readonly AccountRange[];
}

export interface StatementRubric {
  code: string;
  label: string;
  confirmation: ReportingConfirmation;
  /** `true` si la rubrique, sa section ou le modèle est `to_confirm`. */
  toConfirm: boolean;
  note: string | null;
  amount: string;
  accounts: { accountNumber: string; amount: string }[];
}

export interface StatementSection {
  code: string;
  label: string;
  confirmation: ReportingConfirmation;
  toConfirm: boolean;
  total: string;
  rubrics: StatementRubric[];
}

export interface StatementDraft {
  version: string;
  status: StatementStatus;
  disclaimer: string;
  kind: StatementKind;
  label: string;
  bookCurrency: ReportingCurrency;
  from: ReportingDay;
  to: ReportingDay;
  available: boolean;
  /** `STATEMENT_NOT_AVAILABLE` quand l'état n'est pas rendu. */
  unavailableReason: 'STATEMENT_NOT_AVAILABLE' | null;
  sections: StatementSection[];
  /** Somme débit − crédit des comptes repris (chacun une fois). */
  matchedNetBalance: string;
  /** Compte de résultat seulement : crédit − débit des comptes repris ; `null` sinon. */
  result: string | null;
  unmappedAccounts: { accountNumber: string; closingBalance: string }[];
  reserves: Reserve[];
}

function checkRange(r: AccountRange, where: string): { from: string; to: string } {
  const to = r.to ?? r.from;
  if (!/^\d+$/.test(r.from) || !/^\d+$/.test(to) || to.length !== r.from.length || r.from > to) {
    throw new RangeError(`${where} : plage de comptes illisible ${JSON.stringify(r)}`);
  }
  return { from: r.from, to };
}

function inRange(n: string, r: { from: string; to: string }): boolean {
  if (n.length < r.from.length) return false;
  const p = n.slice(0, r.from.length);
  return p >= r.from && p <= r.to;
}

export interface StatementOptions {
  /** Réserves de `computeReserves`, recopiées en tête de l'état. */
  reserves: readonly Reserve[];
}

export function computeStatement(
  trialBalance: TrialBalance,
  template: StatementTemplateView | null,
  kind: StatementKind,
  options: StatementOptions,
): StatementDraft {
  if (template !== null && template.kind !== kind) {
    throw new RangeError(`Modèle d'état « ${template.kind} » fourni pour « ${kind} »`);
  }
  const reserves: Reserve[] = [...options.reserves];
  if (!trialBalance.balanced) {
    reserves.push(
      reserveOf('TRIAL_BALANCE_UNBALANCED', {
        totals: trialBalance.totals,
        unbalancedEntries: trialBalance.unbalancedEntries.length,
      }),
    );
  }
  const base = {
    version: ACCOUNTING_REPORTING_VERSION,
    status: STATEMENT_STATUS,
    disclaimer: STATEMENT_DISCLAIMER,
    kind,
    bookCurrency: trialBalance.bookCurrency,
    from: trialBalance.from,
    to: trialBalance.to,
  };

  const everythingSourced =
    template !== null &&
    template.confirmation === 'sourced' &&
    template.sections.every(
      (s) => s.confirmation === 'sourced' && s.rubrics.every((r) => r.confirmation === 'sourced'),
    );
  if (template === null || (kind === 'cash_flow' && !everythingSourced)) {
    return {
      ...base,
      label: template?.label ?? kind,
      available: false,
      unavailableReason: 'STATEMENT_NOT_AVAILABLE',
      sections: [],
      matchedNetBalance: formatCents(0n),
      result: null,
      unmappedAccounts: [],
      reserves: sortReserves(reserves),
    };
  }

  const balances = trialBalance.rows.map((r) => ({
    n: r.accountNumber,
    v: signedCentsOf(r.closingBalance, `Solde du compte ${r.accountNumber}`),
  }));
  const usedBy = new Map<string, string[]>();
  const sections: StatementSection[] = template.sections.map((s) => {
    let sectionTotal = 0n;
    const rubrics = s.rubrics.map((rub) => {
      const ranges = rub.accounts.map((r) => checkRange(r, `Rubrique ${rub.code}`));
      let amount = 0n;
      const accounts: { accountNumber: string; amount: string }[] = [];
      for (const b of balances) {
        if (!ranges.some((r) => inRange(b.n, r))) continue;
        const shown = rub.normalBalance === 'debit' ? b.v : -b.v;
        amount += shown;
        accounts.push({ accountNumber: b.n, amount: formatCents(shown) });
        usedBy.set(b.n, [...(usedBy.get(b.n) ?? []), rub.code]);
      }
      sectionTotal += amount;
      const toConfirm =
        rub.confirmation === 'to_confirm' ||
        s.confirmation === 'to_confirm' ||
        template.confirmation === 'to_confirm';
      return {
        code: rub.code,
        label: rub.label,
        confirmation: rub.confirmation,
        toConfirm,
        note: toConfirm ? TO_CONFIRM_NOTE : null,
        amount: formatCents(amount),
        accounts,
      };
    });
    return {
      code: s.code,
      label: s.label,
      confirmation: s.confirmation,
      toConfirm: s.confirmation === 'to_confirm' || template.confirmation === 'to_confirm',
      total: formatCents(sectionTotal),
      rubrics,
    };
  });

  let net = 0n;
  for (const b of balances) if (usedBy.has(b.n)) net += b.v;
  const coverage = (template.coverage ?? []).map((r) => checkRange(r, 'Couverture'));
  const unmapped = balances
    .filter((b) => b.v !== 0n && !usedBy.has(b.n) && coverage.some((r) => inRange(b.n, r)))
    .map((b) => ({ accountNumber: b.n, closingBalance: formatCents(b.v) }));
  const multi = [...usedBy.entries()]
    .filter(([, codes]) => codes.length > 1)
    .sort(([a], [b]) => byString(a, b))
    .map(([accountNumber, rubrics]) => ({ accountNumber, rubrics }));

  const anyToConfirm = sections.some((s) => s.toConfirm || s.rubrics.some((r) => r.toConfirm));
  if (anyToConfirm || template.confirmation === 'to_confirm') {
    reserves.push(
      reserveOf('STATEMENT_TEMPLATE_TO_CONFIRM', {
        rubrics: sections.flatMap((s) => s.rubrics.filter((r) => r.toConfirm).map((r) => r.code)),
      }),
    );
  }
  if (unmapped.length > 0) reserves.push(reserveOf('UNMAPPED_ACCOUNTS', { accounts: unmapped }));
  if (multi.length > 0) reserves.push(reserveOf('ACCOUNT_IN_SEVERAL_RUBRICS', { accounts: multi }));

  return {
    ...base,
    label: template.label,
    available: true,
    unavailableReason: null,
    sections,
    matchedNetBalance: formatCents(net),
    result: kind === 'income_statement' ? formatCents(-net) : null,
    unmappedAccounts: unmapped,
    reserves: sortReserves(reserves),
  };
}
