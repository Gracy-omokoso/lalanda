// ─────────────────────────────────────────────────────────────────────────────
// Marge par projet du RUN — types (ADR-0039 § 5)
//
// Module PUR : aucune base, aucun réseau, aucune horloge. L'API lit les
// factures liées au projet, leurs avoirs, les lettrages des encaissements, les
// dépenses rattachées, le temps saisi et les taux horaires, et les passe tels
// quels ; TOUT le calcul vit ici. Montants en chaînes décimales (deux décimales
// au plus) ; arithmétique en centimes entiers (`bigint`), jamais en flottant.
//
// La marge n'est ni un réalisé, ni une prévision, ni une donnée de plan : elle
// se recalcule à chaque lecture et n'est écrite nulle part (ADR-0018).
// ─────────────────────────────────────────────────────────────────────────────

import type { TaxGroupLetter } from '../invoice-totals/types.js';
import type { InvoicedLinesInput, PurchaseOrderLineInput } from '../purchases/types.js';
import type { StockItemInput, StockMovementInput } from '../stock/types.js';

/**
 * Toute évolution d'un calcul de ce module incrémente cette version.
 * 1.1.0 (ADR-0044 § 6.1) : coûts engagés `committed` et `ordered`, INFORMATIFS,
 * rendus à part (`purchases`) et jamais soustraits de la marge ; sans entrée
 * `purchases`, la sortie est celle de 1.0.0.
 */
/**
 * 1.2.0 (ADR-0045 § 6.3) : constat `PERSONNEL_EXPENSES_AND_TIME_COST` — des dépenses
 * de catégorie `personnel` (salaires) et un coût du temps dans la même devise sur le
 * même projet comptent peut-être deux fois la même personne. SIGNALÉ, jamais
 * retranché : aucun montant de la sortie ne change.
 */
/**
 * 1.3.0 (ADR-0046 § 6.4) : matériel sorti du stock pour le projet (`materials`) —
 * sorties `issue` nettes des retours, valorisées au coût moyen pondéré (moteur des
 * stocks, `projectMaterials`), par devise de coût. INFORMATIF, JAMAIS soustrait de
 * `margin` : l'achat de ce matériel y est déjà, ou y sera, par sa dépense. Sans
 * entrée `stock`, la sortie est celle de 1.2.0.
 */
/**
 * 1.4.0 (ADR-0051 § 7.3) : frais du personnel APPROUVÉS non encore remboursés, imputés
 * au projet (`pendingExpenseClaims`), par devise — INFORMATIFS, JAMAIS soustraits de
 * `margin`. Une ligne remboursée entre dans `margin` par sa dépense de remboursement
 * (`treasury_expenses`, possédée par les RH), sans code nouveau ; le moteur retranche
 * de chaque ligne en attente les dépenses déjà créées pour elle (`expenseReportLine`),
 * pour qu'aucun montant ne soit compté deux fois. Sans entrée `hrExpenses`, la sortie
 * est celle de 1.3.0.
 */
export const WORK_MARGIN_VERSION = '1.4.0';

/** Catégorie de dépense des salaires et charges sociales (ADR-0034 § 1). */
export const PERSONNEL_EXPENSE_CATEGORY = 'personnel';

/** Devises de la marge — celles de la facturation et de la trésorerie. */
export const WORK_MARGIN_CURRENCIES = ['CDF', 'USD'] as const;
export type WorkMarginCurrency = (typeof WORK_MARGIN_CURRENCIES)[number];

/** Date civile `AAAA-MM-JJ` (jour de Kinshasa, déjà ramenée par l'appelant). */
export type WorkMarginDay = string;
/** Montant décimal positif ou nul, deux décimales au plus. */
export type WorkMarginAmount = string;

/** Paiement déclaré au gel d'un document (`method: 'CREDIT'` = part à crédit). */
export interface WorkMarginPayment {
  method: string;
  amount: WorkMarginAmount;
}

/**
 * Facture liée au projet (`FV`/`EV`). `final` : émise ou normalisée, série
 * réelle — l'appelant le décide ; une facture non finale (brouillon, pro forma,
 * série d'essai) n'apporte rien et n'est que comptée (`DRAFT_INVOICES_IGNORED`).
 */
export interface WorkMarginInvoiceInput {
  id: string;
  currency: WorkMarginCurrency;
  final: boolean;
  /** Jour d'émission ; requis pour une facture finale. */
  issuedOn: WorkMarginDay | null;
  /** Paiements déclarés au gel : la part non `CREDIT` est réglée à l'émission. */
  payments: readonly WorkMarginPayment[];
  /** Lettrages des encaissements NON annulés, avec le jour de l'encaissement. */
  allocations: readonly { receivedOn: WorkMarginDay; amount: WorkMarginAmount }[];
  /** Bases HT par groupe de taxe du document (facturé, pour information). */
  taxGroups: readonly { group: TaxGroupLetter; ht: WorkMarginAmount }[];
}

