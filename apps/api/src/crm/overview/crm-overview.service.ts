// Fiche 360° et fil chronologique d'un compte — ADR-0040 § 3.1.2 et § 3.1.3.
// ADR-0040 — C8.
//
// Module de COMPOSITION : lit le CRM, les ventes et les projets RUN en lecture
// seule, et n'écrit rien. Aucun montant n'est calculé ici :
//   - totaux estimés des opportunités et des devis : moteur `crm`
//     (`sumAmountsByCurrency`) ;
//   - règlement de chaque facture : `SettlementsService` (moteur `computeSettlement`) ;
//   - solde dû par devise : moteur `receivables` (`sumOutstandingByCurrency`).
// Jamais de conversion entre devises.
//
// Isolation : chaque requête porte `organizationId` ; le compte est d'abord
// résolu dans l'organisation (404 sinon). Les opportunités et activités sont lues
// par la collection native : leur `accountId` n'est déclaré dans leur schéma
// Mongoose qu'aux lots C2 et C4.

import { sumAmountsByCurrency, sumOutstandingByCurrency } from '@lalanda/engine';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { invalidCursor } from '../../sales/sales.errors.js';
import { Customer } from '../../sales/customer.schema.js';
import { CREDIT_NOTE_TYPES } from '../../sales/invoices/invoice.contract.js';
import { SalesInvoice, type SalesInvoiceDocument } from '../../sales/invoices/invoice.schema.js';
import type { InvoiceLean } from '../../sales/invoices/invoice.types.js';
import { quoteStatusOf } from '../../sales/quotes/quote-model.js';
import { SalesQuote, type QuoteLean } from '../../sales/quotes/quote.schema.js';
import { kinshasaDayOf } from '../../sales/receipts/kinshasa-day.js';
import { SalesReceipt, type SalesReceiptLean } from '../../sales/receipts/receipt.schema.js';
import {
  FINAL_INVOICE_STATUSES,
  SettlementsService,
  type SettlementView,
} from '../../sales/receipts/settlements.service.js';
import { WorkProject } from '../../work/work.schemas.js';
import { CrmAccount, type CrmAccountLean } from '../accounts/crm-account.schema.js';
import { accountView, CrmAccountsService } from '../accounts/crm-accounts.service.js';
import { DEFAULT_STAGES } from '../crm-model.js';
import { CrmActivity, CrmContact, CrmOpportunity, CrmSettings } from '../crm.schemas.js';
import {
  decodeTimelineCursor,
  EMPTY,
  HIDDEN,
  pageOfEvents,
  type OverviewAccess,
  type TimelineEvent,
  type TimelineSource,
} from './crm-overview.model.js';
import type {
  CrmOverview,
  CustomerDocumentLike,
  OverviewActivity,
  OverviewContact,
  OverviewInvoice,
  OverviewOpportunity,
  OverviewProject,
  OverviewQuote,
  OverviewReceipt,
  TimelinePage,
} from './crm-overview.types.js';

/** Plafond de chaque liste de la fiche (le solde dû porte, lui, sur TOUTES les factures). */
export const OVERVIEW_LIST_LIMIT = 200;
const NEXT_ACTIONS_LIMIT = 20;
const CREDIT_TYPES: readonly string[] = CREDIT_NOTE_TYPES;

// Documents lus par la collection native (champs des lots C2 et C4 pas encore
// déclarés dans les schémas Mongoose) : formes connues, recopiées champ à champ.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

const iso = (d: unknown): string | null => (d ? new Date(d as string).toISOString() : null);
const idOf = (d: { _id: unknown }) => String(d._id);

function capped<T>(items: T[]): { items: T[]; truncated: boolean } {
  return items.length > OVERVIEW_LIST_LIMIT
    ? { items: items.slice(0, OVERVIEW_LIST_LIMIT), truncated: true }
    : { items, truncated: false };
}

