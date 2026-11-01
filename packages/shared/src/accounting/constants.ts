// Constantes de la comptabilité (ADR-0049 §§ 1 à 11). ADR-0049 — K0.
//
// Libellé d'interface ↔ code (ADR-0049 § 1) : « Pack de plan comptable » = chart pack,
// « Plan de l'organisation » = `accounting_accounts`, « Règle de correspondance » = rule,
// « Écriture » = entry, « Pièce source » = source, « Contre-passation » = reversal,
// « Compte d'attente » = suspense, « Monnaie de tenue » = book currency, « Bascule » =
// cutover, « Projet d'état » = statement (`status: "draft_unverified"`).
//
// Ce fichier ne contient que des unions fermées, des bornes, des valeurs par défaut, des
// codes et des textes d'avertissement : AUCUN numéro de compte, AUCUNE règle comptable ni
// fiscale (ADR-0049 § 2.1 : « aucun numéro n'est créé par le code » ; § 14). Les comptes
// viennent du pack YAML (lot K1) et des règles validées par l'organisation ; les calculs
// vivent dans `@lalanda/engine` (`accounting`, lots K2 et K3).

/** Monnaies de tenue possibles (§ 2.2). AUCUNE valeur par défaut : choix exigé (n° 4). */
export const ACCOUNTING_BOOK_CURRENCIES = ['CDF', 'USD'] as const;
export type AccountingBookCurrency = (typeof ACCOUNTING_BOOK_CURRENCIES)[number];

// ── Activation (§ 3.1) ──────────────────────────────────────────────────────

/** Trois modes ; `off` par défaut. `simulation` ne persiste rien. */
export const ACCOUNTING_MODES = ['off', 'simulation', 'active'] as const;
export type AccountingMode = (typeof ACCOUNTING_MODES)[number];

/**
 * Conditions manquantes d'une activation (`409 ACCOUNTING_ACTIVATION_PRECONDITION`,
 * `details.missing[]`), dans l'ordre de l'assistant. Miroir de
 * `AccountingActivationMissing` (`apps/api/src/authz/permissions.ts`, alignement testé).
 */
export const ACCOUNTING_ACTIVATION_MISSING_CODES = [
  'CHART_PACK_NOT_APPROVED',
  'BOOK_CURRENCY_REQUIRED',
  'CUTOVER_DATE_REQUIRED',
  'RULE_SET_NOT_VALIDATED',
  'EXPERT_REVIEW_NOT_DECLARED',
  'FISCAL_YEAR_NOT_OPEN',
] as const;
export type AccountingActivationMissingCode = (typeof ACCOUNTING_ACTIVATION_MISSING_CODES)[number];

// ── Pack de plan comptable (§ 2.1) ──────────────────────────────────────────

/** Référentiel du pack : même énumération que `systeme_comptable` des packs pays. */
export const ACCOUNTING_FRAMEWORKS = ['syscohada-revise-2017'] as const;
export type AccountingFramework = (typeof ACCOUNTING_FRAMEWORKS)[number];

/** Cycle de docs/09 § Modèle de version. Une version `active` est immuable. */
export const ACCOUNTING_CHART_PACK_STATUSES = [
  'draft',
  'review',
  'approved',
  'active',
  'retired',
] as const;
export type AccountingChartPackStatus = (typeof ACCOUNTING_CHART_PACK_STATUSES)[number];

/** Statuts qui permettent le mode `active` (décision ouverte n° 5). Les autres : simulation. */
export const ACCOUNTING_ACTIVATABLE_PACK_STATUSES: readonly AccountingChartPackStatus[] =
  Object.freeze(['approved', 'active']);

/** Statut d'une classe, d'un compte, d'une rubrique ou d'une règle proposée du pack. */
export const ACCOUNTING_CONFIRMATIONS = ['sourced', 'to_confirm'] as const;
export type AccountingConfirmation = (typeof ACCOUNTING_CONFIRMATIONS)[number];

/** Mention affichée à côté de tout élément `to_confirm` (pack, écran, export). */
export const ACCOUNTING_TO_CONFIRM_LABEL = 'À confirmer par l’expert-comptable';

/** Nature d'un compte du pack. */
export const ACCOUNTING_ACCOUNT_NATURES = [
  'asset',
  'liability',
  'equity',
  'expense',
  'income',
  'off_balance',
  'mixed',
] as const;
export type AccountingAccountNature = (typeof ACCOUNTING_ACCOUNT_NATURES)[number];

/** Nature d'un compte auxiliaire (§ 2.3) : fiche `customers` ou fiche `suppliers`. */
export const ACCOUNTING_AUXILIARY_KINDS = ['customer', 'supplier'] as const;
export type AccountingAuxiliaryKind = (typeof ACCOUNTING_AUXILIARY_KINDS)[number];

