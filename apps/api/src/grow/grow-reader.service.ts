// Lecture des données de BUILD et de RUN pour GROW (ADR-0032 § 1).
//
// RÈGLE : ce service LIT. Il n'appelle que `find`, `findOne` et `countDocuments`
// sur les modèles de BUILD (projets, plans, réalisé) et de RUN (factures,
// catalogue). `grow-readonly.surface.test.ts` lit ce fichier et échoue sur toute
// méthode d'écriture.
//
// Il ne calcule rien : il assemble les entrées du moteur, qui calcule.

import {
  computeHealthScore,
  computeInvestorIndicators,
  kinshasaDateOf,
  suggestJourneyStage,
  type GrowIndicatorsResult,
  type HealthScoreResult,
  type JourneyResult,
} from '@lalanda/engine';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { ActualPeriod } from '../actuals/actual-period.schema.js';
import { FinancialPlan } from '../plans/plan.schema.js';
import { Project } from '../projects/project.schema.js';
import { CatalogItem } from '../sales/catalog-item.schema.js';
import { SalesInvoice } from '../sales/invoices/invoice.schema.js';
import { GrowProfileService, type GrowProfileView } from './grow-profile.service.js';
import {
  pickReferenceProject,
  toGrowActuals,
  toGrowSalesDocument,
  type ActualPeriodForGrow,
  type InvoiceForGrow,
  type ProjectForGrow,
} from './grow-sources.js';

/** Historique de ventes lu : 12 + 12 mois couvrent toutes les fenêtres (ADR-0032 § 3). */
const SALES_HISTORY_DAYS = 800;

export interface GrowSnapshot {
  asOf: string;
  profile: GrowProfileView;
  indicators: GrowIndicatorsResult;
  journey: JourneyResult;
  health: HealthScoreResult;
}

@Injectable()
export class GrowReaderService {
  constructor(
    @InjectModel(Project.name) private readonly projects: Model<Project>,
    @InjectModel(FinancialPlan.name) private readonly plans: Model<FinancialPlan>,
    @InjectModel(ActualPeriod.name) private readonly actuals: Model<ActualPeriod>,
    @InjectModel(SalesInvoice.name) private readonly invoices: Model<SalesInvoice>,
    @InjectModel(CatalogItem.name) private readonly catalog: Model<CatalogItem>,
    @Inject(GrowProfileService) private readonly profiles: GrowProfileService,
  ) {}

  /** Projets de l'organisation (lecture seule). */
  async listProjects(orgId: string): Promise<ProjectForGrow[]> {
    return this.projects
      .find({ organizationId: orgId }, { name: 1, deviseAffichage: 1 })
      .sort({ createdAt: 1 })
      .lean<ProjectForGrow[]>();
  }

  /** Tout ce que GROW calcule, à la date du jour (Kinshasa). */
  async snapshot(orgId: string, now: Date = new Date()): Promise<GrowSnapshot> {
    const asOf = kinshasaDateOf(now.toISOString())!;
    const since = new Date(now.getTime() - SALES_HISTORY_DAYS * 24 * 60 * 60 * 1000);

    const [profile, projects, invoices, approvedPlans, activeCatalogItems] = await Promise.all([
      this.profiles.get(orgId),
      this.listProjects(orgId),
      this.invoices
        .find(
          {
            organizationId: orgId,
            status: { $in: ['issued', 'normalized'] },
            issuedAt: { $gte: since },
          },
          {
            type: 1,
            status: 1,
            series: 1,
            issuedAt: 1,
            currency: 1,
            'customer.customerId': 1,
            'customer.name': 1,
            'lines.catalogItemId': 1,
            'documentAmounts.calculation.totals.groups': 1,
            'normalizedAmounts.currency': 1,
            'normalizedAmounts.calculation.groups': 1,
          },
        )
        .lean<InvoiceForGrow[]>(),
      this.plans.countDocuments({ organizationId: orgId, status: 'approved' }),
      this.catalog.countDocuments({ organizationId: orgId, active: true }),
    ]);

    const ref = pickReferenceProject(projects, profile.referenceProjectId);
    const periods =
      ref.project === null
        ? []
        : await this.actuals
            .find(
              { organizationId: orgId, projectId: String(ref.project._id) },
              { year: 1, month: 1, status: 1, closedAt: 1, values: 1 },
            )
            .lean<ActualPeriodForGrow[]>();

    const indicators = computeInvestorIndicators({
      asOf,
      actuals: toGrowActuals(ref, periods),
      sales: invoices.map(toGrowSalesDocument).filter((d) => d !== null),
      declaredCash: profile.declaredCash
        ? {
            amount: profile.declaredCash.amount,
            currency: profile.declaredCash.currency,
            asOf: profile.declaredCash.asOf,
          }
        : null,
      recurringCatalogItemIds: profile.recurringCatalogItemIds,
    });
    const journey = suggestJourneyStage({
      indicators,
      projects: projects.length,
      approvedPlans,
      activeCatalogItems,
      declaredStage: profile.declaredStage,
      checklistDone: profile.checklistDone,
    });
    const health = computeHealthScore(indicators, journey.retenue);
    return { asOf, profile, indicators, journey, health };
  }
}
