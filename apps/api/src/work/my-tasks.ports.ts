// Points d'extension de « Mes tâches » — ADR-0040 — C4 § 5.2 (O3).
//
// « Une seule liste », sans copie : `GET /work/my-tasks` lit en plus, par ce
// port et en LECTURE SEULE, les activités CRM non faites, assignées à l'appelant
// et à échéance. Motif exact de `WORK_SOURCE` du brief : un jeton, une
// interface, un fournisseur nul par défaut (tests, module CRM absent).
//
// Le fournisseur réel (`crm/agenda/crm-agenda.source.ts`) ne reçoit que
// l'organisation de la session et l'appelant ; il n'est appelé que si le rôle
// détient `crm.read` (contrôlé par `WorkTasksService.myTasks`).

import type { CrmMyTaskItem } from '@lalanda/shared/crm';
import type { HrMyTaskItem } from '@lalanda/shared/hr';
import type { PurchasesMyTaskItem } from '@lalanda/shared/purchases';
import type { AssetsMyTaskItem } from '@lalanda/shared/assets';
import type { StockMyTaskItem } from '@lalanda/shared/stock';
// ADR-0050 — V6
import type { SalesContractMyTaskItem } from '@lalanda/shared/sales-contracts';

export const CRM_AGENDA_SOURCE = Symbol('WORK_CRM_AGENDA_SOURCE');

export interface CrmAgendaPage {
  items: CrmMyTaskItem[];
  /** Vrai si plus de `limit` activités répondaient. */
  truncated: boolean;
}

export interface CrmAgendaReader {
  agendaOf(organizationId: string, userId: string, limit: number): Promise<CrmAgendaPage>;
}

/** Sans module CRM (tests) : aucune relance. */
export const noCrmAgenda: CrmAgendaReader = {
  agendaOf: async () => ({ items: [], truncated: false }),
};

// ── ADR-0044 — P3 (§ 6.5) : approbations d'achat ─────────────────────────────
//
// Même motif : agrégées à la lecture, en lecture seule, par le fournisseur réel
// `purchases/agenda/purchases-agenda.source.ts`, appelé seulement si l'appelant
// détient `purchase.approve` (droits effectifs, contrôlé par `myTasks`).

export const PURCHASES_AGENDA_SOURCE = Symbol('WORK_PURCHASES_AGENDA_SOURCE');

export interface PurchasesAgendaPage {
  items: PurchasesMyTaskItem[];
  /** Vrai si plus de `limit` demandes répondaient. */
  truncated: boolean;
}

export interface PurchasesAgendaReader {
  approvalsOf(organizationId: string, userId: string, limit: number): Promise<PurchasesAgendaPage>;
}

/** Sans module des achats (tests) : aucune approbation. */
export const noPurchasesAgenda: PurchasesAgendaReader = {
  approvalsOf: async () => ({ items: [], truncated: false }),
};

// ── ADR-0045 — H3 (§ 6.1) : validations d'absence et éléments de liste RH ────
//
// Même motif : agrégés à la lecture, en lecture seule, par le fournisseur réel
// `hr/agenda/hr-agenda.source.ts`. Appelé pour tout membre (un manager n'a besoin
// d'aucune action : la relation suffit) ; les droits EFFECTIFS utiles sont passés.

export const HR_AGENDA_SOURCE = Symbol('WORK_HR_AGENDA_SOURCE');

export interface HrAgendaActor {
  userId: string;
  /** `leave.approve` effectif : étape RH, suppléance du manager. */
  holdsLeaveApprove: boolean;
  /** `hr.sensitive.read` effectif : voit le type des absences confidentielles. */
  seesConfidential: boolean;
  // ADR-0051 — H14 (§ 7.5) : notes de frais, avances, corrections de pointage. Absents :
  // faux (aucun élément de ces natures, sauf ses propres avances à régulariser).
  /** `expenses.approve` effectif : étape finance, suppléance du manager. */
  holdsExpensesApprove?: boolean;
  /** `payables.pay` effectif : notes à rembourser, avances à verser. */
  holdsPayablesPay?: boolean;
  /** `hr.manage` effectif : corrections de pointage à décider. */
  holdsHrManage?: boolean;
}

export interface HrAgendaPage {
  items: HrMyTaskItem[];
  /** Vrai si plus de `limit` éléments répondaient. */
  truncated: boolean;
}