/** Origine d'un compte du plan de l'organisation (§ 2.3). */
export const ACCOUNTING_ACCOUNT_ORIGINS = ['pack', 'organization'] as const;
export type AccountingAccountOrigin = (typeof ACCOUNTING_ACCOUNT_ORIGINS)[number];

/**
 * Compte technique d'attente du mode simulation (§ 6.0), signalé comme tel. En mode
 * `active`, le compte d'attente est celui de la classe 47 désigné par l'expert (pack).
 */
export const ACCOUNTING_SIMULATION_SUSPENSE_ACCOUNT = 'ATTENTE';

// ── Règles de correspondance (§ 2.4) ────────────────────────────────────────

/** Une version `validated` est immuable ; la suivante la rend `superseded`. */
export const ACCOUNTING_RULE_SET_STATUSES = ['draft', 'validated', 'superseded'] as const;
export type AccountingRuleSetStatus = (typeof ACCOUNTING_RULE_SET_STATUSES)[number];

/** Jetons résolus à l'exécution dans une règle, à la place d'un numéro de compte. */
export const ACCOUNTING_RULE_TOKENS = ['{customer}', '{supplier}', '{treasuryAccount}'] as const;
export type AccountingRuleToken = (typeof ACCOUNTING_RULE_TOKENS)[number];

// ── Journaux (§ 2.5) ────────────────────────────────────────────────────────

export const ACCOUNTING_JOURNAL_KINDS = [
  'sales',
  'purchases',
  'treasury',
  'misc',
  'opening',
] as const;
export type AccountingJournalKind = (typeof ACCOUNTING_JOURNAL_KINDS)[number];

/**
 * Journaux créés à l'activation, codes proposés et modifiables ; un journal de
 * trésorerie par compte d'ADR-0034 s'y ajoute (`T01`, `T02`…).
 */
export const ACCOUNTING_DEFAULT_JOURNALS: readonly {
  readonly code: string;
  readonly kind: AccountingJournalKind;
  readonly label: string;
}[] = Object.freeze([
  { code: 'VE', kind: 'sales', label: 'Ventes' },
  { code: 'AC', kind: 'purchases', label: 'Achats' },
  { code: 'OD', kind: 'misc', label: 'Opérations diverses' },
  { code: 'AN', kind: 'opening', label: 'À-nouveaux' },
]);

/** Préfixe proposé des journaux de trésorerie (`T01`, `T02`…). */
export const ACCOUNTING_TREASURY_JOURNAL_PREFIX = 'T';

/** Journaux où se saisit une opération diverse (§ 6.9). */
export const ACCOUNTING_MANUAL_JOURNAL_KINDS: readonly AccountingJournalKind[] = Object.freeze([
  'misc',
  'opening',
]);

// ── Écritures (§ 2.6) ───────────────────────────────────────────────────────

/** Jamais de suppression d'une `posted` : contre-passation. */
export const ACCOUNTING_ENTRY_STATUSES = ['draft', 'awaiting_rate', 'posted'] as const;
export type AccountingEntryStatus = (typeof ACCOUNTING_ENTRY_STATUSES)[number];

/** Origine du taux d'une ligne (§ 5), dans l'ordre d'application. */
export const ACCOUNTING_RATE_SOURCES = [
  'same_currency',
  'document',
  'observed',
  'entered',
] as const;
export type AccountingRateSource = (typeof ACCOUNTING_RATE_SOURCES)[number];

/** Nature de la pièce source d'une écriture (`source.kind`). */
export const ACCOUNTING_SOURCE_KINDS = [
  'sales_invoice',
  'sales_receipt',
  'treasury_expense',
  'treasury_movement',
  'supplier_invoice',
  'supplier_payment',
  'stock_movement',
  'manual',
] as const;
export type AccountingSourceKind = (typeof ACCOUNTING_SOURCE_KINDS)[number];

/** Points de lecture de la synchronisation (`accounting_sync_checkpoints`, § 2.7). */
export const ACCOUNTING_SYNC_SOURCES = [
  'sales_invoices',
  'sales_receipts',
  'treasury_expenses',
  'treasury_movements',
  'supplier_invoices',
  'supplier_payments',
  'stock_movements',
] as const;
export type AccountingSyncSource = (typeof ACCOUNTING_SYNC_SOURCES)[number];

