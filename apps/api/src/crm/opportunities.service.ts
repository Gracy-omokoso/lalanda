// Opportunités et pipeline — ADR-0035 § 2.
//
// Une opportunité vise un client de l'organisation OU un prospect nommé. Son
// étape vient des réglages du pipeline ; sa nature (en cours, gagnée, perdue)
// est dénormalisée dans `status`. Chaque changement d'étape s'inscrit dans
// `stageHistory` : c'est la matière de la probabilité historique (moteur).
//
// Montants : ESTIMÉS, chaînes décimales ; toute somme passe par le moteur
// (`sumAmountsByCurrency`), jamais par l'API. Rien n'alimente le réalisé ni un
// plan (ADR-0018 : RUN alimente le réalisé, et un montant estimé n'en est pas un).

import {
  CRM_INDICATORS_VERSION,
  DEFAULT_WIN_RATE_MIN_SAMPLE,
  stageWinRates,
  sumAmountsByCurrency,
  type CurrencyTotal,
  type StageWinRate,
} from '@lalanda/engine';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { Customer, type CustomerDocument } from '../sales/customer.schema.js';
import { quoteStatusOf } from '../sales/quotes/quote-model.js';
import {
  SalesQuote,
  type QuoteLean,
  type SalesQuoteDocument,
} from '../sales/quotes/quote.schema.js';
import { conflict, invalidCursor, staleRevision } from '../sales/sales.errors.js';
import { escapeRegex, isObjectIdHex, normalizeForSearch, searchKeyOf } from '../sales/search.js';
import { ContactsService, customerNamesOf, requireCustomer } from './contacts.service.js';
import {
  daysSince,
  isOverdue,
  isStale,
  kinshasaDay,
  type OpportunityStatus,
  type PipelineStage,
} from './crm-model.js';
import { CrmSettingsService, type CrmActor, type CrmSettingsView } from './crm-settings.service.js';
import type { ListOpportunitiesQuery, OpportunityInput } from './crm.dto.js';
import { opportunityNotFound } from './crm.errors.js';
import {
  CrmActivity,
  CrmOpportunity,
  type CrmActivityDocument,
  type CrmOpportunityDocument,
  type CrmStageEvent,
} from './crm.schemas.js';
import { beforeTimeCursor, decodeTimeCursor, encodeTimeCursor } from './time-cursor.js';

export type OpportunityLean = CrmOpportunity & { _id: Types.ObjectId };
type ActivityLean = CrmActivity & { _id: Types.ObjectId };

/** Clôturées récemment, montrées dans les colonnes « gagné » et « perdu » du tableau. */
const CLOSED_WINDOW_DAYS = 90;
const BOARD_LIMIT = 500;
const HISTORY_LIMIT = 5000;

export interface OpportunitySummary {
  id: string;
  title: string;
  customerId: string | null;
  customerName: string | null;
  prospectName: string | null;
  contactId: string | null;
  contactName: string | null;
  stageKey: string;
  stageLabel: string;
  status: OpportunityStatus;
  amount: string | null;
  currency: 'CDF' | 'USD';
  expectedCloseDate: string | null;
  lastActivityAt: string;
  daysSinceActivity: number;
  stale: boolean;
  closedAt: string | null;
  revision: number;
}

export interface OpportunityView extends OpportunitySummary {
  lostReason: string | null;
  stageHistory: {
    stageKey: string;
    stageLabel: string;
    at: string;
    by: string;
    source: CrmStageEvent['source'];
    quoteId: string | null;
  }[];
  quotes: {
    id: string;
    number: string;
    version: number;
    status: string;
    currency: 'CDF' | 'USD';
    total: string | null;
    validUntil: string;
  }[];
  createdAt: string;
  updatedAt: string;
}

export interface OpportunityPage {
  items: OpportunitySummary[];
  nextCursor: string | null;
}

export interface ActivityBrief {
  id: string;
  kind: string;
  subject: string;
  dueAt: string | null;
  overdue: boolean;
  opportunityId: string | null;
  opportunityTitle: string | null;
}

