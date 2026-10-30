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
  estimatedLinesAmount,
  probabilitiesFromWinRates,
  stageWinRates,
  sumAmountsByCurrency,
  weightedForecast,
  type CurrencyTotal,
  type StageWinRate,
  type WeightedForecast,
} from '@lalanda/engine';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
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
import {
  catalogItemNotFound,
  conflict,
  invalidCursor,
  staleRevision,
} from '../sales/sales.errors.js';
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
import type { ListOpportunitiesQuery, OpportunityInput, OpportunityLineInput } from './crm.dto.js';
import { opportunityNotFound } from './crm.errors.js';
import {
  CrmActivity,
  CrmOpportunity,
  type CrmActivityDocument,
  type CrmOpportunityDocument,
  type CrmStageEvent,
} from './crm.schemas.js';
import { beforeTimeCursor, decodeTimeCursor, encodeTimeCursor } from './time-cursor.js';
// ADR-0040 — C2
import { Membership, type MembershipDocument } from '../organizations/membership.schema.js';
import { CatalogItem, type CatalogItemDocument } from '../sales/catalog-item.schema.js';
import { CrmAccountsService } from './accounts/crm-accounts.service.js';
import { CrmNotifier } from './crm-notifier.js';
import type { AmountSource } from './crm-model.js';
import type { CrmOpportunityLine } from './crm.schemas.js';
import {
  CRM_OPPORTUNITY_EVENTS,
  type CrmOpportunityEvents,
  type OpportunitySuggestion,
  type OpportunityWonEvent,
} from './opportunity-events.js';

export type OpportunityLean = CrmOpportunity & { _id: Types.ObjectId };
type ActivityLean = CrmActivity & { _id: Types.ObjectId };

/** Clôturées récemment, montrées dans les colonnes « gagné » et « perdu » du tableau. */
const CLOSED_WINDOW_DAYS = 90;
const BOARD_LIMIT = 500;
const HISTORY_LIMIT = 5000;
/** Opportunités ouvertes lues pour la prévision pondérée (ADR-0040 § 7.1). */
const FORECAST_LIMIT = 20_000;

/** ADR-0040 — C2 : avertissement d'écriture (jamais un refus). */
export interface OpportunityWarning {
  code: 'CRM_LINE_WITHOUT_PRICE';
  lineIndex: number;
}

/** Ligne d'opportunité rendue (ADR-0040 § 2.3). */
export interface OpportunityLineView {
  catalogItemId: string | null;
  label: string;
  quantity: string;
  unit: string | null;
  /** Prix unitaire HORS TAXES ; `null` : sans prix (compté pour zéro). */
  unitPrice: string | null;
  discountPercent: string | null;
}

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
  // ── ADR-0040 — C2 ──
  accountId: string | null;
  accountName: string | null;
  ownerId: string | null;
  /** Ouverte et sans responsable membre de l'organisation : à réassigner. */
  orphaned: boolean;
  amountSource: AmountSource;
  lostReasonKey: string | null;
  wonAt: string | null;
}

export interface OpportunityView extends OpportunitySummary {
  /** Détail libre du motif de perte (ADR-0040 : `lostReasonKey` porte le motif). */
  lostReason: string | null;
  lines: OpportunityLineView[];
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
  // ── ADR-0040 — C2 ──
  /** Filtre responsable appliqué (`null` : tout le pipeline). */
  ownerId: string | null;
  /** Prévision pondérée par devise (moteur), sur les opportunités ouvertes. */
  forecast: WeightedForecast;
  /** Opportunités ouvertes orphelines (responsable parti) et leurs anciens responsables. */
  orphaned: { count: number; ownerIds: string[] };
}

/** Réponse d'écriture : la vue, plus les avertissements (ADR-0040 § 3.2). */
export type OpportunityWriteResult = OpportunityView & { warnings: OpportunityWarning[] };

/** Réponse de `move` : la vue et, au passage en gagné, les suggestions (ADR-0040 — C7). */
export type OpportunityMoveResult = OpportunityView & { suggestions: OpportunitySuggestion[] };

/** Résultat de la règle de gain d'un devis accepté (ADR-0035 § 1). */
export type QuoteOutcome = 'won' | 'disabled' | 'not_open' | 'none';

@Injectable()
export class OpportunitiesService {
  private readonly logger = new Logger(OpportunitiesService.name);