/** Motifs de « À comptabiliser » (`accounting_pending`, § 2.7). */
export const ACCOUNTING_PENDING_REASONS = [
  'NO_TREASURY_ACCOUNT',
  'RATE_MISSING',
  'PERIOD_CLOSED',
  'SOURCE_CHANGED_IN_CLOSED_PERIOD',
  'UNSUPPORTED_SOURCE',
] as const;
export type AccountingPendingReason = (typeof ACCOUNTING_PENDING_REASONS)[number];

/** Événement de lettrage, en ajout seul (§ 2.7, § 6.11). */
export const ACCOUNTING_LETTERING_ACTIONS = ['letter', 'unletter'] as const;
export type AccountingLetteringAction = (typeof ACCOUNTING_LETTERING_ACTIONS)[number];

// ── Exercices et périodes (§ 2.7, § 4) ──────────────────────────────────────

export const ACCOUNTING_FISCAL_YEAR_STATUSES = ['open', 'closing', 'closed'] as const;
export type AccountingFiscalYearStatus = (typeof ACCOUNTING_FISCAL_YEAR_STATUSES)[number];

export const ACCOUNTING_PERIOD_STATUSES = ['open', 'closed'] as const;
export type AccountingPeriodStatus = (typeof ACCOUNTING_PERIOD_STATUSES)[number];

/** Options d'écriture de stock (§ 6.7) : éteintes par défaut (décision ouverte n° 17). */
export const ACCOUNTING_STOCK_POSTING_MODES = ['off', 'perpetual'] as const;
export type AccountingStockPostingMode = (typeof ACCOUNTING_STOCK_POSTING_MODES)[number];

/** Amortissements (§ 6.8) : `off`, seule valeur admise (décision ouverte n° 18). */
export const ACCOUNTING_DEPRECIATION_POSTING_MODES = ['off'] as const;
export type AccountingDepreciationPostingMode =
  (typeof ACCOUNTING_DEPRECIATION_POSTING_MODES)[number];

/**
 * Réglages par défaut (§ 2.2). `bookCurrency` et `cutoverDate` n'ont AUCUN défaut ;
 * `fiscalYearStartMonth` (janvier) est à confirmer par l'expert (E6, décision n° 19).
 */
export const ACCOUNTING_SETTINGS_DEFAULTS = Object.freeze({
  mode: 'off' as AccountingMode,
  bookCurrency: null as AccountingBookCurrency | null,
  cutoverDate: null as string | null,
  fiscalYearStartMonth: 1,
  stockPosting: 'off' as AccountingStockPostingMode,
  depreciationPosting: 'off' as AccountingDepreciationPostingMode,
});

// ── Restitution (§ 6.10, § 7, § 10) ─────────────────────────────────────────

/** Réserves qu'un projet d'état dit de lui-même (§ 6.10). Jamais masquées. */
export const ACCOUNTING_RESERVES = [
  'PACK_NOT_REVIEWED',
  'SUSPENSE_BALANCE',
  'AWAITING_RATE',
  'PENDING_SOURCES',
  'OPENING_INCOMPLETE',
  'PERIODS_OPEN',
  'DEPRECIATION_NOT_POSTED',
  'STOCK_NOT_POSTED',
  'PAYMENTS_AT_ISSUE_UNCLASSIFIED',
] as const;
export type AccountingReserve = (typeof ACCOUNTING_RESERVES)[number];

/** Causes typées d'un écart avec le réalisé (§ 7) ; `UNEXPLAINED` est une alerte. */
export const ACCOUNTING_RECONCILIATION_CAUSES = [
  'OUTSIDE_CUTOVER',
  'CURRENCY_NOT_CONVERTIBLE',
  'MANUAL_ENTRY',
  'SUSPENSE',
  'PERIOD_MAPPING',
  'ACTUALS_MANUAL_VALUE',
  'UNEXPLAINED',
] as const;
export type AccountingReconciliationCause = (typeof ACCOUNTING_RECONCILIATION_CAUSES)[number];

/** Projets d'états (§ 10) ; `cash-flow` reste « non disponible » tant que E8 n'est pas tranchée. */
export const ACCOUNTING_STATEMENT_KINDS = [
  'balance-sheet',
  'income-statement',
  'cash-flow',
] as const;
export type AccountingStatementKind = (typeof ACCOUNTING_STATEMENT_KINDS)[number];

/** Seul statut d'un projet d'état, sur chaque réponse d'API (§ 10). */
export const ACCOUNTING_STATEMENT_STATUS = 'draft_unverified';
export type AccountingStatementStatus = typeof ACCOUNTING_STATEMENT_STATUS;

/**
 * Bandeau des projets d'états (§ 10) : écran, chaque page PDF, chaque feuille `.xlsx`,
 * réponse d'API (`disclaimer`). Même texte que `STATEMENT_DISCLAIMER` du moteur : l'ADR
 * écrivait « ni certifié », mot interdit par son propre critère 14 (amendement du 1er nov. 2026).
 */
