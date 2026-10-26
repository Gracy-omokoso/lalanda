// Pont RUN → BUILD : chiffre d'affaires des ventes vers le réalisé du projet
// (ADR-0031 § 3).
//
// Le moteur (`planRunActuals`) décide QUOI écrire : montants, mois d'exercice,
// mois non reportés. Ce service ne fait que lire les sources, comparer à ce que
// porte `actual_periods` et écrire, sans jamais :
//   - toucher un plan (ADR-0018) ;
//   - modifier une période clôturée (docs/08) ;
//   - écraser une saisie manuelle ;
//   - inventer un taux de change ou un zéro.
// Rejouer la synchronisation ne réécrit rien (empreinte identique).

import { createHash } from 'node:crypto';

import {
  planRunActuals,
  RECEIVABLES_VERSION,
  signedAmountToJsonNumber,
  type RevenueDocumentInput,
  type RevenueDocumentKind,
  type RunActualsSkipped,
} from '@lalanda/engine';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { PlansService } from '../../plans/plans.service.js';
import { ProjectsService } from '../../projects/projects.service.js';
import { SalesInvoice, type SalesInvoiceDocument } from '../../sales/invoices/invoice.schema.js';
import type { InvoiceLean } from '../../sales/invoices/invoice.types.js';
import { kinshasaDayOf } from '../../sales/receipts/kinshasa-day.js';
import {
  ActualPeriod,
  type ActualPeriodDocument,
  type ActualValueSource,
  isRunActualSource,
} from '../actual-period.schema.js';
import { referenceLines, type PlanLineInput } from '../variance.js';
import {
  RunActualsBridge,
  type RunActualsBridgeDocument,
  type RunSyncSummary,
} from './run-actuals-bridge.schema.js';

export type BridgeState = 'disabled' | 'not_configured' | 'active';

export interface BridgeView {
  state: BridgeState;
  enabled: boolean;
  projectId: string | null;
  projectName: string | null;
  projectCurrency: string | null;
  revenueLineId: string | null;
  exerciseStart: string | null;
  lastSync: (Omit<RunSyncSummary, 'at'> & { at: string }) | null;
}

export interface BridgeCandidate {
  projectId: string;
  name: string;
  currency: string;
  approvedPlanVersion: number | null;
  /** Lignes monétaires du compte d'exploitation du plan validé (docs/08, convention 4). */
  lines: { lineId: string; label: string }[];
}

export interface BridgeSettingsInput {
  enabled: boolean;
  projectId: string | null;
  revenueLineId: string | null;
  exerciseStart: string | null;
}

export type SyncOutcome =
  | 'written'
  | 'unchanged'
  | 'removed'
  | 'PERIOD_CLOSED'
  | 'MANUAL_VALUE_PRESENT'
  /** Ligne déjà alimentée par un autre pont RUN (dépenses, ADR-0034) : jamais écrasée. */
  | 'OTHER_SOURCE_PRESENT';

export interface SyncEntry {
  calendarMonth: string | null;
  year: number;
  month: number;
  lineId: string;
  /** Valeur des ventes (chaîne signée du moteur), `null` pour un retrait. */
  value: string | null;
  storedValue: number | null;
  outcome: SyncOutcome;
  documents: number;
}

export interface SyncReport {
  dryRun: boolean;
  at: string;
  version: string;
  projectId: string;
  projectCurrency: string;
  revenueLineId: string;
  exerciseStart: string;
  entries: SyncEntry[];
  skipped: RunActualsSkipped[];
  excludedDepositIds: string[];
  counts: { written: number; unchanged: number; removed: number; blocked: number; skipped: number };
}

const KIND_OF_TYPE: Readonly<Record<string, RevenueDocumentKind>> = {
  FV: 'invoice',
  EV: 'invoice',
  FA: 'credit_note',
  EA: 'credit_note',
  FT: 'deposit',
  ET: 'deposit',
};

