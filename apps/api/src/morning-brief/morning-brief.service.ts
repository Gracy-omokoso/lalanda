// Brief du matin — lecture et assemblage (ADR-0033).
//
// Ce service LIT des documents écrits par d'autres modules et les remet au
// moteur ; il ne calcule aucun montant (CLAUDE.md). Deux règles de sécurité
// tiennent ici, et nulle part ailleurs :
//
//  1. **Isolation.** Toute lecture porte `organizationId` en filtre, et cet
//     identifiant vient de la session (`req.orgId`, résolu par `AuthGuard` puis
//     vérifié par `PermissionsGuard`), jamais d'un paramètre de la requête.
//  2. **Moindre privilège.** Le bloc ventes n'est CHARGÉ que si le rôle détient
//     `sales.read` (même matrice que l'espace organisation, `can()`). Masquer
//     après lecture laisserait la donnée transiter jusqu'au prompt de l'IA.
//     Même règle pour les tâches et projets (ADR-0039 § 6.5) avec `work.read`,
//     et pour la trésorerie avec `treasury.read` (ADR-0040 § 4.4), et pour les
//     relances et le pipeline du CRM avec `crm.read` (ADR-0040 — C4 § 5.5), et
//     pour les achats avec `purchase.read` (ADR-0044 § 6.4) : leurs montants avec
//     `treasury.read` en plus, les approbations à faire avec `purchase.approve`.
//     Ressources humaines (ADR-0045 § 6.5) : la portée vient de la relation (manager)
//     ou des droits effectifs, décidée par le moteur RH ; des nombres seulement.

import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import {
  MORNING_BRIEF_THRESHOLDS,
  buildMorningBrief,
  type BriefCurrency,
  type BriefInvoiceInput,
  type BriefInvoiceStatus,
  type MorningBrief,
} from '@lalanda/engine';

import {
  can,
  effectiveActions,
  type OrgPermissionContext,
  type OrgRole,
} from '../authz/permissions.js';
import { SalesInvoice, type SalesInvoiceDocument } from '../sales/invoices/invoice.schema.js';
import {
  CASH_POSITION_SOURCE,
  CRM_SOURCE,
  DUE_DATES_SOURCE,
  HR_SOURCE,
  OUTSTANDING_SOURCE,
  PURCHASES_SOURCE,
  WORK_SOURCE,
  noHr,
  noPurchases,
  type CashPositionSource,
  type CrmSource,
  type DueDatesSource,
  type HrSource,
  type OutstandingSource,
  type PurchasesSource,
  type WorkSource,
} from './morning-brief.ports.js';
import {
  MorningBriefSettings,
  MorningBriefSubscription,
  type MorningBriefSettingsDocument,
  type MorningBriefSubscriptionDocument,
} from './morning-brief.schemas.js';

/** Documents lus au plus pour un brief : un tableau de bord n'est pas un export. */
export const MAX_BRIEF_DOCUMENTS = 5000;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Début du mois civil de Kinshasa (UTC+1) contenant `now`. */
export function kinshasaMonthStart(now: Date): Date {
  const k = new Date(now.getTime() + HOUR_MS);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1) - HOUR_MS);
}

/** Jour de Kinshasa `AAAA-MM-JJ` et heure locale. */
export function kinshasaClock(now: Date): { day: string; hour: number } {
  const k = new Date(now.getTime() + HOUR_MS);
  return { day: k.toISOString().slice(0, 10), hour: k.getUTCHours() };
}

/** Coupe-circuit plateforme (ADR-0033 § 7). */
export function platformAiDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env['MORNING_BRIEF_AI'] ?? '').trim().toLowerCase() === 'off';
}

type InvoiceRow = Pick<
  SalesInvoice,
  | 'type'
  | 'status'
  | 'series'
  | 'environment'
  | 'currency'
  | 'issuedAt'
  | 'frozenAt'
  | 'updatedAt'
  | 'amountOnCredit'
> & {
  _id: unknown;
  documentAmounts?: {
    calculation?: { totals?: { groups?: { group: string; ht: string }[] } | null };
  };
  creditNote?: { originInvoiceId?: string | null } | null;
  normalization?: { phase?: string | null } | null;
};

/**
 * `outstanding` : reste à encaisser réel (ADR-0031), lu par `OUTSTANDING_SOURCE` ;
 * `null` pour un document sans règlement.
 */