export const ACCOUNTING_DISCLAIMER =
  'Projet — à valider par un expert-comptable. Établi automatiquement par Lalanda à partir des opérations enregistrées ; non vérifié, non déposé.';

/** Bandeaux des modes (§ 3.1) et en-tête des exports (§ 9). */
export const ACCOUNTING_MODE_BANNERS: Readonly<Record<Exclude<AccountingMode, 'off'>, string>> =
  Object.freeze({
    simulation:
      'Simulation — plan comptable non relu par un expert-comptable ; rien n’est enregistré',
    active: 'Projet — à valider par un expert-comptable',
  });

/** Marque du nom et de l'en-tête d'un export en mode simulation (§ 9). */
export const ACCOUNTING_SIMULATION_EXPORT_MARK = 'SIMULATION';

/**
 * Mots qu'aucun libellé de l'interface, d'un gabarit ou d'un export ne porte (critère 14) :
 * Lalanda n'affirme jamais une conformité.
 *
 * § 10 cite aussi « déclaration » (déclaration fiscale) : il n'est pas dans cette liste
 * mécanique parce que l'écran doit dire « déclaration de relecture » (§ 2.4, décision
 * ouverte n° 6) ; les lots K6 et K8 le vérifient à la main sur leurs gabarits.
 */
export const ACCOUNTING_FORBIDDEN_WORDS = ['conforme', 'certifié', 'définitif', 'liasse'] as const;

/**
 * Mots interdits trouvés dans `text` (casse et accents de la forme fléchie ignorés :
 * « Certifiée », « DÉFINITIVE », « conformité » sont trouvés), le bandeau officiel
 * retiré d'abord. Sert au test des mots interdits des lots K6 et K8.
 */
export function findForbiddenAccountingWords(text: string): string[] {
  const fold = (v: string): string => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const haystack = fold(text.split(ACCOUNTING_DISCLAIMER).join(' '));
  return ACCOUNTING_FORBIDDEN_WORDS.filter((w) => {
    // « conforme » couvre « conformité » ; les autres, leurs formes fléchies.
    const stem = w === 'conforme' ? 'conform' : fold(w);
    return haystack.includes(stem);
  });
}

// ── Codes d'erreur (§ 11) ───────────────────────────────────────────────────

/** Codes métier de l'API comptable, en `SCREAMING_SNAKE_CASE` (§ 11). */
export const ACCOUNTING_ERROR_CODES = [
  'ACCOUNTING_ACTIVATION_PRECONDITION',
  'BOOK_CURRENCY_LOCKED',
  'CUTOVER_LOCKED',
  'ACCOUNT_OUTSIDE_PACK',
  'ACCOUNT_IN_USE',
  'ACCOUNT_NUMBER_EXISTS',
  'UNKNOWN_OPERATION_KEY',
  'SELF_APPROVAL_FORBIDDEN',
  'EXPERT_REVIEW_DECLARATION_REQUIRED',
  'RULE_SET_IMMUTABLE',
  'ENTRY_UNBALANCED',
  'ACCOUNTING_PERIOD_CLOSED',
  'ENTRY_ALREADY_REVERSED',
  'ENTRY_NOT_DRAFT',
  'RATE_IN_USE_IN_CLOSED_PERIOD',
  'LETTERING_NOT_BALANCED',
  'LETTERING_MIXED_ACCOUNTS',
  'STATEMENT_NOT_AVAILABLE',
  'PERIOD_HAS_DRAFTS',
  'FISCAL_YEAR_NOT_CLOSABLE',
  'REOPEN_OWNER_ONLY',
  'REOPEN_REASON_REQUIRED',
  'STOCK_POSTING_NOT_VALIDATED',
] as const;
export type AccountingErrorCode = (typeof ACCOUNTING_ERROR_CODES)[number];

// ── Bornes (techniques, pas comptables) ─────────────────────────────────────

export const ACCOUNTING_LIMITS = Object.freeze({
  /** Numéro de compte : chiffres seulement. Borne de saisie, pas une règle du plan. */
  accountNumberMaxDigits: 20,
  accountLabel: 200,
  journalCode: 10,
  journalLabel: 80,
  entryLabel: 200,
  reason: 500,
  /** Lignes d'une opération diverse. */
  manualEntryLines: 200,
  /** Décimales d'un montant (centimes, comme le moteur). */
  amountDecimals: 2,
  /** Décimales d'un taux saisi ou observé. */
  rateDecimals: 10,
  rateSourceText: 300,
});
