// Réglages, report vers le réalisé, rapprochement et prévision — ADR-0034 § 5 à § 7.
//
// Ce service ne CALCULE rien : il charge les données, les remet au moteur
// (`planExpenseActuals`, `reconcileExpenses`, `forecastTreasury`) et, pour le
// report, compare le plan du moteur à ce que porte `actual_periods` pour
// n'écrire que les différences. Le plan validé n'est JAMAIS écrit (ADR-0018).

import { createHash } from 'node:crypto';

import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  DEFAULT_SCENARIO_HYPOTHESES,
  EXPENSE_CATEGORIES,
  expenseCategoryNature,
  forecastTreasury,
  planExpenseActuals,
  reconcileExpenses,
  TREASURY_VERSION,
  treasuryAddDays,
  type CategoryMapping,
  type ExpenseActualsPlan,
  type ExpenseCategory,
  type ExpenseInput,
  type ExpenseReconciliation,
  type ForecastFinding,
  type ForecastPlanLine,
  type ForecastScenarioId,
  type ScenarioHypotheses,
  type TreasuryCurrency,
  type TreasuryForecast,
} from '@lalanda/engine';
import type { Model, Types } from 'mongoose';

import {
  ActualPeriod,
  type ActualPeriodDocument,
  type ActualValueSource,
} from '../actuals/actual-period.schema.js';
import {
  inferSens,
  parseSoldeFormula,
  referenceLines,
  resolveAnnualBase,
} from '../actuals/variance.js';
import { RunLinkService } from '../actuals/run-link/run-link.service.js';
import { AuditService } from '../authz/audit.service.js';
import type { FinancialPlanDocument } from '../plans/plan.schema.js';
import { PlansService } from '../plans/plans.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { staleRevision } from '../sales/sales.errors.js';
import { TreasuryAccountsService } from './treasury-accounts.service.js';
import { TreasuryRecurringService } from './treasury-recurring.service.js';
import { TreasuryReceivablesReader } from './treasury-sources.js';
import { conflict, rejected, todayKinshasa, type TreasuryActor } from './treasury.common.js';
import type { PutBridgeInput, PutSettingsInput } from './treasury.dto.js';
import {
  TreasuryExpense,
  TreasurySettings,
  type EffectiveTreasuryBridge,
  type TreasuryBridgeConfig,
  type TreasuryExpenseDocument,
  type TreasurySettingsDocument,
} from './treasury.schemas.js';

type SettingsLean = TreasurySettings & { _id: Types.ObjectId };

export interface SettingsView {
  revision: number;
  minimumBalances: { CDF: string | null; USD: string | null };
  scenarios: Record<ForecastScenarioId, ScenarioHypotheses>;
  /** `true` quand les hypothèses sont les valeurs par défaut proposées (ADR-0034, d.o. n° 4). */
  defaultScenarios: boolean;
}

/** Ligne du plan à laquelle une catégorie peut être rattachée. */
export interface MappableLine {
  lineId: string;
  label: string;
}

export interface BridgeView {
  status: 'not_configured' | 'disabled' | 'enabled';
  enabled: boolean;
  projectId: string | null;
  projectName: string | null;
  projectCurrency: string | null;
  firstMonth: string | null;
  mapping: CategoryMapping;
  planVersion: number | null;
  /** Lignes de charge du plan validé courant (ni produit, ni solde). */
  mappableLines: MappableLine[];
  categories: { code: ExpenseCategory; label: string; nature: string; mappable: boolean }[];
}

export type SyncStatus =
  | 'written'
  | 'unchanged'
  | 'removed'
  | 'PERIOD_CLOSED'
  | 'MANUAL_VALUE_PRESENT'
  | 'OTHER_SOURCE_PRESENT'
  | 'UNKNOWN_LINE';

export interface SyncResult {
  year: number;
  month: number;
  calendarMonth: string | null;
  lineId: string;
  /** Valeur issue des dépenses (`null` pour un retrait). */
  amount: string | null;
  /** Valeur portée par le réalisé avant la synchronisation. */
  stored: number | null;
  status: SyncStatus;
}

export interface SyncReport {
  dryRun: boolean;
  projectId: string;
  planVersion: number;
  version: string;
  results: SyncResult[];
  skipped: ExpenseActualsPlan['skipped'];
  unmapped: ExpenseActualsPlan['unmapped'];
  counts: Record<SyncStatus, number>;
}