export interface PipelineView {
  calculationVersion: string;
  generatedAt: string;
  settings: CrmSettingsView;
  stages: {
    key: string;
    label: string;
    kind: PipelineStage['kind'];
    opportunities: OpportunitySummary[];
    /** Somme des montants estimés, par devise (moteur) ; jamais convertie. */
    totals: CurrencyTotal[];
    /** Probabilité historique (moteur) ; étapes en cours seulement. */
    winRate: StageWinRate | null;
  }[];
  stale: OpportunitySummary[];
  overdueActivities: ActivityBrief[];
  upcomingActivities: ActivityBrief[];
  winRateMinSample: number;
}

/** Résultat de la règle de gain d'un devis accepté (ADR-0035 § 1). */
export type QuoteOutcome = 'won' | 'disabled' | 'not_open' | 'none';

@Injectable()
export class OpportunitiesService {
  constructor(
    @InjectModel(CrmOpportunity.name)
    private readonly opportunities: Model<CrmOpportunityDocument>,
    @InjectModel(CrmActivity.name) private readonly activities: Model<CrmActivityDocument>,
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    @InjectModel(SalesQuote.name) private readonly quotes: Model<SalesQuoteDocument>,
    @Inject(ContactsService) private readonly contacts: ContactsService,
    @Inject(CrmSettingsService) private readonly settings: CrmSettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ── Lecture ──────────────────────────────────────────────────────────────

  async list(organizationId: string, query: ListOpportunitiesQuery): Promise<OpportunityPage> {
    const and: Record<string, unknown>[] = [{ organizationId }];
    if (query.status !== 'all') and.push({ status: query.status });
    if (query.stageKey) and.push({ stageKey: query.stageKey });
    if (query.customerId) and.push({ customerId: query.customerId.toLowerCase() });
    if (query.contactId) and.push({ contactId: query.contactId.toLowerCase() });
    if (query.q !== undefined) {
      const term = normalizeForSearch(query.q);
      if (term !== '') and.push({ searchKey: { $regex: escapeRegex(term) } });
    }
    if (query.cursor !== undefined) {
      const cursor = decodeTimeCursor(query.cursor);
      if (cursor === null) invalidCursor();
      and.push(beforeTimeCursor('createdAt', cursor));
    }
    const docs = await this.opportunities
      .find({ $and: and })
      .sort({ createdAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean<OpportunityLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    const settings = await this.settings.get(organizationId);
    return {
      items: await this.summaries(organizationId, page, settings, new Date()),
      nextCursor:
        docs.length > query.limit && last
          ? encodeTimeCursor(new Date(last.createdAt), String(last._id))
          : null,
    };
  }

  async get(organizationId: string, opportunityId: string): Promise<OpportunityView> {
    const doc = await this.requireOwn(organizationId, opportunityId);
    const settings = await this.settings.get(organizationId);
    const now = new Date();
    const [summary] = await this.summaries(organizationId, [doc], settings, now);
    const labels = new Map(settings.stages.map((s) => [s.key, s.label]));
    const quotes = await this.quotes
      .find({ organizationId, opportunityId: String(doc._id) })
      .sort({ createdAt: -1, _id: -1 })
      .limit(100)
      .lean<QuoteLean[]>()
      .exec();
    const today = kinshasaDay(now);
    return {
      ...summary!,
      lostReason: doc.lostReason ?? null,
      stageHistory: doc.stageHistory.map((e) => ({
        stageKey: e.stageKey,
        stageLabel: labels.get(e.stageKey) ?? e.stageKey,
        at: new Date(e.at).toISOString(),
        by: e.by,
        source: e.source,
        quoteId: e.quoteId ?? null,
      })),
      quotes: quotes.map((q) => ({
        id: String(q._id),
        number: q.number,
        version: q.version,
        status: quoteStatusOf(q.status, q.validUntil, today),
        currency: q.currency,
        total: q.documentAmounts.calculation.totals?.total ?? null,
        validUntil: q.validUntil,
      })),
      createdAt: new Date(doc.createdAt).toISOString(),
      updatedAt: new Date(doc.updatedAt).toISOString(),
    };
  }

  async requireOwn(organizationId: string, opportunityId: string): Promise<OpportunityLean> {
    if (!isObjectIdHex(opportunityId)) opportunityNotFound();
    const doc = await this.opportunities
      .findOne({ _id: new Types.ObjectId(opportunityId), organizationId })
      .lean<OpportunityLean>()
      .exec();
    if (!doc) opportunityNotFound();
    return doc;
  }

  async summaries(
    organizationId: string,
    docs: readonly OpportunityLean[],
    settings: CrmSettingsView,
    now: Date,
  ): Promise<OpportunitySummary[]> {
    const [customers, contacts] = await Promise.all([
      customerNamesOf(
        this.customers,
        organizationId,
        docs.map((d) => d.customerId),
      ),
      this.contacts.namesOf(
        organizationId,
        docs.flatMap((d) => (d.contactId ? [d.contactId] : [])),
      ),
    ]);
    const labels = new Map(settings.stages.map((s) => [s.key, s.label]));
    return docs.map((d) => {
      const last = new Date(d.lastActivityAt);
      return {
        id: String(d._id),
        title: d.title,
        customerId: d.customerId ?? null,
        customerName: d.customerId ? (customers.get(d.customerId) ?? null) : null,
        prospectName: d.prospectName ?? null,
        contactId: d.contactId ?? null,
        contactName: d.contactId ? (contacts.get(d.contactId) ?? null) : null,
        stageKey: d.stageKey,
        stageLabel: labels.get(d.stageKey) ?? d.stageKey,
        status: d.status,
        amount: d.amount ?? null,
        currency: d.currency,
        expectedCloseDate: d.expectedCloseDate ?? null,
        lastActivityAt: last.toISOString(),
        daysSinceActivity: daysSince(last, now),
        stale: isStale(d.status, last, settings.staleAfterDays, now),
        closedAt: d.closedAt ? new Date(d.closedAt).toISOString() : null,
        revision: d.revision,
      };
    });
  }

  // ── Pipeline et indicateurs déterministes ────────────────────────────────

  async pipeline(organizationId: string, now = new Date()): Promise<PipelineView> {
    const settings = await this.settings.get(organizationId);
    const since = new Date(now.getTime() - CLOSED_WINDOW_DAYS * 86_400_000);
    const staleBefore = new Date(now.getTime() - settings.staleAfterDays * 86_400_000);
    const [board, history, stale, overdue, upcoming] = await Promise.all([
      this.opportunities
        .find({
          organizationId,
          $or: [{ status: 'open' }, { closedAt: { $gte: since } }],
        })
        .sort({ lastActivityAt: -1, _id: -1 })
        .limit(BOARD_LIMIT)
        .lean<OpportunityLean[]>()
        .exec(),
      this.opportunities
        .find({ organizationId, status: { $in: ['won', 'lost'] } })
        .select({ status: 1, stageHistory: 1 })
        .sort({ closedAt: -1, _id: -1 })
        .limit(HISTORY_LIMIT)
        .lean<OpportunityLean[]>()
        .exec(),
      this.opportunities
        .find({ organizationId, status: 'open', lastActivityAt: { $lte: staleBefore } })
        .sort({ lastActivityAt: 1, _id: 1 })
        .limit(50)
        .lean<OpportunityLean[]>()
        .exec(),
      this.activities
        .find({ organizationId, done: false, dueAt: { $ne: null, $lt: now } })
        .sort({ dueAt: 1, _id: 1 })
        .limit(50)
        .lean<ActivityLean[]>()
        .exec(),
      this.activities
        .find({ organizationId, done: false, dueAt: { $gte: now } })
        .sort({ dueAt: 1, _id: 1 })
        .limit(20)
        .lean<ActivityLean[]>()
        .exec(),
    ]);

    const summaries = await this.summaries(organizationId, board, settings, now);
    const openKeys = settings.stages.filter((s) => s.kind === 'open').map((s) => s.key);
    const rates = stageWinRates({
      stages: openKeys,
      closed: history.map((h) => ({
        stagesVisited: h.stageHistory.map((e) => e.stageKey),
        won: h.status === 'won',
      })),
      minSample: DEFAULT_WIN_RATE_MIN_SAMPLE,
    });
    const titles = await this.titlesOf(
      organizationId,
      [...overdue, ...upcoming].flatMap((a) => (a.opportunityId ? [a.opportunityId] : [])),
    );
    const brief = (a: ActivityLean): ActivityBrief => ({
      id: String(a._id),
      kind: a.kind,
      subject: a.subject,
      dueAt: a.dueAt ? new Date(a.dueAt).toISOString() : null,
      overdue: isOverdue(a.done, a.dueAt ? new Date(a.dueAt) : null, now),
      opportunityId: a.opportunityId ?? null,
      opportunityTitle: a.opportunityId ? (titles.get(a.opportunityId) ?? null) : null,
    });

    return {
      calculationVersion: CRM_INDICATORS_VERSION,
      generatedAt: now.toISOString(),
      settings,
      stages: settings.stages.map((s) => {
        const items = summaries.filter((o) => o.stageKey === s.key);
        return {
          key: s.key,
          label: s.label,
          kind: s.kind,
          opportunities: items,
          totals: sumAmountsByCurrency(
            items.map((o) => ({ amount: o.amount, currency: o.currency })),
          ),
          winRate: s.kind === 'open' ? (rates[s.key] ?? null) : null,
        };
      }),
      stale: await this.summaries(organizationId, stale, settings, now),
      overdueActivities: overdue.map(brief),
      upcomingActivities: upcoming.map(brief),
      winRateMinSample: DEFAULT_WIN_RATE_MIN_SAMPLE,
    };
  }

  private async titlesOf(
    organizationId: string,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    const valid = [...new Set(ids.filter(isObjectIdHex))];
    if (valid.length === 0) return new Map();
    const docs = await this.opportunities
      .find({ _id: { $in: valid.map((i) => new Types.ObjectId(i)) }, organizationId })
      .select({ title: 1 })
      .lean<OpportunityLean[]>()
      .exec();
    return new Map(docs.map((d) => [String(d._id), d.title]));
  }

  // ── Écriture ─────────────────────────────────────────────────────────────

  private stageOf(settings: CrmSettingsView, key: string): PipelineStage {
    const stage = settings.stages.find((s) => s.key === key);
    if (!stage) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Corps de requête invalide.',
        details: {
          issues: [
            { path: 'stageKey', code: 'UNKNOWN_STAGE', message: `Étape inconnue : « ${key} ».` },
          ],
        },
      });
    }
    return stage;
  }