@Injectable()
export class CrmOverviewService {
  constructor(
    @Inject(CrmAccountsService) private readonly accounts: CrmAccountsService,
    @Inject(SettlementsService) private readonly settlements: SettlementsService,
    @InjectModel(CrmAccount.name) private readonly accountModel: Model<CrmAccount>,
    @InjectModel(CrmContact.name) private readonly contacts: Model<CrmContact>,
    @InjectModel(CrmOpportunity.name) private readonly opportunities: Model<CrmOpportunity>,
    @InjectModel(CrmActivity.name) private readonly activities: Model<CrmActivity>,
    @InjectModel(CrmSettings.name) private readonly crmSettings: Model<CrmSettings>,
    @InjectModel(Customer.name) private readonly customers: Model<Customer>,
    @InjectModel(SalesQuote.name) private readonly quotes: Model<SalesQuote>,
    @InjectModel(SalesInvoice.name) private readonly invoices: Model<SalesInvoiceDocument>,
    @InjectModel(SalesReceipt.name) private readonly receipts: Model<SalesReceipt>,
    @InjectModel(WorkProject.name) private readonly projects: Model<WorkProject>,
  ) {}

  // ── Lectures de base ──────────────────────────────────────────────────────

  /** Filtre « rattaché au compte » : `accountId`, ou le `customerId` d'un compte client. */
  private belongsTo(organizationId: string, account: CrmAccountLean): Raw {
    const or: Raw[] = [{ accountId: idOf(account) }];
    if (account.customerId) or.push({ customerId: account.customerId });
    return { organizationId, $or: or };
  }

  private async opportunitiesOf(organizationId: string, account: CrmAccountLean): Promise<Raw[]> {
    return this.opportunities.collection
      .find(this.belongsTo(organizationId, account))
      .sort({ createdAt: -1, _id: -1 })
      .toArray();
  }

  /**
   * Activités du compte : par `accountId` ou `customerId`, ou — tant que le lot C4
   * ne pose pas l'`accountId` à l'écriture — par une opportunité ou un contact du
   * compte (même déduction que § 2.4).
   */
  private async activitiesOf(
    organizationId: string,
    account: CrmAccountLean,
    opportunityIds: readonly string[],
  ): Promise<Raw[]> {
    const filter = this.belongsTo(organizationId, account);
    const contactIds = (
      await this.contacts.collection
        .find(this.belongsTo(organizationId, account), { projection: { _id: 1 } })
        .toArray()
    ).map((c) => String(c['_id']));
    if (opportunityIds.length > 0)
      filter['$or'].push({ opportunityId: { $in: [...opportunityIds] } });
    if (contactIds.length > 0) filter['$or'].push({ contactId: { $in: contactIds } });
    return this.activities.collection.find(filter).sort({ createdAt: -1, _id: -1 }).toArray();
  }

  /** Devis du compte : par `customerId` du client, ou par une opportunité du compte. */
  private async quotesOf(
    organizationId: string,
    account: CrmAccountLean,
    opportunityIds: readonly string[],
  ): Promise<QuoteLean[]> {
    const or: Raw[] = [];
    if (account.customerId) or.push({ 'customer.customerId': account.customerId });
    if (opportunityIds.length > 0) or.push({ opportunityId: { $in: [...opportunityIds] } });
    if (or.length === 0) return [];
    return this.quotes
      .find({ organizationId, $or: or })
      .sort({ createdAt: -1, _id: -1 })
      .lean<QuoteLean[]>()
      .exec();
  }

  /** Documents finaux de la série réelle du client (factures et avoirs). */
  private async finalInvoicesOf(
    organizationId: string,
    account: CrmAccountLean,
  ): Promise<InvoiceLean[]> {
    if (!account.customerId) return [];
    return (await this.invoices
      .find({
        organizationId,
        'customer.customerId': account.customerId,
        status: { $in: FINAL_INVOICE_STATUSES },
        series: 'real',
      })
      .sort({ issuedAt: -1, _id: -1 })
      .lean()
      .exec()) as unknown as InvoiceLean[];
  }

  private async receiptsOf(
    organizationId: string,
    invoiceIds: readonly string[],
    statuses: readonly string[],
  ): Promise<SalesReceiptLean[]> {
    if (invoiceIds.length === 0) return [];
    return this.receipts
      .find({ organizationId, invoiceIds: { $in: [...invoiceIds] }, status: { $in: statuses } })
      .sort({ receivedOn: -1, _id: -1 })
      .lean<SalesReceiptLean[]>()
      .exec();
  }

  private async projectsOf(
    organizationId: string,
    account: CrmAccountLean,
    opportunityIds: readonly string[],
  ): Promise<Raw[]> {
    const or: Raw[] = [];
    if (account.customerId) or.push({ 'links.customerId': account.customerId });
    if (opportunityIds.length > 0) or.push({ 'links.opportunityId': { $in: [...opportunityIds] } });
    if (or.length === 0) return [];
    return this.projects
      .find({ organizationId, $or: or })
      .sort({ createdAt: -1, _id: -1 })
      .lean<Raw[]>()
      .exec();
  }

