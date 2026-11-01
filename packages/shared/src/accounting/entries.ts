// Contrats des écritures et de la synchronisation (ADR-0049 §§ 2.6, 2.7, 4, 6, 11).
// ADR-0049 — K5.
//
// Écritures (générées depuis les pièces du RUN, ou opérations diverses saisies à la
// main), « À comptabiliser », synchronisation, contre-passation, lettrage, régénération
// contrôlée d'un mois ouvert, rattachement d'un compte de trésorerie à un compte du plan.
//
// AUCUN numéro de compte, AUCUNE règle comptable ici : les comptes viennent des règles
// validées par l'organisation ; les montants sont des CHAÎNES décimales calculées par le
// moteur (`@lalanda/engine`, module `accounting`). Recherches et filtres passent en corps
// `POST` (§ 11) : aucune donnée comptable dans l'URL au-delà des identifiants.

import { z } from 'zod';

import {
  ACCOUNTING_ENTRY_STATUSES,
  ACCOUNTING_LIMITS,
  ACCOUNTING_SOURCE_KINDS,
  type AccountingBookCurrency,
  type AccountingEntryStatus,
  type AccountingJournalKind,
  type AccountingMode,
  type AccountingPendingReason,
  type AccountingRateSource,
  type AccountingSourceKind,
} from './constants.js';
import {
  AccountingAccountNumber,
  AccountingAmount,
  AccountingCalendarDay,
  AccountingExpectedRevision,
  AccountingJournalCode,
  AccountingReason,
  accountingFr,
  accountingIssue,
  accountingOptionalText,
} from './common.js';

/** Codes métier propres au lot K5, en plus de `ACCOUNTING_ERROR_CODES` (K0). */
export const ACCOUNTING_ENTRY_ERROR_CODES = [
  /** Mode `off` ou `simulation` : rien n'est enregistré, aucune saisie. */
  'ACCOUNTING_NOT_ACTIVE',
  /** Simulation sans monnaie de tenue ou sans bascule : rien ne se calcule (aucun défaut). */
  'ACCOUNTING_SETTINGS_INCOMPLETE',
  'ENTRY_NOT_FOUND',
  /** Une contre-passation ne se contre-passe pas. */
  'ENTRY_IS_REVERSAL',
  /** Seul un journal d'opérations diverses ou d'à-nouveaux reçoit une saisie (§ 6.9). */
  'JOURNAL_NOT_MANUAL',
  'JOURNAL_NOT_FOUND',
  /** Compte absent du plan actif de l'organisation. */
  'ACCOUNT_NOT_IN_PLAN',
  'PENDING_NOT_FOUND',
  'LETTERING_NOT_FOUND',
  'TREASURY_ACCOUNT_NOT_FOUND',
] as const;
export type AccountingEntryErrorCode = (typeof ACCOUNTING_ENTRY_ERROR_CODES)[number];

// ── Vues des écritures (§ 2.6) ──────────────────────────────────────────────

/**
 * Ligne d'écriture. Débit OU crédit en monnaie de tenue (l'autre côté `null`, comme la
 * restitution) ; montant et devise DE LA PIÈCE ; taux et son origine (§ 5).
 */
export interface AccountingEntryLineView {
  /** Référence stable de la ligne (`<id de l'écriture>#<rang>`) : lettrage manuel. */
  ref: string;
  accountNumber: string;
  /** Libellé du compte dans le plan de l'organisation ; `null` hors plan (compte d'attente). */
  accountLabel: string | null;
  auxiliaryAccountNumber: string | null;
  label: string;
  debit: string | null;
  credit: string | null;
  currency: AccountingBookCurrency;
  amount: string;
  rate: string | null;
  rateSource: AccountingRateSource | null;
  rateRef: string | null;
  letteringCode: string | null;
  /** Clé d'opération qui a choisi le compte (§ 6) ; `manual` pour une opération diverse. */
  operationKey: string;
  /** Motif quand la ligne vise le compte d'attente (§ 6.0). */
  suspenseReason: string | null;
  exchangeDifference: boolean;
}

/** Copie d'affichage de la pièce (§ 2.6 `source`) ; `null` pour une opération diverse. */
export interface AccountingEntrySourceView {
  kind: AccountingSourceKind;
  id: string;
  event: string | null;
  number: string | null;
  date: string;
  partyName: string | null;
}

