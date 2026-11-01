// Outils communs aux générateurs `entriesFor…` — fichier INTERNE.

import { resolveAccount, type TokenValues } from '../rules/resolve.js';
import {
  ACCOUNTING_VERSION,
  type EntryGeneration,
  type EntrySide,
  type PendingReason,
  type PostingContext,
  type PostingNote,
  type PostingResult,
  type ProposedEntry,
  type SkipReason,
  type SourceKind,
} from '../types.js';
import { formatCents } from './money.js';
import { applyRate, type ApplyRateInput, type DraftLine } from './rate.js';

export function generationOf(ctx: PostingContext): EntryGeneration {
  return {
    ruleSetVersion:
      ctx.ruleSet !== null && ctx.ruleSet.status === 'validated' ? ctx.ruleSet.version : null,
    chartPack: ctx.chartPack,
    engineVersion: ACCOUNTING_VERSION,
  };
}

/** Ligne brouillon : compte choisi par la règle validée, ou compte d'attente. */
export function draftLine(
  ctx: PostingContext,
  args: {
    key: string;
    side: EntrySide;
    cents: bigint;
    currency: DraftLine['currency'];
    label: string;
    tokens?: TokenValues;
    matchRef?: string | null;
    pinnedRate?: DraftLine['pinnedRate'];
  },
): DraftLine {
  const account = resolveAccount(
    ctx.ruleSet,
    args.key,
    args.side,
    args.tokens ?? {},
    ctx.suspenseAccount,
  );
  return {
    operationKey: args.key,
    side: args.side,
    accountNumber: account.accountNumber,
    auxiliaryAccountNumber: account.auxiliaryAccountNumber,
    label: args.label,
    currency: args.currency,
    amount: formatCents(args.cents),
    matchRef: args.matchRef ?? null,
    suspenseReason: account.suspenseReason,
    pinnedRate: args.pinnedRate ?? null,
  };
}

/** Options de taux tirées du contexte. */
export function rateInput(
  ctx: PostingContext,
  extra: Partial<ApplyRateInput> = {},
): ApplyRateInput {
  return {
    bookCurrency: ctx.bookCurrency,
    enteredRates: ctx.enteredRates,
    ruleSet: ctx.ruleSet,
    suspenseAccount: ctx.suspenseAccount,
    ...extra,
  };
}

export { applyRate };

export function result(
  source: { kind: SourceKind; id: string },
  parts: {
    entries?: ProposedEntry[];
    cancelled?: boolean;
    skipped?: SkipReason | null;
    pending?: PendingReason[];
    notes?: PostingNote[];
  },
): PostingResult {
  const entries = parts.entries ?? [];
  const pending = new Set(parts.pending ?? []);
  if (entries.some((e) => e.status === 'awaiting_rate')) pending.add('RATE_MISSING');
  return {
    version: ACCOUNTING_VERSION,
    source,
    entries,
    cancelled: parts.cancelled ?? false,
    skipped: parts.skipped ?? null,
    pending: [...pending].sort(),
    notes: [...new Set(parts.notes ?? [])].sort(),
  };
}

/** Compte de trésorerie connu ? `undefined` = pièce sans compte ; `null` = compte sans correspondance. */
export function treasuryAccountOf(ctx: PostingContext, accountId: string | null): string | null {
  if (accountId === null) return null;
  return ctx.treasuryAccounts[accountId] ?? null;
}
