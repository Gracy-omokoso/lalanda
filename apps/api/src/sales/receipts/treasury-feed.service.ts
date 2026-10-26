// Ce que les ventes donnent à la trésorerie — ADR-0031 § 1-2 et ADR-0034 § 4 et
// § 7, intégration du 26 oct. 2026.
//
// LECTURE SEULE, deux flux :
//   1. les encaissements non annulés (argent reçu, avec le compte qui l'a reçu
//      s'il est renseigné) : ils entrent dans les soldes des comptes ;
//   2. les échéances clients RÉELLEMENT restantes : le reste à encaisser calculé
//      par le moteur (`computeSettlement` : part à crédit − avoirs imputés −
//      encaissements) et l'échéance facultative de la facture, au lieu de la part
//      `CREDIT` brute déclarée à l'émission.
// Aucun calcul ici : le moteur décide (CLAUDE.md).

import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { CREDIT_NOTE_TYPES } from '../invoices/invoice.contract.js';
import { SalesInvoice, type SalesInvoiceDocument } from '../invoices/invoice.schema.js';
import { SalesReceipt, type SalesReceiptDocument } from './receipt.schema.js';
import { FINAL_INVOICE_STATUSES, SettlementsService } from './settlements.service.js';

/** Encaissement tel que la trésorerie le consomme. */
export interface SalesReceiptForTreasury {
  id: string;
  accountId: string | null;
  receivedOn: string;
  amount: string;
  currency: 'CDF' | 'USD';
  label: string;
}

/** Échéance client ouverte (forme `ReceivableInput` du moteur `treasury`). */
export interface OpenReceivableForTreasury {
  id: string;
  label: string;
  currency: 'CDF' | 'USD';
  outstanding: string;
  dueDate: string | null;
  issuedOn: string;
}

/** Au-delà, la prévision serait trompeuse sans le dire : borne large et explicite. */
const MAX_OPEN_INVOICES = 2000;

@Injectable()
export class SalesTreasuryFeed {
  constructor(
    @InjectModel(SalesInvoice.name) private readonly invoices: Model<SalesInvoiceDocument>,
    @InjectModel(SalesReceipt.name) private readonly receipts: Model<SalesReceiptDocument>,
    @Inject(SettlementsService) private readonly settlements: SettlementsService,
  ) {}

  async receiptsForTreasury(organizationId: string): Promise<SalesReceiptForTreasury[]> {
    const docs = await this.receipts
      .find(
        { organizationId, status: 'recorded' },
        { accountId: 1, receivedOn: 1, amount: 1, currency: 1, reference: 1, allocations: 1 },
      )
      .lean()
      .exec();
    return docs.map((r) => {
      const numbers = r.allocations
        .map((a) => a.invoiceNumber)
        .filter((n): n is string => typeof n === 'string');
      const what = numbers.length > 0 ? ` — ${numbers.join(', ')}` : '';
      return {
        id: String(r._id),
        accountId: r.accountId ?? null,
        receivedOn: r.receivedOn,
        amount: r.amount,
        currency: r.currency,
        label: `Encaissement${r.reference ? ` ${r.reference}` : ''}${what}`,
      };
    });
  }

  /** Factures définitives (série réelle, hors avoirs) dont le reste à encaisser est > 0. */
  async openReceivables(organizationId: string): Promise<OpenReceivableForTreasury[]> {
    const candidates = await this.invoices
      .find(
        {
          organizationId,
          status: { $in: FINAL_INVOICE_STATUSES },
          type: { $nin: CREDIT_NOTE_TYPES },
          series: { $ne: 'test' },
          amountOnCredit: { $nin: [null, '0', '0.00'] },
        },
        { _id: 1 },
      )
      .sort({ issuedAt: 1, _id: 1 })
      .limit(MAX_OPEN_INVOICES)
      .lean()
      .exec();
    const views = await this.settlements.byIds(
      organizationId,
      candidates.map((c) => String(c._id)),
    );
    const out: OpenReceivableForTreasury[] = [];
    for (const v of views) {
      if (v.settlement === null || v.issuedOn === null) continue;
      if (v.settlement.status === 'paid') continue;
      out.push({
        id: v.invoiceId,
        label: `Facture ${v.number ?? ''}${v.customerName ? ` — ${v.customerName}` : ''}`.trim(),
        currency: v.currency,
        outstanding: v.settlement.outstanding,
        dueDate: v.dueDate,
        issuedOn: v.issuedOn,
      });
    }
    return out;
  }
}
