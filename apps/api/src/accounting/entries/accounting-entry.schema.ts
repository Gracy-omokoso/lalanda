// Écritures (`accounting_entries`, ADR-0049 § 2.6), tête de chaîne
// (`accounting_journal_heads`) et compteurs (`accounting_counters`, § 2.7). ADR-0049 — K5.
//
// Ajout seul : une écriture `posted` n'est jamais modifiée ni supprimée (contre-passation).
// Seuls deux champs d'une écriture validée bougent après coup, hors empreinte :
// `lines[].letteringCode` (lettrage, § 6.11, journal d'événements à part) et `reversedBy`
// (lien vers sa contre-passation). `keyed` passe à `false` quand une régénération
// contrôlée l'a contre-passée : la même clé de source peut alors renaître (§ 2.6, index
// unique partiel).

import type { SuspenseReason } from '@lalanda/engine';
import type {
  AccountingBookCurrency,
  AccountingEntryStatus,
  AccountingJournalKind,
} from '@lalanda/shared/accounting';
import { Schema as MongooseSchema, type Types } from 'mongoose';

import { accountingBaseFields, type AccountingBase } from '../accounting-base.schema.js';

/** Ligne enregistrée : forme de `EntryLine` du moteur (côté inactif « 0.00 »). */
export interface StoredEntryLine {
  operationKey: string;
  side: 'debit' | 'credit';
  accountNumber: string;
  auxiliaryAccountNumber: string | null;
  label: string;
  currency: AccountingBookCurrency;
  amount: string;
  bookAmount: string | null;
  debit: string | null;
  credit: string | null;
  rate: string | null;
  rateSource: 'same_currency' | 'document' | 'observed' | 'entered' | null;
  rateRef: string | null;
  letteringCode: string | null;
  matchRef: string | null;
  suspenseReason: SuspenseReason | null;
  exchangeDifference: boolean;
}

export interface StoredEntrySource {
  kind: string;
  id: string;
  event: string | null;
  number: string | null;
  date: string;
  partyName: string | null;
}

export type AccountingEntryLean = AccountingBase & {
  journalCode: string;
  journalKind: AccountingJournalKind;
  /** Attribués à la validation ; `null` avant. */
  fiscalYear: number | null;
  number: number | null;
  date: string;
  status: AccountingEntryStatus;
  bookCurrency: AccountingBookCurrency;
  label: string | null;
  source: StoredEntrySource | null;
  sourceKey: string;
  /** Participe à l'unicité `organizationId + sourceKey` (faux après régénération). */
  keyed: boolean;
  lines: StoredEntryLine[];
  /** Identifiant (et clé) de l'écriture contre-passée. */
  reversalOf: string | null;
  reversalOfKey: string | null;
  reversalReason: string | null;
  reversedBy: string | null;
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
  /** Régénération contrôlée : lot et rôle (`reversed` : l'origine, `reversal` : l'inverse). */
  regeneration: { batchId: string; role: 'reversed' | 'reversal' } | null;
  suspense: boolean;
  seq: number | null;
  prevHash: string | null;
  hash: string | null;
  postedAt: Date | null;
  postedBy: string | null;
};

export class AccountingEntry {}
export const AccountingEntrySchema = new MongooseSchema(
  {
    ...accountingBaseFields,
    journalCode: { type: String, required: true },
    journalKind: {
      type: String,
      required: true,
      enum: ['sales', 'purchases', 'treasury', 'misc', 'opening'],
    },
    fiscalYear: { type: Number, default: null },
    number: { type: Number, default: null },
    date: { type: String, required: true },
    status: { type: String, required: true, enum: ['draft', 'awaiting_rate', 'posted'] },
    bookCurrency: { type: String, required: true, enum: ['CDF', 'USD'] },
    label: { type: String, default: null },
    source: { type: Object, default: null },
    sourceKey: { type: String, required: true },
    keyed: { type: Boolean, required: true, default: true },
    lines: { type: [Object], required: true },
    reversalOf: { type: String, default: null },
    reversalOfKey: { type: String, default: null },
    reversalReason: { type: String, default: null },
    reversedBy: { type: String, default: null },
    generation: { type: Object, default: null },
    manual: { type: Object, default: null },
    regeneration: { type: Object, default: null },
    suspense: { type: Boolean, required: true, default: false },
    seq: { type: Number, default: null },
    prevHash: { type: String, default: null },
    hash: { type: String, default: null },
    postedAt: { type: Date, default: null },
    postedBy: { type: String, default: null },
  },
  { collection: 'accounting_entries', timestamps: true, strict: true, minimize: false },
);
/** Idempotence : une clé de source n'existe qu'une fois (hors écritures régénérées). */
AccountingEntrySchema.index(
  { organizationId: 1, sourceKey: 1 },
  { unique: true, partialFilterExpression: { keyed: true }, name: 'source_key_unique' },
);
/** Numéros sans trou par journal et exercice : filet sous le compteur. */
AccountingEntrySchema.index(
  { organizationId: 1, journalCode: 1, fiscalYear: 1, number: 1 },
  { unique: true, partialFilterExpression: { number: { $type: 'number' } }, name: 'number_unique' },
);
/** Chaînage par organisation : un rang n'existe qu'une fois. */
AccountingEntrySchema.index(
  { organizationId: 1, seq: 1 },
  { unique: true, partialFilterExpression: { seq: { $type: 'number' } }, name: 'seq_unique' },
);
AccountingEntrySchema.index({ organizationId: 1, date: 1, _id: 1 });
AccountingEntrySchema.index({ organizationId: 1, 'source.kind': 1, 'source.id': 1 });
AccountingEntrySchema.index({ organizationId: 1, status: 1 });
AccountingEntrySchema.index({ organizationId: 1, 'lines.matchRef': 1 });

export type AccountingEntryId = Types.ObjectId;

/** Tête de chaîne par organisation (`accounting_journal_heads`). */
export type AccountingJournalHeadLean = {
  _id: Types.ObjectId;
  organizationId: string;
  seq: number;
  lastHash: string | null;
};
export class AccountingJournalHead {}
export const AccountingJournalHeadSchema = new MongooseSchema(
  {
    organizationId: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
    lastHash: { type: String, default: null },
    _schemaVersion: { type: Number, required: true, default: 1 },
  },
  { collection: 'accounting_journal_heads', timestamps: true, strict: true, minimize: false },
);
AccountingJournalHeadSchema.index({ organizationId: 1 }, { unique: true });

/**
 * Compteurs (`accounting_counters`) : `entry:<journal>:<exercice>` (numéros d'écriture),
 * `aux:<collectif>` (comptes auxiliaires), `lettering` (codes de lettrage).
 */
export type AccountingCounterLean = {
  _id: Types.ObjectId;
  organizationId: string;
  key: string;
  seq: number;
};
export class AccountingCounter {}
export const AccountingCounterSchema = new MongooseSchema(
  {
    organizationId: { type: String, required: true },
    key: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
    _schemaVersion: { type: Number, required: true, default: 1 },
  },
  { collection: 'accounting_counters', timestamps: true, strict: true, minimize: false },
);
AccountingCounterSchema.index({ organizationId: 1, key: 1 }, { unique: true });
