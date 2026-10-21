// Points d'extension du brief du matin (ADR-0033 § 10).
//
// Les chantiers parallèles fourniront des faits que `main` ne connaît pas
// encore. Chacun se branche ici en REMPLAÇANT le fournisseur par défaut dans
// `morning-brief.module.ts` ; ni le service, ni le moteur, ni l'interface n'ont
// à changer pour cela — le moteur accepte déjà ces entrées.
//
//   CASH_POSITION_SOURCE  trésorerie connue            ADR-0034 (dépenses et trésorerie)
//   DUE_DATES_SOURCE      échéances dépassées          ADR-0031 (encaissements)
//
// Le pipeline (ADR-0035) et la santé GROW (ADR-0032) suivront le même motif :
// un jeton, un fournisseur par défaut « non disponible », un fait de plus.

import type { BriefCashInput, BriefDueDatesInput } from '@lalanda/engine';

export const CASH_POSITION_SOURCE = Symbol('MORNING_BRIEF_CASH_POSITION_SOURCE');
export const DUE_DATES_SOURCE = Symbol('MORNING_BRIEF_DUE_DATES_SOURCE');

/** Trésorerie disponible de l'organisation. Ne reçoit QUE son identifiant. */
export interface CashPositionSource {
  cashOf(organizationId: string, now: Date): Promise<BriefCashInput>;
}

/** Échéances de facture dépassées de l'organisation. */
export interface DueDatesSource {
  dueDatesOf(organizationId: string, now: Date): Promise<BriefDueDatesInput>;
}

/** Sur `main` : aucune trésorerie réelle n'existe — « à renseigner ». */
export const noCashPosition: CashPositionSource = {
  cashOf: async () => ({ status: 'to_fill' }),
};

/** Sur `main` : aucune date d'échéance n'existe — « non disponible ». */
export const noDueDates: DueDatesSource = {
  dueDatesOf: async () => ({ status: 'unavailable' }),
};
