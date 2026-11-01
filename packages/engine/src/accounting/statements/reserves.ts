// Réserves : ce qu'une balance ou un projet d'état dit de lui-même
// (ADR-0049 § 6.10). Une réserve n'est jamais masquée ; l'ordre est fixe.

import {
  byString,
  checkDay,
  excludedCounts,
  formatCents,
  postedLines,
} from '../ledger/money.js';
import { ACCOUNTING_REPORTING_VERSION, type ReportingEntry } from '../ledger/types.js';

/**
 * Codes de réserve, dans l'ordre d'affichage. Les neuf premiers sont ceux du
 * § 6.10 ; `RULES_NOT_VALIDATED` traduit « règles non validées » (§ 2.4) ; les
 * quatre derniers sont ajoutés par `computeStatement` (modèle d'état).
 */
export const RESERVE_CODES = [
  'PACK_NOT_REVIEWED',
  'RULES_NOT_VALIDATED',
  'SUSPENSE_BALANCE',
  'AWAITING_RATE',
  'PENDING_SOURCES',
  'OPENING_INCOMPLETE',
  'PERIODS_OPEN',
  'DEPRECIATION_NOT_POSTED',
  'STOCK_NOT_POSTED',
  'PAYMENTS_AT_ISSUE_UNCLASSIFIED',
  'TRIAL_BALANCE_UNBALANCED',
  'STATEMENT_TEMPLATE_TO_CONFIRM',
  'UNMAPPED_ACCOUNTS',
  'ACCOUNT_IN_SEVERAL_RUBRICS',
] as const;
export type ReserveCode = (typeof RESERVE_CODES)[number];

export interface Reserve {
  code: ReserveCode;
  /** Phrase en français simple, affichée et imprimée telle quelle. */
  message: string;
  details: Record<string, unknown>;
}

const MESSAGES: Record<ReserveCode, string> = {
  PACK_NOT_REVIEWED: "Plan comptable non relu par un expert-comptable : comptes et rubriques à confirmer.",
  RULES_NOT_VALIDATED:
    "Règles de correspondance non validées, ou sans relecture déclarée par l'expert-comptable de l'organisation.",
  SUSPENSE_BALANCE: "Compte d'attente non soldé : des opérations restent à classer.",
  AWAITING_RATE: "Écritures en attente d'un taux de change : absentes de la balance.",
  PENDING_SOURCES: 'Pièces non comptabilisées (« À comptabiliser »).',
  OPENING_INCOMPLETE: 'Reprise incomplète : à-nouveaux de reprise non validés ou non équilibrés.',
  PERIODS_OPEN: 'Mois encore ouverts : les montants peuvent changer.',
  DEPRECIATION_NOT_POSTED: 'Aucune dotation aux amortissements calculée par Lalanda.',
  STOCK_NOT_POSTED: 'Stocks non comptabilisés : registre de gestion seulement.',
  PAYMENTS_AT_ISSUE_UNCLASSIFIED:
    "Fonds reçus à l'émission de factures sans compte de trésorerie précisé : la trésorerie ne les voit pas.",
  TRIAL_BALANCE_UNBALANCED: 'Balance déséquilibrée : total des débits différent du total des crédits.',
  STATEMENT_TEMPLATE_TO_CONFIRM: "Modèle d'état non relu : rubriques à confirmer par l'expert-comptable.",
  UNMAPPED_ACCOUNTS: "Comptes soldés non repris dans une rubrique du modèle d'état.",
  ACCOUNT_IN_SEVERAL_RUBRICS: "Comptes repris dans plusieurs rubriques du modèle d'état.",
};

export function reserveOf(code: ReserveCode, details: Record<string, unknown> = {}): Reserve {
  return { code, message: MESSAGES[code], details };
}

/** Trie et dédoublonne une liste de réserves (même code : la première l'emporte). */
export function sortReserves(reserves: readonly Reserve[]): Reserve[] {
  const seen = new Set<ReserveCode>();
  const out: Reserve[] = [];
  for (const r of reserves) {
    if (seen.has(r.code)) continue;
    seen.add(r.code);
    out.push(r);
  }
  return out.sort((a, b) => RESERVE_CODES.indexOf(a.code) - RESERVE_CODES.indexOf(b.code));
}

export interface ReservesInput {
  mode: 'simulation' | 'active';
  chartPackStatus: 'draft' | 'review' | 'approved' | 'active' | 'retired';
  /** Jeu de règles en vigueur, `null` s'il n'y en a aucun. */
  ruleSet: { status: 'draft' | 'validated' | 'superseded'; expertReviewDeclared: boolean } | null;
  /** Écritures de la période (tous statuts). */
  entries: readonly ReportingEntry[];
  /** Fin de période (incluse) : seules les écritures datées au plus tard ce jour comptent. */
  to: string;
  /** Comptes d'attente désignés (pack ou réglages) ; jamais deviné. */
  suspenseAccountNumbers: readonly string[];
  /** Solde d'attente accepté explicitement à la clôture (§ 4) : la réserve reste, marquée. */
  suspenseAccepted?: { reason: string } | null;
  /** « À comptabiliser », compté par motif. */
  pendingSources?: readonly { reason: string; count: number }[];
  /** Reprise de l'existant (§ 3.2). */
  opening: { validated: boolean; balanced: boolean };
  /** Mois de la période et leur état. */
  periods: readonly { month: string; status: 'open' | 'closed' }[];
  stockPosting: 'off' | 'perpetual';
  depreciationPosting: 'off';
  /** Préfixe des clés d'opération des fonds reçus à l'émission (§ 6.1). */
  paymentAtIssueKeyPrefix?: string;
}

