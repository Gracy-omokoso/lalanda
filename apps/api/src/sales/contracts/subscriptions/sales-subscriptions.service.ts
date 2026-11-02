// Échéancier et abonnements — ADR-0050 § 2.4, § 3, § 4.3, § 5.3, O6, O7. ADR-0050 — V5.
//
// - Échéances : moteur `contracts` (`billingOccurrences`, récurrence par `occurrencesOf`
//   du module `treasury` ; `occurrenceStatus`). Bornes facturables : `billableUntil` de
//   `contractTerms` (fin du terme CONSTATÉ, ou date d'effet de la résiliation) ; rien
//   n'est préparé au-delà. Aucun prorata, aucun pourcentage : chaque brouillon reprend
//   les lignes EN VIGUEUR à la date de l'échéance (`termsAt`), à prix figés.
// - Préparer = un BROUILLON (pro forma) par `InvoiceDraftsService.create`, seul écrivain
//   de `sales_invoices`, puis un lien `sales_document_links` (`subscription_occurrence`
//   avec `occurrenceDate`, ou `schedule_item` avec `itemRef` ET `occurrenceDate`). Les
//   index uniques partiels du lien garantissent UN brouillon par échéance : une
//   préparation concurrente qui perd retire son brouillon. RIEN n'est émis ni normalisé,
//   aucun appel e-MCF/DGI : l'émission reste un geste humain sous `sales.invoice`.
// - Échéance bloquée (aucun brouillon, motif affiché) : client désactivé, calcul en
//   erreur, terme échu sans reconduction constatée, résiliation, avenant non signé dont
//   la date d'effet est atteinte.
//
// Isolation : chaque lecture et écriture porte `organizationId` ; un contrat d'une autre
// organisation répond 404. Chaque préparation est auditée.

import {
  billingOccurrences,
  occurrenceStatus,
  termsAt,
  type BillingOccurrence,
  type ContractBilling,
  type ContractTermsResult,
  type OccurrenceBlock,
  type OccurrenceBlockReason,
  type OccurrenceState,
} from '@lalanda/engine';
import {
  type SalesContractOccurrenceBlock,
  type SalesContractSettingsValues,
  type SalesEngagementInvoiceType,
} from '@lalanda/shared/sales-contracts';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, type Connection } from 'mongoose';

import { addDays, kinshasaDay } from '../../../crm/crm-model.js';
import { InvoiceDraftsService } from '../../invoices/invoice-drafts.service.js';
import type { InvoiceActor } from '../../invoices/invoice.types.js';
import type { InvoiceDraftInput } from '../../invoices/invoices.dto.js';
import { lineInputOf } from '../../quotes/quotes.service.js';
import { conflict, invalidRequestOf, isDuplicateKey } from '../../sales.errors.js';
import { READ_ONLY_COLLECTIONS, contractsNotFound } from '../common/contracts.common.js';
import { storedLineOf, type EngagementLine } from '../common/engagement-document.js';
import {
  canonicalJson,
  engineAmendmentOf,
  engineContractOf,
} from '../contracts/sales-contract-model.js';
import type { SalesContractLean } from '../contracts/sales-contract.schema.js';
import { SalesContractsService } from '../contracts/sales-contracts.service.js';
import { SalesDocumentLinksService, type LiveLink } from '../links/sales-document-links.service.js';
import { SalesContractSettingsService } from '../settings/sales-contract-settings.service.js';
import type { SalesContractAmendmentLean } from '../amendments/sales-contract-amendment.schema.js';
import {
  BLOCK_CODE_OF,
  BLOCK_MESSAGES,
  COMMENT_C_MAX,
  OCCURRENCE_STATE_LABELS,
  SCHEDULE_DEFAULT_FUTURE_DAYS,
  SCHEDULE_DEFAULT_PAST_DAYS,
  SCHEDULE_MAX_SPAN_DAYS,
  SUBSCRIPTIONS_ACTOR,
  occurrenceComment,
  scheduleKeyOf,
} from './sales-subscriptions-model.js';

