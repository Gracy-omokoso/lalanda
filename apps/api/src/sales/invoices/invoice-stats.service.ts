// Tableau de bord des factures — `GET /sales/invoices/stats` (ADR-0056).
//
// LECTURE SEULE. Lit les documents de vente de l'organisation, leurs échéances,
// les encaissements non annulés et la monnaie de tenue de la comptabilité, puis
// délègue TOUT calcul au moteur (`computeInvoiceStats`). Rien n'est stocké : le
// tableau se recalcule à chaque lecture et ne peut pas diverger de la liste.

import {
  computeInvoiceStats,
  type InvoiceStatsDocument,
  type ReceiptStatsReceipt,
} from '@lalanda/engine';
import type { InvoiceStats, InvoiceStatsCurrencySource } from '@lalanda/shared/sales-invoices';
import { INVOICE_STATS_DEFAULT_MONTHS } from '@lalanda/shared/sales-invoices';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import {
  SalesInvoiceSettlement,
  type SalesInvoiceSettlementDocument,
} from '../receipts/invoice-settlement.schema.js';
import { kinshasaDayOf } from '../receipts/kinshasa-day.js';
import { SalesReceipt, type SalesReceiptDocument } from '../receipts/receipt.schema.js';
import { SettlementsService } from '../receipts/settlements.service.js';
import { SalesInvoice, type SalesInvoiceDocument } from './invoice.schema.js';
import type { InvoiceLean } from './invoice.types.js';

/**
 * Au-delà, le tableau serait trompeur sans le dire : borne large et explicite
 * (`truncated: true`, affiché à l'écran). Même esprit que la trésorerie.
 */
export const INVOICE_STATS_MAX_DOCUMENTS = 20_000;

type StatsInvoice = Pick<
  InvoiceLean,
  | '_id'
  | 'status'
  | 'type'
  | 'series'
  | 'issuedAt'
  | 'currency'
  | 'customer'
  | 'documentAmounts'
  | 'normalizedAmounts'
  | 'conversion'
  | 'amountOnCredit'
  | 'creditNote'
>;

@Injectable()
export class InvoiceStatsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(SalesInvoice.name) private readonly invoices: Model<SalesInvoiceDocument>,
    @InjectModel(SalesReceipt.name) private readonly receipts: Model<SalesReceiptDocument>,
    @InjectModel(SalesInvoiceSettlement.name)
    private readonly settlements: Model<SalesInvoiceSettlementDocument>,
    @Inject(SettlementsService) private readonly settlementsService: SettlementsService,
  ) {}

  /**
   * Devise de référence (ADR-0056) : la monnaie de tenue de la comptabilité si elle
   * est choisie (ADR-0049 § 5), sinon le CDF, monnaie légale et devise des montants
   * normalisés. Lecture directe de `accounting_settings` : le module comptable
   * dépend des ventes, l'inverse créerait un cycle.
   */
  async referenceCurrency(
    organizationId: string,
  ): Promise<{ currency: 'CDF' | 'USD'; source: InvoiceStatsCurrencySource }> {
    const settings = await this.connection
      .collection<{ organizationId: string; bookCurrency?: string | null }>('accounting_settings')
      .findOne({ organizationId }, { projection: { bookCurrency: 1 } });
    const book = settings?.bookCurrency;
    if (book === 'CDF' || book === 'USD') return { currency: book, source: 'accounting_book' };
    return { currency: 'CDF', source: 'default_cdf' };
  }

  /**
   * Données lues pour les tableaux de bord des ventes (factures, ADR-0056 ;
   * encaissements, ADR-0067) : devise de référence, documents de vente (bornés),
   * encaissements de TOUS statuts. Aucun calcul.
   */
  async inputs(organizationId: string): Promise<{
    reference: { currency: 'CDF' | 'USD'; source: InvoiceStatsCurrencySource };
    documents: InvoiceStatsDocument[];
    receipts: ReceiptStatsReceipt[];
    truncated: boolean;
  }> {
    const [reference, docs, receipts, dueDates] = await Promise.all([
      this.referenceCurrency(organizationId),
      this.invoices
        .find(
          { organizationId },
          {
            status: 1,
            type: 1,
            series: 1,
            issuedAt: 1,
            currency: 1,
            customer: 1,
            'documentAmounts.calculation.totals.total': 1,
            'normalizedAmounts.calculation.total': 1,
            'normalizedAmounts.counterValueUsd': 1,
            conversion: 1,
            amountOnCredit: 1,
            creditNote: 1,
          },
        )
        .sort({ sortAt: -1, _id: -1 })
        .limit(INVOICE_STATS_MAX_DOCUMENTS + 1)
        .lean()
        .exec() as unknown as Promise<StatsInvoice[]>,
      this.receipts
        .find(
          { organizationId },
          { status: 1, receivedOn: 1, currency: 1, method: 1, allocations: 1 },
        )
        .lean()
        .exec(),
      this.settlements
        .find({ organizationId, dueDate: { $ne: null } }, { invoiceId: 1, dueDate: 1 })
        .lean()
        .exec(),
    ]);

    const truncated = docs.length > INVOICE_STATS_MAX_DOCUMENTS;
    const kept = truncated ? docs.slice(0, INVOICE_STATS_MAX_DOCUMENTS) : docs;
    const due = new Map(dueDates.map((s) => [s.invoiceId, s.dueDate]));

    const documents: InvoiceStatsDocument[] = kept.map((d) => {
      const id = String(d._id);
      return {
        id,
        status: d.status,
        type: d.type,
        series: d.series,
        issuedOn: d.issuedAt ? kinshasaDayOf(d.issuedAt) : null,
        currency: d.currency,
        total: d.documentAmounts?.calculation?.totals?.total ?? null,
        customerKey: d.customer?.customerId ?? null,
        customerName: d.customer?.name ?? null,
        normalizedTotalCdf: d.normalizedAmounts?.calculation?.total ?? null,
        conversion: d.conversion
          ? { from: d.conversion.from, to: d.conversion.to, rate: d.conversion.rate }
          : null,
        usdCounterValue: d.normalizedAmounts?.counterValueUsd?.amount ?? null,
        amountOnCredit: d.amountOnCredit,
        dueDate: due.get(id) ?? null,
        originInvoiceId: d.creditNote?.originInvoiceId ?? null,
      };
    });

    return {
      reference,
      documents,
      receipts: receipts.map((r) => ({
        id: String(r._id),
        status: r.status,
        receivedOn: r.receivedOn,
        currency: r.currency,
        method: r.method,
        allocations: r.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })),
      })),
      truncated,
    };
  }

  async stats(organizationId: string, months?: number): Promise<InvoiceStats> {
    const { reference, documents, receipts, truncated } = await this.inputs(organizationId);
    const result = computeInvoiceStats({
      referenceCurrency: reference.currency,
      asOf: this.settlementsService.today(),
      months: months ?? INVOICE_STATS_DEFAULT_MONTHS,
      documents,
      allocations: receipts
        .filter((r) => r.status === 'recorded')
        .flatMap((r) =>
          r.allocations.map((a) => ({
            invoiceId: a.invoiceId,
            amount: a.amount,
            receivedOn: r.receivedOn,
          })),
        ),
    });

    return { ...result, currencySource: reference.source, truncated };
  }
}