  private async checkRefs(organizationId: string, input: OpportunityInput): Promise<void> {
    await requireCustomer(this.customers, organizationId, input.customerId);
    if (input.contactId !== null) await this.contacts.requireOwn(organizationId, input.contactId);
  }

  private searchKey(input: OpportunityInput): string {
    return searchKeyOf([input.title, input.prospectName]);
  }

  async create(
    organizationId: string,
    stageKey: string | null,
    input: OpportunityInput,
    actor: CrmActor,
    source: CrmStageEvent['source'] = 'user',
  ): Promise<OpportunityView> {
    const doc = await this.build(organizationId, stageKey, input, actor, source);
    const created = await this.opportunities.create(doc);
    return this.get(organizationId, String(created._id));
  }

  /** Document d'une opportunité neuve, références vérifiées (création et import). */
  async build(
    organizationId: string,
    stageKey: string | null,
    input: OpportunityInput,
    actor: CrmActor,
    source: CrmStageEvent['source'],
  ): Promise<Record<string, unknown>> {
    const settings = await this.settings.get(organizationId);
    const stage = stageKey
      ? this.stageOf(settings, stageKey)
      : settings.stages.find((s) => s.kind === 'open')!;
    await this.checkRefs(organizationId, input);
    const now = new Date();
    return {
      organizationId,
      ...input,
      stageKey: stage.key,
      status: stage.kind,
      lostReason: null,
      closedAt: stage.kind === 'open' ? null : now,
      lastActivityAt: now,
      stageHistory: [{ stageKey: stage.key, at: now, by: actor.userId, source, quoteId: null }],
      searchKey: this.searchKey(input),
      revision: 1,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
    };
  }