// ── Vues ─────────────────────────────────────────────────────────────────────

export interface SalesOccurrenceWarning {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface SalesOccurrenceInvoice {
  invoiceId: string;
  type: string;
  status: string;
  reference: string | null;
  currency: 'CDF' | 'USD';
  /** Total RECOPIÉ du calcul du moteur des factures (`null` sans calcul). */
  total: string | null;
}

export interface SalesOccurrenceView {
  key: string;
  kind: 'schedule_item' | 'subscription_occurrence';
  date: string;
  itemRef: string | null;
  label: string | null;
  /** LIBELLÉ de période d'un abonnement ; aucun montant n'en dépend. */
  periodStart: string | null;
  periodEnd: string | null;
  /** La période libellée déborde du terme facturable : constat, aucun prorata. */
  periodExceedsBounds: boolean;
  state: OccurrenceState;
  stateLabel: string;
  invoice: SalesOccurrenceInvoice | null;
  reasons: { code: SalesContractOccurrenceBlock; message: string }[];
  /** Préparable par la tâche (réglage d'organisation et du contrat). */
  autoPrepare: boolean;
}

export interface SalesContractScheduleView {
  contractId: string;
  number: string;
  status: SalesContractLean['status'];
  billingKind: ContractBilling['kind'];
  today: string;
  window: { from: string; to: string };
  /** Les brouillons sont préparés N jours avant l'échéance (réglage). */
  leadDays: number;
  /** Début de la fenêtre de rattrapage de la tâche (aujourd'hui − 90 jours). */
  catchUpFrom: string;
  /** Préparation automatique active pour l'organisation. */
  autoPrepareEnabled: boolean;
  /** Dernier jour facturable (`null` = sans borne) ; aucune échéance au-delà. */
  billableUntil: string | null;
  entries: SalesOccurrenceView[];
  warnings: SalesOccurrenceWarning[];
}

export interface PreparedOccurrence {
  invoiceId: string;
  warnings: SalesOccurrenceWarning[];
  occurrence: SalesOccurrenceView;
}

export interface SubscriptionsRunReport {
  today: string;
  contracts: number;
  prepared: number;
  blocked: number;
  failed: number;
}

// ── Plan d'un contrat ────────────────────────────────────────────────────────

interface PlannedOccurrence {
  occurrence: BillingOccurrence;
  billing: ContractBilling<EngagementLine>;
  /** Motifs connus sans calcul (le calcul n'est tenté qu'au besoin). */
  reasons: OccurrenceBlockReason[];
}

interface ContractPlan {
  contract: SalesContractLean;
  amendments: SalesContractAmendmentLean[];
  settings: SalesContractSettingsValues;
  today: string;
  terms: ContractTermsResult | null;
  billingToday: ContractBilling<EngagementLine>;
  planned: PlannedOccurrence[];
  live: Map<string, LiveLink>;
  customerActive: boolean;
}

/** Lien vivant → clé d'échéance du moteur. */
function keyOfLink({ link }: LiveLink): string | null {
  if (link.kind === 'subscription_occurrence' && link.occurrenceDate) return link.occurrenceDate;
  if (link.kind === 'schedule_item' && link.itemRef) return scheduleKeyOf(link.itemRef);
  return null;
}

const maxDay = (a: string, b: string) => (a > b ? a : b);

@Injectable()
export class SalesSubscriptionsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(SalesContractsService) private readonly contracts: SalesContractsService,
    @Inject(SalesDocumentLinksService) private readonly links: SalesDocumentLinksService,
    @Inject(SalesContractSettingsService) private readonly settings: SalesContractSettingsService,
    @Inject(InvoiceDraftsService) private readonly drafts: InvoiceDraftsService,
  ) {}

  // ── Lecture ──────────────────────────────────────────────────────────────

  /** Le client du contrat est actif dans l'organisation (lecture seule). */
  private async customerActive(organizationId: string, customerId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(customerId)) return false;
    const doc = await this.connection
      .collection(READ_ONLY_COLLECTIONS.customers)
      .findOne(
        { _id: new Types.ObjectId(customerId), organizationId },
        { projection: { active: 1 } },
      );
    return doc !== null && (doc as { active?: boolean }).active !== false;
  }

  /**
   * Échéances d'un contrat signé (ou résilié) dans `[from, to]`, avec l'échéancier en
   * vigueur à chaque date : un avenant signé qui change l'échéancier vaut à partir de sa
   * date d'effet. Au-delà du dernier jour facturable, une échéance n'est retenue que pour
   * MONTRER pourquoi rien n'est préparé (reconduction à constater, résiliation).
   */
  private async plan(
    organizationId: string,
    contract: SalesContractLean,
    today: string,
    window: { from: string; to: string },
  ): Promise<ContractPlan> {
    const contractId = String(contract._id);
    const [amendments, settings, live, customerActive] = await Promise.all([
      this.contracts.amendmentsOf(organizationId, contractId),
      this.settings.values(organizationId),
      this.links.liveLinks(organizationId, [{ contractId }]),
      this.customerActive(organizationId, contract.customerId),
    ]);
    const engineContract = engineContractOf(contract);
    const engineAmendments = amendments.map(engineAmendmentOf);
    const terms = this.contracts.termsOf(contract, amendments, today, settings);
    const billingToday = termsAt(engineContract, engineAmendments, today).terms.billing;

    const liveByKey = new Map<string, LiveLink>();
    for (const l of live) {
      const key = keyOfLink(l);
      if (key !== null && !liveByKey.has(key)) liveByKey.set(key, l);
    }

    const base: ContractPlan = {
      contract,
      amendments,
      settings,
      today,
      terms,
      billingToday,
      planned: [],
      live: liveByKey,
      customerActive,
    };
    if (terms === null || window.from > window.to) return base;

    // Bornes de calcul : le dernier jour facturable, prolongé pour montrer le terme
    // proposé (reconduction à constater) ou le reste du terme après une résiliation.
    let extendedEnd = terms.billableUntil;
    let beyond: { fromDate: string; reason: OccurrenceBlockReason } | null = null;
    if (contract.termination && terms.billableUntil !== null) {
      beyond = { fromDate: addDays(terms.billableUntil, 1), reason: 'TERMINATED' };
      extendedEnd =
        terms.lastTermEnd === null ? null : maxDay(terms.lastTermEnd, terms.billableUntil);
    } else if (terms.proposedNextTerm !== null && terms.billableUntil !== null) {
      beyond = { fromDate: addDays(terms.billableUntil, 1), reason: 'RENEWAL_NOT_RECORDED' };
      extendedEnd = terms.proposedNextTerm.to;
    }

    // Échéanciers distincts : celui du contrat et ceux des avenants signés.
    const billings = new Map<string, ContractBilling<EngagementLine>>();
    const remember = (b: ContractBilling<EngagementLine>) => {
      const k = canonicalJson(b);
      if (!billings.has(k)) billings.set(k, b);
    };
    remember(engineContract.billing);
    for (const a of engineAmendments) {
      if (a.status === 'signed' && a.changes.billing !== undefined) remember(a.changes.billing);
    }

    const planned = new Map<string, PlannedOccurrence>();
    for (const [k, billing] of billings) {
      if (billing.kind === 'none') continue;
      const { occurrences } = billingOccurrences(
        billing,
        { startDate: contract.startDate, endDate: extendedEnd },
        window.from,
        window.to,
      );
      for (const occurrence of occurrences) {
        if (planned.has(occurrence.key)) continue;
        const inForce = termsAt(engineContract, engineAmendments, occurrence.date);
        // L'échéance appartient à l'échéancier EN VIGUEUR à sa date, et à lui seul.
        if (canonicalJson(inForce.terms.billing) !== k) continue;
        const reasons: OccurrenceBlockReason[] = [];
        if (!customerActive) reasons.push('CUSTOMER_ARCHIVED');
        if (beyond && occurrence.date >= beyond.fromDate) reasons.push(beyond.reason);
        if (inForce.pendingAmendments.length > 0) reasons.push('AMENDMENT_PENDING');
        planned.set(occurrence.key, { occurrence, billing, reasons });
      }
    }
    base.planned = [...planned.values()].sort(
      (a, b) =>
        a.occurrence.date.localeCompare(b.occurrence.date) ||
        a.occurrence.key.localeCompare(b.occurrence.key),
    );
    return base;
  }

  /** Lignes EN VIGUEUR à la date de l'échéance (prix figés du contrat ou de l'avenant). */
  private linesOf(plan: ContractPlan, p: PlannedOccurrence): EngagementLine[] {
    const inForce = termsAt(
      engineContractOf(plan.contract),
      plan.amendments.map(engineAmendmentOf),
      p.occurrence.date,
    ).terms;
    if (p.occurrence.kind === 'subscription_occurrence') return [...inForce.lines];
    const billing = inForce.billing;
    const item =
      billing.kind === 'schedule'
        ? billing.items.find((i) => i.itemRef === p.occurrence.itemRef)
        : undefined;
    return [...(item?.lines ?? [])];
  }

  private labelOf(p: PlannedOccurrence): string | null {
    if (p.billing.kind !== 'schedule') return null;
    return p.billing.items.find((i) => i.itemRef === p.occurrence.itemRef)?.label ?? null;
  }

  /** Préparable par la tâche : réglage d'organisation, et `autoPrepare` d'un abonnement. */
  private autoPrepareOf(plan: ContractPlan, p: PlannedOccurrence): boolean {
    if (!plan.settings.autoPrepareSubscriptionDrafts) return false;
    return p.billing.kind === 'recurring' ? p.billing.autoPrepare : true;
  }

  /** Brouillon de l'échéance (forme exacte d'une facture saisie à la main). */
  private draftOf(
    plan: ContractPlan,
    p: PlannedOccurrence,
    type: SalesEngagementInvoiceType,
  ): { draft: InvoiceDraftInput; lines: EngagementLine[]; commentTruncated: boolean } {
    const c = plan.contract;
    const lines = this.linesOf(plan, p);
    const comment =
      p.occurrence.kind === 'subscription_occurrence'
        ? occurrenceComment({
            kind: 'subscription_occurrence',
            number: c.number,
            periodStart: p.occurrence.periodStart,
            periodEnd: p.occurrence.periodEnd,
            date: p.occurrence.date,
          })
        : occurrenceComment({
            kind: 'schedule_item',
            number: c.number,
            itemRef: p.occurrence.itemRef ?? '',
            date: p.occurrence.date,
            label: this.labelOf(p),
          });
    return {
      draft: {
        type,
        currency: c.currency,
        priceMode: c.priceMode,
        customer: {
          customerId: c.customerId,
          printContactDetails: c.customer.printContactDetails,
        },
        pointOfSaleId: null,
        lines: lines.map((l) => lineInputOf(storedLineOf(l), true)),
        payments: [],
        comments: { A: null, C: comment.text },
        creditNote: null,
        showUsdCounterValue: false,
      },
      lines,
      commentTruncated: comment.truncated,
    };
  }

  /** Le brouillon se calcule (taux DGI relevés, lignes valides) ; aucun montant ici. */
  private async computes(organizationId: string, draft: InvoiceDraftInput): Promise<boolean> {
    if (draft.lines.length === 0) return false;
    try {
      const composed = await this.drafts.compose(organizationId, draft);
      return composed.documentAmounts.calculation.ok;
    } catch {
      return false;
    }
  }

  /** Motifs complets d'une échéance non préparée (calcul compris). */
  private async reasonsOf(
    organizationId: string,
    plan: ContractPlan,
    p: PlannedOccurrence,
  ): Promise<OccurrenceBlockReason[]> {
    if (p.reasons.length > 0) return p.reasons;
    const { draft } = this.draftOf(plan, p, 'FV');
    return (await this.computes(organizationId, draft)) ? [] : ['COMPUTATION_ERROR'];
  }

  /**
   * État de chaque échéance (`occurrenceStatus`). Le calcul n'est tenté que pour les
   * échéances dues sans autre motif. Au-delà du dernier jour facturable, seules les
   * échéances dues sont montrées (bloquées) : rien n'est « à venir » après le terme.
   */
  private async entriesOf(
    organizationId: string,
    plan: ContractPlan,
  ): Promise<SalesOccurrenceView[]> {
    const lead = plan.settings.subscriptionLeadDays;
    const horizon = addDays(plan.today, lead);
    const blocks: OccurrenceBlock[] = [];
    for (const p of plan.planned) {
      const due = p.occurrence.date <= horizon;
      if (!due || plan.live.has(p.occurrence.key)) continue;
      for (const reason of await this.reasonsOf(organizationId, plan, p)) {
        blocks.push({ reason, key: p.occurrence.key });
      }
    }
    const status = occurrenceStatus(
      plan.planned.map((p) => ({ key: p.occurrence.key, date: p.occurrence.date })),
      [...plan.live.entries()].map(([key, l]) => ({ key, invoiceId: l.link.invoiceId })),
      blocks,
      { today: plan.today, leadDays: lead },
    );
    const byKey = new Map(status.entries.map((e) => [e.key, e]));
    const billableUntil = plan.terms?.billableUntil ?? null;
    return plan.planned.flatMap((p) => {
      const e = byKey.get(p.occurrence.key)!;
      const beyond = billableUntil !== null && p.occurrence.date > billableUntil;
      if (beyond && e.state === 'upcoming') return [];
      return [this.viewOf(plan, p, e.state, e.reasons)];
    });
  }

  private viewOf(
    plan: ContractPlan,
    p: PlannedOccurrence,
    state: OccurrenceState,
    reasons: readonly OccurrenceBlockReason[],
  ): SalesOccurrenceView {
    const live = state === 'prepared' ? plan.live.get(p.occurrence.key) : undefined;
    const o = p.occurrence;
    return {
      key: o.key,
      kind: o.kind,
      date: o.date,
      itemRef: o.itemRef,
      label: this.labelOf(p),
      periodStart: o.periodStart,
      periodEnd: o.periodEnd,
      periodExceedsBounds: o.periodExceedsBounds,
      state,
      stateLabel: OCCURRENCE_STATE_LABELS[state],
      invoice: live
        ? {
            invoiceId: live.link.invoiceId,
            type: live.invoice.type,
            status: live.invoice.status,
            reference: live.invoice.number ?? live.invoice.proformaRef ?? null,
            currency: live.invoice.currency,
            total: live.invoice.documentAmounts?.calculation?.totals?.total ?? null,
          }
        : null,
      reasons: reasons.map((r) => {
        const code = BLOCK_CODE_OF[r];
        return { code, message: BLOCK_MESSAGES[code] };
      }),
      autoPrepare: this.autoPrepareOf(plan, p),
    };
  }

  /** `GET /sales/contracts/:id/schedule` : préparées, à préparer, à venir, bloquées. */
  async schedule(
    organizationId: string,
    contractId: string,
    query: { from?: string; to?: string },
    now: Date = new Date(),
  ): Promise<SalesContractScheduleView> {
    const contract = await this.contracts.requireOwn(organizationId, contractId);
    const today = kinshasaDay(now);
    const from =
      query.from ?? maxDay(contract.startDate, addDays(today, -SCHEDULE_DEFAULT_PAST_DAYS));
    const to = query.to ?? addDays(today, SCHEDULE_DEFAULT_FUTURE_DAYS);
    if (from > to || addDays(from, SCHEDULE_MAX_SPAN_DAYS) < to) {
      invalidRequestOf([
        {
          path: 'to',
          code: 'SCHEDULE_WINDOW_INVALID',
          message: `Fenêtre attendue : début avant la fin, ${SCHEDULE_MAX_SPAN_DAYS} jours au plus.`,
        },
      ]);
    }
    const active = contract.status === 'signed' || contract.status === 'terminated';
    const plan = await this.plan(
      organizationId,
      contract,
      today,
      active ? { from, to } : { from: to, to: from },
    );
    const warnings: SalesOccurrenceWarning[] = [];
    if (!active) {
      warnings.push({
        code: 'CONTRACT_NOT_SIGNED',
        message: 'Les échéances se préparent une fois la signature du contrat déclarée.',
      });
    } else if (plan.terms === null) {
      warnings.push({
        code: 'TERMS_UNAVAILABLE',
        message: 'Les dates de ce contrat ne peuvent pas être calculées : vérifiez ses clauses.',
      });
    }
    return {
      contractId,
      number: contract.number,
      status: contract.status,
      billingKind: plan.billingToday.kind,
      today,
      window: { from, to },
      leadDays: plan.settings.subscriptionLeadDays,
      catchUpFrom: addDays(today, -90),
      autoPrepareEnabled: plan.settings.autoPrepareSubscriptionDrafts,
      billableUntil: plan.terms?.billableUntil ?? null,
      entries: active ? await this.entriesOf(organizationId, plan) : [],
      warnings,
    };
  }

  // ── Préparation ──────────────────────────────────────────────────────────

  /**
   * Crée le brouillon de l'échéance et son lien. Une échéance déjà liée (préparation
   * concurrente, tâche rejouée) → le brouillon créé est retiré et `null` est rendu :
   * jamais deux brouillons pour une même échéance.
   */
  private async prepareOne(
    organizationId: string,
    plan: ContractPlan,
    p: PlannedOccurrence,
    type: SalesEngagementInvoiceType,
    actor: InvoiceActor,
  ): Promise<{ invoiceId: string; warnings: SalesOccurrenceWarning[] } | null> {
    const contractId = String(plan.contract._id);
    const { draft, lines, commentTruncated } = this.draftOf(plan, p, type);
    // Reprise après panne : un brouillon portant la clé de l'échéance, sans lien, est
    // RATTACHÉ au lieu d'en créer un second (jamais deux brouillons par échéance).
    const recovered = await this.orphanDraftOf(organizationId, plan, draft, lines.length);
    const invoice = recovered
      ? { id: recovered }
      : await this.drafts.create(organizationId, draft, actor);
    const stored = (await this.links.invoicesOf(organizationId, [invoice.id])).get(invoice.id);
    try {
      if (!stored) throw new Error(`Brouillon ${invoice.id} introuvable après sa création`);
      await this.links.link(organizationId, {
        invoiceId: invoice.id,
        kind: p.occurrence.kind,
        contractId,
        itemRef: p.occurrence.itemRef,
        // Posée aussi pour un échéancier : la date d'effet d'un avenant est refusée dès
        // qu'une échéance préparée existe à cette date ou après (lot V3).
        occurrenceDate: p.occurrence.date,
        lineMap: lines.map((l, i) => ({
          invoiceLineIndex: stored.lines[i]!.index,
          lineRef: l.lineRef,
          quantity: l.quantity,
        })),
        linkedBy: actor.userId,
      });
    } catch (err) {
      // Un brouillon rattaché n'est jamais retiré : il préexistait à cette passe.
      if (!recovered) {
        await this.drafts.remove(organizationId, invoice.id, actor).catch(() => undefined);
      }
      if (isDuplicateKey(err)) return null;
      throw err;
    }
    const warnings: SalesOccurrenceWarning[] = [];
    if (recovered) {
      warnings.push({
        code: 'DRAFT_RECOVERED',
        message:
          'Un brouillon de cette échéance existait sans lien (préparation interrompue) : il a été rattaché, aucun autre n’a été créé.',
        details: { invoiceId: recovered },
      });
    }
    if (commentTruncated) {
      warnings.push({
        code: 'COMMENT_TRUNCATED',
        message: `Le commentaire C dépassait ${COMMENT_C_MAX} caractères : il a été tronqué.`,
      });
    }
    if (p.occurrence.periodExceedsBounds) {
      warnings.push({
        code: 'PERIOD_EXCEEDS_TERM',
        message:
          'La période libellée déborde du terme facturable : aucun prorata n’est appliqué, ajustez le brouillon si nécessaire.',
        details: {
          periodStart: p.occurrence.periodStart,
          periodEnd: p.occurrence.periodEnd,
          billableUntil: plan.terms?.billableUntil ?? null,
        },
      });
    }
    await this.contracts.record(
      organizationId,
      actor,
      contractId,
      'sales_contract.occurrence_prepared',
      {
        number: plan.contract.number,
        key: p.occurrence.key,
        kind: p.occurrence.kind,
        date: p.occurrence.date,
        invoiceId: invoice.id,
        type,
        automatic: actor.userId === SUBSCRIPTIONS_ACTOR.userId,
        recovered: recovered !== null,
      },
    );
    return { invoiceId: invoice.id, warnings };
  }

  /**
   * Brouillon ORPHELIN de l'échéance : brouillon de l'organisation, au client, à la devise
   * et au mode de prix du contrat, portant la clé déterministe de l'échéance (commentaire
   * C : numéro du contrat et période, ou référence et date de l'échéance), au même nombre
   * de lignes, et sans aucun lien. C'est la trace d'une préparation interrompue entre la
   * création du brouillon et la pose du lien. Lecture seule de `sales_invoices`.
   */
  private async orphanDraftOf(
    organizationId: string,
    plan: ContractPlan,
    draft: InvoiceDraftInput,
    lineCount: number,
  ): Promise<string | null> {
    const candidates = await this.connection
      .collection(READ_ONLY_COLLECTIONS.invoices)
      .find(
        {
          organizationId,
          status: 'draft',
          type: draft.type,
          currency: plan.contract.currency,
          priceMode: plan.contract.priceMode,
          'customer.customerId': plan.contract.customerId,
          'comments.C': draft.comments.C,
        },
        { projection: { _id: 1, lines: 1 }, sort: { createdAt: 1, _id: 1 }, limit: 20 },
      )
      .toArray();
    for (const c of candidates) {
      if (((c['lines'] as unknown[] | undefined) ?? []).length !== lineCount) continue;
      const id = String(c._id);
      if ((await this.links.linkOfInvoice(organizationId, id)) === null) return id;
    }
    return null;
  }

  /** Date d'une clé d'échéance (`AAAA-MM-JJ`, ou échéance `item:<ref>` d'un échéancier). */
  private dateOfKey(
    contract: SalesContractLean,
    amendments: SalesContractAmendmentLean[],
    key: string,
  ): string | null {
    if (!key.startsWith('item:')) return key;
    const ref = key.slice('item:'.length);
    const billings = [
      contract.billing,
      ...amendments.flatMap((a) =>
        a.status === 'signed' && a.changes.billing ? [a.changes.billing] : [],
      ),
    ];
    for (const b of billings) {
      if (b.kind !== 'schedule') continue;
      const item = b.items.find((i) => i.itemRef === ref);
      if (item) return item.dueDate;
    }
    return null;
  }

  /**
   * « Préparer maintenant » (`POST …/occurrences/:key/prepare`, `sales.manage`) : même
   * effet que la tâche, à la main, y compris pour une échéance à venir du terme
   * facturable. Bloquée → `409 OCCURRENCE_BLOCKED` ; déjà préparée → `409
   * OCCURRENCE_ALREADY_PREPARED`. Rien n'est émis.
   */
  async prepareNow(
    organizationId: string,
    contractId: string,
    key: string,
    type: SalesEngagementInvoiceType,
    actor: InvoiceActor,
    now: Date = new Date(),
  ): Promise<PreparedOccurrence> {
    const contract = await this.contracts.requireOwn(organizationId, contractId);
    if (contract.status !== 'signed' && contract.status !== 'terminated') {
      conflict('CONTRACT_NOT_SIGNED', 'Les échéances se préparent sur un contrat signé.', {
        status: contract.status,
      });
    }
    const notFound = (): never =>
      contractsNotFound('OCCURRENCE_NOT_FOUND', 'Cette échéance n’existe pas dans le contrat.');
    const amendments = await this.contracts.amendmentsOf(organizationId, contractId);
    const date = this.dateOfKey(contract, amendments, key) ?? notFound();
    const today = kinshasaDay(now);
    const plan = await this.plan(organizationId, contract, today, { from: date, to: date });
    const p = plan.planned.find((x) => x.occurrence.key === key) ?? notFound();
    const prepared = plan.live.get(key);
    if (prepared) {
      conflict('OCCURRENCE_ALREADY_PREPARED', 'Le brouillon de cette échéance existe déjà.', {
        invoiceId: prepared.link.invoiceId,
      });
    }
    const reasons = await this.reasonsOf(organizationId, plan, p);
    if (reasons.length > 0) {
      conflict('OCCURRENCE_BLOCKED', 'Cette échéance est bloquée : aucun brouillon préparé.', {
        reasons: reasons.map((r) => BLOCK_CODE_OF[r]),
      });
    }
    const done = await this.prepareOne(organizationId, plan, p, type, actor);
    if (done === null) {
      const again = await this.links.liveLinks(organizationId, [{ contractId }]);
      conflict('OCCURRENCE_ALREADY_PREPARED', 'Le brouillon de cette échéance existe déjà.', {
        invoiceId: again.find((l) => keyOfLink(l) === key)?.link.invoiceId ?? null,
      });
    }
    const after = await this.plan(organizationId, contract, today, { from: date, to: date });
    const entry = (await this.entriesOf(organizationId, after)).find((e) => e.key === key)!;
    return { invoiceId: done.invoiceId, warnings: done.warnings, occurrence: entry };
  }

  // ── Tâche `sales.subscriptions.prepare` (§ 5.3) ──────────────────────────

  /**
   * Un contrat : chaque échéance due de `[aujourd'hui − 90 j, aujourd'hui + délai]`,
   * sans lien vivant, non bloquée et préparable automatiquement → un brouillon.
   * Rejouable sans effet (index uniques des liens).
   */
  async prepareDue(
    organizationId: string,
    contract: SalesContractLean,
    now: Date,
    report: SubscriptionsRunReport,
  ): Promise<void> {
    const today = kinshasaDay(now);
    const settings = await this.settings.values(organizationId);
    if (!settings.autoPrepareSubscriptionDrafts) return;
    const window = {
      from: maxDay(contract.startDate, addDays(today, -90)),
      to: addDays(today, settings.subscriptionLeadDays),
    };
    const plan = await this.plan(organizationId, contract, today, window);
    for (const p of plan.planned) {
      if (plan.live.has(p.occurrence.key) || !this.autoPrepareOf(plan, p)) continue;
      const reasons = await this.reasonsOf(organizationId, plan, p);
      if (reasons.length > 0) {
        report.blocked += 1;
        continue;
      }
      try {
        const done = await this.prepareOne(organizationId, plan, p, 'FV', SUBSCRIPTIONS_ACTOR);
        if (done) report.prepared += 1;
      } catch {
        report.failed += 1;
      }
    }
  }
}
