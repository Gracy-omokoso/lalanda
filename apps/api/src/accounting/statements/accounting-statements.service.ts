// Projets d'états financiers (ADR-0049 § 10, § 11). ADR-0049 — K6.
//
// - TOUJOURS `status: "draft_unverified"`, le bandeau (`disclaimer`) et les réserves, sur
//   chaque réponse : le projet est calculé par le moteur (`computeStatement`), jamais ici.
// - Le modèle (rubriques → plages de comptes) vient du pack ; tant qu'il manque, l'état est
//   rendu « non disponible » plutôt que deviné. Le tableau des flux reste « non
//   disponible » tant que la méthode n'est pas tranchée par l'expert (E8) :
//   `409 STATEMENT_NOT_AVAILABLE`, enveloppe du projet comprise dans `details`.
//
// Le pack (lot K1) décrit une rubrique par ses préfixes de comptes, sans sens d'affichage :
// ce sens est déduit de la nature du compte du pack qui ouvre la rubrique (actif, charge →
// débit ; passif, capitaux, produit → crédit). Ce n'est pas un classement comptable — le
// montant reste celui des comptes — et chaque rubrique non relue reste marquée.

import {
  computeStatement,
  type StatementDraft,
  type StatementKind,
  type StatementTemplateView,
} from '@lalanda/engine';
import type {
  AccountingStatementKind,
  AccountingStatementQuery,
  AccountingStatementView,
} from '@lalanda/shared/accounting';
import { ConflictException, Inject, Injectable } from '@nestjs/common';

import type { AccountingChartPackLean } from '../chart/chart-pack.schema.js';
import { fiscalYearMonths } from '../periods/accounting-periods.service.js';
import { AccountingSettingsService } from '../settings/accounting-settings.service.js';
import {
  AccountingReportingService,
  type ReportingContext,
} from '../reports/accounting-reporting.service.js';

const ENGINE_KIND: Record<AccountingStatementKind, StatementKind> = {
  'balance-sheet': 'balance_sheet',
  'income-statement': 'income_statement',
  'cash-flow': 'cash_flow',
};

const TEMPLATE_KEY: Record<StatementKind, 'balanceSheet' | 'incomeStatement' | 'cashFlow'> = {
  balance_sheet: 'balanceSheet',
  income_statement: 'incomeStatement',
  cash_flow: 'cashFlow',
};

const LABELS: Record<StatementKind, string> = {
  balance_sheet: 'Bilan (projet)',
  income_statement: 'Compte de résultat (projet)',
  cash_flow: 'Tableau des flux de trésorerie (projet)',
};

/** Modèle d'état du pack → vue du moteur ; `null` tant que le pack ne le fournit pas. */
export function templateOf(
  pack: AccountingChartPackLean | null,
  kind: StatementKind,
): StatementTemplateView | null {
  const rubrics = pack?.content.statementTemplates[TEMPLATE_KEY[kind]] ?? null;
  if (rubrics === null || rubrics.length === 0) return null;
  const accounts = pack?.content.accounts ?? [];
  const natureOf = (prefix: string): string | null =>
    accounts
      .filter((a) => prefix.startsWith(a.number) || a.number.startsWith(prefix))
      .sort((a, b) => a.number.length - b.number.length)[0]?.nature ?? null;
  const confirmation = rubrics.every((r) => r.confirmation === 'sourced')
    ? 'sourced'
    : 'to_confirm';
  return {
    kind,
    label: LABELS[kind],
    confirmation,
    sections: [
      {
        code: kind,
        label: LABELS[kind],
        confirmation,
        rubrics: rubrics.map((r) => {
          const nature = natureOf(r.accountPrefixes[0]!);
          return {
            code: r.code,
            label: r.label,
            confirmation: r.confirmation,
            normalBalance:
              nature === 'liability' || nature === 'equity' || nature === 'income'
                ? ('credit' as const)
                : ('debit' as const),
            accounts: r.accountPrefixes.map((p) => ({ from: p })),
          };
        }),
      },
    ],
  };
}

@Injectable()
export class AccountingStatementsService {
  constructor(
    @Inject(AccountingReportingService) private readonly reporting: AccountingReportingService,
    @Inject(AccountingSettingsService) private readonly settings: AccountingSettingsService,
  ) {}

  /** Bornes de l'exercice `year` jusqu'à la fin du mois `month` (défaut : tout l'exercice). */
  rangeOf(startMonth: number, year: number, month?: number): { from: string; to: string } {
    const months = fiscalYearMonths(year, startMonth);
    const last = month === undefined ? months[11]! : months.find((m) => m.month === month)!;
    return { from: months[0]!.start, to: last.end };
  }

  /** Projet d'état de l'exercice `year` (jusqu'au mois `month`), enveloppe comprise. */
  async draft(
    organizationId: string,
    kind: AccountingStatementKind,
    query: AccountingStatementQuery,
  ): Promise<AccountingStatementView> {
    const { fiscalYearStartMonth } = await this.settings.ensure(organizationId);
    const { from, to } = this.rangeOf(fiscalYearStartMonth, query.year, query.month);
    const ctx = await this.reporting.context(organizationId, to, from);
    return this.draftForRange(ctx, kind, from, to, query.year);
  }

  /** Projet d'état sur `[from, to]` (à-nouveaux = tout ce qui précède `from`). */
  async draftForRange(
    ctx: ReportingContext,
    kind: AccountingStatementKind,
    from: string,
    to: string,
    fiscalYear: number,
  ): Promise<AccountingStatementView> {
    const reserves = await this.reporting.reserves(ctx, from, to);
    const tb = this.reporting.trialBalanceOf(ctx, from, to);
    const engineKind = ENGINE_KIND[kind];
    const draft: StatementDraft = computeStatement(
      tb,
      templateOf(ctx.pack, engineKind),
      engineKind,
      { reserves },
    );
    return {
      ...this.reporting.envelope(ctx, from, to, draft.reserves),
      status: draft.status,
      disclaimer: draft.disclaimer,
      kind,
      label: draft.label === engineKind ? LABELS[engineKind] : draft.label,
      fiscalYear,
      available: draft.available,
      unavailableReason: draft.unavailableReason,
      sections: draft.sections,
      matchedNetBalance: draft.matchedNetBalance,
      result: draft.result,
      unmappedAccounts: draft.unmappedAccounts,
    };
  }

  /** Route : le tableau des flux non disponible est refusé (`409`), l'enveloppe jointe. */
  async get(
    organizationId: string,
    kind: AccountingStatementKind,
    query: AccountingStatementQuery,
  ): Promise<AccountingStatementView> {
    const view = await this.draft(organizationId, kind, query);
    if (kind === 'cash-flow' && !view.available) {
      throw new ConflictException({
        code: 'STATEMENT_NOT_AVAILABLE',
        message:
          'Tableau des flux non disponible : sa méthode est une question posée à l’expert-comptable. Lalanda ne le devine pas.',
        details: {
          status: view.status,
          disclaimer: view.disclaimer,
          reserves: view.reserves,
        },
      });
    }
    return view;
  }
}
