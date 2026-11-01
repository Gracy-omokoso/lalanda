// Libellés français des unions fermées de `@lalanda/shared/accounting` (ADR-0049), lot K8.
// Logique pure. Aucun numéro de compte, aucune règle.

import type {
  AccountingEntryStatus,
  AccountingFiscalYearStatus,
  AccountingJournalKind,
  AccountingPendingReason,
  AccountingPeriodStatus,
  AccountingReconciliationCause,
  AccountingRuleSetStatus,
  AccountingSourceKind,
  AccountingStatementKind,
} from '@lalanda/shared/accounting';

export const LIBELLES_JOURNAL: Record<AccountingJournalKind, string> = {
  sales: 'Ventes',
  purchases: 'Achats',
  treasury: 'Trésorerie',
  misc: 'Opérations diverses',
  opening: 'À-nouveaux',
};

export const LIBELLES_STATUT_REGLES: Record<AccountingRuleSetStatus, string> = {
  draft: 'Brouillon',
  validated: 'Validée',
  superseded: 'Remplacée',
};

export const LIBELLES_STATUT_ECRITURE: Record<AccountingEntryStatus, string> = {
  draft: 'Brouillon',
  awaiting_rate: 'En attente d’un taux',
  posted: 'Validée',
};

export const LIBELLES_SOURCE: Record<AccountingSourceKind, string> = {
  sales_invoice: 'Facture de vente',
  sales_receipt: 'Encaissement',
  treasury_expense: 'Dépense',
  treasury_movement: 'Mouvement de trésorerie',
  supplier_invoice: 'Facture fournisseur',
  supplier_payment: 'Paiement fournisseur',
  stock_movement: 'Mouvement de stock',
  manual: 'Opération diverse',
};

export const LIBELLES_EN_ATTENTE: Record<AccountingPendingReason, string> = {
  NO_TREASURY_ACCOUNT: 'Compte de trésorerie non précisé',
  RATE_MISSING: 'Taux de change manquant',
  PERIOD_CLOSED: 'Mois déjà clos',
  SOURCE_CHANGED_IN_CLOSED_PERIOD: 'Pièce modifiée après la clôture du mois',
  UNSUPPORTED_SOURCE: 'Pièce que Lalanda ne sait pas encore passer en écriture',
};

export const LIBELLES_ETAT: Record<AccountingStatementKind, string> = {
  'balance-sheet': 'Bilan (projet)',
  'income-statement': 'Compte de résultat (projet)',
  'cash-flow': 'Tableau des flux de trésorerie (projet)',
};

export const LIBELLES_EXERCICE: Record<AccountingFiscalYearStatus, string> = {
  open: 'Ouvert',
  closing: 'En cours de clôture',
  closed: 'Clos',
};

export const LIBELLES_PERIODE: Record<AccountingPeriodStatus, string> = {
  open: 'Ouvert',
  closed: 'Clos',
};

export const LIBELLES_CAUSE: Record<AccountingReconciliationCause, string> = {
  OUTSIDE_CUTOVER: 'Pièce antérieure à la bascule',
  CURRENCY_NOT_CONVERTIBLE: 'Devise sans taux',
  MANUAL_ENTRY: 'Opération diverse',
  SUSPENSE: 'Montant au compte d’attente',
  PERIOD_MAPPING: 'Mois différent',
  ACTUALS_MANUAL_VALUE: 'Valeur saisie à la main dans le réalisé',
  UNEXPLAINED: 'Écart inexpliqué : à examiner',
};