export function toBriefInvoice(
  row: InvoiceRow,
  outstanding: string | null = null,
): BriefInvoiceInput {
  return {
    id: String(row._id),
    type: row.type,
    status: row.status as BriefInvoiceStatus,
    testSeries: row.series === 'test' || row.environment === 'test',
    currency: row.currency as BriefCurrency,
    issuedAt: row.issuedAt ? new Date(row.issuedAt).toISOString() : null,
    frozenAt: row.frozenAt ? new Date(row.frozenAt).toISOString() : null,
    updatedAt: new Date(row.updatedAt).toISOString(),
    groups: row.documentAmounts?.calculation?.totals?.groups ?? null,
    outstanding,
    creditNoteOriginId: row.creditNote?.originInvoiceId ?? null,
    normalizationPhase: row.normalization?.phase ?? null,
  };
}

export interface MorningBriefPreferences {
  emailDaily: boolean;
  aiEnabled: boolean;
  aiDisabledBy: 'organization' | 'platform' | null;
}

@Injectable()
export class MorningBriefService {
  private readonly purchases: PurchasesSource;
  private readonly hr: HrSource;

  constructor(
    @InjectModel(SalesInvoice.name) private readonly invoices: Model<SalesInvoiceDocument>,
    @InjectModel(MorningBriefSettings.name)
    private readonly settings: Model<MorningBriefSettingsDocument>,
    @InjectModel(MorningBriefSubscription.name)
    private readonly subscriptions: Model<MorningBriefSubscriptionDocument>,
    @Inject(CASH_POSITION_SOURCE) private readonly cash: CashPositionSource,
    @Inject(DUE_DATES_SOURCE) private readonly dueDates: DueDatesSource,
    @Inject(OUTSTANDING_SOURCE) private readonly outstanding: OutstandingSource,
    @Inject(WORK_SOURCE) private readonly work: WorkSource,
    // ADR-0040 — C4
    @Inject(CRM_SOURCE) private readonly crm: CrmSource,
    // ADR-0044 — P6 : facultatif, « non disponible » sans module des achats.
    @Optional() @Inject(PURCHASES_SOURCE) purchases: PurchasesSource | null = null,
    // ADR-0045 — H5 : facultatif, « non disponible » sans module RH.
    @Optional() @Inject(HR_SOURCE) hr: HrSource | null = null,
  ) {
    this.purchases = purchases ?? noPurchases;
    this.hr = hr ?? noHr;
  }

  /**
   * Brief de l'organisation, vu par ce rôle et pour ce membre : `userId`
   * (session ou destinataire de l'e-mail) ne sert qu'aux faits personnels
   * `mes_taches.*` (ADR-0039 § 6.5) et `mes_relances.*` (ADR-0040 — C4).
   *
   * ADR-0041 § 9.4 (A3) : chaque section se décide sur les droits EFFECTIFS du
   * membre (`role` + `context` : droit de clôture, ajouts, retraits) ; un retrait
   * masque la section comme si le titre ne la donnait pas.
   */
  async build(
    organizationId: string,
    role: OrgRole,
    context: OrgPermissionContext,
    userId: string,
    now: Date = new Date(),
  ): Promise<MorningBrief> {
    const salesVisible = can(role, 'sales.read', context);
    const workVisible = can(role, 'work.read', context);
    // ADR-0040 — C0 § 4.4 : une donnée de trésorerie exige `treasury.read`.
    const cashVisible = can(role, 'treasury.read', context);
    // ADR-0040 — C4 § 5.5 : relances et pipeline chargés seulement avec `crm.read`.
    const crmVisible = can(role, 'crm.read', context);
    // ADR-0044 § 6.4 : achats chargés seulement avec `purchase.read`.
    const purchasesVisible = can(role, 'purchase.read', context);
    // ADR-0045 § 6.5 : RH pour tout membre qui lit le brief ; la portée est décidée
    // par le moteur RH sur les droits effectifs (un retrait de `hr.read` la réduit).
    const hrVisible = can(role, 'analytics.read', context);
    const [sales, cash, dueDates, work, crm, purchases, hr] = await Promise.all([
      salesVisible ? this.loadSales(organizationId, now) : Promise.resolve('hidden' as const),
      cashVisible ? this.cash.cashOf(organizationId, now) : Promise.resolve('hidden' as const),
      // Les échéances sont des données de ventes : même règle de visibilité.
      salesVisible
        ? this.dueDates.dueDatesOf(organizationId, now)
        : Promise.resolve({ status: 'unavailable' as const }),
      // Tâches et projets : chargés seulement avec `work.read`.
      workVisible
        ? this.work.workOf(organizationId, userId, now)
        : Promise.resolve('hidden' as const),
      crmVisible ? this.crm.crmOf(organizationId, userId, now) : Promise.resolve('hidden' as const),
      purchasesVisible
        ? this.purchases.purchasesOf(
            organizationId,
            userId,
            {
              amounts: cashVisible,
              approvals: can(role, 'purchase.approve', context),
            },
            now,
          )
        : Promise.resolve('hidden' as const),
      hrVisible
        ? this.hr.hrOf(organizationId, userId, effectiveActions(role, context), now)
        : Promise.resolve('hidden' as const),
    ]);
    return buildMorningBrief({
      now: now.toISOString(),
      sales,
      cash,
      dueDates,
      work,
      crm,
      purchases,
      hr,
    });
  }