  async insertMany(docs: readonly Record<string, unknown>[]): Promise<number> {
    if (docs.length === 0) return 0;
    return (await this.opportunities.insertMany(docs)).length;
  }

  async put(
    organizationId: string,
    opportunityId: string,
    expectedRevision: number,
    input: OpportunityInput,
    actor: CrmActor,
  ): Promise<OpportunityView> {
    const current = await this.requireOwn(organizationId, opportunityId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    await this.checkRefs(organizationId, input);
    const res = await this.opportunities
      .updateOne(
        { _id: current._id, organizationId, revision: expectedRevision },
        {
          $set: { ...input, searchKey: this.searchKey(input), updatedBy: actor.userId },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1) {
      staleRevision((await this.requireOwn(organizationId, opportunityId)).revision);
    }
    return this.get(organizationId, opportunityId);
  }

  /** Changement d'étape : historique, nature, clôture ; même étape → rien n'est écrit. */
  async move(
    organizationId: string,
    opportunityId: string,
    expectedRevision: number,
    stageKey: string,
    lostReason: string | null,
    actor: CrmActor,
  ): Promise<OpportunityView> {
    const current = await this.requireOwn(organizationId, opportunityId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    const settings = await this.settings.get(organizationId);
    const stage = this.stageOf(settings, stageKey);
    if (stage.key === current.stageKey) return this.get(organizationId, opportunityId);
    const now = new Date();
    const res = await this.opportunities
      .updateOne(
        { _id: current._id, organizationId, revision: expectedRevision },
        {
          $set: {
            stageKey: stage.key,
            status: stage.kind,
            closedAt: stage.kind === 'open' ? null : now,
            lostReason: stage.kind === 'lost' ? lostReason : null,
            lastActivityAt: now,
            updatedBy: actor.userId,
          },
          $push: {
            stageHistory: {
              stageKey: stage.key,
              at: now,
              by: actor.userId,
              source: 'user',
              quoteId: null,
            },
          },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1) {
      staleRevision((await this.requireOwn(organizationId, opportunityId)).revision);
    }
    return this.get(organizationId, opportunityId);
  }

  /** Suppression : refusée si un devis y est rattaché ; ses activités sont supprimées avec elle. */
  async remove(organizationId: string, opportunityId: string, actor: CrmActor): Promise<void> {
    const current = await this.requireOwn(organizationId, opportunityId);
    const quotes = await this.quotes
      .countDocuments({ organizationId, opportunityId: String(current._id) })
      .exec();
    if (quotes > 0) {
      conflict(
        'CRM_OPPORTUNITY_HAS_QUOTES',
        'Des devis sont rattachés à cette opportunité : passez-la plutôt en « perdu ».',
        { quotes },
      );
    }
    await this.opportunities.deleteOne({ _id: current._id, organizationId }).exec();
    await this.activities.deleteMany({ organizationId, opportunityId: String(current._id) }).exec();
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'crm_opportunity.deleted',
      targetType: 'crm_opportunity',
      targetId: opportunityId,
    });
  }

  /** Une activité rattachée vient d'avoir lieu (création ou fin). */
  async touch(organizationId: string, opportunityId: string, at: Date): Promise<void> {
    await this.opportunities
      .updateOne(
        { _id: new Types.ObjectId(opportunityId), organizationId, lastActivityAt: { $lt: at } },
        { $set: { lastActivityAt: at } },
        { timestamps: false },
      )
      .exec();
  }

  /**
   * Règle de gain (ADR-0035 § 1) : un devis accepté fait passer son opportunité
   * OUVERTE à l'étape gagnée, si le réglage de l'organisation le permet. Une
   * opportunité déjà gagnée ou perdue n'est jamais réécrite.
   */
  async markWonFromQuote(
    organizationId: string,
    opportunityId: string | null,
    quoteId: string,
    actor: CrmActor,
    opts: { session?: ClientSession } = {},
  ): Promise<QuoteOutcome> {
    if (opportunityId === null || !isObjectIdHex(opportunityId)) return 'none';
    const settings = await this.settings.get(organizationId);
    if (!settings.autoWinOnQuoteAccepted) return 'disabled';
    const won = settings.stages.find((s) => s.kind === 'won')!;
    const now = new Date();
    const res = await this.opportunities
      .updateOne(
        { _id: new Types.ObjectId(opportunityId), organizationId, status: 'open' },
        {
          $set: {
            stageKey: won.key,
            status: 'won',
            closedAt: now,
            lostReason: null,
            lastActivityAt: now,
            updatedBy: actor.userId,
          },
          $push: {
            stageHistory: {
              stageKey: won.key,
              at: now,
              by: actor.userId,
              source: 'quote',
              quoteId,
            },
          },
          $inc: { revision: 1 },
        },
        opts.session ? { session: opts.session } : {},
      )
      .exec();
    return res.modifiedCount === 1 ? 'won' : 'not_open';
  }

  /** Toutes les opportunités (export CSV), bornées. */
  async all(organizationId: string, max: number): Promise<OpportunitySummary[]> {
    const docs = await this.opportunities
      .find({ organizationId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(max)
      .lean<OpportunityLean[]>()
      .exec();
    return this.summaries(
      organizationId,
      docs,
      await this.settings.get(organizationId),
      new Date(),
    );
  }
}
