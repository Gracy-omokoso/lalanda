// Points d'extension du brief du matin (ADR-0033 § 10).
//
// Chaque module RUN se branche ici par un fournisseur déclaré dans
// `morning-brief.module.ts`. Depuis l'intégration du 27 oct. 2026 (amendement
// d'ADR-0033), les trois sont RÉELS (`morning-brief.run-sources.ts`) :
//
//   CASH_POSITION_SOURCE  soldes des comptes          ADR-0034 (dépenses et trésorerie)
//   DUE_DATES_SOURCE      règlements en retard        ADR-0031 (encaissements)
//   OUTSTANDING_SOURCE    reste à encaisser réel      ADR-0031 (encaissements)
//
// Les fournisseurs « non disponible » ci-dessous restent pour les tests.
// Le pipeline (ADR-0035) et la santé GROW (ADR-0032) suivront le même motif :
// un jeton, un fournisseur par défaut « non disponible », un fait de plus.

import type { BriefCashInput, BriefDueDatesInput } from '@lalanda/engine';

export const CASH_POSITION_SOURCE = Symbol('MORNING_BRIEF_CASH_POSITION_SOURCE');
export const DUE_DATES_SOURCE = Symbol('MORNING_BRIEF_DUE_DATES_SOURCE');
export const OUTSTANDING_SOURCE = Symbol('MORNING_BRIEF_OUTSTANDING_SOURCE');

/** Trésorerie disponible de l'organisation. Ne reçoit QUE son identifiant. */
export interface CashPositionSource {
  cashOf(organizationId: string, now: Date): Promise<BriefCashInput>;
}

/** Échéances de facture dépassées de l'organisation. */
export interface DueDatesSource {
  dueDatesOf(organizationId: string, now: Date): Promise<BriefDueDatesInput>;
}

/**
 * Reste à encaisser réel de factures de l'organisation (moteur `receivables`).
 * Une facture absente de la réponse, ou à `null`, ne porte pas de créance.
 */
export interface OutstandingSource {
  outstandingOf(
    organizationId: string,
    invoiceIds: readonly string[],
  ): Promise<Map<string, string | null>>;
}

/** Sans module de trésorerie (tests) : « à renseigner ». */
export const noCashPosition: CashPositionSource = {
  cashOf: async () => ({ status: 'to_fill' }),
};

/** Sans module d'encaissements (tests) : « non disponible ». */
export const noDueDates: DueDatesSource = {
  dueDatesOf: async () => ({ status: 'unavailable' }),
};