/** Avoir qui vise une facture liée ; sa part non `CREDIT` est de l'argent rendu. */
export interface WorkMarginCreditNoteInput {
  id: string;
  currency: WorkMarginCurrency;
  final: boolean;
  issuedOn: WorkMarginDay | null;
  payments: readonly WorkMarginPayment[];
  taxGroups: readonly { group: TaxGroupLetter; ht: WorkMarginAmount }[];
}

/** Dépense rattachée au projet (`status = recorded`) : montant payé. */
export interface WorkMarginExpenseInput {
  id: string;
  currency: WorkMarginCurrency;
  spentOn: WorkMarginDay;
  amount: WorkMarginAmount;
  /** Catégorie de la dépense (ADR-0034) ; sert au seul constat de 1.2.0, jamais au calcul. */
  category?: string | null;
  /**
   * ADR-0051 § 7.3 (1.4.0) : ligne de note de frais d'origine (`<reportId>:<lineIndex>`)
   * d'une dépense possédée par les RH ; `null` ou absent pour toute autre dépense. Sert
   * au seul calcul de `pendingExpenseClaims`, jamais à `margin`.
   */
  expenseReportLine?: string | null;
}

/**
 * Ligne de note de frais APPROUVÉE, imputée au projet, pas (ou pas entièrement)
 * remboursée (ADR-0051 § 7.3). `amount` : montant de la ligne (payé par le
 * collaborateur) ; le moteur en retranche les dépenses déjà créées pour elle.
 */
export interface WorkMarginExpenseClaimInput {
  /** `<reportId>:<lineIndex>`, unique. */
  line: string;
  currency: WorkMarginCurrency;
  amount: WorkMarginAmount;
}

/** Frais du personnel lus pour un projet (ADR-0051 § 7.3), par le port `WORK_HR_EXPENSES_SOURCE`. */
export interface ProjectHrExpensesInput {
  claims: readonly WorkMarginExpenseClaimInput[];
}

/** Frais approuvés non remboursés d'une devise — INFORMATIFS, jamais soustraits de `margin`. */
export interface ProjectPendingExpenseClaimsCurrency {
  currency: WorkMarginCurrency;
  amount: WorkMarginAmount;
  /** Lignes dont un reste est en attente de remboursement. */
  lineCount: number;
}

/** Saisie de temps non supprimée. */
export interface WorkMarginTimeEntryInput {
  userId: string;
  workedOn: WorkMarginDay;
  /** Entier strictement positif. */
  minutes: number;
}

/** Coût horaire d'un membre à partir d'une date (le plus récent ≤ jour travaillé). */
export interface WorkMarginRateInput {
  userId: string;
  currency: WorkMarginCurrency;
  /** Strictement positif, deux décimales au plus. */
  hourlyCost: WorkMarginAmount;
  effectiveFrom: WorkMarginDay;
}

/**
 * Facture fournisseur VALIDÉE (type `invoice`) dont une imputation vise le projet :
 * reste à payer (moteur des achats, `payableSettlement`) et imputations de coût
 * dans l'ordre de la facture.
 */
export interface WorkMarginPayableInput {
  id: string;
  currency: WorkMarginCurrency;
  remaining: WorkMarginAmount;
  costAllocations: readonly { amount: WorkMarginAmount; workProjectId: string | null }[];
}

/**
 * Commande approuvée et non close (`approved`, `sent`, `partially_received`,
 * `received`) dont une ligne vise le projet, avec les factures VALIDÉES qui la
 * visent (lignes facturées).
 */
export interface WorkMarginOrderInput {
  id: string;
  currency: WorkMarginCurrency;
  lines: readonly PurchaseOrderLineInput[];
  invoices: readonly InvoicedLinesInput[];
}

/** Achats du projet (ADR-0044 § 6.1), lus par le port `WORK_PURCHASES_SOURCE`. */
export interface ProjectPurchasesInput {
  projectId: string;
  payables: readonly WorkMarginPayableInput[];
  orders: readonly WorkMarginOrderInput[];
}

export interface ProjectMarginInput {
  invoices: readonly WorkMarginInvoiceInput[];
  creditNotes: readonly WorkMarginCreditNoteInput[];
  expenses: readonly WorkMarginExpenseInput[];
  timeEntries: readonly WorkMarginTimeEntryInput[];
  rates: readonly WorkMarginRateInput[];
  /** Période facultative, bornes incluses (dates d'encaissement, de dépense, de travail). */
  from: WorkMarginDay | null;
  to: WorkMarginDay | null;
  /**
   * Achats du projet (ADR-0044 § 6.1) ; absent : rien n'est rendu (`purchases`
   * absent du résultat). Hors période : ce sont des engagements à date.
   */
  purchases?: ProjectPurchasesInput;
  /**
   * Stock (ADR-0046 § 6.4) ; absent : rien n'est rendu (`materials` absent du
   * résultat). Les mouvements sont TOUS ceux des articles concernés (le coût moyen se
   * rejoue sur tout l'historique) ; seuls ceux imputés à `projectId` comptent.
   */
  stock?: ProjectStockInput;
  /**
   * Frais du personnel (ADR-0051 § 7.3) ; absent : rien n'est rendu
   * (`pendingExpenseClaims` absent du résultat). Hors période : un reste à rembourser
   * est un engagement à date.
   */
  hrExpenses?: ProjectHrExpensesInput;
}