export interface ReconciliationView extends ExpenseReconciliation {
  projectId: string;
  projectName: string;
  projectCurrency: string;
  planVersion: number;
  bridgeEnabled: boolean;
  firstMonth: string;
  /** Mois civils de l'exercice demandé. */
  calendarMonths: string[];
  skipped: ExpenseActualsPlan['skipped'];
  unmapped: ExpenseActualsPlan['unmapped'];
}

const CATEGORY_LABELS = new Map<string, string>(EXPENSE_CATEGORIES.map((c) => [c.code, c.label]));

function fingerprintOf(lineId: string, amount: string, documents: string[]): string {
  return createHash('sha256')
    .update(JSON.stringify({ lineId, amount, documents, version: TREASURY_VERSION }))
    .digest('hex');
}

/** Mois civil `AAAA-MM` décalé de `offset` mois. */
function shiftMonth(month: string, offset: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

@Injectable()
export class TreasuryPlanningService {
  constructor(
    @InjectModel(TreasurySettings.name) private readonly settings: Model<TreasurySettingsDocument>,
    @InjectModel(TreasuryExpense.name) private readonly expenses: Model<TreasuryExpenseDocument>,
    @InjectModel(ActualPeriod.name) private readonly periods: Model<ActualPeriodDocument>,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(PlansService) private readonly plans: PlansService,
    @Inject(TreasuryAccountsService) private readonly accounts: TreasuryAccountsService,
    @Inject(TreasuryRecurringService) private readonly recurring: TreasuryRecurringService,
    @Inject(TreasuryReceivablesReader) private readonly sources: TreasuryReceivablesReader,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RunLinkService) private readonly runLink: RunLinkService,
  ) {}

  /**
   * Report des dépenses effectif : interrupteur et correspondance propres, projet
   * et début d'exercice lus dans le rattachement COMMUN aux deux ponts (ADR-0034,
   * amendement du 26 oct. 2026).
   */
  private async effectiveBridge(
    organizationId: string,
    settings?: SettingsLean | null,
  ): Promise<EffectiveTreasuryBridge | null> {
    const doc = settings === undefined ? await this.settingsOf(organizationId) : settings;
    const link = await this.runLink.state(organizationId);
    const own = doc?.bridge ?? null;
    if (own === null && link.projectId === null && link.exerciseStart === null) return null;
    return {
      enabled: own?.enabled ?? false,
      projectId: link.projectId,
      firstMonth: link.exerciseStart,
      mapping: own?.mapping ?? {},
    };
  }

  // ─── Réglages ──────────────────────────────────────────────────────────────

  private async settingsOf(organizationId: string): Promise<SettingsLean | null> {
    return this.settings.findOne({ organizationId }).lean<SettingsLean>().exec();
  }

  async getSettings(organizationId: string): Promise<SettingsView> {
    const doc = await this.settingsOf(organizationId);
    return {
      revision: doc?.revision ?? 0,
      minimumBalances: {
        CDF: doc?.minimumBalances?.CDF ?? null,
        USD: doc?.minimumBalances?.USD ?? null,
      },
      scenarios: doc?.scenarios ?? { ...DEFAULT_SCENARIO_HYPOTHESES },
      defaultScenarios: !doc?.scenarios,
    };
  }

  async putSettings(
    organizationId: string,
    input: PutSettingsInput,
    actor: TreasuryActor,
  ): Promise<SettingsView> {
    const current = await this.settingsOf(organizationId);
    const revision = current?.revision ?? 0;
    if (revision !== input.expectedRevision) staleRevision(revision);
    const minimumBalances: Partial<Record<TreasuryCurrency, string>> = {};
    if (input.minimumBalances.CDF !== null) minimumBalances.CDF = input.minimumBalances.CDF;
    if (input.minimumBalances.USD !== null) minimumBalances.USD = input.minimumBalances.USD;
    await this.writeSettings(organizationId, revision, {
      minimumBalances,
      scenarios: input.scenarios,
    });
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'treasury.settings.updated',
      targetType: 'treasury_settings',
      targetId: organizationId,
      metadata: { defaultScenarios: input.scenarios === null },
    });
    return this.getSettings(organizationId);
  }

  /** Écriture conditionnée par la révision (création à la première écriture). */
  private async writeSettings(
    organizationId: string,
    expectedRevision: number,
    set: Partial<Pick<TreasurySettings, 'minimumBalances' | 'scenarios' | 'bridge'>>,
  ): Promise<void> {
    if (expectedRevision === 0) {
      try {
        await this.settings.create({
          organizationId,
          minimumBalances: {},
          scenarios: null,
          bridge: null,
          ...set,
          revision: 1,
          _schemaVersion: 1,
        });
        return;
      } catch (err) {
        if ((err as { code?: number }).code === 11000) {
          staleRevision((await this.settingsOf(organizationId))?.revision ?? 0);
        }
        throw err;
      }
    }
    const res = await this.settings
      .updateOne(
        { organizationId, revision: expectedRevision },
        { $set: set, $inc: { revision: 1 } },
      )
      .exec();
    if (res.matchedCount === 0)
      staleRevision((await this.settingsOf(organizationId))?.revision ?? 0);
  }

  // ─── Pont : configuration ──────────────────────────────────────────────────

  async getBridge(organizationId: string): Promise<BridgeView & { revision: number }> {
    const doc = await this.settingsOf(organizationId);
    const bridge = await this.effectiveBridge(organizationId, doc);
    let projectName: string | null = null;
    let projectCurrency: string | null = null;
    let planVersion: number | null = null;
    let mappableLines: MappableLine[] = [];
    if (bridge?.projectId) {
      const project = await this.projects
        .findScoped(bridge.projectId, organizationId)
        .catch(() => null);
      if (project) {
        projectName = project.name;
        projectCurrency = project.deviseAffichage;
        const plan = await this.plans.findLatestApproved(organizationId, bridge.projectId);
        if (plan) {
          planVersion = plan.version;
          mappableLines = chargeLines(plan);
        }
      }
    }
    return {
      revision: doc?.revision ?? 0,
      status:
        bridge === null || bridge.projectId === null || bridge.firstMonth === null
          ? 'not_configured'
          : bridge.enabled
            ? 'enabled'
            : 'disabled',
      enabled: bridge?.enabled ?? false,
      projectId: bridge?.projectId ?? null,
      projectName,
      projectCurrency,
      firstMonth: bridge?.firstMonth ?? null,
      mapping: bridge?.mapping ?? {},
      planVersion,
      mappableLines,
      categories: EXPENSE_CATEGORIES.map((c) => ({
        code: c.code,
        label: c.label,
        nature: c.nature,
        mappable: c.nature === 'exploitation',
      })),
    };
  }

  /** Lignes de correspondance choisies par l'utilisateur ; le logiciel n'en devine aucune. */
  async putBridge(
    organizationId: string,
    input: PutBridgeInput,
    actor: TreasuryActor,
  ): Promise<BridgeView> {
    const current = await this.settingsOf(organizationId);
    const mapping = input.mapping as CategoryMapping;
    for (const category of Object.keys(mapping) as ExpenseCategory[]) {
      if (expenseCategoryNature(category) !== 'exploitation') {
        rejected(
          'CATEGORY_NOT_OPERATING',
          `« ${CATEGORY_LABELS.get(category) ?? category} » n'est pas une charge d'exploitation : elle ne se rattache à aucune ligne du compte d'exploitation.`,
        );
      }
    }
    if (input.projectId !== null) {
      await this.projects.findScoped(input.projectId, organizationId);
      if (Object.keys(mapping).length > 0 || input.enabled) {
        const plan = await this.requireApprovedPlan(organizationId, input.projectId);
        const charges = new Set(chargeLines(plan).map((l) => l.lineId));
        const all = new Set(referenceLines(plan.result.lines).map((l) => l.lineId));
        for (const lineId of Object.values(mapping)) {
          if (lineId === undefined) continue;
          if (!all.has(lineId)) {
            rejected(
              'UNKNOWN_LINE',
              `La ligne "${lineId}" n'appartient pas au compte d'exploitation du plan validé.`,
            );
          }
          if (!charges.has(lineId)) {
            rejected(
              'LINE_NOT_A_CHARGE',
              `La ligne "${lineId}" n'est pas une charge (produit ou solde) : une dépense ne s'y rattache pas.`,
            );
          }
        }
      }
    } else if (Object.keys(mapping).length > 0) {
      rejected('BRIDGE_INCOMPLETE', 'Choisissez d’abord l’initiative reliée.');
    }
    // Une ligne n'est alimentée que par un seul pont : celle du chiffre d'affaires
    // des ventes n'entre pas dans la correspondance des dépenses.
    const link = await this.runLink.state(organizationId);
    const salesLine = link.salesEnabled ? link.salesRevenueLineId : null;
    if (salesLine !== null && Object.values(mapping).includes(salesLine)) {
      conflict(
        'LINE_FED_BY_OTHER_BRIDGE',
        `La ligne "${salesLine}" est déjà alimentée par les ventes : une dépense ne s'y rattache pas.`,
      );
    }
    // Rattachement commun (projet, début d'exercice) : refusé s'il change sous le
    // pont des ventes actif (`RUN_LINK_IN_USE`).
    await this.runLink.setFromExpenses(
      organizationId,
      { projectId: input.projectId, exerciseStart: input.firstMonth },
      actor.userId,
    );
    const bridge: TreasuryBridgeConfig = {
      enabled: input.enabled,
      mapping,
      updatedAt: new Date(),
      updatedBy: actor.userId,
    };
    await this.writeSettings(organizationId, current?.revision ?? 0, { bridge });
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'treasury.bridge.updated',
      targetType: 'treasury_settings',
      targetId: organizationId,
      metadata: {
        enabled: input.enabled,
        projectId: input.projectId,
        firstMonth: input.firstMonth,
        mappedCategories: Object.keys(mapping).length,
      },
    });
    return this.getBridge(organizationId);
  }

  // ─── Pont : synchronisation ────────────────────────────────────────────────

  async sync(organizationId: string, dryRun: boolean, actor: TreasuryActor): Promise<SyncReport> {
    const ctx = await this.bridgeContext(organizationId);
    if (!ctx.bridge.enabled) {
      conflict('BRIDGE_DISABLED', 'Le report des dépenses vers le réalisé est désactivé.');
    }
    const { plan, project, actualsPlan } = ctx;
    const allowed = new Set(referenceLines(plan.result.lines).map((l) => l.lineId));
    const projectId = String(project._id);
    const docs = await this.periods.find({ organizationId, projectId }).exec();
    const byKey = new Map(docs.map((d) => [`${d.year}|${d.month}`, d]));
    const results: SyncResult[] = [];
    const now = new Date();
    const writes: (() => Promise<void>)[] = [];

    const covered = new Set<string>();
    for (const cell of actualsPlan.cells) {
      covered.add(`${cell.year}|${cell.month}|${cell.lineId}`);
      const doc = byKey.get(`${cell.year}|${cell.month}`);
      const stored = doc?.values[cell.lineId];
      const source = doc?.sources?.[cell.lineId];
      const fingerprint = fingerprintOf(cell.lineId, cell.amount, cell.documents);
      const base = {
        year: cell.year,
        month: cell.month,
        calendarMonth: cell.calendarMonth,
        lineId: cell.lineId,
        amount: cell.amount,
        stored: stored ?? null,
      };
      const value = Number(cell.amount);
      if (!allowed.has(cell.lineId)) {
        results.push({ ...base, status: 'UNKNOWN_LINE' });
        continue;
      }
      if (stored !== undefined && source?.source !== 'run.expenses') {
        results.push({
          ...base,
          status: source?.source === 'run.sales' ? 'OTHER_SOURCE_PRESENT' : 'MANUAL_VALUE_PRESENT',
        });
        continue;
      }
      if (
        stored === value &&
        source?.source === 'run.expenses' &&
        source.fingerprint === fingerprint
      ) {
        results.push({ ...base, status: 'unchanged' });
        continue;
      }
      if (doc?.status === 'closed') {
        results.push({ ...base, status: 'PERIOD_CLOSED' });
        continue;
      }
      results.push({ ...base, status: 'written' });
      const label: ActualValueSource = {
        source: 'run.expenses',
        at: now,
        by: actor.userId,
        version: TREASURY_VERSION,
        calendarMonth: cell.calendarMonth,
        documents: cell.documents.length,
        fingerprint,
      };
      writes.push(() =>
        this.writeCell(organizationId, projectId, cell.year, cell.month, cell.lineId, value, label),
      );
    }

    // Valeurs issues des dépenses devenues sans objet : retirées des périodes ouvertes.
    for (const doc of docs) {
      for (const [lineId, source] of Object.entries(doc.sources ?? {})) {
        if (source.source !== 'run.expenses') continue;
        if (covered.has(`${doc.year}|${doc.month}|${lineId}`)) continue;
        if (doc.values[lineId] === undefined) continue;
        const base = {
          year: doc.year,
          month: doc.month,
          calendarMonth: null,
          lineId,
          amount: null,
          stored: doc.values[lineId] ?? null,
        };
        if (doc.status === 'closed') {
          results.push({ ...base, status: 'PERIOD_CLOSED' });
          continue;
        }
        results.push({ ...base, status: 'removed' });
        writes.push(() => this.removeCell(doc._id as Types.ObjectId, lineId));
      }
    }

    if (!dryRun) {
      for (const write of writes) await write();
      if (writes.length > 0) {
        await this.audit.record({
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'treasury.actuals.synced',
          targetType: 'project',
          targetId: projectId,
          metadata: {
            written: results.filter((r) => r.status === 'written').length,
            removed: results.filter((r) => r.status === 'removed').length,
            planVersion: plan.version,
          },
        });
      }
    }

    results.sort(
      (a, b) => a.year - b.year || a.month - b.month || a.lineId.localeCompare(b.lineId),
    );
    const counts = {
      written: 0,
      unchanged: 0,
      removed: 0,
      PERIOD_CLOSED: 0,
      MANUAL_VALUE_PRESENT: 0,
      OTHER_SOURCE_PRESENT: 0,
      UNKNOWN_LINE: 0,
    } satisfies Record<SyncStatus, number>;
    for (const r of results) counts[r.status] += 1;
    return {
      dryRun,
      projectId,
      planVersion: plan.version,
      version: TREASURY_VERSION,
      results,
      skipped: actualsPlan.skipped,
      unmapped: actualsPlan.unmapped,
      counts,
    };
  }

  private async writeCell(
    organizationId: string,
    projectId: string,
    year: number,
    month: number,
    lineId: string,
    value: number,
    label: ActualValueSource,
  ): Promise<void> {
    try {
      await this.periods
        .updateOne(
          { organizationId, projectId, year, month, status: 'open' },
          {
            $set: { [`values.${lineId}`]: value, [`sources.${lineId}`]: label },
            $setOnInsert: { reopenedLog: [], _schemaVersion: 1 },
          },
          { upsert: true },
        )
        .exec();
    } catch (err) {
      // La période a été clôturée entre la lecture et l'écriture : l'upsert bute
      // sur l'index unique. Elle reste intacte ; rejouer la synchronisation le dira.
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException({
          code: 'PERIOD_CONFLICT',
          message: 'Une période a changé pendant la synchronisation — relancez-la.',
        });
      }
      throw err;
    }
  }

  private async removeCell(periodId: Types.ObjectId, lineId: string): Promise<void> {
    await this.periods
      .updateOne(
        { _id: periodId, status: 'open', [`sources.${lineId}.source`]: 'run.expenses' },
        { $unset: { [`values.${lineId}`]: '', [`sources.${lineId}`]: '' } },
      )
      .exec();
  }

  // ─── Rapprochement ─────────────────────────────────────────────────────────

  async reconciliation(organizationId: string, year: number): Promise<ReconciliationView> {
    const ctx = await this.bridgeContext(organizationId);
    const { plan, project, bridge, actualsPlan, expenses } = ctx;
    const planLines = plan.result.lines;
    const labels = new Map(planLines.map((l) => [l.lineId, l.label]));
    // Lignes visées, dans l'ordre du compte d'exploitation.
    const targets = new Set(Object.values(bridge.mapping));
    const lines = referenceLines(planLines)
      .filter((l) => targets.has(l.lineId))
      .map((l) => {
        const base = resolveAnnualBase(planLines, l.lineId, year);
        return {
          lineId: l.lineId,
          label: labels.get(l.lineId) ?? l.lineId,
          prevuMensuel: base === null ? null : base.planAnnuel / 12,
        };
      });
    const docs = await this.periods
      .find({ organizationId, projectId: String(project._id), year })
      .lean<ActualPeriod[]>()
      .exec();
    const result = reconcileExpenses({
      year,
      lines,
      plan: actualsPlan,
      expenses,
      periods: docs.map((d) => ({
        month: d.month,
        status: d.status,
        values: d.values,
        sources: d.sources ?? {},
      })),
    });
    const firstMonth = bridge.firstMonth as string;
    const calendarMonths = Array.from({ length: 12 }, (_, i) =>
      shiftMonth(firstMonth, (year - 1) * 12 + i),
    );
    const inYear = new Set(calendarMonths);
    return {
      ...result,
      projectId: String(project._id),
      projectName: project.name,
      projectCurrency: project.deviseAffichage,
      planVersion: plan.version,
      bridgeEnabled: bridge.enabled,
      firstMonth,
      calendarMonths,
      skipped: actualsPlan.skipped.filter((s) => inYear.has(s.calendarMonth)),
      unmapped: actualsPlan.unmapped.filter((u) => inYear.has(u.calendarMonth)),
    };
  }

  /** Projet, plan validé et dépenses du pont configuré — 409 sinon. */
  private async bridgeContext(organizationId: string) {
    const bridge = await this.effectiveBridge(organizationId);
    if (bridge === null || bridge.projectId === null || bridge.firstMonth === null) {
      conflict(
        'BRIDGE_NOT_CONFIGURED',
        'Reliez d’abord une initiative validée (initiative, mois d’ouverture de l’exercice 1, correspondance des catégories).',
      );
    }
    const project = await this.projects.findScoped(bridge.projectId, organizationId);
    const plan = await this.requireApprovedPlan(organizationId, bridge.projectId);
    const expenses = await this.recordedExpenses(organizationId);
    const actualsPlan = planExpenseActuals({
      expenses,
      mapping: bridge.mapping,
      projectCurrency: project.deviseAffichage,
      firstMonth: bridge.firstMonth,
    });
    return {
      bridge: bridge as EffectiveTreasuryBridge & { projectId: string; firstMonth: string },
      project,
      plan,
      expenses,
      actualsPlan,
    };
  }

  private async recordedExpenses(organizationId: string): Promise<ExpenseInput[]> {
    const docs = await this.expenses
      .find(
        { organizationId, status: 'recorded' },
        { spentOn: 1, amount: 1, currency: 1, category: 1, label: 1 },
      )
      .lean<(TreasuryExpense & { _id: Types.ObjectId })[]>()
      .exec();
    return docs.map((d) => ({
      id: String(d._id),
      spentOn: d.spentOn,
      amount: d.amount,
      currency: d.currency,
      category: d.category,
      label: d.label,
    }));
  }

  private async requireApprovedPlan(
    organizationId: string,
    projectId: string,
  ): Promise<FinancialPlanDocument> {
    const plan = await this.plans.findLatestApproved(organizationId, projectId);
    if (!plan) {
      conflict(
        'NO_APPROVED_PLAN',
        'Aucun plan validé sur cette initiative : validez un plan avant de le relier.',
      );
    }
    return plan;
  }

  // ─── Prévision ─────────────────────────────────────────────────────────────

  async forecast(organizationId: string, currency: TreasuryCurrency): Promise<TreasuryForecast> {
    const asOf = todayKinshasa();
    const [ledger, receivables, rules, confirmed, settings] = await Promise.all([
      this.accounts.ledger(organizationId),
      this.sources.openReceivables(organizationId),
      this.recurring.engineRules(organizationId),
      this.recurring.confirmedOccurrences(organizationId),
      this.settingsOf(organizationId),
    ]);

    const external: ForecastFinding[] = [];
    if (!this.sources.receiptsIntegrated()) {
      external.push({
        code: 'RECEIPTS_NOT_INTEGRATED',
        count: 1,
        detail:
          'Les encaissements (ADR-0031) ne sont pas encore reliés : le reste à encaisser est la part à crédit déclarée à l’émission.',
      });
    }
    const withoutAccount = await this.expenses
      .countDocuments({
        organizationId,
        status: 'recorded',
        currency,
        accountId: null,
        spentOn: { $gte: treasuryAddDays(asOf, -90) },
      })
      .exec();
    if (withoutAccount > 0) {
      external.push({
        code: 'EXPENSES_WITHOUT_ACCOUNT',
        count: withoutAccount,
        detail: 'Dépenses des 90 derniers jours sans compte : absentes des soldes.',
      });
    }
    // ADR-0034 § 4 (amendement du 26 oct. 2026) : un encaissement sans compte
    // reste hors des soldes, comme une dépense sans compte.
    if (this.sources.receiptsIntegrated()) {
      const since = treasuryAddDays(asOf, -90);
      const receiptsWithoutAccount = ledger.unassignedReceipts.filter(
        (r) => r.currency === currency && r.receivedOn >= since,
      ).length;
      if (receiptsWithoutAccount > 0) {
        external.push({
          code: 'RECEIPTS_WITHOUT_ACCOUNT',
          count: receiptsWithoutAccount,
          detail: 'Encaissements des 90 derniers jours sans compte : absents des soldes.',
        });
      }
    }

    const plan = await this.forecastPlan(
      organizationId,
      currency,
      await this.effectiveBridge(organizationId, settings),
      external,
    );
    return forecastTreasury({
      asOf,
      currency,
      accounts: ledger.accounts,
      movements: ledger.movements,
      receivables,
      recurring: rules,
      confirmedOccurrences: confirmed,
      plan,
      scenarios: settings?.scenarios ?? { ...DEFAULT_SCENARIO_HYPOTHESES },
      minimumBalance: settings?.minimumBalances?.[currency] ?? null,
      externalFindings: external,
    });
  }

  /** Lignes du plan pour la prévision, ou `null` avec la raison dans les constats. */
  private async forecastPlan(
    organizationId: string,
    currency: TreasuryCurrency,
    bridge: EffectiveTreasuryBridge | null,
    findings: ForecastFinding[],
  ): Promise<{ lines: ForecastPlanLine[]; mapping: CategoryMapping } | null> {
    const notUsed = (detail: string): null => {
      findings.push({ code: 'PLAN_NOT_USED', count: 1, detail });
      return null;
    };
    if (bridge === null || bridge.projectId === null) {
      return notUsed('Aucune initiative reliée : aucune vente future non facturée n’est prévue.');
    }
    const project = await this.projects
      .findScoped(bridge.projectId, organizationId)
      .catch(() => null);
    if (!project) return notUsed('L’initiative reliée est introuvable.');
    if (project.deviseAffichage !== currency) {
      return notUsed(
        `L’initiative reliée est tenue en ${project.deviseAffichage} : aucune conversion n’est faite.`,
      );
    }
    const plan = await this.plans.findLatestApproved(organizationId, bridge.projectId);
    if (!plan) return notUsed('L’initiative reliée n’a pas de plan validé.');
    const refs = referenceLines(plan.result.lines);
    const refIds = new Set(refs.map((l) => l.lineId));
    // Entrées : les seules lignes de PRODUIT (chiffre d'affaires, ventes…). Les
    // soldes (marge, résultat, excédent…) sont exclus même quand leur formule
    // mêle un driver : les compter ajouterait le résultat au chiffre d'affaires.
    const lines: ForecastPlanLine[] = [];
    for (const l of refs) {
      if (parseSoldeFormula(l.formulaSource, l.lineId, refIds) !== null) continue;
      if (REVENUE_LINE.test(l.lineId)) {
        lines.push({ lineId: l.lineId, label: l.label, direction: 'in', monthlyAmount: l.value });
      } else if (inferSens(l.lineId) === 'charge') {
        lines.push({ lineId: l.lineId, label: l.label, direction: 'out', monthlyAmount: l.value });
      }
    }
    return { lines, mapping: bridge.mapping };
  }
}

/** Lignes de chiffre d'affaires (préfixes de produit de docs/08, soldes exclus). */
const REVENUE_LINE = /^(ca|chiffre|ventes?|produits?|recettes?|encaissements?|subventions?)(_|$)/;

/** Lignes de CHARGE du compte d'exploitation du plan (ni produit, ni solde). */
function chargeLines(plan: FinancialPlanDocument): MappableLine[] {
  const refs = referenceLines(plan.result.lines);
  const refIds = new Set(refs.map((l) => l.lineId));
  return refs
    .filter(
      (l) =>
        inferSens(l.lineId) === 'charge' &&
        parseSoldeFormula(l.formulaSource, l.lineId, refIds) === null,
    )
    .map((l) => ({ lineId: l.lineId, label: l.label }));
}