export interface HrAgendaReader {
  agendaOf(organizationId: string, actor: HrAgendaActor, limit: number): Promise<HrAgendaPage>;
}

/** Sans module RH (tests) : aucun élément. */
export const noHrAgenda: HrAgendaReader = {
  agendaOf: async () => ({ items: [], truncated: false }),
};

// ── ADR-0046 — S7 (§ 6.7) : inventaires, « À traiter », maintenances ──────────
//
// Même motif : agrégés à la lecture, en lecture seule, par les fournisseurs réels
// `stock/agenda/stock-agenda.source.ts` et `assets/agenda/assets-agenda.source.ts`.
// Appelés seulement avec `stock.read` (resp. `assets.read`) ; les droits EFFECTIFS
// utiles sont passés, la séparation des tâches est jugée par le fournisseur.

export const STOCK_AGENDA_SOURCE = Symbol('WORK_STOCK_AGENDA_SOURCE');

export interface StockAgendaActor {
  userId: string;
  /** `stock.count` effectif : inventaires à compter dont il est compteur. */
  holdsCount: boolean;
  /** `stock.manage` effectif : inventaires soumis qu'il peut valider. */
  holdsManage: boolean;
  /** `stock.move` effectif : lignes « À traiter » regroupées. */
  holdsMove: boolean;
}

export interface StockAgendaPage {
  items: StockMyTaskItem[];
  /** Vrai si plus de `limit` éléments répondaient. */
  truncated: boolean;
}

export interface StockAgendaReader {
  agendaOf(
    organizationId: string,
    actor: StockAgendaActor,
    limit: number,
  ): Promise<StockAgendaPage>;
}

/** Sans module des stocks (tests) : aucun élément. */
export const noStockAgenda: StockAgendaReader = {
  agendaOf: async () => ({ items: [], truncated: false }),
};

export const ASSETS_AGENDA_SOURCE = Symbol('WORK_ASSETS_AGENDA_SOURCE');

export interface AssetsAgendaActor {
  userId: string;
  /** `assets.manage` effectif : toutes les maintenances dues de l'organisation. */
  holdsManage: boolean;
}

export interface AssetsAgendaPage {
  items: AssetsMyTaskItem[];
  truncated: boolean;
}

export interface AssetsAgendaReader {
  agendaOf(
    organizationId: string,
    actor: AssetsAgendaActor,
    limit: number,
    now: Date,
  ): Promise<AssetsAgendaPage>;
}

/** Sans module des équipements (tests) : aucun élément. */
export const noAssetsAgenda: AssetsAgendaReader = {
  agendaOf: async () => ({ items: [], truncated: false }),
};

// ── ADR-0050 — V6 (§ 6) : contrats, avenants, échéances et acomptes ──────────
//
// Même motif : agrégés à la lecture, en lecture seule, par le fournisseur réel
// `sales/contracts/agenda/contracts-agenda.source.ts`. Appelé seulement avec `sales.read`
// effectif ; les droits EFFECTIFS utiles sont passés, l'audience de chaque élément
// (approbateurs, responsable, émetteurs) est jugée par le fournisseur. Le fournisseur
// réel est déclaré par un module `@Global` du module des contrats : `WorkModule` ne
// l'importe pas (le module des ventes importe déjà, par le CRM, `WorkModule`).

export const SALES_CONTRACTS_AGENDA_SOURCE = Symbol('WORK_SALES_CONTRACTS_AGENDA_SOURCE');

export interface SalesContractsAgendaActor {
  userId: string;
  /** `sales.contract.approve` effectif : contrats et avenants à approuver, reconductions. */
  holdsApprove: boolean;
  /** `sales.invoice` effectif : brouillons d'échéance à émettre. */
  holdsInvoice: boolean;
  /** `sales.manage` effectif : acomptes à marquer « traités ». */
  holdsManage: boolean;
}

export interface SalesContractsAgendaPage {
  items: SalesContractMyTaskItem[];
  /** Vrai si plus de `limit` éléments répondaient. */
  truncated: boolean;
}

export interface SalesContractsAgendaReader {
  agendaOf(
    organizationId: string,
    actor: SalesContractsAgendaActor,
    limit: number,
    now: Date,
  ): Promise<SalesContractsAgendaPage>;
}

/** Sans module des contrats (tests) : aucun élément. */
export const noSalesContractsAgenda: SalesContractsAgendaReader = {
  agendaOf: async () => ({ items: [], truncated: false }),
};