export interface AccountingEntryView {
  /** Identifiant enregistré ; en simulation, la clé de source (rien n'est enregistré). */
  id: string;
  journalCode: string;
  journalKind: AccountingJournalKind;
  /** Exercice et numéro attribués à la validation ; `null` avant, et en simulation. */
  fiscalYear: number | null;
  number: number | null;
  date: string;
  status: AccountingEntryStatus;
  bookCurrency: AccountingBookCurrency;
  label: string | null;
  source: AccountingEntrySourceView | null;
  sourceKey: string;
  lines: AccountingEntryLineView[];
  /** Identifiant de l'écriture contre-passée (en simulation : sa clé). */
  reversalOf: string | null;
  reversedBy: string | null;
  /** `SOURCE_CANCELLED`, `SOURCE_REVISED`, `SOURCE_CHANGED_IN_CLOSED_PERIOD`, `MANUAL`, `REGENERATION`. */
  reversalReason: string | null;
  /** Règles et moteur qui l'ont produite ; `null` pour une saisie manuelle. */
  generation: {
    ruleSetVersion: number | null;
    chartPack: { slug: string; version: number } | null;
    engineVersion: string;
  } | null;
  manual: {
    authorId: string;
    validatorId: string | null;
    soleApprover: boolean;
    attachmentKey: string | null;
    reason: string;
  } | null;
  suspense: boolean;
  /** Chaînage (§ 2.6), posé à la validation. */
  seq: number | null;
  hash: string | null;
  postedAt: string | null;
  /** Vrai en mode `simulation` : calculée à la volée, jamais enregistrée. */
  simulation: boolean;
  /** Révision (opération diverse en brouillon) ; `null` en simulation. */
  revision: number | null;
}

/** Page d'une liste (curseur opaque). */
export interface AccountingPage<T> {
  items: T[];
  nextCursor: string | null;
  /** Vrai en mode `simulation`. */
  simulation?: boolean;
}

/** Corps de `POST /accounting/entries/search` (filtres en corps, § 11). */
export const AccountingEntrySearchBody = z
  .object({
    journalCode: AccountingJournalCode.optional(),
    from: AccountingCalendarDay.optional(),
    to: AccountingCalendarDay.optional(),
    accountNumber: AccountingAccountNumber.optional(),
    /** Numéro de la pièce (copie d'affichage), recherche exacte sans casse. */
    sourceNumber: z
      .string(accountingFr('Numéro de pièce : texte attendu.'))
      .trim()
      .min(1)
      .max(80)
      .optional(),
    sourceKind: z
      .enum(ACCOUNTING_SOURCE_KINDS, accountingFr('Nature de pièce inconnue.'))
      .optional(),
    sourceId: z
      .string(accountingFr('Identifiant de pièce attendu.'))
      .regex(/^[0-9a-f]{24}$/i, { message: 'Identifiant de pièce invalide.' })
      .transform((v) => v.toLowerCase())
      .optional(),
    status: z.enum(ACCOUNTING_ENTRY_STATUSES, accountingFr('Statut inconnu.')).optional(),
    suspense: z.boolean(accountingFr('Booléen attendu.')).optional(),
    cursor: z.string(accountingFr('Curseur attendu.')).min(1).max(200).optional(),
    limit: z
      .number(accountingFr('Limite : un entier.'))
      .int({ message: 'Limite : un entier.' })
      .min(1)
      .max(200)
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.from !== undefined && v.to !== undefined && v.from > v.to) {
      accountingIssue(ctx, 'INVALID_RANGE', 'La date de début dépasse la date de fin.', ['from']);
    }
  });
export type AccountingEntrySearchBody = z.output<typeof AccountingEntrySearchBody>;
export type AccountingEntrySearch = z.input<typeof AccountingEntrySearchBody>;

// ── Opérations diverses (§ 6.9) ─────────────────────────────────────────────

/**
 * Ligne saisie : un compte du plan (ou son auxiliaire), un débit OU un crédit,
 * strictement positif, en monnaie de tenue.
 */