  constructor(
    @InjectModel(CrmOpportunity.name)
    private readonly opportunities: Model<CrmOpportunityDocument>,
    @InjectModel(CrmActivity.name) private readonly activities: Model<CrmActivityDocument>,
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    @InjectModel(SalesQuote.name) private readonly quotes: Model<SalesQuoteDocument>,
    @Inject(ContactsService) private readonly contacts: ContactsService,
    @Inject(CrmSettingsService) private readonly settings: CrmSettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
    // ADR-0040 — C2
    @Inject(CrmAccountsService) private readonly accounts: CrmAccountsService,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(CatalogItem.name) private readonly items: Model<CatalogItemDocument>,
    @Inject(CRM_OPPORTUNITY_EVENTS) private readonly events: CrmOpportunityEvents,
    @Inject(CrmNotifier) private readonly notifier: CrmNotifier,
  ) {}

  // ── Lecture ──────────────────────────────────────────────────────────────

  async list(
    organizationId: string,
    query: ListOpportunitiesQuery,
    callerId: string | null = null,
  ): Promise<OpportunityPage> {
    const and: Record<string, unknown>[] = [{ organizationId }];
    // ADR-0040 — C2 : filtres responsable et compte (confort ; tout `crm.read` voit tout).
    if (query.ownerId) and.push({ ownerId: query.ownerId === 'me' ? callerId : query.ownerId });
    if (query.accountId) and.push({ accountId: query.accountId.toLowerCase() });
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
      lines: (doc.lines ?? []).map(lineView),
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
    const [customers, contacts, accounts, members] = await Promise.all([
      customerNamesOf(
        this.customers,
        organizationId,
        docs.map((d) => d.customerId),
      ),
      this.contacts.namesOf(
        organizationId,
        docs.flatMap((d) => (d.contactId ? [d.contactId] : [])),
      ),
      this.accounts.byIds(
        organizationId,
        docs.map((d) => d.accountId),
      ),
      this.membersAmong(
        organizationId,
        docs.map((d) => d.ownerId),
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
        accountId: d.accountId ?? null,
        accountName: d.accountId ? (accounts.get(d.accountId)?.name ?? null) : null,
        ownerId: d.ownerId ?? null,
        orphaned: d.status === 'open' && !(d.ownerId && members.has(d.ownerId)),
        amountSource: d.amountSource ?? 'manual',
        lostReasonKey: d.lostReasonKey ?? null,
        wonAt: d.wonAt ? new Date(d.wonAt).toISOString() : null,
      };
    });
  }

  // ── Pipeline et indicateurs déterministes ────────────────────────────────