function fingerprintOf(parts: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

@Injectable()
export class RunBridgeService {
  constructor(
    @InjectModel(RunActualsBridge.name) private readonly bridges: Model<RunActualsBridgeDocument>,
    @InjectModel(ActualPeriod.name) private readonly periods: Model<ActualPeriodDocument>,
    @InjectModel(SalesInvoice.name) private readonly invoices: Model<SalesInvoiceDocument>,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(PlansService) private readonly plans: PlansService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Lignes verrouillées par le pont actif pour ce projet (saisie manuelle refusée). */
  async lockedLines(organizationId: string, projectId: string): Promise<ReadonlySet<string>> {
    const bridge = await this.bridges.findOne({ organizationId }).lean().exec();
    if (bridge?.enabled && bridge.projectId === projectId && bridge.revenueLineId) {
      return new Set([bridge.revenueLineId]);
    }
    return new Set();
  }

  async view(organizationId: string): Promise<BridgeView> {
    const bridge = await this.bridges.findOne({ organizationId }).lean().exec();
    let projectName: string | null = null;
    let projectCurrency: string | null = null;
    if (bridge?.projectId) {
      const project = await this.projects
        .findScoped(bridge.projectId, organizationId)
        .catch(() => null);
      projectName = project?.name ?? null;
      projectCurrency = project?.deviseAffichage ?? null;
    }
    const configured = Boolean(
      bridge?.projectId && bridge.revenueLineId && bridge.exerciseStart && projectName !== null,
    );
    return {
      state: !bridge?.enabled ? 'disabled' : configured ? 'active' : 'not_configured',
      enabled: bridge?.enabled ?? false,
      projectId: bridge?.projectId ?? null,
      projectName,
      projectCurrency,
      revenueLineId: bridge?.revenueLineId ?? null,
      exerciseStart: bridge?.exerciseStart ?? null,
      lastSync: bridge?.lastSync
        ? { ...bridge.lastSync, at: new Date(bridge.lastSync.at).toISOString() }
        : null,
    };
  }

  /** Projets de l'organisation et lignes de CA proposables (plan validé courant). */
  async candidates(organizationId: string): Promise<BridgeCandidate[]> {
    const projects = await this.projects.listByOrg(organizationId, 50);
    const out: BridgeCandidate[] = [];
    for (const project of projects) {
      const plan = await this.plans.findLatestApproved(organizationId, String(project._id));
      out.push({
        projectId: String(project._id),
        name: project.name,
        currency: project.deviseAffichage,
        approvedPlanVersion: plan?.version ?? null,
        lines: plan
          ? referenceLines(plan.result.lines as PlanLineInput[]).map((l) => ({
              lineId: l.lineId,
              label: l.label,
            }))
          : [],
      });
    }
    return out;
  }

  async configure(
    organizationId: string,
    input: BridgeSettingsInput,
    actor: { userId: string; role: string },
  ): Promise<BridgeView> {
    if (input.enabled) {
      if (!input.projectId || !input.revenueLineId || !input.exerciseStart) {
        throw new ConflictException({
          code: 'BRIDGE_NOT_CONFIGURED',
          message:
            'Pour activer le pont, choisissez le projet, la ligne de chiffre d’affaires et le mois qui ouvre l’exercice 1.',
        });
      }
      await this.assertTarget(organizationId, input.projectId, input.revenueLineId);
    }
    await this.bridges.updateOne(
      { organizationId },
      {
        $set: {
          enabled: input.enabled,
          projectId: input.projectId,
          revenueLineId: input.revenueLineId,
          exerciseStart: input.exerciseStart,
          updatedBy: actor.userId,
        },
        $setOnInsert: { lastSync: null, _schemaVersion: 1 },
      },
      { upsert: true },
    );
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'run.actuals.bridge_configured',
      targetType: 'run_actuals_bridge',
      targetId: organizationId,
      metadata: {
        enabled: input.enabled,
        projectId: input.projectId,
        revenueLineId: input.revenueLineId,
        exerciseStart: input.exerciseStart,
      },
    });
    return this.view(organizationId);
  }

  async sync(
    organizationId: string,
    dryRun: boolean,
    actor: { userId: string; role: string },
  ): Promise<SyncReport> {
    const bridge = await this.bridges.findOne({ organizationId }).lean().exec();
    if (!bridge?.enabled || !bridge.projectId || !bridge.revenueLineId || !bridge.exerciseStart) {
      throw new ConflictException({
        code: 'BRIDGE_NOT_CONFIGURED',
        message: 'Le pont vers le réalisé n’est pas activé pour cette organisation.',
      });
    }
    const { projectId, revenueLineId: lineId, exerciseStart } = bridge;
    const project = await this.assertTarget(organizationId, projectId, lineId);
    const currency = project.deviseAffichage;

    const plan = planRunActuals({
      documents: await this.revenueDocuments(organizationId),
      projectCurrency: currency,
      exerciseStart,
      revenueLineId: lineId,
    });

    const stored = await this.periods.find({ organizationId, projectId }).exec();
    const byKey = new Map(stored.map((p) => [`${p.year}-${p.month}`, p]));
    const entries: SyncEntry[] = [];
    const at = new Date();
    const touched = new Set<string>();

    for (const period of plan.periods) {
      const key = `${period.year}-${period.month}`;
      touched.add(key);
      const value = period.values[lineId] as string;
      const fingerprint = fingerprintOf({
        version: plan.version,
        lineId,
        value,
        currency,
        documentIds: period.documentIds,
      });
      const existing = byKey.get(key);
      const storedValue = existing?.values[lineId] ?? null;
      const source = existing?.sources?.[lineId];
      const entry = {
        calendarMonth: period.calendarMonth,
        year: period.year,
        month: period.month,
        lineId,
        value,
        storedValue,
        documents: period.documentIds.length,
      };
      if (source?.source === 'run.sales' && source.fingerprint === fingerprint) {
        entries.push({ ...entry, outcome: 'unchanged' });
        continue;
      }
      if (existing?.status === 'closed') {
        entries.push({ ...entry, outcome: 'PERIOD_CLOSED' });
        continue;
      }
      if (storedValue !== null && source?.source !== 'run.sales') {
        entries.push({
          ...entry,
          outcome: isRunActualSource(source) ? 'OTHER_SOURCE_PRESENT' : 'MANUAL_VALUE_PRESENT',
        });
        continue;
      }
      entries.push({ ...entry, outcome: 'written' });
      if (dryRun) continue;
      const label: ActualValueSource = {
        source: 'run.sales',
        at,
        by: actor.userId,
        version: plan.version,
        calendarMonth: period.calendarMonth,
        documents: period.documentIds.length,
        fingerprint,
      };
      await this.writePeriod(organizationId, projectId, period.year, period.month, {
        [`values.${lineId}`]: signedAmountToJsonNumber(value),
        [`sources.${lineId}`]: label,
      });
    }

    // Valeurs issues des ventes qui n'ont plus de vente (début d'exercice changé).
    for (const existing of stored) {
      const key = `${existing.year}-${existing.month}`;
      if (touched.has(key) || existing.sources?.[lineId]?.source !== 'run.sales') continue;
      const entry = {
        calendarMonth: null,
        year: existing.year,
        month: existing.month,
        lineId,
        value: null,
        storedValue: existing.values[lineId] ?? null,
        documents: 0,
      };
      if (existing.status === 'closed') {
        entries.push({ ...entry, outcome: 'PERIOD_CLOSED' });
        continue;
      }
      entries.push({ ...entry, outcome: 'removed' });
      if (dryRun) continue;
      await this.periods
        .updateOne(
          { _id: existing._id, organizationId, status: 'open' },
          { $unset: { [`values.${lineId}`]: '', [`sources.${lineId}`]: '' } },
        )
        .exec();
    }

    const count = (o: SyncOutcome) => entries.filter((e) => e.outcome === o).length;
    const counts = {
      written: count('written'),
      unchanged: count('unchanged'),
      removed: count('removed'),
      blocked:
        count('PERIOD_CLOSED') + count('MANUAL_VALUE_PRESENT') + count('OTHER_SOURCE_PRESENT'),
      skipped: plan.skipped.length,
    };
    if (!dryRun) {
      await this.bridges
        .updateOne(
          { organizationId },
          { $set: { lastSync: { at, by: actor.userId, version: plan.version, ...counts } } },
        )
        .exec();
      if (counts.written + counts.removed > 0) {
        await this.audit.record({
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'run.actuals.synced',
          targetType: 'project',
          targetId: projectId,
          metadata: { lineId, ...counts, version: plan.version },
        });
      }
    }
    return {
      dryRun,
      at: at.toISOString(),
      version: RECEIVABLES_VERSION,
      projectId,
      projectCurrency: currency,
      revenueLineId: lineId,
      exerciseStart,
      entries,
      skipped: [...plan.skipped],
      excludedDepositIds: [...plan.excludedDepositIds],
      counts,
    };
  }

  // ── interne ──────────────────────────────────────────────────────────────

  /** Projet de l'organisation, plan validé courant, ligne du compte d'exploitation. */
  private async assertTarget(organizationId: string, projectId: string, lineId: string) {
    const project = await this.projects.findScoped(projectId, organizationId).catch(() => {
      throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: 'Projet introuvable.' });
    });
    const plan = await this.plans.findLatestApproved(organizationId, String(project._id));
    if (!plan) {
      throw new ConflictException({
        code: 'NO_APPROVED_PLAN',
        message: 'Ce projet n’a pas de plan validé : validez un plan avant de relier les ventes.',
      });
    }
    const allowed = referenceLines(plan.result.lines as PlanLineInput[]).map((l) => l.lineId);
    if (!allowed.includes(lineId)) {
      throw new ConflictException({
        code: 'UNKNOWN_LINE',
        message: `La ligne « ${lineId} » n’appartient pas au compte d’exploitation du plan validé.`,
      });
    }
    return project;
  }

  /** Factures et avoirs définitifs de la série réelle, sous la forme du moteur. */
  private async revenueDocuments(organizationId: string): Promise<RevenueDocumentInput[]> {
    const docs = (await this.invoices
      .find({
        organizationId,
        status: { $in: ['issued', 'normalized'] },
        series: { $ne: 'test' },
      })
      .lean()
      .exec()) as unknown as InvoiceLean[];
    const out: RevenueDocumentInput[] = [];
    for (const doc of docs) {
      const totals = doc.documentAmounts?.calculation?.totals;
      const kind = KIND_OF_TYPE[doc.type];
      if (!totals || !doc.issuedAt || !kind) continue; // un document gelé a toujours des totaux
      out.push({
        id: String(doc._id),
        issuedOn: kinshasaDayOf(doc.issuedAt),
        kind,
        document: {
          currency: doc.currency,
          groups: totals.groups.map((g) => ({ group: g.group, ht: g.ht })),
        },
        normalized: doc.normalizedAmounts
          ? {
              currency: 'CDF',
              groups: doc.normalizedAmounts.calculation.groups.map((g) => ({
                group: g.group,
                ht: g.ht,
              })),
            }
          : null,
      });
    }
    return out;
  }

  /** Écrit dans une période ouverte, ou la crée ouverte ; jamais une période clôturée. */
  private async writePeriod(
    organizationId: string,
    projectId: string,
    year: number,
    month: number,
    set: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.periods
        .updateOne(
          { organizationId, projectId, year, month, status: 'open' },
          {
            $set: set,
            $setOnInsert: { reopenedLog: [], _schemaVersion: 1 },
          },
          { upsert: true },
        )
        .exec();
    } catch (err) {
      // E11000 : la période existe mais vient d'être clôturée (le filtre `open` ne
      // l'a pas trouvée, l'upsert bute sur l'index unique). Rien n'est écrit.
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException({
          code: 'PERIOD_CONFLICT',
          message: 'Une période a changé pendant la synchronisation : relancez-la.',
        });
      }
      throw err;
    }
  }
}
