// ─────────────────────────────────────────────────────────────────────────────
// Comptabilité — restitution (ADR-0049 § 6.10, § 6.11, § 4, § 3.2, § 7, § 9,
// § 10 ; lot K3) — types d'entrée et de sortie.
//
// Module PUR : aucune base, aucun réseau, aucune horloge. Montants en chaînes
// décimales (deux décimales au plus) ; arithmétique en entiers `bigint`
// (centimes), jamais en flottant ; AUCUNE conversion de devise : la balance et
// les états sont en monnaie de tenue (montants `debit` / `credit` déjà calculés
// par le moteur d'écritures, avec leur taux explicite), le grand livre, les
// auxiliaires et le lettrage gardent AUSSI le montant en devise de la pièce.
//
// Aucun numéro de compte n'est écrit dans ce module : les classes, la nature
// des comptes et les rubriques d'états viennent du pack (lot K1), le compte
// d'attente et le compte de résultat viennent des réglages ou des règles.
//
// Ces types sont des VUES structurelles des écritures du lot K2
// (`accounting/types.ts`, ADR-0049 § 2.6) : le lot K3 ne les possède pas et
// les lit seulement ; un objet d'écriture K2 conforme au § 2.6 s'y range.
// ─────────────────────────────────────────────────────────────────────────────

/** Toute évolution d'un calcul de restitution incrémente cette version. */
export const ACCOUNTING_REPORTING_VERSION = '1.0.0';

/** Monnaies admises (monnaie de tenue et devise des pièces), ADR-0049 § 2.2. */
export const REPORTING_CURRENCIES = ['CDF', 'USD'] as const;
export type ReportingCurrency = (typeof REPORTING_CURRENCIES)[number];

/** Date civile `AAAA-MM-JJ` (jour de Kinshasa, ADR-0027). */
export type ReportingDay = string;
/** Mois civil `AAAA-MM`. */
export type ReportingMonth = string;
/** Montant décimal, deux décimales au plus (« 1250.50 ») ; signé seulement en sortie. */
export type ReportingAmount = string;

/** Statuts d'une écriture (§ 2.6). Seules les `posted` entrent dans les livres. */
export const REPORTING_ENTRY_STATUSES = ['draft', 'awaiting_rate', 'posted'] as const;
export type ReportingEntryStatus = (typeof REPORTING_ENTRY_STATUSES)[number];

/** Copie d'affichage de la pièce source (§ 2.6 `source`). */
export interface ReportingSource {
  kind: string;
  id: string;
  number: string | null;
  date: ReportingDay;
  partyName: string | null;
}

/** Ligne d'écriture (§ 2.6 `lines[]`). */
export interface ReportingLine {
  accountNumber: string;
  auxiliaryAccountNumber: string | null;
  label: string;
  /** Débit en MONNAIE DE TENUE, strictement positif ; `null` (ou absent) si la ligne est au crédit. */
  debit: ReportingAmount | null;
  /** Crédit en MONNAIE DE TENUE, strictement positif ; `null` (ou absent) si la ligne est au débit. */
  credit: ReportingAmount | null;
  /** Devise de la pièce. */
  currency: ReportingCurrency;
  /** Montant en devise de la pièce, strictement positif, du même côté que la ligne. */
  amount: ReportingAmount;
  rate?: string | null;
  rateSource?: string | null;
  rateRef?: string | null;
  letteringCode?: string | null;
  /**
   * Clé d'opération de la règle qui a produit la ligne (§ 2.4, § 6), par exemple
   * `sale.invoice.revenue.SER.B` ; `null` pour une saisie manuelle. Sert au
   * rapprochement avec le réalisé (§ 7) et au détail du compte d'attente.
   */
  operationKey?: string | null;
  /** Motif d'attente quand la ligne vise le compte d'attente (§ 6.0). */
  suspenseReason?: string | null;
  /**
   * Pièce que la ligne règle ou constate (facture citée par un encaissement,
   * facture elle-même) : base du lettrage automatique (§ 6.11) et du détail des
   * à-nouveaux de tiers par facture ouverte (§ 3.2).
   */
  documentRef?: string | null;
}

/** Écriture (§ 2.6). */
export interface ReportingEntry {
  id: string;
  journalCode: string;
  fiscalYear: number | null;
  /** Numéro attribué à la validation ; `null` en simulation ou avant validation. */
  number: number | null;
  date: ReportingDay;
  status: ReportingEntryStatus;
  label?: string | null;
  source: ReportingSource | null;
  sourceKey: string | null;
  lines: readonly ReportingLine[];
  reversalOf?: string | null;
  reversedBy?: string | null;
  generation?: {
    ruleSetVersion: number;
    chartPack: { slug: string; version: number | string };
    engineVersion: string;
  } | null;
  manual?: { authorId: string; validatorId: string | null; reason: string } | null;
  /** Date de validation (jour de Kinshasa), `null` si non validée. */
  postedOn?: ReportingDay | null;
  hash?: string | null;
}

/** Confirmation d'un élément du pack (§ 2.1). */
export type ReportingConfirmation = 'sourced' | 'to_confirm';

/** Nature d'un compte du pack (§ 2.1). */
export type ReportingAccountNature =
  'asset' | 'liability' | 'equity' | 'expense' | 'income' | 'off_balance' | 'mixed';

/** Vue du plan comptable (pack K1 + comptes de l'organisation) utile à la restitution. */
export interface ReportingChart {
  classes: readonly {
    number: string | number;
    label: string;
    confirmation: ReportingConfirmation;
  }[];
  accounts: readonly {
    number: string;
    label: string;
    classNumber: string | number;
    nature: ReportingAccountNature;
    confirmation: ReportingConfirmation;
    collective?: boolean;
    auxiliaryKind?: 'customer' | 'supplier' | null;
  }[];
}

/** Identifiant stable d'une ligne : `<id de l'écriture>#<rang de la ligne>`. */
export type LineRef = string;
