// Soldes des comptes de trésorerie (ADR-0034 § 4).
//
//   solde(D) = solde d'ouverture + Σ entrées − Σ sorties, mouvements datés de [ouverture, D]
//
// Le solde d'ouverture est celui du DÉBUT du jour d'ouverture : un mouvement daté
// du jour d'ouverture compte. Un flux s'additionne, un stock se reporte (docs/21).

import { dayNumber } from './calendar.js';
import { formatCents, trustedCents } from './money.js';
import {
  TREASURY_VERSION,
  type AccountBalance,
  type AccountBalances,
  type CalendarDay,
  type TreasuryAccountInput,
  type TreasuryCurrency,
  type TreasuryMovementInput,
} from './types.js';

export function computeAccountBalances(
  accounts: readonly TreasuryAccountInput[],
  movements: readonly TreasuryMovementInput[],
  asOf: CalendarDay,
): AccountBalances {
  const asOfN = dayNumber(asOf);
  const state = new Map<
    string,
    {
      account: TreasuryAccountInput;
      openingN: number;
      inflows: bigint;
      outflows: bigint;
      count: number;
    }
  >();
  for (const account of accounts) {
    state.set(account.id, {
      account,
      openingN: dayNumber(account.openingDate),
      inflows: 0n,
      outflows: 0n,
      count: 0,
    });
  }

  const ignored = { unknownAccount: 0, beforeOpening: 0, afterAsOf: 0 };
  for (const movement of movements) {
    const s = state.get(movement.accountId);
    if (s === undefined) {
      ignored.unknownAccount += 1;
      continue;
    }
    const n = dayNumber(movement.date);
    if (n > asOfN) {
      ignored.afterAsOf += 1;
      continue;
    }
    if (n < s.openingN) {
      ignored.beforeOpening += 1;
      continue;
    }
    const cents = trustedCents(movement.amount, 'Mouvement');
    if (cents <= 0n) throw new RangeError('Un mouvement porte un montant strictement positif');
    if (movement.direction === 'in') s.inflows += cents;
    else s.outflows += cents;
    s.count += 1;
  }

  const totals = new Map<TreasuryCurrency, bigint>();
  const out: AccountBalance[] = [];
  for (const s of state.values()) {
    const opening = trustedCents(s.account.openingBalance, "Solde d'ouverture");
    // Un compte ouvert APRÈS `asOf` n'a pas encore de solde : il vaut 0 à cette date.
    const started = s.openingN <= asOfN;
    const balance = started ? opening + s.inflows - s.outflows : 0n;
    out.push({
      accountId: s.account.id,
      currency: s.account.currency,
      openingBalance: formatCents(opening),
      inflows: formatCents(s.inflows),
      outflows: formatCents(s.outflows),
      balance: formatCents(balance),
      movementCount: s.count,
    });
    if (s.account.active !== false) {
      totals.set(s.account.currency, (totals.get(s.account.currency) ?? 0n) + balance);
    }
  }

  const totalsByCurrency: Partial<Record<TreasuryCurrency, string>> = {};
  for (const [currency, cents] of [...totals.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    totalsByCurrency[currency] = formatCents(cents);
  }
  return { version: TREASURY_VERSION, asOf, accounts: out, totalsByCurrency, ignored };
}
