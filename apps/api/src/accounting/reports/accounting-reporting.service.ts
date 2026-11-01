// Restitution : grand livre, balances, auxiliaires, réserves (ADR-0049 §§ 6.10, 6.11, 11).
// ADR-0049 — K6.
//
// L'API LIT et SERT ; le moteur (`@lalanda/engine`, lot K3) CALCULE : aucun solde, aucun
// total, aucune réserve n'est fabriqué ici. Les écritures viennent du point d'extension de
// K5 (`reportingEntries` : calculées à la volée en simulation, enregistrées en mode actif).
// Le plan (classes, natures, libellés) vient du pack K1 ; aucun numéro n'est écrit ici.
//
// Toute restitution porte le mode, le bandeau (« Projet — à valider par un
// expert-comptable », ou celui de la simulation) et ses réserves, jamais masquées.

import {
  computeAuxiliaryBalances,
  computeLedger,
  computeReserves,
  computeTrialBalance,
  PROJECT_BANNER,
  SIMULATION_BANNER,
  type Reserve,
  type ReportingAccountNature,
  type ReportingChart,
  type ReportingEntry,
  type TrialBalance,
} from '@lalanda/engine';
import type {
  AccountingAuxiliaryBalanceView,
  AccountingBookCurrency,
  AccountingLedgerView,
  AccountingPeriodCriteriaBody,
  AccountingReportEnvelope,
  AccountingReserveView,
  AccountingTrialBalanceView,
} from '@lalanda/shared/accounting';
import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { conflict } from '../accounting.common.js';
import {
  AccountingAccount,
  type AccountingAccountLean,
} from '../chart/accounting-account.schema.js';
import type { AccountingChartPackLean } from '../chart/chart-pack.schema.js';
import { AccountingEntriesService } from '../entries/accounting-entries.service.js';
import { AccountingEntryStore } from '../entries/accounting-entry-store.service.js';
import { CutoverOpeningService } from '../opening/cutover-opening.service.js';
import {
  AccountingFiscalYear,
  AccountingPeriod,
  type AccountingFiscalYearLean,
  type AccountingPeriodLean,
} from '../periods/accounting-period.schema.js';
import {
  AccountingRuleSet,
  type AccountingRuleSetLean,
} from '../rules/accounting-rule-set.schema.js';
import { AccountingSettingsService } from '../settings/accounting-settings.service.js';
import type { AccountingSettingsLean } from '../settings/accounting-settings.schema.js';
import { ACCOUNTING_SUSPENSE_ACCOUNT } from '../sync/accounting-sync.service.js';

/** Libellé du compte d'attente technique (simulation et pack non relu). */
export const SUSPENSE_ACCOUNT_LABEL =
  'Compte d’attente (technique, à désigner par l’expert-comptable)';