  private async stageLabels(organizationId: string): Promise<Map<string, string>> {
    const doc = await this.crmSettings.findOne({ organizationId }).lean<Raw>().exec();
    const stages = (doc?.['stages'] as { key: string; label: string }[] | undefined) ?? [
      ...DEFAULT_STAGES,
    ];
    return new Map(stages.map((s) => [s.key, s.label]));
  }

  // ── Fiche 360° ────────────────────────────────────────────────────────────

  async overview(
    organizationId: string,
    accountId: string,
    access: OverviewAccess,
  ): Promise<CrmOverview> {
    const account = await this.accounts.requireOwn(organizationId, accountId);
    const today = this.settlements.today();
    const labels = await this.stageLabels(organizationId);

    const [contactDocs, oppDocs] = await Promise.all([
      this.contacts.collection
        .find(this.belongsTo(organizationId, account))
        .sort({ sortName: 1, _id: 1 })
        .toArray(),
      this.opportunitiesOf(organizationId, account),
    ]);
    const opportunityIds = oppDocs.map((o) => String(o['_id']));
    const activityDocs = await this.activitiesOf(organizationId, account, opportunityIds);

    // Identité : la fiche client fait foi pour le type DGI, le NIF et les coordonnées.
    let customer: CustomerDocumentLike | null = null;
    if (account.customerId && Types.ObjectId.isValid(account.customerId)) {
      const c = await this.customers
        .findOne({ _id: new Types.ObjectId(account.customerId), organizationId })
        .lean<Raw>()
        .exec();
      customer = c
        ? {
            id: String(c['_id']),
            type: c['type'],
            name: c['name'],
            nif: c['nif'] ?? null,
            phone: c['phone'] ?? null,
            email: c['email'] ?? null,
            address: c['address'] ?? null,
            active: c['active'] !== false,
          }
        : null;
    }

    const contacts: OverviewContact[] = contactDocs.map((c) => ({
      id: String(c['_id']),
      name: c['name'],
      jobTitle: c['jobTitle'] ?? null,
      email: c['email'] ?? null,
      phone: c['phone'] ?? null,
    }));

    const opportunities: OverviewOpportunity[] = oppDocs.map((o) => ({
      id: String(o['_id']),
      title: o['title'],
      status: o['status'],
      stageKey: o['stageKey'],
      stageLabel: labels.get(o['stageKey']) ?? null,
      amount: o['amount'] ?? null,
      currency: o['currency'],
      expectedCloseDate: o['expectedCloseDate'] ?? null,
      ownerId: o['ownerId'] ?? o['createdBy'] ?? null,
      closedAt: iso(o['closedAt']),
      lostReason: o['lostReason'] ?? null,
      lostReasonKey: o['lostReasonKey'] ?? null,
      createdAt: iso(o['createdAt']) as string,
    }));
    const estimatedTotals = (status: string) =>
      sumAmountsByCurrency(
        opportunities
          .filter((o) => o.status === status)
          .map((o) => ({ amount: o.amount, currency: o.currency })),
      );

    const nextActions: OverviewActivity[] = activityDocs
      .filter((a) => a['done'] !== true)
      .sort((a, b) => {
        const da = a['dueAt'] ? new Date(a['dueAt']).getTime() : Number.POSITIVE_INFINITY;
        const db = b['dueAt'] ? new Date(b['dueAt']).getTime() : Number.POSITIVE_INFINITY;
        return da - db || (String(a['_id']) < String(b['_id']) ? -1 : 1);
      })
      .slice(0, NEXT_ACTIONS_LIMIT)
      .map((a) => ({
        id: String(a['_id']),
        kind: a['kind'],
        subject: a['subject'],
        dueAt: iso(a['dueAt']),
        dueDay: a['dueDay'] ?? (a['dueAt'] ? kinshasaDayOf(new Date(a['dueAt'])) : null),
        assigneeUserId: a['assigneeUserId'] ?? null,
        opportunityId: a['opportunityId'] ?? null,
        contactId: a['contactId'] ?? null,
      }));

    const result: CrmOverview = {
      asOf: today,
      account: accountView(account),
      sections: {
        identity: { status: 'known', account: accountView(account), customer },
        contacts: contacts.length ? { status: 'known', ...capped(contacts) } : EMPTY,
        opportunities: opportunities.length
          ? {
              status: 'known',
              ...capped(opportunities),
              totals: {
                basis: 'estimated',
                open: estimatedTotals('open'),
                won: estimatedTotals('won'),
              },
            }
          : EMPTY,
        nextActions: nextActions.length ? { status: 'known', items: nextActions } : EMPTY,
        quotes: HIDDEN,
        invoices: HIDDEN,
        receipts: HIDDEN,
        outstanding: HIDDEN,
        projects: HIDDEN,
      },
    };

    if (access.sales) await this.fillSales(organizationId, account, opportunityIds, today, result);
    if (access.work) {
      const projects: OverviewProject[] = (
        await this.projectsOf(organizationId, account, opportunityIds)
      ).map((p) => ({
        id: String(p['_id']),
        name: p['name'],
        kind: p['kind'],
        status: p['status'],
        ownerUserId: p['ownerUserId'] ?? null,
        startDate: p['startDate'] ?? null,
        dueDate: p['dueDate'] ?? null,
        completedAt: iso(p['completedAt']),
        customerId: p['links']?.['customerId'] ?? null,
        opportunityId: p['links']?.['opportunityId'] ?? null,
      }));
      result.sections.projects = projects.length ? { status: 'known', ...capped(projects) } : EMPTY;
    }
    return result;
  }

