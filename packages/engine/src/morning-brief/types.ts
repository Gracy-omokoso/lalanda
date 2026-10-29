// ─────────────────────────────────────────────────────────────────────────────
// Brief du matin — types (ADR-0033)
//
// Le moteur reçoit des documents déjà lus par l'API (aucune base, aucune
// horloge : l'instant `now` est un paramètre) et rend des FAITS sourcés, puis
// les ALERTES et RECOMMANDATIONS de règles déterministes. Aucun texte de ce
// module ne vient d'un modèle de langue : l'IA lit ce qu'il produit, jamais
// l'inverse.
//
// Montants : chaînes décimales canoniques, jamais de `number` (docs/26).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 1.1.0 (ADR-0039 § 6.5) : faits `mes_taches.*`, `taches.en_retard`,
 * `projets_a_risque` et règles R8, R9 (projets et tâches du RUN).
 */
export const MORNING_BRIEF_VERSION = '1.1.0';

export const BRIEF_CURRENCIES = ['CDF', 'USD'] as const;
export type BriefCurrency = (typeof BRIEF_CURRENCIES)[number];

/** Statuts d'un document de vente (ADR-0023 § S25e.1), recopiés pour garder le moteur sans dépendance à l'API. */
export type BriefInvoiceStatus =
  'draft' | 'issued' | 'pending_normalization' | 'normalized' | 'normalization_failed';

/** Ce que le moteur lit d'un document de vente. */
export interface BriefInvoiceInput {
  id: string;
  /** `FV`, `FT`, `FA`, `EV`, `ET`, `EA` (ADR-0023). */
  type: string;
  status: BriefInvoiceStatus;
  /** Vrai pour la série d'essai DGI : document sans valeur fiscale, exclu partout. */
  testSeries: boolean;
  currency: BriefCurrency;
  /** ISO 8601 ; `null` tant que le document n'est pas émis. */
  issuedAt: string | null;
  /** ISO 8601 ; instant du gel (entrée en `pending_normalization`). */
  frozenAt: string | null;
  /** ISO 8601 ; dernière modification (âge d'un brouillon). */
  updatedAt: string;
  /** Bases HT par groupe, dans la devise du document (totaux du moteur). `null` si non calculés. */
  groups: readonly { group: string; ht: string }[] | null;
  /**
   * Reste à encaisser RÉEL de la facture (ADR-0031, `computeSettlement` : part à
   * crédit − avoirs imputés − encaissements), lu par l'API ; `null` quand le
   * document ne porte pas de règlement (avoir, pro forma, payé comptant…).
   * Remplace la part `CREDIT` déclarée (amendement d'ADR-0033 du 27 oct. 2026).
   */
  outstanding: string | null;
  /** Avoir : identifiant de la facture d'origine. */
  creditNoteOriginId: string | null;
  /** Phase de normalisation (ADR-0024 § 4.1), `null` hors normalisation. */
  normalizationPhase: string | null;
}

/** Trésorerie : soldes des comptes d'ADR-0034 ; « à renseigner » sans compte. */
export type BriefCashInput =
  | { status: 'to_fill' }
  | {
      status: 'known';
      amounts: readonly { currency: BriefCurrency; amount: string }[];
      /** Origine affichée (ex. « Rapprochement bancaire du 20 oct. »). */
      sourceLabel: string;
    };

/** Échéances (ADR-0031) : factures dont le règlement est en retard selon le moteur. */
export type BriefDueDatesInput =
  { status: 'unavailable' } | { status: 'known'; overdueCount: number };

/**
 * Tâche NON terminée dont l'échéance est aujourd'hui ou passée (ADR-0039 § 6.5),
 * lue par l'API dans un projet non archivé. Le moteur décide seul de ce qui est
 * « en retard » ou « du jour », au jour de Kinshasa de `now`.
 */
export interface BriefWorkTaskInput {
  projectId: string;
  /** Échéance `AAAA-MM-JJ` (jour de Kinshasa). */
  dueDate: string;
  isMilestone: boolean;
  /** Assignée à l'appelant du brief (ou au destinataire de l'e-mail). */
  mine: boolean;
  /** Projet au statut `active` : seul un projet actif peut être « à risque ». */
  projectActive: boolean;
}

