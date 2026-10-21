// Statut de règlement des factures — ADR-0031 § 2.
//
// Lit les factures, leurs avoirs finaux, les encaissements non annulés et
// l'échéance, puis délègue TOUT calcul au moteur (`computeSettlement`). Rien
// n'est stocké : le statut se recalcule à chaque lecture, il ne peut pas
// diverger de ses sources.

import { computeSettlement, type Settlement } from '@lalanda/engine';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';
import { Types } from 'mongoose';

import { CREDIT_NOTE_TYPES } from '../invoices/invoice.contract.js';
import { SalesInvoice, type SalesInvoiceDocument } from '../invoices/invoice.schema.js';
import type { InvoiceLean } from '../invoices/invoice.types.js';
import {
  SalesInvoiceSettlement,
  type SalesInvoiceSettlementDocument,
} from './invoice-settlement.schema.js';
import { kinshasaDayOf } from './kinshasa-day.js';
import { SalesReceipt, type SalesReceiptDocument } from './receipt.schema.js';

/** Horloge du calcul des retards, remplaçable en test. */
@Injectable()
export class SettlementClock {
  now(): Date {
    return new Date();
  }
}

/** Statuts qui portent un règlement : facture gelée et définitive. */
export const FINAL_INVOICE_STATUSES = ['issued', 'normalized'] as const;
const CREDIT_TYPES: readonly string[] = CREDIT_NOTE_TYPES;

export type NotApplicableReason =
  'NOT_FINAL' | 'CREDIT_NOTE' | 'TEST_SERIES' | 'NO_PAYMENTS_DECLARED';

export interface SettlementView {
  invoiceId: string;
  number: string | null;
  type: string;
  currency: 'CDF' | 'USD';
  customerName: string | null;
  issuedOn: string | null;
  total: string | null;
  dueDate: string | null;
  /** `not_applicable` : brouillon, pro forma, avoir, série d'essai… (raison donnée). */
  status: Settlement['status'] | 'not_applicable';
  reason: NotApplicableReason | null;
  settlement: Settlement | null;
  asOf: string;
}

export interface SettlementContext {
  invoice: InvoiceLean;
  applicable: NotApplicableReason | null;
  creditNoteCredits: string[];
  allocations: string[];
  dueDate: string | null;
}

@Injectable()
export class SettlementsService {
  constructor(
    @InjectModel(SalesInvoice.name) private readonly invoices: Model<SalesInvoiceDocument>,
    @InjectModel(SalesReceipt.name) private readonly receipts: Model<SalesReceiptDocument>,
    @InjectModel(SalesInvoiceSettlement.name)
    private readonly settlements: Model<SalesInvoiceSettlementDocument>,
    @Inject(SettlementClock) private readonly clock: SettlementClock,
  ) {}

  /** Date du jour à Kinshasa : seule horloge du calcul des retards. */
  today(): string {
    return kinshasaDayOf(this.clock.now());
  }

  /** Raison pour laquelle une facture n'a pas de règlement, ou `null`. */
  static applicability(invoice: InvoiceLean): NotApplicableReason | null {
    if (!(FINAL_INVOICE_STATUSES as readonly string[]).includes(invoice.status)) return 'NOT_FINAL';
    if (CREDIT_TYPES.includes(invoice.type)) return 'CREDIT_NOTE';
    if (invoice.series === 'test') return 'TEST_SERIES';
    if (invoice.amountOnCredit === null) return 'NO_PAYMENTS_DECLARED';
    return null;
  }