  private async fillSales(
    organizationId: string,
    account: CrmAccountLean,
    opportunityIds: readonly string[],
    today: string,
    result: CrmOverview,
  ): Promise<void> {
    const quoteDocs = await this.quotesOf(organizationId, account, opportunityIds);
    const quotes: OverviewQuote[] = quoteDocs.map((q) => ({
      id: idOf(q),
      number: q.number,
      version: q.version,
      title: q.title ?? null,
      status: quoteStatusOf(q.status, q.validUntil, today),
      validUntil: q.validUntil,
      currency: q.currency,
      total: q.documentAmounts?.calculation?.totals?.total ?? null,
      opportunityId: q.opportunityId ?? null,
      invoiceId: q.conversion?.invoiceId ?? null,
      createdAt: iso(q.createdAt) as string,
    }));
    const quoteTotals = (status: string) =>
      sumAmountsByCurrency(
        quotes
          .filter((q) => q.status === status)
          .map((q) => ({ amount: q.total, currency: q.currency })),
      );
    result.sections.quotes = quotes.length
      ? {
          status: 'known',
          ...capped(quotes),
          totals: { sent: quoteTotals('sent'), accepted: quoteTotals('accepted') },
        }
      : EMPTY;

    // Factures et avoirs : statut de règlement par `SettlementsService` (moteur).
    const invoiceDocs = await this.finalInvoicesOf(organizationId, account);
    const views = await this.settlements.byIds(organizationId, invoiceDocs.map(idOf));
    const viewById = new Map<string, SettlementView>(views.map((v) => [v.invoiceId, v]));
    const invoices: OverviewInvoice[] = invoiceDocs.map((inv) => {
      const v = viewById.get(idOf(inv));
      return {
        id: idOf(inv),
        number: inv.number,
        type: inv.type,
        kind: CREDIT_TYPES.includes(inv.type) ? 'credit_note' : 'invoice',
        status: inv.status,
        currency: inv.currency,
        total: v?.total ?? null,
        issuedOn: v?.issuedOn ?? null,
        dueDate: v?.dueDate ?? null,
        settlementStatus: v?.status ?? 'not_applicable',
        settlementReason: v?.reason ?? null,
        settlement: v?.settlement ?? null,
      };
    });
    result.sections.invoices = invoices.length ? { status: 'known', ...capped(invoices) } : EMPTY;

    // Solde dû par devise : moteur `receivables`, sur TOUTES les factures réglables.
    const settled = views.filter((v) => v.settlement !== null);
    if (settled.length === 0) {
      result.sections.outstanding = EMPTY;
    } else {
      const sum = sumOutstandingByCurrency(
        settled.map((v) => ({ currency: v.currency, settlement: v.settlement! })),
      );
      result.sections.outstanding = {
        status: 'known',
        version: sum.version,
        asOf: views[0]?.asOf ?? today,
        byCurrency: sum.byCurrency,
        overdueInvoices: sum.byCurrency.reduce((n, c) => n + c.overdueCount, 0),
      };
    }

    // Encaissements non annulés lettrés sur les factures du client. Le compte de
    // trésorerie qui a reçu l'argent n'est PAS rendu (donnée de trésorerie, D3).
    const invoiceIds = new Set(invoiceDocs.map(idOf));
    const receiptDocs = await this.receiptsOf(organizationId, [...invoiceIds], ['recorded']);
    const receipts: OverviewReceipt[] = receiptDocs.map((r) => ({
      id: idOf(r),
      receivedOn: r.receivedOn,
      amount: r.amount,
      currency: r.currency,
      method: r.method,
      reference: r.reference ?? null,
      allocations: r.allocations
        .filter((a) => invoiceIds.has(a.invoiceId))
        .map((a) => ({
          invoiceId: a.invoiceId,
          invoiceNumber: a.invoiceNumber ?? null,
          amount: a.amount,
        })),
    }));
    result.sections.receipts = receipts.length ? { status: 'known', ...capped(receipts) } : EMPTY;
  }

