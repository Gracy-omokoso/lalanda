// Tableaux de bord des écrans Trésorerie (ADR-0071) — LECTURE SEULE.
//
//   GET /treasury/expenses/stats?month=   GET /treasury/accounts/stats
//
// Organisation active seulement ; rien n'est stocké. Tout chiffre vient du moteur
// (`computeExpenseStats`, `computeAccountStats`, qui s'appuie sur
// `computeAccountBalances`). Dépenses : lecture bornée à `TREASURY_STATS_MAX_READ`
// (`truncated` au-delà). Comptes : le grand livre lu par la liste des comptes
// (`TreasuryAccountsService.ledger`), tel quel : les soldes concordent.
//
// Ce sont les comptes RÉELS (ADR-0034) ; la trésorerie mensuelle des plans BUILD
// est une vue simplifiée, distincte.

import { computeAccountStats, computeExpenseStats, EXPENSE_CATEGORIES } from '@lalanda/engine';
import {
  TREASURY_STATS_DEFAULT_MONTHS,
  TREASURY_STATS_MAX_READ,
  type AccountStats,
  type ExpenseStats,
} from '@lalanda/shared/treasury';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { TreasuryAccountsService } from './treasury-accounts.service.js';
import { todayKinshasa } from './treasury.common.js';
import { TreasuryExpense, type TreasuryExpenseDocument } from './treasury.schemas.js';

const LABELS = new Map<string, string>(EXPENSE_CATEGORIES.map((c) => [c.code, c.label]));

/** Premier jour du mois qui précède la fenêtre de `months` mois finissant au mois de `asOf`. */
function readFrom(asOf: string, months: number): string {
  const y = Number(asOf.slice(0, 4));
  const m = Number(asOf.slice(5, 7)) - 1 - months;
  const year = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${String(year).padStart(4, '0')}-${String(mm + 1).padStart(2, '0')}-01`;
}

interface ExpenseStatsLean {
  _id: unknown;
  status: 'recorded' | 'cancelled';
  spentOn: string;
  amount: string;
  currency: 'CDF' | 'USD';
  category: (typeof EXPENSE_CATEGORIES)[number]['code'];
  attachment: unknown;
}

@Injectable()
export class TreasuryStatsService {
  constructor(
    @InjectModel(TreasuryExpense.name) private readonly expenses: Model<TreasuryExpenseDocument>,
    @Inject(TreasuryAccountsService) private readonly accounts: TreasuryAccountsService,
  ) {}

  async expenseStats(
    organizationId: string,
    query: { months?: number | undefined; month?: string | undefined },
    now = new Date(),
  ): Promise<ExpenseStats> {
    const asOf = todayKinshasa(now);
    const months = query.months ?? TREASURY_STATS_DEFAULT_MONTHS;
    const listMonth = query.month ?? asOf.slice(0, 7);
    const docs = await this.expenses
      .find(
        {
          organizationId,
          $or: [
            { spentOn: { $gte: readFrom(asOf, months) } },
            { spentOn: { $gte: `${listMonth}-01`, $lte: `${listMonth}-31` } },
          ],
        },
        { status: 1, spentOn: 1, amount: 1, currency: 1, category: 1, attachment: 1 },
      )
      .sort({ spentOn: -1, _id: -1 })
      .limit(TREASURY_STATS_MAX_READ + 1)
      .lean<ExpenseStatsLean[]>()
      .exec();
    const kept = docs.slice(0, TREASURY_STATS_MAX_READ);
    const stats = computeExpenseStats({
      asOf,
      months,
      listMonth,
      expenses: kept.map((d) => ({
        id: String(d._id),
        status: d.status,
        spentOn: d.spentOn,
        amount: d.amount,
        currency: d.currency,
        category: d.category,
        hasAttachment: d.attachment !== null && d.attachment !== undefined,
      })),
    });
    return {
      ...stats,
      byCurrency: stats.byCurrency.map((c) => ({
        ...c,
        byCategoryThisMonth: c.byCategoryThisMonth.map((x) => ({
          ...x,
          label: LABELS.get(x.category) ?? x.category,
        })),
      })),
      truncated: docs.length > TREASURY_STATS_MAX_READ,
    };
  }

  async accountStats(
    organizationId: string,
    query: { months?: number | undefined },
    now = new Date(),
  ): Promise<AccountStats> {
    const asOf = todayKinshasa(now);
    const ledger = await this.accounts.ledger(organizationId);
    const names = new Map(ledger.accounts.map((a) => [a.id, a.name]));
    const stats = computeAccountStats({
      asOf,
      months: query.months ?? TREASURY_STATS_DEFAULT_MONTHS,
      accounts: ledger.accounts,
      movements: ledger.movements,
    });
    return {
      ...stats,
      byCurrency: stats.byCurrency.map((c) => ({
        ...c,
        accounts: c.accounts.map((a) => ({ ...a, name: names.get(a.accountId) ?? 'Compte' })),
      })),
      // Le grand livre est lu en entier, comme pour la liste des comptes.
      truncated: false,
    };
  }
}
