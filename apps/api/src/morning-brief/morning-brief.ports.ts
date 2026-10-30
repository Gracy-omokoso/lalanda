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
//   WORK_SOURCE           tâches et projets à risque  ADR-0039 § 6.5 (projets et tâches)
//                         — fournisseur réel dans le module `work`
//                         (`work/brief/work-brief.source.ts`)
//   CRM_SOURCE            relances et pipeline       ADR-0040 — C4 § 5.5
//                         — fournisseur réel dans le module `crm`
//                         (`crm/brief/crm-brief.source.ts`)
//   PURCHASES_SOURCE      dettes fournisseurs et     ADR-0044 § 6.4
//                         approbations d'achat
//                         — fournisseur réel `purchases/brief/purchases-brief.source.ts`
//
// Les fournisseurs « non disponible » ci-dessous restent pour les tests.
// Le pipeline (ADR-0035) et la santé GROW (ADR-0032) suivront le même motif :
// un jeton, un fournisseur par défaut « non disponible », un fait de plus.

import type {
  BriefCashInput,
  BriefCrmInput,
  BriefDueDatesInput,
  BriefPurchasesInput,
  BriefWorkInput,
} from '@lalanda/engine';

export const CASH_POSITION_SOURCE = Symbol('MORNING_BRIEF_CASH_POSITION_SOURCE');
export const DUE_DATES_SOURCE = Symbol('MORNING_BRIEF_DUE_DATES_SOURCE');
export const OUTSTANDING_SOURCE = Symbol('MORNING_BRIEF_OUTSTANDING_SOURCE');
export const WORK_SOURCE = Symbol('MORNING_BRIEF_WORK_SOURCE');
// ADR-0040 — C4
export const CRM_SOURCE = Symbol('MORNING_BRIEF_CRM_SOURCE');
// ADR-0044 — P6
export const PURCHASES_SOURCE = Symbol('MORNING_BRIEF_PURCHASES_SOURCE');

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

/**
 * Projets et tâches (ADR-0039 § 6.5) : tâches non terminées à échéance
 * aujourd'hui ou passée, dans les projets non archivés de l'organisation.
 * `userId` ne sert qu'à marquer les tâches assignées à l'appelant (`mine`).
 * Appelé seulement si le rôle détient `work.read`.
 */
export interface WorkSource {
  workOf(organizationId: string, userId: string, now: Date): Promise<BriefWorkInput>;
}

/** Sans module de travail (tests) : « non disponible ». */
export const noWork: WorkSource = {
  workOf: async () => ({ status: 'unavailable' }),
};

/**
 * Relances et pipeline du CRM (ADR-0040 — C4 § 5.5) : activités non faites à
 * échéance aujourd'hui ou passée, nombre d'opportunités ouvertes. `userId` ne
 * sert qu'à marquer les relances assignées à l'appelant (`mine`). Appelé
 * seulement si le rôle détient `crm.read`.
 */
export interface CrmSource {
  crmOf(organizationId: string, userId: string, now: Date): Promise<BriefCrmInput>;
}

/** Sans module CRM (tests) : « non disponible ». */
export const noCrm: CrmSource = {
  crmOf: async () => ({ status: 'unavailable' }),
};

/**
 * Achats (ADR-0044 § 6.4) : factures fournisseurs validées au reste non nul et
 * demandes que l'appelant peut approuver. Appelé seulement si le membre détient
 * `purchase.read`. `amounts` (`treasury.read`) : le moteur rend les montants par
 * devise (`amountsVisible`) ; sans lui, il ne rend que des nombres de factures —
 * le reste à payer ne sert alors qu'à savoir qu'une dette existe et ne sort jamais
 * du moteur. `approvals` (`purchase.approve`) : le compte des demandes à approuver
 * est lu ; sinon il ne l'est pas et le fait est masqué.
 */
export interface PurchasesSource {
  purchasesOf(
    organizationId: string,
    userId: string,
    access: { amounts: boolean; approvals: boolean },
    now: Date,
  ): Promise<BriefPurchasesInput>;
}

/** Sans module des achats (tests) : « non disponible ». */
export const noPurchases: PurchasesSource = {
  purchasesOf: async () => ({ status: 'unavailable' }),
};
