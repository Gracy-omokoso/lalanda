// Contrats de la reprise de l'existant : à-nouveaux de reprise à la bascule
// (ADR-0049 § 3.2, § 6.9, § 11 `GET /accounting/opening/proposal`, `POST /accounting/opening`).
// ADR-0049 — K7.
//
// Lalanda PROPOSE, sans rien valider : soldes des comptes de trésorerie au début du jour de
// bascule (moteur `treasury`), restes à encaisser par facture (moteur `receivables`), restes
// à payer par facture fournisseur (moteur `purchases`, ADR-0044). La contrepartie (capitaux
// propres, immobilisations, emprunts, stocks, dettes fiscales et sociales) n'est PAS
// proposée : l'organisation la saisit, d'après la dernière balance de son expert-comptable.
// L'écriture d'à-nouveaux (journal `AN`) naît brouillon et se valide par une AUTRE personne
// autorisée (séparation des tâches, `manualEntryDecision`), sauf approbateur unique.
//
// AUCUN numéro de compte ici ; les montants sont des CHAÎNES décimales rendues par le moteur.

import { z } from 'zod';

import {
  AccountingAccountNumber,
  AccountingAmount,
  AccountingCurrencySchema,
  AccountingExpectedRevision,
  AccountingReason,
  accountingFr,
  accountingIssue,
  accountingOptionalText,
} from './common.js';
import {
  ACCOUNTING_LIMITS,
  ACCOUNTING_SIMULATION_SUSPENSE_ACCOUNT,
  type AccountingBookCurrency,
  type AccountingMode,
} from './constants.js';
import type { AccountingEntryView } from './entries.js';

/** Nature d'une ligne proposée : trésorerie, créance client, dette fournisseur. */
export const ACCOUNTING_OPENING_LINE_KINDS = ['treasury', 'receivable', 'payable'] as const;
export type AccountingOpeningLineKind = (typeof ACCOUNTING_OPENING_LINE_KINDS)[number];

/** Ce que Lalanda ne connaît pas et ne propose jamais (§ 3.2). */
export const ACCOUNTING_OPENING_NOT_PROPOSED = [
  'capitaux_propres',
  'immobilisations',
  'emprunts',
  'stocks',
  'dettes_fiscales_et_sociales',
] as const;

/** Codes d'erreur propres à la reprise (en plus de ceux du § 11). */
export const ACCOUNTING_OPENING_ERROR_CODES = [
  'ACCOUNTING_OFF',
  'OPENING_ALREADY_EXISTS',
  'OPENING_NOT_FOUND',
  'OPENING_RATE_MISSING',
  'OPENING_UNKNOWN_PROPOSAL_LINE',
  'OPENING_PROPOSAL_CHANGED',
  'OPENING_EMPTY',
] as const;
export type AccountingOpeningErrorCode = (typeof ACCOUNTING_OPENING_ERROR_CODES)[number];

/** Ligne proposée par Lalanda (montants du moteur, jamais modifiables : on l'écarte). */
export interface AccountingOpeningProposalLineView {
  /** Référence stable : `treasury:<compte>`, `sales_invoice:<id>`, `supplier_invoice:<id>`. */
  ref: string;
  kind: AccountingOpeningLineKind;
  accountNumber: string;
  accountLabel: string | null;
  auxiliaryAccountNumber: string | null;
  /** Vrai si le compte auxiliaire n'existe pas encore : il naîtra à la saisie. */
  auxiliaryProvisional: boolean;
  label: string;
  side: 'debit' | 'credit';
  currency: AccountingBookCurrency;
  /** Montant en devise de la pièce, positif. */
  amount: string;
  /** Montant en monnaie de tenue ; `null` sans taux saisi pour le jour de bascule. */
  bookAmount: string | null;
  rate: string | null;
  rateSource: 'same_currency' | 'entered' | null;
  status: 'proposed' | 'awaiting_rate';
  documentNumber: string | null;
  partyName: string | null;
  /** Motif quand la ligne vise le compte d'attente (compte inconnu). */
  suspenseReason: 'NO_TREASURY_ACCOUNT' | 'NO_COLLECTIVE_ACCOUNT' | null;
}

/** Compte de trésorerie ouvert APRÈS la bascule : son solde d'ouverture n'est pas repris ici. */
export interface AccountingOpeningLaterAccountView {
  treasuryAccountId: string;
  name: string;
  currency: AccountingBookCurrency;
  openingDate: string;
  openingBalance: string;
}

