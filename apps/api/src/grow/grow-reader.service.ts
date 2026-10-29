// Lecture des données de BUILD et de RUN pour GROW (ADR-0032 § 1).
//
// RÈGLE : ce service LIT. Il n'appelle que `find`, `findOne` et `countDocuments`
// sur les modèles de BUILD (projets, plans, réalisé) et de RUN (factures,
// catalogue). `grow-readonly.surface.test.ts` lit ce fichier et échoue sur toute
// méthode d'écriture.
//
// Il ne calcule rien : il assemble les entrées du moteur, qui calcule.
//
// ADR-0040 — C0 § 4.4 : une donnée de trésorerie exige `treasury.read`. Sans ce
// droit, ni les soldes des comptes ni le solde déclaré ne sont LUS (masquer après
// lecture laisserait la donnée transiter), et l'autonomie (`runway`) est rendue
// indisponible pour la raison `TRESORERIE_MASQUEE` avant le score et le parcours.

import {
  computeHealthScore,
  computeInvestorIndicators,
  kinshasaDateOf,
  suggestJourneyStage,
  type GrowIndicatorUnavailable,
  type GrowIndicatorsResult,
  type HealthScoreResult,
  type JourneyResult,
} from '@lalanda/engine';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { ActualPeriod } from '../actuals/actual-period.schema.js';
import { IdeaLabService } from '../idea-lab/idea-lab.service.js';
import { FinancialPlan } from '../plans/plan.schema.js';
import { Project } from '../projects/project.schema.js';
import { CatalogItem } from '../sales/catalog-item.schema.js';
import { SalesInvoice } from '../sales/invoices/invoice.schema.js';
import { TreasuryAccountsService } from '../treasury/treasury-accounts.service.js';
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

/** Raison rendue pour un fait de trésorerie masqué faute de `treasury.read`. */
export const GROW_TREASURY_HIDDEN_REASON = 'TRESORERIE_MASQUEE' as const;

/** Ce que l'appelant peut lire (ADR-0040 § 4.4) ; par défaut, tout. */
export interface GrowReadAccess {
  /** `treasury.read` : soldes des comptes et solde déclaré. */
  treasury: boolean;
}

/**
 * Indicateurs sans aucun fait de trésorerie : l'autonomie devient indisponible,
 * sans valeur, sans source ni hypothèse qui citerait un solde.
 */
export function withoutTreasury(result: GrowIndicatorsResult): GrowIndicatorsResult {
  const runway: GrowIndicatorUnavailable = {
    code: 'runway',
    libelle: result.indicateurs.runway.libelle,
    disponible: false,
    raison: GROW_TREASURY_HIDDEN_REASON,
    message: 'L’autonomie de trésorerie est réservée aux rôles qui consultent la trésorerie.',
    sources: [],
    hypotheses: [],
  };
  return { ...result, indicateurs: { ...result.indicateurs, runway } };
}

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
    @Inject(TreasuryAccountsService) private readonly treasury: TreasuryAccountsService,
    // ADR-0036 § 5 : faits de l'Idea Lab pour le parcours, lecture seule.
    @Inject(IdeaLabService) private readonly ideaLab: IdeaLabService,
  ) {}

  /** Projets de l'organisation (lecture seule). */
  async listProjects(orgId: string): Promise<ProjectForGrow[]> {
    return this.projects
      .find({ organizationId: orgId }, { name: 1, deviseAffichage: 1 })
      .sort({ createdAt: 1 })
      .lean<ProjectForGrow[]>();
  }

  /** Tout ce que GROW calcule, à la date du jour (Kinshasa). */
  async snapshot(
    orgId: string,
    now: Date = new Date(),
    access: GrowReadAccess = { treasury: true },
  ): Promise<GrowSnapshot> {
    const asOf = kinshasaDateOf(now.toISOString())!;
    const since = new Date(now.getTime() - SALES_HISTORY_DAYS * 24 * 60 * 60 * 1000);

    const [profile, projects, invoices, approvedPlans, activeCatalogItems, accounts, ideaLab] =
      await Promise.all([
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
        // ADR-0034 : soldes des comptes, calculés par le moteur `treasury`.
        // ADR-0040 § 4.4 : lus seulement avec `treasury.read`.
        access.treasury ? this.treasury.list(orgId) : Promise.resolve(null),
        // ADR-0036 § 5 : un Idea Lab illisible laisse ses points « inconnus », il
        // ne fait pas échouer le parcours.
        this.ideaLab.journeyFacts(orgId).catch(() => null),
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

    const computed = computeInvestorIndicators({
      asOf,
      actuals: toGrowActuals(ref, periods),
      sales: invoices.map(toGrowSalesDocument).filter((d) => d !== null),
      declaredCash:
        access.treasury && profile.declaredCash
          ? {
              amount: profile.declaredCash.amount,
              currency: profile.declaredCash.currency,
              asOf: profile.declaredCash.asOf,
            }
          : null,
      // Trésorerie RÉELLE (amendement d'ADR-0032 du 27 oct. 2026) : prioritaire
      // sur le solde déclaré quand un compte existe dans la devise du réalisé.
      accountsCash:
        accounts === null || accounts.items.length === 0
          ? null
          : {
              amounts: Object.entries(accounts.totalsByCurrency).flatMap(([currency, amount]) =>
                amount === undefined ? [] : [{ currency, amount }],
              ),
              asOf: accounts.asOf,
              accountCount: accounts.items.length,
            },
      recurringCatalogItemIds: profile.recurringCatalogItemIds,
    });
    const indicators = access.treasury ? computed : withoutTreasury(computed);
    const journey = suggestJourneyStage({
      indicators,
      projects: projects.length,
      approvedPlans,
      activeCatalogItems,
      declaredStage: profile.declaredStage,
      checklistDone: profile.checklistDone,
      ideaLab,
    });
    const health = computeHealthScore(indicators, journey.retenue);
    return {
      asOf,
      profile: access.treasury ? profile : { ...profile, declaredCash: null },
      indicators,
      journey,
      health,
    };
  }
}
