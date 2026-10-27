// Fournisseurs RÉELS des points d'extension du brief du matin — amendement
// d'ADR-0033 du 27 oct. 2026, une fois ADR-0031 (encaissements) et ADR-0034
// (trésorerie) intégrés.
//
//   CASH_POSITION_SOURCE  soldes des comptes de trésorerie (moteur `treasury`,
//                         `computeAccountBalances`, via `TreasuryAccountsService`)
//   DUE_DATES_SOURCE      factures en retard de règlement (moteur `receivables`,
//                         `computeSettlement`, via `SettlementsService`)
//   OUTSTANDING_SOURCE    reste à encaisser réel de chaque facture (même moteur)
//
// LECTURE SEULE et aucun calcul ici : les services lus appellent le moteur.

import { Inject, Injectable } from '@nestjs/common';

import type { BriefCashInput, BriefCurrency, BriefDueDatesInput } from '@lalanda/engine';

import { SalesTreasuryFeed } from '../sales/receipts/treasury-feed.service.js';
import { SettlementsService } from '../sales/receipts/settlements.service.js';
import { TreasuryAccountsService } from '../treasury/treasury-accounts.service.js';
import type {
  CashPositionSource,
  DueDatesSource,
  OutstandingSource,
} from './morning-brief.ports.js';

const BRIEF_CURRENCIES: readonly BriefCurrency[] = ['CDF', 'USD'];

/** Trésorerie disponible : total des soldes des comptes, par devise. */
@Injectable()
export class TreasuryCashPosition implements CashPositionSource {
  constructor(
    @Inject(TreasuryAccountsService) private readonly accounts: TreasuryAccountsService,
  ) {}

  async cashOf(organizationId: string): Promise<BriefCashInput> {
    const page = await this.accounts.list(organizationId);
    if (page.items.length === 0) return { status: 'to_fill' };
    const amounts = BRIEF_CURRENCIES.flatMap((currency) => {
      const amount = page.totalsByCurrency[currency];
      return amount === undefined ? [] : [{ currency, amount }];
    });
    if (amounts.length === 0) return { status: 'to_fill' };
    const n = page.items.length;
    return {
      status: 'known',
      amounts,
      sourceLabel: `Soldes des ${n} compte${n > 1 ? 's' : ''} de trésorerie au ${page.asOf} (ADR-0034)`,
    };
  }
}

/** Reste à encaisser réel, facture par facture (`null` : pas de règlement). */
@Injectable()
export class SettlementsOutstanding implements OutstandingSource {
  constructor(@Inject(SettlementsService) private readonly settlements: SettlementsService) {}

  async outstandingOf(
    organizationId: string,
    invoiceIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    const views = await this.settlements.byIds(organizationId, invoiceIds);
    return new Map(views.map((v) => [v.invoiceId, v.settlement?.outstanding ?? null]));
  }
}

/** Factures dont le règlement est en retard (échéance dépassée, reste > 0). */
@Injectable()
export class SettlementsDueDates implements DueDatesSource {
  constructor(
    @Inject(SalesTreasuryFeed) private readonly feed: SalesTreasuryFeed,
    @Inject(SettlementsService) private readonly settlements: SettlementsService,
  ) {}

  async dueDatesOf(organizationId: string): Promise<BriefDueDatesInput> {
    // Les factures encore ouvertes (reste > 0), puis le drapeau `overdue` du moteur.
    const open = await this.feed.openReceivables(organizationId);
    const withDueDate = open.filter((r) => r.dueDate !== null).map((r) => r.id);
    if (withDueDate.length === 0) return { status: 'known', overdueCount: 0 };
    const views = await this.settlements.byIds(organizationId, withDueDate);
    return {
      status: 'known',
      overdueCount: views.filter((v) => v.settlement?.overdue === true).length,
    };
  }
}