  async pipeline(
    organizationId: string,
    now = new Date(),
    ownerId: string | null = null,
  ): Promise<PipelineView> {
    const settings = await this.settings.get(organizationId);
    const since = new Date(now.getTime() - CLOSED_WINDOW_DAYS * 86_400_000);
    const staleBefore = new Date(now.getTime() - settings.staleAfterDays * 86_400_000);
    // ADR-0040 — C2 : filtre responsable (confort d'affichage, pas un contrôle d'accès).
    const owner = ownerId === null ? {} : { ownerId };
    const [board, history, stale, overdue, upcoming, open] = await Promise.all([
      this.opportunities
        .find({
          organizationId,
          ...owner,
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
        .find({ organizationId, ...owner, status: 'open', lastActivityAt: { $lte: staleBefore } })
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
      this.opportunities
        .find({ organizationId, ...owner, status: 'open' })
        .select({ stageKey: 1, amount: 1, currency: 1, expectedCloseDate: 1, ownerId: 1 })
        .limit(FORECAST_LIMIT)
        .lean<OpportunityLean[]>()
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
    // ADR-0040 — C2 (§ 7.1) : probabilités historiques seulement (décision n° 6).
    const forecast = weightedForecast({
      opportunities: open.map((o) => ({
        id: String(o._id),
        stageKey: o.stageKey,
        amount: o.amount ?? null,
        currency: o.currency,
        expectedCloseDate: o.expectedCloseDate ?? null,
        ownerId: o.ownerId ?? null,
      })),
      probabilities: probabilitiesFromWinRates(rates),
      probabilitySource: 'historical',
    });
    const members = await this.membersAmong(
      organizationId,
      open.map((o) => o.ownerId),
    );
    const orphans = open.filter((o) => !(o.ownerId && members.has(o.ownerId)));
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
      ownerId,
      forecast,
      orphaned: {
        count: orphans.length,
        ownerIds: [...new Set(orphans.flatMap((o) => (o.ownerId ? [o.ownerId] : [])))].sort(),
      },
    };
  }

  /** Identifiants, parmi `ids`, des membres actuels de l'organisation. */
  private async membersAmong(
    organizationId: string,
    ids: readonly (string | null | undefined)[],
  ): Promise<Set<string>> {
    const valid = [...new Set(ids.filter((i): i is string => typeof i === 'string'))];
    if (valid.length === 0) return new Set();
    const docs = await this.memberships
      .find({ organizationId, userId: { $in: valid } }, { userId: 1 })
      .lean<{ userId: string }[]>()
      .exec();
    return new Set(docs.map((d) => d.userId));
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

  /**
   * ADR-0040 — C2 : compte, responsable, lignes et montant d'une écriture.
   * `current` : opportunité modifiée (un champ non envoyé reste inchangé).
   * Ressources d'une autre organisation : 404 (compte, responsable, article).
   */
  private async resolveV2(
    organizationId: string,
    input: OpportunityInput,
    actor: CrmActor,
    current: OpportunityLean | null,
  ): Promise<{
    fields: Record<string, unknown>;
    input: OpportunityInput;
    warnings: OpportunityWarning[];
  }> {
    // Compte : `accountId` fait foi ; sans lui, `customerId` / `prospectName`
    // sont résolus (compatibilité N-1, même règle que les contacts de C1).
    let resolved = input;
    let accountId: string | null = null;
    if (input.accountId) {
      const account = await this.accounts.requireUsable(organizationId, input.accountId);
      accountId = String(account._id);
      resolved = {
        ...input,
        customerId: account.customerId ?? null,
        prospectName: account.customerId ? null : account.name,
      };
    } else {
      await requireCustomer(this.customers, organizationId, input.customerId);
      const account = await this.accounts.resolveLegacy(
        organizationId,
        { customerId: input.customerId, companyName: input.prospectName },
        actor,
      );
      accountId = account ? String(account._id) : null;
    }

    // Responsable : membre détenant `crm.manage` (404 hors organisation, 400 sinon).
    const ownerId = input.ownerId ?? current?.ownerId ?? actor.userId;
    if (input.ownerId !== undefined && input.ownerId !== current?.ownerId) {
      await this.accounts.assertOwner(organizationId, input.ownerId);
    }

    const amountSource: AmountSource = input.amountSource ?? current?.amountSource ?? 'manual';
    const lines =
      input.lines === undefined
        ? (current?.lines ?? []).map(lineView)
        : await this.resolveLines(organizationId, input.currency, input.lines);
    if (input.lines === undefined && current && current.currency !== input.currency) {
      const priced = lines.findIndex((l) => l.unitPrice !== null);
      if (priced >= 0) lineCurrencyMismatch(priced);
    }
    const warnings: OpportunityWarning[] = lines.flatMap((l, lineIndex) =>
      l.unitPrice === null ? [{ code: 'CRM_LINE_WITHOUT_PRICE' as const, lineIndex }] : [],
    );
    let amount = resolved.amount;
    if (amountSource === 'lines') {
      // Total HORS TAXES des lignes, calculé par le moteur (décision ouverte n° 8).
      const total = estimatedLinesAmount(lines).amount;
      amount = total === null || total === '0.00' ? null : total;
    }
    resolved = { ...resolved, amount };
    return {
      input: resolved,
      fields: { accountId, ownerId, lines, amountSource },
      warnings,
    };
  }

  /** Lignes : articles de l'organisation, libellé, unité et prix HT copiés à l'ajout. */
  private async resolveLines(
    organizationId: string,
    currency: 'CDF' | 'USD',
    lines: readonly OpportunityLineInput[],
  ): Promise<OpportunityLineView[]> {
    const ids = [...new Set(lines.flatMap((l) => (l.catalogItemId ? [l.catalogItemId] : [])))];
    const items = new Map<string, CatalogItem & { _id: Types.ObjectId }>();
    if (ids.length > 0) {
      const docs = await this.items
        .find({ _id: { $in: ids.map((i) => new Types.ObjectId(i)) }, organizationId })
        .lean<(CatalogItem & { _id: Types.ObjectId })[]>()
        .exec();
      for (const d of docs) items.set(String(d._id), d);
      if (items.size !== ids.length) catalogItemNotFound();
    }
    return lines.map((l, index) => {
      const item = l.catalogItemId ? items.get(l.catalogItemId)! : null;
      // Jamais de conversion entre devises (§ 2.6).
      if (item && item.currency !== currency) lineCurrencyMismatch(index);
      const copiedPrice = item && item.priceMode === 'ht' ? item.unitPrice : null;
      return {
        catalogItemId: item ? String(item._id) : null,
        label: l.label ?? item?.name ?? '',
        quantity: l.quantity,
        unit: l.unit !== undefined ? l.unit : (item?.unit ?? null),
        // Un article au prix TTC n'est pas recopié : le prix HT se saisit.
        unitPrice: l.unitPrice !== undefined ? l.unitPrice : copiedPrice,
        discountPercent: l.discountPercent,
      };
    });
  }

  /** Motif de perte : clé active des réglages, obligatoire si les réglages l'exigent. */
  private lostReasonFor(settings: CrmSettingsView, lostReasonKey: string | null): string | null {
    if (lostReasonKey === null) {
      if (settings.lostReasonRequired) {
        throw new BadRequestException({
          code: 'CRM_LOST_REASON_REQUIRED',
          message: 'Choisissez le motif de la perte.',
        });
      }
      return null;
    }
    if (!settings.lostReasons.some((r) => r.key === lostReasonKey && r.active)) {
      throw new BadRequestException({
        code: 'CRM_LOST_REASON_UNKNOWN',
        message: 'Ce motif de perte n’existe pas ou est désactivé.',
        details: { lostReasonKey },
      });
    }
    return lostReasonKey;
  }

  async create(
    organizationId: string,
    stageKey: string | null,
    input: OpportunityInput,
    actor: CrmActor,
    source: CrmStageEvent['source'] = 'user',
    lost: { lostReasonKey: string | null; lostReasonDetail: string | null } = {
      lostReasonKey: null,
      lostReasonDetail: null,
    },
  ): Promise<OpportunityWriteResult> {
    const { doc, warnings } = await this.buildV2(
      organizationId,
      stageKey,
      input,
      actor,
      source,
      lost,
    );
    const created = await this.opportunities.create(doc);
    const view = await this.get(organizationId, String(created._id));
    await this.notifyAssigned(organizationId, view.id, view.title, view.ownerId, actor.userId);
    if (view.status === 'won')
      await this.notifyWon(organizationId, created.toObject(), actor.userId, 'user', null);
    return { ...view, warnings };
  }

  /** Document d'une opportunité neuve, références vérifiées (création et import). */
  async build(
    organizationId: string,
    stageKey: string | null,
    input: OpportunityInput,
    actor: CrmActor,
    source: CrmStageEvent['source'],
    // ADR-0040 — C9 : l'import CSV transmet le motif de perte (exigé pour une
    // opportunité perdue si les réglages l'imposent, comme à la création).
    lost: { lostReasonKey: string | null; lostReasonDetail: string | null } = {
      lostReasonKey: null,
      lostReasonDetail: null,
    },
  ): Promise<Record<string, unknown>> {
    return (await this.buildV2(organizationId, stageKey, input, actor, source, lost)).doc;
  }

  private async buildV2(
    organizationId: string,
    stageKey: string | null,
    input: OpportunityInput,
    actor: CrmActor,
    source: CrmStageEvent['source'],
    lost: { lostReasonKey: string | null; lostReasonDetail: string | null } | null,
  ): Promise<{ doc: Record<string, unknown>; warnings: OpportunityWarning[] }> {
    const settings = await this.settings.get(organizationId);
    const stage = stageKey
      ? this.stageOf(settings, stageKey)
      : settings.stages.find((s) => s.kind === 'open')!;
    const lostReasonKey =
      stage.kind === 'lost' && lost !== null
        ? this.lostReasonFor(settings, lost.lostReasonKey)
        : null;
    await this.checkRefs(organizationId, input);
    const v2 = await this.resolveV2(organizationId, input, actor, null);
    const now = new Date();
    return {
      warnings: v2.warnings,
      doc: {
        organizationId,
        ...stripV2(v2.input),
        ...v2.fields,
        stageKey: stage.key,
        status: stage.kind,
        lostReason: stage.kind === 'lost' ? (lost?.lostReasonDetail ?? null) : null,
        lostReasonKey,
        wonAt: stage.kind === 'won' ? now : null,
        closedAt: stage.kind === 'open' ? null : now,
        lastActivityAt: now,
        stageHistory: [{ stageKey: stage.key, at: now, by: actor.userId, source, quoteId: null }],
        searchKey: this.searchKey(v2.input),
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        _schemaVersion: 1,
      },
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
  ): Promise<OpportunityWriteResult> {
    const current = await this.requireOwn(organizationId, opportunityId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    await this.checkRefs(organizationId, input);
    const v2 = await this.resolveV2(organizationId, input, actor, current);
    const res = await this.opportunities
      .updateOne(
        { _id: current._id, organizationId, revision: expectedRevision },
        {
          $set: {
            ...stripV2(v2.input),
            ...v2.fields,
            searchKey: this.searchKey(v2.input),
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
      )
      .exec();
    if (res.matchedCount !== 1) {
      staleRevision((await this.requireOwn(organizationId, opportunityId)).revision);
    }
    if (v2.fields['ownerId'] !== current.ownerId) {
      await this.audit.record({
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'crm_opportunity.owner_changed',
        targetType: 'crm_opportunity',
        targetId: opportunityId,
        metadata: { from: current.ownerId ?? null, to: v2.fields['ownerId'] as string },
      });
      await this.notifyAssigned(
        organizationId,
        opportunityId,
        v2.input.title,
        v2.fields['ownerId'] as string,
        actor.userId,
      );
    }
    return { ...(await this.get(organizationId, opportunityId)), warnings: v2.warnings };
  }

  /** Changement d'étape : historique, nature, clôture ; même étape → rien n'est écrit. */
  async move(
    organizationId: string,
    opportunityId: string,
    expectedRevision: number,
    stageKey: string,
    lost: { lostReasonKey: string | null; lostReasonDetail: string | null },
    actor: CrmActor,
  ): Promise<OpportunityMoveResult> {
    const current = await this.requireOwn(organizationId, opportunityId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    const settings = await this.settings.get(organizationId);
    const stage = this.stageOf(settings, stageKey);
    if (stage.key === current.stageKey) {
      return { ...(await this.get(organizationId, opportunityId)), suggestions: [] };
    }
    // ADR-0040 — C2 (§ 2.3) : motif obligatoire pour passer en perdu.
    const lostReasonKey =
      stage.kind === 'lost' ? this.lostReasonFor(settings, lost.lostReasonKey) : null;
    const now = new Date();
    const res = await this.opportunities
      .updateOne(
        { _id: current._id, organizationId, revision: expectedRevision },
        {
          $set: {
            stageKey: stage.key,
            status: stage.kind,
            closedAt: stage.kind === 'open' ? null : now,
            lostReason: stage.kind === 'lost' ? lost.lostReasonDetail : null,
            lostReasonKey,
            wonAt: stage.kind === 'won' ? now : null,
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
    if (stage.kind === 'won' && current.status !== 'won') {
      await this.notifyWon(organizationId, current, actor.userId, 'user', null, now);
      // ADR-0040 — C7 § 6.4 : proposer, jamais créer.
      const view = await this.get(organizationId, opportunityId);
      return { ...view, suggestions: await this.wonSuggestions(organizationId, opportunityId) };
    }
    return { ...(await this.get(organizationId, opportunityId)), suggestions: [] };
  }

  /** ADR-0040 — C7 : `CREATE_PROJECT` si aucun projet n'existe ; une erreur → aucune suggestion. */
  private async wonSuggestions(
    organizationId: string,
    opportunityId: string,
  ): Promise<OpportunitySuggestion[]> {
    try {
      return (await this.events.projectExists(organizationId, opportunityId))
        ? []
        : [{ code: 'CREATE_PROJECT' }];
    } catch (err) {
      this.logger.error(
        `Suggestion « Créer le projet » non calculée (${opportunityId}) : ${String(err)}`,
      );
      return [];
    }
  }

  /**
   * Réassignation en masse (départ d'un membre, ADR-0040 § 3.2) : les
   * opportunités de `fromOwnerId` (ouvertes seulement par défaut) passent à
   * `toOwnerId`, éligible (`crm.manage`). `fromOwnerId` peut ne plus être membre.
   */
  async reassign(
    organizationId: string,
    input: { fromOwnerId: string; toOwnerId: string; onlyOpen: boolean },
    actor: CrmActor,
  ): Promise<{ reassigned: number }> {
    await this.accounts.assertOwner(organizationId, input.toOwnerId);
    if (input.fromOwnerId === input.toOwnerId) return { reassigned: 0 };
    const filter = {
      organizationId,
      ownerId: input.fromOwnerId,
      ...(input.onlyOpen ? { status: 'open' } : {}),
    };
    const targets = await this.opportunities
      .find(filter, { title: 1 })
      .lean<{ _id: Types.ObjectId; title: string }[]>()
      .exec();
    const res = await this.opportunities
      .updateMany(
        { ...filter, _id: { $in: targets.map((t) => t._id) } },
        { $set: { ownerId: input.toOwnerId, updatedBy: actor.userId }, $inc: { revision: 1 } },
      )
      .exec();
    // Une notification par opportunité au nouveau responsable (sauf l'auteur).
    for (const t of targets) {
      await this.notifyAssigned(
        organizationId,
        String(t._id),
        t.title,
        input.toOwnerId,
        actor.userId,
      );
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'crm_opportunity.reassigned',
      targetType: 'crm_opportunity',
      targetId: input.fromOwnerId,
      metadata: { ...input, reassigned: res.modifiedCount },
    });
    return { reassigned: res.modifiedCount };
  }

  /** `crm.opportunity_assigned` au responsable, sauf s'il est l'auteur (notifier de C4). */
  private async notifyAssigned(
    organizationId: string,
    opportunityId: string,
    title: string,
    ownerId: string | null,
    actorUserId: string,
  ): Promise<void> {
    await this.notifier.opportunityEvent({
      kind: 'crm.opportunity_assigned',
      organizationId,
      opportunityId,
      recipients: [ownerId],
      title: `Opportunité confiée : ${title}`,
      href: `/crm/opportunites/${opportunityId}`,
      actorUserId,
    });
  }

  /**
   * Point d'extension « opportunité gagnée » (ADR-0040 § 6.4) : APRÈS
   * l'écriture ; une erreur est journalisée, jamais propagée.
   */
  private async notifyWon(
    organizationId: string,
    doc: Pick<OpportunityLean, '_id' | 'ownerId'>,
    actorUserId: string,
    source: OpportunityWonEvent['source'],
    quoteId: string | null,
    wonAt = new Date(),
  ): Promise<void> {
    try {
      await this.events.onWon({
        organizationId,
        opportunityId: String(doc._id),
        ownerId: doc.ownerId ?? null,
        actorUserId,
        source,
        quoteId,
        wonAt,
      });
    } catch (err) {
      this.logger.error(
        `Événement « opportunité gagnée » non traité (${String(doc._id)}) : ${String(err)}`,
      );
    }
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
            // ADR-0040 — C2
            lostReasonKey: null,
            wonAt: now,
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
    if (res.modifiedCount !== 1) return 'not_open';
    // ADR-0040 — C2 : appelé dans la transaction du devis s'il y en a une ; le
    // fournisseur branché doit donc rester idempotent (voir opportunity-events.ts).
    const won2 = await this.opportunities
      .findOne({ _id: new Types.ObjectId(opportunityId), organizationId }, { ownerId: 1 })
      .session(opts.session ?? null)
      .lean<OpportunityLean>()
      .exec();
    if (won2) await this.notifyWon(organizationId, won2, actor.userId, 'quote', quoteId, now);
    return 'won';
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

// ── ADR-0040 — C2 : aides pures ─────────────────────────────────────────────

function lineView(l: CrmOpportunityLine): OpportunityLineView {
  return {
    catalogItemId: l.catalogItemId ?? null,
    label: l.label,
    quantity: l.quantity,
    unit: l.unit ?? null,
    unitPrice: l.unitPrice ?? null,
    discountPercent: l.discountPercent ?? null,
  };
}

/** Champs v2 de l'entrée retirés : le service les écrit lui-même (`resolveV2`). */
function stripV2(
  input: OpportunityInput,
): Omit<OpportunityInput, 'accountId' | 'ownerId' | 'lines' | 'amountSource'> {
  const { accountId: _a, ownerId: _o, lines: _l, amountSource: _s, ...rest } = input;
  return rest;
}

function lineCurrencyMismatch(lineIndex: number): never {
  throw new BadRequestException({
    code: 'CRM_LINE_CURRENCY_MISMATCH',
    message:
      'Le prix de cet article est dans une autre devise que l’opportunité : aucune conversion n’est faite.',
    details: { lineIndex },
  });
}
