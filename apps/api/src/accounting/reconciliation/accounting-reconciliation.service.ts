// Rapprochement avec le réalisé (ADR-0049 § 7 ; docs/08 § Règle cardinale). ADR-0049 — K6.
//
// AFFICHÉ, JAMAIS CORRIGÉ. Ce service LIT le réalisé (`actual_periods`), le rattachement
// commun des ponts RUN → BUILD (`run_actuals_bridges`), la correspondance des catégories
// de dépenses (`treasury_settings.bridge.mapping`) et le projet relié (`projects`) ; il
// n'écrit RIEN, ni dans ces collections, ni dans les livres. La comparaison et ses causes
// typées sont calculées par le moteur (`reconcileWithActuals`) ; ici, seulement la lecture
// et la mise en forme d'une valeur stockée (nombre → chaîne à deux décimales).
//
// Lectures seules, par le pilote : aucun modèle Mongoose n'est déclaré sur ces
// collections, qui appartiennent à `actuals/`, `treasury/` et `projects/`.

import { EXPENSE_CATEGORIES, reconcileWithActuals, type ActualValue } from '@lalanda/engine';
import type {
  AccountingReconciliationMetricView,
  AccountingReconciliationUnavailable,
  AccountingReconciliationView,
} from '@lalanda/shared/accounting';
import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, type Connection } from 'mongoose';

import { suspenseAccountsOf } from '../chart/suspense-account.js';
import { AccountingEntriesService } from '../entries/accounting-entries.service.js';
import { AccountingSettingsService } from '../settings/accounting-settings.service.js';
import { conflict } from '../accounting.common.js';