/**
 * Projets et tâches (ADR-0039) : `hidden` si le rôle ne détient pas
 * `work.read` (rien n'est alors lu), `unavailable` sans module de travail (tests).
 */
export type BriefWorkInput =
  | 'hidden'
  | { status: 'unavailable' }
  | { status: 'known'; tasks: readonly BriefWorkTaskInput[]; truncated: boolean };

export interface MorningBriefInput {
  /** Instant de référence, ISO 8601. */
  now: string;
  /**
   * Documents de vente de l'organisation courante, ou `hidden` si le rôle de
   * l'appelant ne détient pas `sales.read` : le bloc n'est alors jamais chargé.
   */
  sales: { invoices: readonly BriefInvoiceInput[]; truncated: boolean } | 'hidden';
  cash: BriefCashInput;
  dueDates: BriefDueDatesInput;
  work: BriefWorkInput;
}

export type BriefFactStatus = 'known' | 'to_fill' | 'unavailable' | 'hidden';
export type BriefFactKind = 'amount' | 'count' | 'status';

export interface BriefSource {
  /** Module producteur : `run.sales`, `treasury`, `crm`… */
  module: string;
  /** Collection lue, quand il y en a une. */
  collection: string | null;
  /** Règle de calcul, en une phrase. */
  rule: string;
  /** Référence documentaire (ADR, docs). */
  reference: string;
}

export interface BriefFact {
  /** Identifiant STABLE (`ca_mois.CDF`) : les alertes et l'IA le citent. */
  id: string;
  label: string;
  kind: BriefFactKind;
  status: BriefFactStatus;
  /** Chaîne décimale (montant) ou entier en chaîne (dénombrement) ; `null` si non connu. */
  value: string | null;
  currency: BriefCurrency | null;
  source: BriefSource;
}

export type BriefSeverity = 'critique' | 'attention' | 'info';

export interface BriefThreshold {
  /** Identifiant du seuil (S1…S6, ADR-0033 § 3 ; S7, ADR-0039 § 6.5). */
  id: string;
  value: number;
  unit: 'facture' | 'heures' | 'jours' | 'jour_du_mois' | 'tache';
  label: string;
  /** Les seuils sont des paramètres produit, pas des règles fiscales ou comptables. */
  nature: 'parametre_produit_a_valider';
}

export interface BriefRuleOutcome {
  ruleId: string;
  severity: BriefSeverity;
  /** Ordre de la table d'ADR-0033 § 3 : départage deux règles de même gravité. */
  rank: number;
  title: string;
  /** Constat chiffré, composé à partir des faits seulement. */
  message: string;
  /** Action proposée — l'utilisateur agit lui-même (niveau 5 « Act » refusé). */
  recommendation: string;
  /** Écran où agir (chemin de l'application web). */
  actionPath: string;
  factIds: readonly string[];
  threshold: BriefThreshold | null;
}

export interface BriefSkippedRule {
  ruleId: string;
  reason: 'hidden' | 'unavailable';
}

export interface MorningBrief {
  version: string;
  now: string;
  /** Mois civil de Kinshasa du brief. */
  period: { year: number; month: number; day: number };
  facts: readonly BriefFact[];
  /** Règles déclenchées de gravité `critique` ou `attention`, triées ; 3 au plus. */
  alerts: readonly BriefRuleOutcome[];
  /** Recommandations des règles déclenchées, triées ; 3 au plus. */
  recommendations: readonly BriefRuleOutcome[];
  /** Totaux AVANT la coupe à trois. */
  triggeredCount: number;
  alertCount: number;
  rulesSkipped: readonly BriefSkippedRule[];
  /** Niveau 4 « Predict » : réservé aux projections du moteur (ADR-0033 § 1). */
  predictions: readonly never[];
  /** Vrai si l'API a dû borner la lecture des documents ou des tâches. */
  truncated: boolean;
}