/** Stock lu pour un projet (ADR-0046 § 6.4), par le port `WORK_STOCK_SOURCE`. */
export interface ProjectStockInput {
  projectId: string;
  items: readonly StockItemInput[];
  movements: readonly StockMovementInput[];
}

/**
 * Matériel sorti du stock pour le projet, d'une devise de coût (ADR-0046 § 6.4) —
 * INFORMATIF, jamais soustrait de `margin` (décision ouverte n° 12).
 */
export interface ProjectMaterialsCurrency {
  currency: WorkMarginCurrency;
  /** Sorties nettes des retours, au coût moyen pondéré ; signée si les retours l'emportent. */
  consumedValue: string;
  /** Bons de sortie (mouvements `issue` sortants) imputés au projet. */
  issueCount: number;
  /** Mouvements sans coût connu (entrée `pending_cost`) : comptés, non valorisés. */
  unvaluedCount: number;
}

/** Constats codés (ADR-0039 § 5). */
export const PROJECT_MARGIN_FINDING_CODES = [
  'MULTI_CURRENCY',
  'TIME_WITHOUT_RATE',
  'NO_INVOICE_LINKED',
  'DRAFT_INVOICES_IGNORED',
  'AMOUNTS_INCLUDE_TAX',
  // ADR-0045 § 6.3 (1.2.0) : salaire rattaché ET temps valorisé, même devise.
  'PERSONNEL_EXPENSES_AND_TIME_COST',
] as const;
export type ProjectMarginFindingCode = (typeof PROJECT_MARGIN_FINDING_CODES)[number];

export interface ProjectMarginFinding {
  code: ProjectMarginFindingCode;
  /** `TIME_WITHOUT_RATE` : minutes non valorisées. */
  minutes?: number;
  /**
   * `MULTI_CURRENCY` : devises ; `DRAFT_INVOICES_IGNORED` : factures ignorées ;
   * `PERSONNEL_EXPENSES_AND_TIME_COST` : dépenses `personnel` de la devise.
   */
  count?: number;
  /** `PERSONNEL_EXPENSES_AND_TIME_COST` : devise concernée (un constat par devise). */
  currency?: WorkMarginCurrency;
}

/** Marge d'une devise : jamais additionnée à celle d'une autre devise. */
export interface ProjectMarginCurrency {
  currency: WorkMarginCurrency;
  /** Réglé à l'émission + encaissements lettrés (TTC). */
  received: WorkMarginAmount;
  /** Part non `CREDIT` des avoirs finaux : argent rendu. */
  refunded: WorkMarginAmount;
  expenses: WorkMarginAmount;
  /** Σ minutes × taux ÷ 60, un seul arrondi au centime (demi vers le haut). */
  timeCost: WorkMarginAmount;
  /** received − refunded − expenses − timeCost ; signée. */
  margin: string;
  /** Bases HT des factures finales moins celles des avoirs finaux ; signée, jamais soustraite. */
  invoicedExclTax: string;
  invoiceCount: number;
  expenseCount: number;
  /** Minutes VALORISÉES dans cette devise. */
  timeMinutes: number;
}

/** Détail par membre et par devise (chaque ligne arrondie pour elle-même). */
export interface ProjectMarginMemberCost {
  userId: string;
  currency: WorkMarginCurrency;
  minutes: number;
  cost: WorkMarginAmount;
}

/**
 * Coûts engagés non payés d'une devise (ADR-0044 § 6.1) — INFORMATIFS, jamais
 * soustraits de `margin` (décision ouverte n° 10).
 */
export interface ProjectPurchasesCurrency {
  currency: WorkMarginCurrency;
  /** Part du projet dans le reste à payer des factures validées (plus fort reste). */
  committed: WorkMarginAmount;
  /** Reste à facturer HT des lignes de commande approuvées qui visent le projet. */
  ordered: WorkMarginAmount;
  /** Factures validées avec un reste à payer imputé au projet. */
  invoiceCount: number;
  /** Commandes avec un reste à facturer sur une ligne du projet. */
  orderCount: number;
}

export interface ProjectMarginResult {
  version: string;
  from: WorkMarginDay | null;
  to: WorkMarginDay | null;
  /** Par devise, CDF puis USD ; une devise sans aucun élément n'apparaît pas. */
  currencies: ProjectMarginCurrency[];
  findings: ProjectMarginFinding[];
  /** Minutes sans taux applicable : signalées, jamais valorisées à zéro. */
  minutesWithoutRate: number;
  byMember: ProjectMarginMemberCost[];
  /** Présent seulement si l'entrée porte `purchases` ; une devise sans engagement n'apparaît pas. */
  purchases?: ProjectPurchasesCurrency[];
  /** Présent seulement si l'entrée porte `stock` ; une devise sans sortie n'apparaît pas. */
  materials?: ProjectMaterialsCurrency[];
  /** Présent seulement si l'entrée porte `hrExpenses` ; une devise sans reste n'apparaît pas. */
  pendingExpenseClaims?: ProjectPendingExpenseClaimsCurrency[];
}
