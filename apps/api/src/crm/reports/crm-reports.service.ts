// Rapports du CRM — ADR-0040 § 3.4 et § 7.2. ADR-0040 — C3.
//
// Lecture seule. Le service charge les opportunités de l'organisation utiles à la
// période (créées ou clôturées dans la période, et toutes les ouvertes), les
// ramène en jours civils de Kinshasa et confie TOUS les calculs au moteur
// (`crmReports`). Il y joint les noms des responsables et les libellés des
// motifs. Les montants rendus sont des ESTIMATIONS : rien n'est écrit, ni dans
// `actual_periods`, ni dans un plan, ni dans un scénario.

import {
  CRM_REPORT_MIN_SAMPLE,
  crmReportPeriod,
  crmReports,
  probabilitiesFromWinRates,
  stageWinRates,
  type ReportOpportunity,
} from '@lalanda/engine';
import {
  CRM_REPORT_ESTIMATE_LABEL,
  type CrmReportLostReason,
  type CrmReportsView,
} from '@lalanda/shared/crm';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, Types } from 'mongoose';

import { Membership, type MembershipDocument } from '../../organizations/membership.schema.js';
import { MembersService } from '../../organizations/members.service.js';
import { addDays, kinshasaDay } from '../crm-model.js';
import { CrmSettingsService } from '../crm-settings.service.js';
import { CrmOpportunity, type CrmOpportunityDocument } from '../crm.schemas.js';

/** Opportunités lues au plus pour un rapport ; au-delà, `truncated: true`. */
export const REPORT_LIMIT = 20_000;
/** Historique des clôturées pour les probabilités d'étape (même borne que le pipeline). */
const HISTORY_LIMIT = 5000;

type ReportLean = Pick<
  CrmOpportunity,
  | 'stageKey'
  | 'status'
  | 'amount'
  | 'currency'
  | 'expectedCloseDate'
  | 'ownerId'
  | 'lostReasonKey'
  | 'closedAt'
  | 'wonAt'
  | 'stageHistory'
  | 'createdAt'
> & { _id: Types.ObjectId };

export interface CrmReportsRequest {
  from?: string;
  to?: string;
  /** Responsable déjà résolu (`me` → l'appelant) ; `null` : toute l'organisation. */
  ownerId: string | null;
}

/** Début (inclus) d'un jour de Kinshasa (UTC+1, sans heure d'été). */
function kinshasaStart(day: string): Date {
  return new Date(`${day}T00:00:00+01:00`);
}

@Injectable()
export class CrmReportsService {
  constructor(
    @InjectModel(CrmOpportunity.name)
    private readonly opportunities: Model<CrmOpportunityDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @Inject(CrmSettingsService) private readonly settings: CrmSettingsService,
    @Inject(MembersService) private readonly members: MembersService,
  ) {}