export interface Reserves {
  version: string;
  reserves: Reserve[];
}

const PAYMENT_AT_ISSUE_PREFIX = 'sale.payment_at_issue.';

export function computeReserves(input: ReservesInput): Reserves {
  checkDay(input.to, 'Fin de période');
  const list: Reserve[] = [];
  const entries = input.entries.filter((e) => e.date <= input.to);

  if (
    input.mode === 'simulation' ||
    (input.chartPackStatus !== 'approved' && input.chartPackStatus !== 'active')
  ) {
    list.push(reserveOf('PACK_NOT_REVIEWED', { chartPackStatus: input.chartPackStatus, mode: input.mode }));
  }
  if (
    input.ruleSet === null ||
    input.ruleSet.status !== 'validated' ||
    !input.ruleSet.expertReviewDeclared
  ) {
    list.push(
      reserveOf('RULES_NOT_VALIDATED', {
        status: input.ruleSet?.status ?? null,
        expertReviewDeclared: input.ruleSet?.expertReviewDeclared ?? false,
      }),
    );
  }

  const suspense = new Set(input.suspenseAccountNumbers);
  const prefix = input.paymentAtIssueKeyPrefix ?? PAYMENT_AT_ISSUE_PREFIX;
  let suspenseTotal = 0n;
  let suspenseLines = 0;
  const byReason = new Map<string, { balance: bigint; lines: number }>();
  const byAccount = new Map<string, bigint>();
  let payAtIssue = 0n;
  let payAtIssueLines = 0;
  for (const l of postedLines(entries)) {
    if (!suspense.has(l.line.accountNumber)) continue;
    suspenseTotal += l.book;
    suspenseLines += 1;
    byAccount.set(l.line.accountNumber, (byAccount.get(l.line.accountNumber) ?? 0n) + l.book);
    const reason = l.line.suspenseReason ?? 'UNSPECIFIED';
    const r = byReason.get(reason) ?? { balance: 0n, lines: 0 };
    r.balance += l.book;
    r.lines += 1;
    byReason.set(reason, r);
    if ((l.line.operationKey ?? '').startsWith(prefix)) {
      payAtIssue += l.book;
      payAtIssueLines += 1;
    }
  }
  const anyAccountOpen = [...byAccount.values()].some((v) => v !== 0n);
  if (anyAccountOpen || [...byReason.values()].some((r) => r.balance !== 0n)) {
    list.push(
      reserveOf('SUSPENSE_BALANCE', {
        balance: formatCents(suspenseTotal),
        lineCount: suspenseLines,
        accepted: input.suspenseAccepted ?? null,
        byAccount: [...byAccount.entries()]
          .sort(([a], [b]) => byString(a, b))
          .map(([accountNumber, v]) => ({ accountNumber, balance: formatCents(v) })),
        byReason: [...byReason.entries()]
          .sort(([a], [b]) => byString(a, b))
          .map(([reason, r]) => ({ reason, balance: formatCents(r.balance), lineCount: r.lines })),
      }),
    );
  }

  const { awaitingRate, draft } = excludedCounts(entries);
  if (awaitingRate > 0) list.push(reserveOf('AWAITING_RATE', { count: awaitingRate }));

  const pending = (input.pendingSources ?? []).filter((p) => p.count > 0);
  if (pending.length > 0) {
    list.push(
      reserveOf('PENDING_SOURCES', {
        count: pending.reduce((s, p) => s + p.count, 0),
        byReason: [...pending].sort((a, b) => byString(a.reason, b.reason)),
      }),
    );
  }
  if (!input.opening.validated || !input.opening.balanced) {
    list.push(reserveOf('OPENING_INCOMPLETE', { ...input.opening }));
  }
  const open = input.periods.filter((p) => p.status === 'open').map((p) => p.month).sort(byString);
  if (open.length > 0 || draft > 0) list.push(reserveOf('PERIODS_OPEN', { months: open, draftEntries: draft }));
  if (input.depreciationPosting === 'off') list.push(reserveOf('DEPRECIATION_NOT_POSTED'));
  if (input.stockPosting === 'off') list.push(reserveOf('STOCK_NOT_POSTED'));
  if (payAtIssueLines > 0 && payAtIssue !== 0n) {
    list.push(
      reserveOf('PAYMENTS_AT_ISSUE_UNCLASSIFIED', {
        balance: formatCents(payAtIssue),
        lineCount: payAtIssueLines,
      }),
    );
  }
  return { version: ACCOUNTING_REPORTING_VERSION, reserves: sortReserves(list) };
}