  // ── Fil chronologique ─────────────────────────────────────────────────────

  async timeline(
    organizationId: string,
    accountId: string,
    sources: { read: readonly TimelineSource[]; hidden: readonly TimelineSource[] },
    rawCursor: string | undefined,
  ): Promise<TimelinePage> {
    const cursor = rawCursor ? decodeTimelineCursor(rawCursor) : null;
    if (rawCursor && !cursor) invalidCursor();
    const account = await this.accounts.requireOwn(organizationId, accountId);
    const wants = (s: TimelineSource) => sources.read.includes(s);
    const events: TimelineEvent[] = [];
    const push = (e: Omit<TimelineEvent, 'at'> & { at: unknown }) => {
      const at = iso(e.at);
      if (at) events.push({ ...e, at });
    };

    const oppDocs =
      wants('opportunity') || wants('quote') || wants('project') || wants('activity')
        ? await this.opportunitiesOf(organizationId, account)
        : [];
    const opportunityIds = oppDocs.map((o) => String(o['_id']));

    if (wants('account')) {
      const id = idOf(account);
      push({
        id,
        type: 'account.created',
        source: 'account',
        at: account.createdAt,
        refId: id,
        title: account.name,
        by: account.createdBy ?? null,
        details: { kind: account.kind },
      });
      if (account.conversion) {
        push({
          id,
          type: 'account.converted',
          source: 'account',
          at: account.conversion.convertedAt,
          refId: id,
          title: account.name,
          by: account.conversion.convertedBy,
          details: { customerId: account.conversion.customerId, mode: account.conversion.mode },
        });
      }
      if (account.mergedInto) {
        push({
          id,
          type: 'account.merged',
          source: 'account',
          at: account.updatedAt,
          refId: id,
          title: account.name,
          by: account.updatedBy ?? null,
          details: { from: id, into: account.mergedInto },
        });
      }
      const merged = await this.accountModel
        .find({ organizationId, mergedInto: idOf(account) })
        .lean<CrmAccountLean[]>()
        .exec();
      for (const m of merged) {
        push({
          id: idOf(m),
          type: 'account.merged',
          source: 'account',
          at: m.updatedAt,
          refId: idOf(m),
          title: m.name,
          by: m.updatedBy ?? null,
          details: { from: idOf(m), into: idOf(account) },
        });
      }
    }

    if (wants('activity')) {
      for (const a of await this.activitiesOf(organizationId, account, opportunityIds)) {
        const id = String(a['_id']);
        const base = { source: 'activity' as const, refId: id, title: a['subject'] as string };
        const details = {
          kind: a['kind'] ?? null,
          opportunityId: a['opportunityId'] ?? null,
          dueAt: iso(a['dueAt']),
        };
        push({
          ...base,
          id,
          type: 'activity.created',
          at: a['createdAt'],
          by: a['createdBy'] ?? null,
          details,
        });
        if (a['done'] === true && a['doneAt']) {
          push({
            ...base,
            id,
            type: 'activity.done',
            at: a['doneAt'],
            by: a['updatedBy'] ?? null,
            details,
          });
        }
      }
    }

    if (wants('opportunity')) {
      for (const o of oppDocs) {
        const id = String(o['_id']);
        const base = { source: 'opportunity' as const, refId: id, title: o['title'] as string };
        push({
          ...base,
          id,
          type: 'opportunity.created',
          at: o['createdAt'],
          by: o['createdBy'] ?? null,
          details: { amount: o['amount'] ?? null, currency: o['currency'] ?? null },
        });
        const history = (o['stageHistory'] as Raw[] | undefined) ?? [];
        history.forEach((h, i) => {
          if (i === 0) return; // étape initiale : c'est la création
          const closing =
            i === history.length - 1 &&
            (o['status'] === 'won' || o['status'] === 'lost') &&
            h['stageKey'] === o['stageKey'];
          const type = closing
            ? o['status'] === 'won'
              ? 'opportunity.won'
              : 'opportunity.lost'
            : 'opportunity.stage_changed';
          push({
            ...base,
            id: `${id}:${i}`,
            type,
            at: h['at'],
            by: h['by'] ?? null,
            details: {
              stageKey: h['stageKey'],
              source: h['source'] ?? null,
              quoteId: h['quoteId'] ?? null,
              ...(type === 'opportunity.lost'
                ? {
                    lostReasonKey: o['lostReasonKey'] ?? null,
                    lostReason: o['lostReason'] ?? null,
                  }
                : {}),
            },
          });
        });
      }
    }

    if (wants('quote')) {
      for (const q of await this.quotesOf(organizationId, account, opportunityIds)) {
        const id = idOf(q);
        const base = { source: 'quote' as const, refId: id, title: q.number };
        const details = {
          currency: q.currency,
          total: q.documentAmounts?.calculation?.totals?.total ?? null,
          version: q.version,
        };
        push({ ...base, id, type: 'quote.created', at: q.createdAt, by: q.createdBy, details });
        push({ ...base, id, type: 'quote.sent', at: q.sentAt, by: null, details });
        push({ ...base, id, type: 'quote.accepted', at: q.acceptedAt, by: null, details });
        push({
          ...base,
          id,
          type: 'quote.refused',
          at: q.refusedAt,
          by: null,
          details: { ...details, reason: q.refusalReason ?? null },
        });
        if (q.conversion) {
          push({
            ...base,
            id,
            type: 'quote.converted',
            at: q.conversion.convertedAt,
            by: q.conversion.convertedBy,
            details: { ...details, invoiceId: q.conversion.invoiceId },
          });
        }
      }
    }

    let invoiceDocs: InvoiceLean[] = [];
    if (wants('invoice') || wants('receipt')) {
      invoiceDocs = await this.finalInvoicesOf(organizationId, account);
    }
    if (wants('invoice')) {
      for (const inv of invoiceDocs) {
        const id = idOf(inv);
        const base = {
          source: 'invoice' as const,
          refId: id,
          title: inv.number ?? inv.proformaRef,
        };
        const details = {
          type: inv.type,
          currency: inv.currency,
          total: inv.documentAmounts?.calculation?.totals?.total ?? null,
        };
        push({
          ...base,
          id,
          type: 'invoice.issued',
          at: inv.issuedAt,
          by: inv.operator?.userId ?? null,
          details,
        });
        push({
          ...base,
          id,
          type: 'invoice.normalized',
          at: inv.normalization?.normalizedAt ?? null,
          by: null,
          details,
        });
      }
    }
    if (wants('receipt')) {
      const invoiceIds = new Set(invoiceDocs.map(idOf));
      for (const r of await this.receiptsOf(
        organizationId,
        [...invoiceIds],
        ['recorded', 'cancelled'],
      )) {
        const id = idOf(r);
        const base = { source: 'receipt' as const, refId: id, title: r.reference ?? r.receivedOn };
        const details = { amount: r.amount, currency: r.currency, receivedOn: r.receivedOn };
        push({ ...base, id, type: 'receipt.recorded', at: r.createdAt, by: r.createdBy, details });
        if (r.cancellation) {
          push({
            ...base,
            id,
            type: 'receipt.cancelled',
            at: r.cancellation.at,
            by: r.cancellation.by,
            details: { ...details, reason: r.cancellation.reason },
          });
        }
      }
    }

    if (wants('project')) {
      for (const p of await this.projectsOf(organizationId, account, opportunityIds)) {
        const id = String(p['_id']);
        const base = { source: 'project' as const, refId: id, title: p['name'] as string };
        push({
          ...base,
          id,
          type: 'project.created',
          at: p['createdAt'],
          by: p['createdBy'] ?? null,
          details: {},
        });
        push({
          ...base,
          id,
          type: 'project.completed',
          at: p['completedAt'],
          by: null,
          details: {},
        });
      }
    }

    const page = pageOfEvents(events, cursor);
    return { ...page, hiddenSources: [...sources.hidden] };
  }
}