  async reports(
    organizationId: string,
    request: CrmReportsRequest,
    now = new Date(),
  ): Promise<CrmReportsView> {
    const today = kinshasaDay(now);
    const period = crmReportPeriod({ today, from: request.from, to: request.to });
    if (!period.ok) {
      throw new BadRequestException({ code: period.code, message: period.message });
    }
    const start = kinshasaStart(period.from);
    const end = kinshasaStart(addDays(period.to, 1));
    const owner = request.ownerId === null ? {} : { ownerId: request.ownerId };

    const [settings, docs, history] = await Promise.all([
      this.settings.get(organizationId),
      this.opportunities
        .find({
          organizationId,
          ...owner,
          $or: [
            { status: 'open' },
            { createdAt: { $gte: start, $lt: end } },
            { status: { $in: ['won', 'lost'] }, closedAt: { $gte: start, $lt: end } },
          ],
        })
        .select({
          stageKey: 1,
          status: 1,
          amount: 1,
          currency: 1,
          expectedCloseDate: 1,
          ownerId: 1,
          lostReasonKey: 1,
          closedAt: 1,
          wonAt: 1,
          'stageHistory.stageKey': 1,
          createdAt: 1,
        })
        .sort({ _id: 1 })
        .limit(REPORT_LIMIT + 1)
        .lean<ReportLean[]>()
        .exec(),
      // Probabilités d'étape : historique de TOUTE l'organisation, comme le pipeline.
      this.opportunities
        .find({ organizationId, status: { $in: ['won', 'lost'] } })
        .select({ status: 1, 'stageHistory.stageKey': 1 })
        .sort({ closedAt: -1, _id: -1 })
        .limit(HISTORY_LIMIT)
        .lean<Pick<ReportLean, '_id' | 'status' | 'stageHistory'>[]>()
        .exec(),
    ]);
    const truncated = docs.length > REPORT_LIMIT;
    const rows = truncated ? docs.slice(0, REPORT_LIMIT) : docs;

    const openKeys = settings.stages.filter((s) => s.kind === 'open').map((s) => s.key);
    const rates = stageWinRates({
      stages: openKeys,
      closed: history.map((h) => ({
        stagesVisited: h.stageHistory.map((e) => e.stageKey),
        won: h.status === 'won',
      })),
      minSample: CRM_REPORT_MIN_SAMPLE,
    });

    const report = crmReports({
      period: { from: period.from, to: period.to },
      asOf: today,
      stages: settings.stages.map((s) => ({ key: s.key, kind: s.kind })),
      opportunities: rows.map(toReportOpportunity),
      probabilities: probabilitiesFromWinRates(rates),
      probabilitySource: 'historical',
      ownerId: request.ownerId,
      minSample: CRM_REPORT_MIN_SAMPLE,
    });

    const ownerIds = report.byOwner.flatMap((o) => (o.ownerId ? [o.ownerId] : []));
    const [identities, memberDocs] = await Promise.all([
      this.members.identitiesOf(ownerIds),
      ownerIds.length === 0
        ? Promise.resolve([])
        : this.memberships
            .find({ organizationId, userId: { $in: ownerIds } }, { userId: 1 })
            .lean<{ userId: string }[]>()
            .exec(),
    ]);
    const memberSet = new Set(memberDocs.map((m) => m.userId));
    const labels = new Map(settings.lostReasons.map((r) => [r.key, r.label]));
    const labelled = (r: { lostReasonKey: string | null; count: number }): CrmReportLostReason => ({
      ...r,
      label: r.lostReasonKey === null ? null : (labels.get(r.lostReasonKey) ?? null),
    });

    return {
      version: report.version,
      basis: report.basis,
      label: CRM_REPORT_ESTIMATE_LABEL,
      generatedAt: now.toISOString(),
      period: report.period,
      asOf: report.asOf,
      ownerId: report.ownerId,
      minSample: report.minSample,
      stages: settings.stages.map((s) => ({ key: s.key, label: s.label, kind: s.kind })),
      funnel: report.funnel,
      conversion: report.conversion,
      cycle: report.cycle,
      byOwner: report.byOwner.map((o) => {
        const identity = o.ownerId ? identities.get(o.ownerId) : undefined;
        // Seul un membre ACTUEL est nommé : un ancien membre reste un identifiant.
        const isMember = o.ownerId !== null && memberSet.has(o.ownerId);
        return {
          ...o,
          ownerName: isMember ? (identity?.name ?? identity?.email ?? null) : null,
          isMember,
          topLostReasons: o.topLostReasons.map(labelled),
        };
      }),
      forecastByMonth: report.forecastByMonth,
      lostReasons: {
        total: report.lostReasons.total,
        reasons: report.lostReasons.reasons.map(labelled),
      },
      truncated,
    };
  }
}

function toReportOpportunity(d: ReportLean): ReportOpportunity {
  const closedAt = d.status === 'won' ? (d.wonAt ?? d.closedAt) : d.closedAt;
  return {
    id: String(d._id),
    stageKey: d.stageKey,
    status: d.status,
    amount: d.amount ?? null,
    currency: d.currency,
    createdDay: kinshasaDay(new Date(d.createdAt)),
    closedDay: d.status === 'open' || !closedAt ? null : kinshasaDay(new Date(closedAt)),
    expectedCloseDate: d.expectedCloseDate ?? null,
    ownerId: d.ownerId ?? null,
    lostReasonKey: d.lostReasonKey ?? null,
    stagesVisited: (d.stageHistory ?? []).map((e) => e.stageKey),
  };
}