  /**
   * Contexte de règlement de factures de l'organisation, dans la session de
   * l'appelant s'il en a une. `excludeReceiptId` retire un encaissement (sa
   * modification se contrôle contre le reste HORS lui-même).
   */
  async contexts(
    organizationId: string,
    invoiceIds: readonly string[],
    opts: { session?: ClientSession; excludeReceiptId?: string } = {},
  ): Promise<Map<string, SettlementContext>> {
    const ids = [...new Set(invoiceIds)].filter((id) => Types.ObjectId.isValid(id));
    const result = new Map<string, SettlementContext>();
    if (ids.length === 0) return result;
    const session = opts.session ?? null;
    const invoices = (await this.invoices
      .find({ organizationId, _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
      .session(session)
      .lean()
      .exec()) as unknown as InvoiceLean[];
    const creditNotes = (await this.invoices
      .find({
        organizationId,
        'creditNote.originInvoiceId': { $in: ids },
        status: { $in: FINAL_INVOICE_STATUSES },
      })
      .session(session)
      .lean()
      .exec()) as unknown as InvoiceLean[];
    const receiptFilter: Record<string, unknown> = {
      organizationId,
      status: 'recorded',
      invoiceIds: { $in: ids },
    };
    if (opts.excludeReceiptId) {
      receiptFilter['_id'] = { $ne: new Types.ObjectId(opts.excludeReceiptId) };
    }
    const receipts = await this.receipts.find(receiptFilter).session(session).lean().exec();
    const settlementDocs = await this.settlements
      .find({ organizationId, invoiceId: { $in: ids } })
      .session(session)
      .lean()
      .exec();

    for (const invoice of invoices) {
      const id = String(invoice._id);
      result.set(id, {
        invoice,
        applicable: SettlementsService.applicability(invoice),
        creditNoteCredits: creditNotes
          .filter((cn) => cn.creditNote?.originInvoiceId === id && cn.amountOnCredit !== null)
          .map((cn) => cn.amountOnCredit as string),
        allocations: receipts.flatMap((r) =>
          r.allocations.filter((a) => a.invoiceId === id).map((a) => a.amount),
        ),
        dueDate: settlementDocs.find((s) => s.invoiceId === id)?.dueDate ?? null,
      });
    }
    return result;
  }

  /** Calcul du moteur pour un contexte applicable. */
  static compute(context: SettlementContext, asOf: string): Settlement {
    return computeSettlement({
      amountOnCredit: context.invoice.amountOnCredit as string,
      creditNoteCredits: context.creditNoteCredits,
      allocations: context.allocations,
      dueDate: context.dueDate,
      asOf,
    });
  }

  viewOf(context: SettlementContext, asOf: string): SettlementView {
    const inv = context.invoice;
    const settlement =
      context.applicable === null ? SettlementsService.compute(context, asOf) : null;
    return {
      invoiceId: String(inv._id),
      number: inv.number,
      type: inv.type,
      currency: inv.currency,
      customerName: inv.customer?.name ?? null,
      issuedOn: inv.issuedAt ? kinshasaDayOf(inv.issuedAt) : null,
      total: inv.documentAmounts?.calculation?.totals?.total ?? null,
      dueDate: context.dueDate,
      status: settlement?.status ?? 'not_applicable',
      reason: context.applicable,
      settlement,
      asOf,
    };
  }

  /** `GET /sales/settlements?invoiceIds=…` : les factures inconnues sont ignorées. */
  async byIds(organizationId: string, invoiceIds: readonly string[]): Promise<SettlementView[]> {
    const asOf = this.today();
    const contexts = await this.contexts(organizationId, invoiceIds);
    return invoiceIds.flatMap((id) => {
      const c = contexts.get(id);
      return c ? [this.viewOf(c, asOf)] : [];
    });
  }

  /**
   * `GET /sales/settlements?open=true` : factures avec un reste à encaisser, les
   * plus anciennes d'abord (au plus 200). Sert au choix des factures à lettrer.
   */
  async open(organizationId: string, currency?: 'CDF' | 'USD'): Promise<SettlementView[]> {
    const filter: Record<string, unknown> = {
      organizationId,
      status: { $in: FINAL_INVOICE_STATUSES },
      type: { $nin: CREDIT_TYPES },
      series: { $ne: 'test' },
      amountOnCredit: { $nin: [null, '0.00'] },
    };
    if (currency) filter['currency'] = currency;
    const candidates = await this.invoices
      .find(filter, { _id: 1 })
      .sort({ issuedAt: 1, _id: 1 })
      .limit(500)
      .lean()
      .exec();
    const views = await this.byIds(
      organizationId,
      candidates.map((c) => String(c._id)),
    );
    return views
      .filter((v) => v.settlement !== null && v.settlement.outstanding !== '0.00')
      .slice(0, 200);
  }

  async one(organizationId: string, invoiceId: string): Promise<SettlementView> {
    const [view] = await this.byIds(organizationId, [invoiceId]);
    if (!view)
      throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Document introuvable.' });
    return view;
  }

  /** Échéance hors du document figé (ADR-0031 § 2). */
  async setDueDate(
    organizationId: string,
    invoiceId: string,
    dueDate: string | null,
    userId: string,
  ): Promise<SettlementView> {
    const view = await this.one(organizationId, invoiceId);
    if (view.reason !== null) {
      throw new ConflictException({
        code: 'INVOICE_NOT_SETTLEABLE',
        message: 'Seule une facture définitive (ni avoir, ni essai) porte une échéance.',
      });
    }
    if (dueDate !== null && view.issuedOn !== null && dueDate < view.issuedOn) {
      throw new BadRequestException({
        code: 'DUE_DATE_BEFORE_ISSUE',
        message: 'L’échéance ne peut pas précéder la date d’émission.',
      });
    }
    await this.settlements.updateOne(
      { organizationId, invoiceId },
      {
        $set: { dueDate, updatedBy: userId },
        $setOnInsert: { revision: 0, _schemaVersion: 1 },
      },
      { upsert: true },
    );
    return this.one(organizationId, invoiceId);
  }
}