interface BridgeDoc {
  projectId?: string | null;
  exerciseStart?: string | null;
  enabled?: boolean;
  revenueLineId?: string | null;
}
interface TreasurySettingsDoc {
  bridge?: { enabled?: boolean; mapping?: Record<string, string | null> } | null;
}
interface ProjectDoc {
  _id: Types.ObjectId;
  name?: string;
  deviseAffichage?: string;
}
interface ActualPeriodDoc {
  values?: Record<string, number>;
  sources?: Record<string, { source?: string } | undefined>;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Mois civil décalé de `delta` mois. */
export function shiftCalendarMonth(month: string, delta: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + delta;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** Rang du mois civil `month` depuis `start` (0 = premier mois de l'exercice 1). */
export function monthIndexFrom(start: string, month: string): number {
  const a = Number(start.slice(0, 4)) * 12 + Number(start.slice(5, 7));
  const b = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
  return b - a;
}

function lastDayOf(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

/** Valeur du réalisé, recopiée (nombre stocké → chaîne à deux décimales) avec son origine. */
function actualOf(period: ActualPeriodDoc | null, lineId: string): ActualValue {
  const raw = period?.values?.[lineId];
  const src = period?.sources?.[lineId]?.source;
  const source: ActualValue['source'] =
    src === 'run.sales' || src === 'run.expenses' || src === 'manual'
      ? src
      : typeof raw === 'number'
        ? 'manual'
        : null;
  return {
    value: typeof raw === 'number' && Number.isFinite(raw) ? raw.toFixed(2) : null,
    source,
  };
}

const CATEGORY_LABELS = new Map<string, string>(EXPENSE_CATEGORIES.map((c) => [c.code, c.label]));

@Injectable()
export class AccountingReconciliationService {
  constructor(
    @Inject(AccountingSettingsService) private readonly settings: AccountingSettingsService,
    @Inject(forwardRef(() => AccountingEntriesService))
    private readonly entries: AccountingEntriesService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private unavailable(
    month: string,
    reason: AccountingReconciliationUnavailable,
    project: AccountingReconciliationView['project'] = null,
  ): AccountingReconciliationView {
    return {
      month,
      displayOnly: true,
      available: false,
      unavailableReason: reason,
      project,
      exercise: null,
      metrics: [],
      alertCount: 0,
      notes: [],
    };
  }

  async actuals(organizationId: string, month: string): Promise<AccountingReconciliationView> {
    const settings = await this.settings.ensure(organizationId);
    if (settings.mode === 'off') {
      conflict('ACCOUNTING_OFF', 'La comptabilité est éteinte : rien à rapprocher.');
    }
    const db = this.connection;
    const bridge = await db
      .collection<BridgeDoc>('run_actuals_bridges')
      .findOne({ organizationId });
    if (!bridge?.projectId || !bridge.exerciseStart) {
      return this.unavailable(month, 'NO_LINKED_PROJECT');
    }
    if (!Types.ObjectId.isValid(bridge.projectId))
      return this.unavailable(month, 'PROJECT_NOT_FOUND');
    const project = await db
      .collection<ProjectDoc>('projects')
      .findOne({ _id: new Types.ObjectId(bridge.projectId), organizationId });
    if (!project) return this.unavailable(month, 'PROJECT_NOT_FOUND');
    const currency = project.deviseAffichage ?? '';
    const projectView = { id: String(project._id), name: project.name ?? '', currency };
    if (currency !== 'CDF' && currency !== 'USD') {
      return this.unavailable(month, 'PROJECT_CURRENCY_NOT_SUPPORTED', projectView);
    }
    const index = monthIndexFrom(bridge.exerciseStart.slice(0, 7), month);
    if (index < 0 || index >= 60) {
      return this.unavailable(month, 'MONTH_OUTSIDE_EXERCISES', projectView);
    }
    const exercise = { year: Math.floor(index / 12) + 1, month: (index % 12) + 1 };
    const period = await db
      .collection<ActualPeriodDoc & { organizationId: string }>('actual_periods')
      .findOne({
        organizationId,
        projectId: projectView.id,
        year: exercise.year,
        month: exercise.month,
      });

    const notes: string[] = [];
    const revenue = bridge.revenueLineId ? actualOf(period, bridge.revenueLineId) : null;
    const treasury = await db
      .collection<TreasurySettingsDoc & { organizationId: string }>('treasury_settings')
      .findOne({ organizationId });
    const mapping = Object.entries(treasury?.bridge?.mapping ?? {}).filter(
      (e): e is [string, string] => typeof e[1] === 'string' && e[1] !== '',
    );
    const perLine = new Map<string, number>();
    for (const [, line] of mapping) perLine.set(line, (perLine.get(line) ?? 0) + 1);
    const shared = new Set(
      mapping.filter(([, line]) => (perLine.get(line) ?? 0) > 1).map(([c]) => c),
    );
    if (shared.size > 0) {
      notes.push(
        'Plusieurs catégories de dépenses alimentent une même ligne du plan : leur réalisé ne se sépare pas par catégorie, il est montré « non reporté ».',
      );
    }
    const expenses = mapping.map(([category, line]) => ({
      category,
      actual: shared.has(category) ? { value: null, source: null } : actualOf(period, line),
    }));
    if (settings.cutoverDate !== null && settings.cutoverDate.slice(0, 7) >= month) {
      notes.push(
        'Ce mois précède ou contient la date de bascule : les pièces antérieures ne sont pas comptabilisées, un écart peut en venir.',
      );
    }

    // Mois voisins compris : un décalage de période se voit des deux côtés.
    const from = `${shiftCalendarMonth(month, -1)}-01`;
    const to = lastDayOf(shiftCalendarMonth(month, 1));
    const { entries } = await this.entries.reportingEntries(organizationId, { from, to });
    const result = reconcileWithActuals({
      month,
      projectCurrency: currency,
      entries,
      suspenseAccountNumbers: suspenseAccountsOf(await this.settings.chartPackOf(settings)),
      revenue,
      expenses,
    });
    const metrics: AccountingReconciliationMetricView[] = result.metrics.map((m) => {
      const category = m.metric.startsWith('expense.') ? m.metric.slice('expense.'.length) : null;
      return {
        key: m.metric,
        label:
          category === null
            ? 'Chiffre d’affaires hors taxes'
            : `Dépenses — ${CATEGORY_LABELS.get(category) ?? category}`,
        currency: m.currency,
        comparable: m.comparable,
        reason: m.reason,
        actual: m.actual,
        actualSource: m.actualSource,
        accounting: m.accounting,
        difference: m.difference,
        causes: m.causes,
        otherCurrencies: m.otherCurrencies,
        alert: m.alert,
        sharedLine: category !== null && shared.has(category),
      };
    });
    return {
      month,
      displayOnly: true,
      available: true,
      unavailableReason: null,
      project: projectView,
      exercise,
      metrics,
      alertCount: result.alertCount,
      notes,
    };
  }
}
