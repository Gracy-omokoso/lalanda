// Sources extérieures à la trésorerie — ADR-0034 § 4 et § 7, amendement du
// 26 oct. 2026 (intégration d'ADR-0031).
//
// La trésorerie lit les ventes par un PORT (`TREASURY_RECEIPTS_SOURCE`) :
//   1. ENCAISSEMENTS : chaque encaissement non annulé rattaché à un compte
//      (`sales_receipts.accountId`) est une entrée de ce compte ; sans compte, il
//      reste hors des soldes et la prévision le compte comme incertitude ;
//   2. ÉCHÉANCES CLIENTS : le reste à encaisser RÉEL de chaque facture
//      (`computeSettlement`, ADR-0031 § 2 : part à crédit − avoirs imputés −
//      encaissements) et son échéance facultative.
//
// Fournisseur de production : `SalesReceiptsSource` (module Ventes, lecture
// seule). `NoReceiptsSource` reste pour un montage sans ventes : il se déclare
// non intégré, et le lecteur retombe alors sur la part `CREDIT` brute déclarée à
// l'émission (`amountOnCredit`), ce que la prévision signale
// (`RECEIPTS_NOT_INTEGRATED`).

import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { ReceivableInput, TreasuryCurrency } from '@lalanda/engine';
import type { Connection } from 'mongoose';

import { kinshasaDay } from '../sales/invoices/exchange-rate-reference.service.js';
import { SalesTreasuryFeed } from '../sales/receipts/treasury-feed.service.js';

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
  /** Échéances clients réellement restantes ; absent d'une source non intégrée. */
  openReceivables?(organizationId: string): Promise<ReceivableInput[]>;
}

export const TREASURY_RECEIPTS_SOURCE = Symbol('TREASURY_RECEIPTS_SOURCE');

/** Fournisseur sans ventes : aucun encaissement, et il le dit. */
@Injectable()
export class NoReceiptsSource implements TreasuryReceiptsSource {
  readonly integrated = false;
  listForTreasury(): Promise<TreasuryReceipt[]> {
    return Promise.resolve([]);
  }
}

/** Fournisseur de production : encaissements et règlements d'ADR-0031. */
@Injectable()
export class SalesReceiptsSource implements TreasuryReceiptsSource {
  readonly integrated = true;
  constructor(@Inject(SalesTreasuryFeed) private readonly feed: SalesTreasuryFeed) {}

  listForTreasury(organizationId: string): Promise<TreasuryReceipt[]> {
    return this.feed.receiptsForTreasury(organizationId);
  }

  openReceivables(organizationId: string): Promise<ReceivableInput[]> {
    return this.feed.openReceivables(organizationId);
  }
}

const FINAL_STATUSES = ['issued', 'normalized'];
/** Factures (et factures d'acompte) : un avoir n'est pas une créance. */
const RECEIVABLE_TYPES = ['FV', 'FT', 'EV', 'ET'];

/**
 * Repli SANS module Encaissements : lecture SEULE de `sales_invoices` par la
 * connexion, sans `InjectModel` (le module Ventes garde la liste fermée de ses
 * écrivains, `invoices.sources.test.ts`).
 */
const SALES_INVOICES = 'sales_invoices';

@Injectable()
export class TreasuryReceivablesReader {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(TREASURY_RECEIPTS_SOURCE) private readonly receipts: TreasuryReceiptsSource,
  ) {}

  /** Échéances clients ouvertes, toutes devises (la prévision filtre). */
  async openReceivables(organizationId: string): Promise<ReceivableInput[]> {
    if (this.receipts.integrated && this.receipts.openReceivables) {
      return this.receipts.openReceivables(organizationId);
    }
    return this.rawCreditParts(organizationId);
  }

  receiptsIntegrated(): boolean {
    return this.receipts.integrated;
  }

  listReceipts(organizationId: string): Promise<TreasuryReceipt[]> {
    return this.receipts.listForTreasury(organizationId);
  }

  /** Part `CREDIT` déclarée à l'émission, sans avoirs ni encaissements imputés. */
  private async rawCreditParts(organizationId: string): Promise<ReceivableInput[]> {
    const docs = (await this.connection
      .collection(SALES_INVOICES)
      .find(
        {
          organizationId,
          status: { $in: FINAL_STATUSES },
          series: 'real',
          type: { $in: RECEIVABLE_TYPES },
          amountOnCredit: { $nin: [null, '0', '0.00'] },
        },
        { projection: { number: 1, currency: 1, amountOnCredit: 1, issuedAt: 1, customer: 1 } },
      )
      .toArray()) as unknown as {
      _id: unknown;
      number: string | null;
      currency: TreasuryCurrency;
      amountOnCredit: string | null;
      issuedAt: Date | null;
      customer: { name: string | null } | null;
    }[];
    return docs
      .filter((d) => d.amountOnCredit !== null && d.issuedAt !== null)
      .map((d) => ({
        id: String(d._id),
        label: `Facture ${d.number ?? ''}${d.customer?.name ? ` — ${d.customer.name}` : ''}`.trim(),
        currency: d.currency,
        outstanding: d.amountOnCredit as string,
        dueDate: null,
        issuedOn: kinshasaDay(d.issuedAt as Date),
      }));
  }
}
