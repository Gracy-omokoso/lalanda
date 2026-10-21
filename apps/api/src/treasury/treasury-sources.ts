// Sources extérieures à la trésorerie — ADR-0034 § 4 et § 7.
//
// 1. ENCAISSEMENTS (ADR-0031). Le module Encaissements est livré en parallèle ;
//    la trésorerie le lit par un PORT pour ne dépendre d'aucun de ses fichiers.
//    Tant qu'il n'est pas fusionné, le fournisseur par défaut rend une liste vide
//    et se déclare « non intégré » : la prévision le dit (`RECEIPTS_NOT_INTEGRATED`).
//
// 2. ÉCHÉANCES CLIENTS. Le reste à encaisser d'une facture finale (série réelle,
//    hors avoirs) est, avant ADR-0031, sa part `CREDIT` déclarée au gel
//    (`amountOnCredit`). Les avoirs et paiements ultérieurs ne sont pas imputés ;
//    à la fusion, la source deviendra `computeSettlement` (ADR-0031 § 2).

import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ReceivableInput, TreasuryCurrency } from '@lalanda/engine';
import type { Model } from 'mongoose';

import { kinshasaDay } from '../sales/invoices/exchange-rate-reference.service.js';
import { SalesInvoice, type SalesInvoiceDocument } from '../sales/invoices/invoice.schema.js';

/** Encaissement tel que la trésorerie le consomme. */
export interface TreasuryReceipt {
  id: string;
  accountId: string | null;
  receivedOn: string;
  amount: string;
  currency: TreasuryCurrency;
  label: string;
}

export interface TreasuryReceiptsSource {
  /** `false` tant que le module Encaissements n'alimente pas la trésorerie. */
  readonly integrated: boolean;
  listForTreasury(organizationId: string): Promise<TreasuryReceipt[]>;
}

export const TREASURY_RECEIPTS_SOURCE = Symbol('TREASURY_RECEIPTS_SOURCE');

/** Fournisseur par défaut : aucun encaissement, et il le dit. */
@Injectable()
export class NoReceiptsSource implements TreasuryReceiptsSource {
  readonly integrated = false;
  listForTreasury(): Promise<TreasuryReceipt[]> {
    return Promise.resolve([]);
  }
}

const FINAL_STATUSES = ['issued', 'normalized'];
/** Factures (et factures d'acompte) : un avoir n'est pas une créance. */
const RECEIVABLE_TYPES = ['FV', 'FT', 'EV', 'ET'];

@Injectable()
export class TreasuryReceivablesReader {
  constructor(
    @InjectModel(SalesInvoice.name) private readonly invoices: Model<SalesInvoiceDocument>,
    @Inject(TREASURY_RECEIPTS_SOURCE) private readonly receipts: TreasuryReceiptsSource,
  ) {}

  /** Échéances clients ouvertes, toutes devises (la prévision filtre). */
  async openReceivables(organizationId: string): Promise<ReceivableInput[]> {
    const docs = await this.invoices
      .find(
        {
          organizationId,
          status: { $in: FINAL_STATUSES },
          series: 'real',
          type: { $in: RECEIVABLE_TYPES },
          amountOnCredit: { $nin: [null, '0', '0.00'] },
        },
        { number: 1, currency: 1, amountOnCredit: 1, issuedAt: 1, customer: 1 },
      )
      .lean<
        {
          _id: unknown;
          number: string | null;
          currency: TreasuryCurrency;
          amountOnCredit: string | null;
          issuedAt: Date | null;
          customer: { name: string | null } | null;
        }[]
      >()
      .exec();
    return docs
      .filter((d) => d.amountOnCredit !== null && d.issuedAt !== null)
      .map((d) => ({
        id: String(d._id),
        label: `Facture ${d.number ?? ''}${d.customer?.name ? ` — ${d.customer.name}` : ''}`.trim(),
        currency: d.currency,
        outstanding: d.amountOnCredit as string,
        // ADR-0031 ajoutera l'échéance facultative ; avant, aucune n'existe.
        dueDate: null,
        issuedOn: kinshasaDay(d.issuedAt as Date),
      }));
  }

  receiptsIntegrated(): boolean {
    return this.receipts.integrated;
  }

  listReceipts(organizationId: string): Promise<TreasuryReceipt[]> {
    return this.receipts.listForTreasury(organizationId);
  }
}