  /**
   * Documents utiles au brief, et eux seuls : anomalies de normalisation,
   * brouillons anciens, documents finaux du mois, documents finaux à crédit
   * (factures et avoirs qui les visent). Les lignes, le client et les
   * coordonnées ne sont PAS lus : le brief n'en a pas besoin.
   */
  private async loadSales(
    organizationId: string,
    now: Date,
  ): Promise<{ invoices: BriefInvoiceInput[]; truncated: boolean }> {
    const draftLimit = new Date(now.getTime() - MORNING_BRIEF_THRESHOLDS.S5.value * DAY_MS);
    const rows = (await this.invoices
      .find(
        {
          organizationId,
          $or: [
            { status: { $in: ['normalization_failed', 'pending_normalization'] } },
            { status: 'draft', updatedAt: { $lt: draftLimit } },
            {
              status: { $in: ['issued', 'normalized'] },
              issuedAt: { $gte: kinshasaMonthStart(now) },
            },
            {
              status: { $in: ['issued', 'normalized'] },
              amountOnCredit: { $nin: [null, '0', '0.00'] },
            },
          ],
        },
        {
          type: 1,
          status: 1,
          series: 1,
          environment: 1,
          currency: 1,
          issuedAt: 1,
          frozenAt: 1,
          updatedAt: 1,
          amountOnCredit: 1,
          'documentAmounts.calculation.totals.groups': 1,
          'creditNote.originInvoiceId': 1,
          'normalization.phase': 1,
        },
      )
      .sort({ sortAt: -1, _id: -1 })
      .limit(MAX_BRIEF_DOCUMENTS + 1)
      .lean()
      .exec()) as unknown as InvoiceRow[];

    const truncated = rows.length > MAX_BRIEF_DOCUMENTS;
    const kept = rows.slice(0, MAX_BRIEF_DOCUMENTS);
    // Créances RÉELLES (ADR-0031) : reste à encaisser des factures finales à crédit,
    // avoirs et encaissements imputés par le moteur des encaissements.
    const onCredit = kept
      .filter(
        (r) =>
          (r.status === 'issued' || r.status === 'normalized') &&
          r.amountOnCredit !== null &&
          r.amountOnCredit !== undefined &&
          !['0', '0.00'].includes(r.amountOnCredit),
      )
      .map((r) => String(r._id));
    const outstanding =
      onCredit.length > 0
        ? await this.outstanding.outstandingOf(organizationId, onCredit)
        : new Map<string, string | null>();
    return {
      invoices: kept.map((r) => toBriefInvoice(r, outstanding.get(String(r._id)) ?? null)),
      truncated,
    };
  }

  // ── Réglages et préférences ────────────────────────────────────────────────

  async aiDisabledBy(organizationId: string): Promise<MorningBriefPreferences['aiDisabledBy']> {
    if (platformAiDisabled()) return 'platform';
    const s = await this.settings.findOne({ organizationId }, { aiEnabled: 1 }).lean().exec();
    return s && s.aiEnabled === false ? 'organization' : null;
  }

  async preferences(organizationId: string, userId: string): Promise<MorningBriefPreferences> {
    const [sub, disabledBy] = await Promise.all([
      this.subscriptions.findOne({ organizationId, userId }, { emailDaily: 1 }).lean().exec(),
      this.aiDisabledBy(organizationId),
    ]);
    return {
      emailDaily: sub?.emailDaily === true,
      aiEnabled: disabledBy === null,
      aiDisabledBy: disabledBy,
    };
  }

  async setEmailDaily(
    organizationId: string,
    userId: string,
    emailDaily: boolean,
  ): Promise<MorningBriefPreferences> {
    await this.subscriptions
      .updateOne(
        { organizationId, userId },
        {
          $set: { emailDaily },
          $setOnInsert: { organizationId, userId, lastSentOn: null, _schemaVersion: 1 },
        },
        { upsert: true },
      )
      .exec();
    return this.preferences(organizationId, userId);
  }

  async setAiEnabled(
    organizationId: string,
    aiEnabled: boolean,
    actorUserId: string,
  ): Promise<void> {
    await this.settings
      .updateOne(
        { organizationId },
        {
          $set: { aiEnabled, updatedBy: actorUserId },
          $setOnInsert: { organizationId, _schemaVersion: 1 },
        },
        { upsert: true },
      )
      .exec();
  }
}