export const AccountingManualLineInput = z
  .object({
    accountNumber: AccountingAccountNumber,
    auxiliaryAccountNumber: AccountingAccountNumber.nullable().optional(),
    label: accountingOptionalText(ACCOUNTING_LIMITS.entryLabel).optional(),
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
export type AccountingManualLineInput = z.output<typeof AccountingManualLineInput>;

const ManualLines = z
  .array(AccountingManualLineInput, accountingFr('Lignes attendues.'))
  .min(2, { message: 'Une écriture compte au moins deux lignes.' })
  .max(ACCOUNTING_LIMITS.manualEntryLines, {
    message: `${ACCOUNTING_LIMITS.manualEntryLines} lignes au plus.`,
  });

/** Clé d'une pièce jointe déjà déposée (PDF ou image, motif d'ADR-0039 § 2.5). */
const AttachmentKey = z
  .string(accountingFr('Clé de pièce jointe attendue.'))
  .trim()
  .min(1)
  .max(300)
  .nullable();

/** `POST /accounting/entries` : brouillon d'opération diverse (journal `OD` ou `AN`). */
export const CreateManualEntryBody = z
  .object({
    journalCode: AccountingJournalCode,
    date: AccountingCalendarDay,
    label: accountingOptionalText(ACCOUNTING_LIMITS.entryLabel).optional(),
    reason: AccountingReason,
    attachmentKey: AttachmentKey.optional(),
    lines: ManualLines,
  })
  .strict();
export type CreateManualEntryBody = z.output<typeof CreateManualEntryBody>;

/** `PUT /accounting/entries/:id` : brouillon seulement (`409 ENTRY_NOT_DRAFT`). */
export const UpdateManualEntryBody = z
  .object({
    expectedRevision: AccountingExpectedRevision,
    date: AccountingCalendarDay.optional(),
    label: accountingOptionalText(ACCOUNTING_LIMITS.entryLabel).optional(),
    reason: AccountingReason.optional(),
    attachmentKey: AttachmentKey.optional(),
    lines: ManualLines.optional(),
  })
  .strict();
export type UpdateManualEntryBody = z.output<typeof UpdateManualEntryBody>;

/** `POST /accounting/entries/:id/validate` : séparation des tâches (`manualEntryDecision`). */
export const ValidateManualEntryBody = z
  .object({ expectedRevision: AccountingExpectedRevision })
  .strict();
export type ValidateManualEntryBody = z.output<typeof ValidateManualEntryBody>;

/**
 * `POST /accounting/entries/:id/reverse` : contre-passation d'une écriture validée, motif
 * obligatoire ; date par défaut : le jour de Kinshasa.
 */
export const ReverseEntryBody = z
  .object({ reason: AccountingReason, date: AccountingCalendarDay.optional() })
  .strict();
export type ReverseEntryBody = z.output<typeof ReverseEntryBody>;

// ── « À comptabiliser » (§ 2.7) ─────────────────────────────────────────────

export interface AccountingPendingView {
  /** Identifiant enregistré ; en simulation, `<nature>:<pièce>:<motif>`. */
  id: string;
  reason: AccountingPendingReason;
  status: 'open' | 'resolved';
  source: { kind: AccountingSourceKind; id: string; number: string | null; date: string };
  /** Écriture concernée (contre-passation au premier jour ouvert), s'il y en a une. */
  entryId: string | null;
  createdAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
}

/** `POST /accounting/pending/:id/resolve` : revue faite, motif obligatoire. */
export const ResolvePendingBody = z.object({ note: AccountingReason }).strict();
export type ResolvePendingBody = z.output<typeof ResolvePendingBody>;

// ── Synchronisation (§ 6, O3) ───────────────────────────────────────────────

/** Compteurs d'une synchronisation ; en simulation, rien n'est écrit. */
export interface AccountingSyncResult {
  mode: AccountingMode;
  /** Simulation : écritures calculées ; actif : écritures créées (contre-passations comprises). */
  created: number;
  posted: number;
  awaitingRate: number;
  reversed: number;
  /** Clés déjà présentes : rien d'écrit (idempotence). */
  unchanged: number;
  /** Pièces lues volontairement non comptabilisées (avant la bascule, série d'essai…). */
  skipped: number;
  /** Pièces inscrites dans « À comptabiliser ». */
  pending: number;
  sourcesRead: number;
}

/** `POST /accounting/periods/:year/:month/regenerate` : aperçu, puis `?confirm=true`. */
export interface AccountingRegenerationView {
  year: number;
  month: number;
  confirmed: boolean;
  /** Écritures générées du mois contre-passées (ou à contre-passer). */
  reversed: { id: string; sourceKey: string; date: string; journalCode: string }[];
  /** Écritures nouvelles (ou proposées), selon les règles en vigueur. */
  created: { sourceKey: string; date: string; journalCode: string; suspense: boolean }[];
  ruleSetVersion: number | null;
}

// ── Lettrage (§ 6.11) ───────────────────────────────────────────────────────

const LINE_REF = /^[0-9a-f]{24}#\d{1,3}$/;

/** `POST /accounting/lettering` : lignes `<id>#<rang>` d'un même compte auxiliaire. */
export const AccountingLetteringBody = z
  .object({
    lineRefs: z
      .array(
        z
          .string(accountingFr('Référence de ligne attendue.'))
          .regex(LINE_REF, { message: 'Référence de ligne invalide.' }),
      )
      .min(2, { message: 'Deux lignes au moins.' })
      .max(500),
  })
  .strict();
export type AccountingLetteringBody = z.output<typeof AccountingLetteringBody>;

export interface AccountingLetteringView {
  code: string;
  accountNumber: string;
  auxiliaryAccountNumber: string | null;
  currency: AccountingBookCurrency;
  lineRefs: string[];
  /** Écart en monnaie de tenue (change), rendu pour information, jamais corrigé. */
  bookDifference: string;
  automatic: boolean;
  at: string;
}

// ── Comptes de trésorerie ↔ plan (jeton `{treasuryAccount}`, § 2.4) ─────────

/**
 * Compte du plan de l'organisation rattaché à un compte de trésorerie d'ADR-0034 : c'est
 * lui que résout le jeton `{treasuryAccount}`. Aucun n'est posé d'office.
 */
export interface AccountingTreasuryLinkView {
  treasuryAccountId: string;
  treasuryAccountName: string;
  treasuryAccountKind: string;
  currency: AccountingBookCurrency;
  journalCode: string | null;
  accountNumber: string | null;
  revision: number | null;
}

export const PutAccountingTreasuryLinkBody = z
  .object({
    accountNumber: AccountingAccountNumber.nullable(),
    expectedRevision: AccountingExpectedRevision.nullable(),
  })
  .strict();
export type PutAccountingTreasuryLinkBody = z.output<typeof PutAccountingTreasuryLinkBody>;