/** Tout ce que lit une restitution, une fois. */
export interface ReportingContext {
  organizationId: string;
  settings: AccountingSettingsLean;
  mode: 'simulation' | 'active';
  bookCurrency: AccountingBookCurrency;
  pack: AccountingChartPackLean | null;
  chart: ReportingChart;
  /** Écritures (tous statuts) datées au plus tard `to`. */
  entries: ReportingEntry[];
  openingJournalCodes: string[];
  journalLabels: Record<string, string>;
  /** Libellés du plan : comptes du pack, comptes propres et auxiliaires. */
  labels: Map<string, string>;
  /** Comptes auxiliaires → nature (client, fournisseur). */
  auxiliaryKinds: Map<string, 'customer' | 'supplier'>;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Mois civils (`AAAA-MM`) couverts par une période. */
export function monthsBetween(from: string, to: string): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push({ year: y, month: m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export const monthKey = (year: number, month: number): string => `${year}-${pad(month)}`;

/** Vue d'API d'une réserve du moteur (phrase et détails recopiés tels quels). */
export function reserveViews(reserves: readonly Reserve[]): AccountingReserveView[] {
  return reserves.map((r) => ({ code: r.code, message: r.message, details: { ...r.details } }));
}

@Injectable()
export class AccountingReportingService {
  constructor(
    @Inject(AccountingSettingsService) private readonly settingsService: AccountingSettingsService,
    @Inject(forwardRef(() => AccountingEntriesService))
    private readonly entriesService: AccountingEntriesService,
    @Inject(forwardRef(() => AccountingEntryStore)) private readonly store: AccountingEntryStore,
    @InjectModel(AccountingAccount.name) private readonly accounts: Model<AccountingAccountLean>,
    @InjectModel(AccountingPeriod.name) private readonly periods: Model<AccountingPeriodLean>,
    @InjectModel(AccountingFiscalYear.name)
    private readonly fiscalYears: Model<AccountingFiscalYearLean>,
    @InjectModel(AccountingRuleSet.name) private readonly ruleSets: Model<AccountingRuleSetLean>,
    @Inject(forwardRef(() => CutoverOpeningService))
    private readonly cutover: CutoverOpeningService,
  ) {}

  /**
   * Contexte d'une restitution jusqu'au jour `to` (inclus). `off` : rien n'est lu
   * (`409 ACCOUNTING_OFF`) ; monnaie de tenue absente : `409 ACCOUNTING_SETTINGS_INCOMPLETE`.
   *
   * Un exercice CLOS antérieur à `from` a reporté ses soldes de bilan par ses à-nouveaux
   * (journal d'à-nouveaux, premier jour de l'exercice suivant) : ses écritures sont alors
   * écartées, sans quoi l'ouverture compterait deux fois les soldes reportés. Rouvrir
   * l'exercice contre-passe ses à-nouveaux : ses écritures reviennent.
   */
  async context(organizationId: string, to: string, from?: string): Promise<ReportingContext> {
    const settings = await this.settingsService.ensure(organizationId);
    if (settings.mode === 'off') {
      conflict(
        'ACCOUNTING_OFF',
        'La comptabilité est éteinte : rien n’est lu, rien n’est calculé. Passez d’abord en simulation.',
      );
    }
    if (settings.bookCurrency === null || settings.cutoverDate === null) {
      conflict(
        'ACCOUNTING_SETTINGS_INCOMPLETE',
        'Choisissez la monnaie de tenue et la date de bascule avant de lire les livres.',
      );
    }
    const pack = await this.settingsService.chartPackOf(settings);
    const { entries: all } = await this.entriesService.reportingEntries(organizationId, { to });
    const closedBefore =
      from === undefined
        ? null
        : await this.fiscalYears
            .findOne({ organizationId, status: 'closed', end: { $lt: from } })
            .sort({ end: -1 })
            .lean<AccountingFiscalYearLean>()
            .exec();
    const entries = closedBefore === null ? all : all.filter((e) => e.date > closedBefore.end);
    const journals = await this.store.journalsOf(organizationId);
    const docs = await this.accounts
      .find({ organizationId })
      .lean<AccountingAccountLean[]>()
      .exec();

    const labels = new Map<string, string>();
    for (const a of pack?.content.accounts ?? []) labels.set(a.number, a.label);
    const auxiliaryKinds = new Map<string, 'customer' | 'supplier'>();
    for (const d of docs) {
      if (d.label) labels.set(d.number, d.label);
      if (d.auxiliary) auxiliaryKinds.set(d.number, d.auxiliary.kind);
    }
    labels.set(ACCOUNTING_SUSPENSE_ACCOUNT, SUSPENSE_ACCOUNT_LABEL);

    return {
      organizationId,
      settings,
      mode: settings.mode,
      bookCurrency: settings.bookCurrency,
      pack,
      chart: chartOf(pack),
      entries,
      openingJournalCodes: journals.filter((j) => j.kind === 'opening').map((j) => j.code),
      journalLabels: Object.fromEntries(journals.map((j) => [j.code, j.label])),
      labels,
      auxiliaryKinds,
    };
  }

  /** Réserves du moteur pour la période `[from, to]` (§ 6.10), dans l'ordre fixe. */
  async reserves(ctx: ReportingContext, from: string, to: string): Promise<Reserve[]> {
    const ruleSet = await this.ruleSets
      .findOne({ organizationId: ctx.organizationId, status: 'validated' })
      .sort({ version: -1 })
      .lean<AccountingRuleSetLean>()
      .exec();
    const pending = await this.entriesService.listPending(ctx.organizationId);
    const byReason = new Map<string, number>();
    for (const p of pending.items) byReason.set(p.reason, (byReason.get(p.reason) ?? 0) + 1);

    const months = monthsBetween(from, to);
    const docs = await this.periods
      .find({
        organizationId: ctx.organizationId,
        $or: months.map((m) => ({ year: m.year, month: m.month })),
      })
      .lean<AccountingPeriodLean[]>()
      .exec();
    const periods = months.map((m) => {
      const d = docs.find((p) => p.year === m.year && p.month === m.month);
      // Un mois hors de tout exercice n'est pas clos : il compte comme ouvert.
      return { month: monthKey(m.year, m.month), status: d?.status ?? ('open' as const) };
    });

    const inRange = ctx.entries.filter((e) => e.date >= from && e.date <= to);
    return computeReserves({
      mode: ctx.mode,
      chartPackStatus: ctx.pack?.status ?? 'draft',
      ruleSet: ruleSet
        ? {
            status: ruleSet.status,
            expertReviewDeclared: ruleSet.validation?.expertReview?.declared === true,
          }
        : null,
      // Le compte d'attente et l'attente de taux se lisent sur tout ce qui précède `to`.
      entries: ctx.entries,
      to,
      suspenseAccountNumbers: [ACCOUNTING_SUSPENSE_ACCOUNT],
      pendingSources: [...byReason.entries()].map(([reason, count]) => ({ reason, count })),
      // Reprise de l'existant (§ 3.2) : état lu du lot K7, jamais déduit ici.
      opening: await this.cutover.reserveInput(ctx.organizationId),
      periods,
      stockPosting: ctx.settings.stockPosting,
      depreciationPosting: 'off',
    }).reserves.filter(
      // « Mois ouverts » ne vaut que pour la période lue, pas pour l'historique.
      (r) =>
        r.code !== 'PERIODS_OPEN' || periods.some((p) => p.status === 'open') || hasDraft(inRange),
    );
  }

  envelope(
    ctx: ReportingContext,
    from: string,
    to: string,
    reserves: readonly Reserve[],
  ): AccountingReportEnvelope {
    return {
      mode: ctx.mode,
      simulation: ctx.mode === 'simulation',
      banner: ctx.mode === 'simulation' ? SIMULATION_BANNER : PROJECT_BANNER,
      bookCurrency: ctx.bookCurrency,
      from,
      to,
      reserves: reserveViews(reserves),
    };
  }

  /** Balance du moteur sur `[from, to]` (à-nouveaux = tout ce qui précède `from`). */
  trialBalanceOf(ctx: ReportingContext, from: string, to: string): TrialBalance {
    return computeTrialBalance({
      entries: ctx.entries,
      bookCurrency: ctx.bookCurrency,
      from,
      to,
      openingJournalCodes: ctx.openingJournalCodes,
      chart: ctx.chart,
    });
  }

  // ── Routes ───────────────────────────────────────────────────────────────

  async ledger(
    organizationId: string,
    body: AccountingPeriodCriteriaBody,
  ): Promise<AccountingLedgerView> {
    return this.ledgerFor(await this.context(organizationId, body.to, body.from), body);
  }

  async ledgerFor(
    ctx: ReportingContext,
    body: AccountingPeriodCriteriaBody,
  ): Promise<AccountingLedgerView> {
    const ledger = computeLedger({
      entries: ctx.entries,
      bookCurrency: ctx.bookCurrency,
      from: body.from,
      to: body.to,
      openingJournalCodes: ctx.openingJournalCodes,
      chart: ctx.chart,
      level: body.level ?? 'general',
      ...(body.accountNumber !== undefined ? { accountPrefixes: [body.accountNumber] } : {}),
    });
    const reserves = await this.reserves(ctx, body.from, body.to);
    return {
      ...this.envelope(ctx, body.from, body.to, reserves),
      level: ledger.level,
      excluded: ledger.excluded,
      accounts: ledger.accounts.map((a) => ({
        ...a,
        label: ctx.labels.get(a.accountNumber) ?? null,
      })),
    };
  }

  async trialBalance(
    organizationId: string,
    body: AccountingPeriodCriteriaBody,
  ): Promise<AccountingTrialBalanceView> {
    return this.trialBalanceFor(await this.context(organizationId, body.to, body.from), body);
  }

  async trialBalanceFor(
    ctx: ReportingContext,
    body: AccountingPeriodCriteriaBody,
  ): Promise<AccountingTrialBalanceView> {
    const tb = this.trialBalanceOf(ctx, body.from, body.to);
    const reserves = await this.reserves(ctx, body.from, body.to);
    return {
      ...this.envelope(ctx, body.from, body.to, reserves),
      rows: tb.rows.map((r) => ({ ...r, label: ctx.labels.get(r.accountNumber) ?? r.label })),
      classes: tb.classes,
      totals: tb.totals,
      balanced: tb.balanced,
      unbalancedEntries: tb.unbalancedEntries,
      excluded: tb.excluded,
    };
  }

  async auxiliaryBalance(
    organizationId: string,
    body: AccountingPeriodCriteriaBody,
  ): Promise<AccountingAuxiliaryBalanceView> {
    return this.auxiliaryBalanceFor(await this.context(organizationId, body.to, body.from), body);
  }

  async auxiliaryBalanceFor(
    ctx: ReportingContext,
    body: AccountingPeriodCriteriaBody,
  ): Promise<AccountingAuxiliaryBalanceView> {
    const aux = computeAuxiliaryBalances({
      entries: ctx.entries,
      bookCurrency: ctx.bookCurrency,
      from: body.from,
      to: body.to,
      openingJournalCodes: ctx.openingJournalCodes,
      chart: ctx.chart,
    });
    const kind = body.auxiliaryKind ?? null;
    const kindOf = (g: (typeof aux.groups)[number]): 'customer' | 'supplier' | null =>
      g.auxiliaryKind ??
      g.rows.map((r) => ctx.auxiliaryKinds.get(r.auxiliaryAccountNumber)).find((k) => k) ??
      null;
    const reserves = await this.reserves(ctx, body.from, body.to);
    return {
      ...this.envelope(ctx, body.from, body.to, reserves),
      auxiliaryKind: kind,
      groups: aux.groups
        .filter((g) => kind === null || kindOf(g) === kind)
        .map((g) => ({
          collectiveAccountNumber: g.collectiveAccountNumber,
          auxiliaryKind: kindOf(g),
          closingBalance: g.closingBalance,
          withoutAuxiliaryBalance: g.withoutAuxiliaryBalance,
          rows: g.rows.map((r) => ({
            auxiliaryAccountNumber: r.auxiliaryAccountNumber,
            collectiveAccountNumber: r.collectiveAccountNumber,
            label: ctx.labels.get(r.auxiliaryAccountNumber) ?? r.partyName,
            openingBalance: r.openingBalance,
            periodDebit: r.periodDebit,
            periodCredit: r.periodCredit,
            closingBalance: r.closingBalance,
            byCurrency: r.byCurrency,
            unletteredLineCount: r.unletteredLineCount,
          })),
        })),
      conflicts: aux.conflicts,
    };
  }
}

function hasDraft(entries: readonly ReportingEntry[]): boolean {
  return entries.some((e) => e.status === 'draft');
}

/**
 * Vue du plan pour le moteur de restitution : classes et comptes du pack. Une nature que
 * le pack ne fournit pas encore (`null`, à fournir par l'expert) est transmise telle
 * quelle : le moteur traite alors le compte comme « non classé », reporté et signalé.
 */
export function chartOf(pack: AccountingChartPackLean | null): ReportingChart {
  return {
    classes: (pack?.content.classes ?? []).map((c) => ({
      number: c.number,
      label: c.label,
      confirmation: c.confirmation,
    })),
    accounts: (pack?.content.accounts ?? []).map((a) => ({
      number: a.number,
      label: a.label,
      classNumber: a.classNumber,
      nature: a.nature as ReportingAccountNature,
      confirmation: a.confirmation,
      collective: a.collective,
      auxiliaryKind: a.auxiliaryKind,
    })),
  };
}