/** État de la reprise : écriture d'à-nouveaux de reprise (brouillon ou validée), écarts. */
export interface AccountingOpeningStatusView {
  /** `none` : rien saisi ; `draft` : brouillon à valider ; `posted` : validée. */
  state: 'none' | 'draft' | 'posted';
  /** Vrai seulement pour une écriture validée (réserve `OPENING_INCOMPLETE` levée). */
  validated: boolean;
  /** Équilibre en monnaie de tenue ET dans chaque devise. */
  balanced: boolean;
  entry: AccountingEntryView | null;
  /**
   * Écarts entre l'écriture et la proposition recalculée aujourd'hui : `changed` (montant
   * différent : la validation est refusée) ; `missing` (ligne proposée absente de
   * l'écriture : écartée à la saisie, ou née depuis).
   */
  differences: { changed: string[]; missing: string[] };
}

/** `GET /accounting/opening/proposal` : proposition, jamais une écriture. */
export interface AccountingOpeningProposalView {
  proposal: true;
  mode: AccountingMode;
  simulation: boolean;
  cutoverDate: string;
  /** Les soldes sont ceux du DÉBUT du jour de bascule (pièces antérieures seulement). */
  asOfStartOf: string;
  bookCurrency: AccountingBookCurrency;
  journalCode: string;
  lines: AccountingOpeningProposalLineView[];
  /** Débit − crédit des lignes chiffrées, en monnaie de tenue (moteur). */
  bookImbalance: string;
  /** Totaux par devise de pièce (moteur) : la contrepartie doit les équilibrer. */
  currencyTotals: { currency: AccountingBookCurrency; debit: string; credit: string }[];
  awaitingRateCount: number;
  notProposed: readonly string[];
  counterpartRequired: true;
  laterTreasuryAccounts: AccountingOpeningLaterAccountView[];
  engineVersion: string;
  current: AccountingOpeningStatusView;
}

/**
 * Compte d'une contrepartie : un compte du plan, ou le compte d'attente technique (§ 6.0) —
 * le pack v1 ne désigne encore ni les capitaux propres ni les autres comptes de la classe 1 :
 * ce que l'organisation ne sait pas classer y attend, visible, jusqu'au reclassement.
 */
const OpeningAccountNumber = z.union([
  z.literal(ACCOUNTING_SIMULATION_SUSPENSE_ACCOUNT),
  AccountingAccountNumber,
]);

/**
 * Ligne de contrepartie saisie : un compte du plan (ou son auxiliaire), un débit OU un
 * crédit, dans une devise (monnaie de tenue par défaut ; autre devise : taux saisi du jour
 * de bascule exigé).
 */
export const AccountingOpeningLineInput = z
  .object({
    accountNumber: OpeningAccountNumber,
    auxiliaryAccountNumber: AccountingAccountNumber.nullable().optional(),
    label: accountingOptionalText(ACCOUNTING_LIMITS.entryLabel).optional(),
    currency: AccountingCurrencySchema.optional(),
    debit: AccountingAmount.optional(),
    credit: AccountingAmount.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.debit === undefined) === (v.credit === undefined)) {
      accountingIssue(
        ctx,
        'LINE_ONE_SIDE',
        'Chaque ligne porte soit un débit, soit un crédit, jamais les deux.',
      );
    }
  });
export type AccountingOpeningLineInput = z.output<typeof AccountingOpeningLineInput>;

/** Référence d'une ligne proposée à écarter. */
const ProposalRef = z
  .string(accountingFr('Référence de ligne proposée attendue.'))
  .trim()
  .min(1)
  .max(120);

/**
 * `POST /accounting/opening` : saisie, en brouillon, de l'écriture d'à-nouveaux de reprise
 * datée du jour de bascule. Les lignes proposées sont reprises telles que le moteur les
 * calcule, sauf celles écartées (`exclude`) ; la contrepartie est saisie (`lines`).
 */
export const CreateAccountingOpeningBody = z
  .object({
    reason: AccountingReason,
    label: accountingOptionalText(ACCOUNTING_LIMITS.entryLabel).optional(),
    exclude: z.array(ProposalRef).max(ACCOUNTING_LIMITS.manualEntryLines).optional(),
    lines: z
      .array(AccountingOpeningLineInput, accountingFr('Lignes attendues.'))
      .max(ACCOUNTING_LIMITS.manualEntryLines, {
        message: `${ACCOUNTING_LIMITS.manualEntryLines} lignes au plus.`,
      }),
  })
  .strict();
export type CreateAccountingOpeningBody = z.output<typeof CreateAccountingOpeningBody>;

/** `POST /accounting/opening/:id/validate` : séparation des tâches. */
export const ValidateAccountingOpeningBody = z
  .object({ expectedRevision: AccountingExpectedRevision })
  .strict();
export type ValidateAccountingOpeningBody = z.output<typeof ValidateAccountingOpeningBody>;
