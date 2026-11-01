// Lettrage (ADR-0049 § 6.11, § 2.7 `accounting_lettering`).
//
// - `checkLettering` : lignes `posted` d'un même compte (et du même auxiliaire),
//   dans une seule devise, dont la somme EN DEVISE DE LA PIÈCE est nulle. L'écart
//   éventuel en monnaie de tenue (change) est rendu, jamais corrigé : il relève
//   du compte d'attente « écarts de change à qualifier » (§ 5).
// - `suggestLettering` : automatique seulement quand des lignes citent la MÊME
//   pièce (`documentRef`) ; aucun rapprochement « au montant » n'est deviné.
// - `resolveLettering` : état courant à partir des événements en ajout seul
//   (`letter` / `unletter`) ; un événement incohérent est rejeté et signalé.

import {
  byString,
  formatCents,
  lineRefOf,
  parseLine,
  type ParsedLine,
} from './money.js';
import {
  ACCOUNTING_REPORTING_VERSION,
  type LineRef,
  type ReportingCurrency,
  type ReportingEntry,
} from './types.js';

export const LETTERING_ERROR_CODES = [
  'LETTERING_TOO_FEW_LINES',
  'LETTERING_UNKNOWN_LINE',
  'LETTERING_DUPLICATE_LINE',
  'LETTERING_LINE_NOT_POSTED',
  'LETTERING_LINE_WITHOUT_AUXILIARY',
  'LETTERING_MIXED_ACCOUNTS',
  'LETTERING_MIXED_CURRENCIES',
  'LETTERING_NOT_BALANCED',
  'LETTERING_ALREADY_LETTERED',
] as const;
export type LetteringErrorCode = (typeof LETTERING_ERROR_CODES)[number];

/** Index des lignes de toutes les écritures (tous statuts), par référence. */
function indexLines(
  entries: readonly ReportingEntry[],
): Map<LineRef, { entry: ReportingEntry; index: number }> {
  const map = new Map<LineRef, { entry: ReportingEntry; index: number }>();
  for (const entry of entries) {
    for (let i = 0; i < entry.lines.length; i += 1) map.set(lineRefOf(entry.id, i), { entry, index: i });
  }
  return map;
}

export interface LetteringCheckInput {
  entries: readonly ReportingEntry[];
  lineRefs: readonly LineRef[];
  /** Lignes déjà lettrées (état courant) : une ligne ne porte qu'un code. */
  alreadyLettered?: ReadonlySet<LineRef> | readonly LineRef[];
  /**
   * `true` (défaut, lettrage manuel § 6.11) : lignes d'un compte AUXILIAIRE
   * seulement. `false` : tout compte (lettrage d'un compte général).
   */
  requireAuxiliary?: boolean;
}

export type LetteringCheck =
  | {
      ok: true;
      accountNumber: string;
      auxiliaryAccountNumber: string | null;
      currency: ReportingCurrency;
      /** Somme en devise de la pièce : toujours « 0.00 » ici. */
      documentTotal: string;
      /** Somme en monnaie de tenue (débit − crédit) : non nulle = écart de change à qualifier. */
      bookDifference: string;
      lineRefs: LineRef[];
    }
  | { ok: false; code: LetteringErrorCode; lineRefs: LineRef[]; documentTotal?: string };

export function checkLettering(input: LetteringCheckInput): LetteringCheck {
  const refs = [...input.lineRefs];
  const fail = (code: LetteringErrorCode, lineRefs: LineRef[] = refs, documentTotal?: string) =>
    documentTotal === undefined
      ? ({ ok: false, code, lineRefs } as const)
      : ({ ok: false, code, lineRefs, documentTotal } as const);
  if (refs.length < 2) return fail('LETTERING_TOO_FEW_LINES');
  const dup = refs.filter((r, i) => refs.indexOf(r) !== i);
  if (dup.length > 0) return fail('LETTERING_DUPLICATE_LINE', [...new Set(dup)].sort(byString));

  const index = indexLines(input.entries);
  const unknown = refs.filter((r) => !index.has(r));
  if (unknown.length > 0) return fail('LETTERING_UNKNOWN_LINE', unknown.sort(byString));

  const parsed: ParsedLine[] = [];
  const notPosted: LineRef[] = [];
  for (const r of refs) {
    const hit = index.get(r);
    if (hit === undefined) continue;
    if (hit.entry.status !== 'posted') notPosted.push(r);
    else parsed.push(parseLine(hit.entry, hit.index));
  }
  if (notPosted.length > 0) return fail('LETTERING_LINE_NOT_POSTED', notPosted.sort(byString));

  const lettered =
    input.alreadyLettered instanceof Set
      ? input.alreadyLettered
      : new Set<LineRef>((input.alreadyLettered as readonly LineRef[] | undefined) ?? []);
  const taken = refs.filter((r) => lettered.has(r));
  if (taken.length > 0) return fail('LETTERING_ALREADY_LETTERED', taken.sort(byString));

  if (input.requireAuxiliary ?? true) {
    const noAux = parsed.filter((p) => !p.line.auxiliaryAccountNumber).map((p) => p.ref);
    if (noAux.length > 0) return fail('LETTERING_LINE_WITHOUT_AUXILIARY', noAux.sort(byString));
  }
  const first = parsed[0];
  if (first === undefined) return fail('LETTERING_TOO_FEW_LINES');
  const sameAccount = parsed.every(
    (p) =>
      p.line.accountNumber === first.line.accountNumber &&
      (p.line.auxiliaryAccountNumber ?? null) === (first.line.auxiliaryAccountNumber ?? null),
  );
  if (!sameAccount) return fail('LETTERING_MIXED_ACCOUNTS');
  if (!parsed.every((p) => p.currency === first.currency)) return fail('LETTERING_MIXED_CURRENCIES');

  const docTotal = parsed.reduce((s, p) => s + p.doc, 0n);
  if (docTotal !== 0n) return fail('LETTERING_NOT_BALANCED', refs, formatCents(docTotal));
  return {
    ok: true,
    accountNumber: first.line.accountNumber,
    auxiliaryAccountNumber: first.line.auxiliaryAccountNumber ?? null,
    currency: first.currency,
    documentTotal: formatCents(0n),
    bookDifference: formatCents(parsed.reduce((s, p) => s + p.book, 0n)),
    lineRefs: [...refs].sort(byString),
  };
}

// ─── Suggestions automatiques ────────────────────────────────────────────────

export interface LetteringSuggestion {
  accountNumber: string;
  auxiliaryAccountNumber: string | null;
  currency: ReportingCurrency;
  documentRef: string;
  lineRefs: LineRef[];
  /** `full` : somme nulle en devise, lettrable ; `partial` : reste dû, non lettrable en l'état. */
  status: 'full' | 'partial';
  /** Reste signé en devise de la pièce (débit − crédit). */
  remaining: string;
  /** Écart en monnaie de tenue (change), rendu pour information. */
  bookDifference: string;
}

export interface LetteringSuggestions {
  version: string;
  suggestions: LetteringSuggestion[];
}

/**
 * Regroupe les lignes `posted` non lettrées d'un même compte, même auxiliaire,
 * même devise et même pièce citée (`documentRef`), quand le groupe porte à la
 * fois un débit et un crédit.
 */
export function suggestLettering(
  entries: readonly ReportingEntry[],
  alreadyLettered: ReadonlySet<LineRef> | readonly LineRef[] = [],
): LetteringSuggestions {
  const lettered =
    alreadyLettered instanceof Set
      ? alreadyLettered
      : new Set<LineRef>(alreadyLettered as readonly LineRef[]);
  const groups = new Map<string, ParsedLine[]>();
  for (const entry of entries) {
    if (entry.status !== 'posted') continue;
    for (let i = 0; i < entry.lines.length; i += 1) {
      const p = parseLine(entry, i);
      const docRef = p.line.documentRef ?? null;
      if (docRef === null || docRef === '' || lettered.has(p.ref) || p.line.letteringCode) continue;
      const key = [p.line.accountNumber, p.line.auxiliaryAccountNumber ?? '', p.currency, docRef].join(
        '\u0000',
      );
      const g = groups.get(key) ?? [];
      g.push(p);
      groups.set(key, g);
    }
  }
  const suggestions: LetteringSuggestion[] = [];
  for (const [key, g] of [...groups.entries()].sort(([a], [b]) => byString(a, b))) {
    const hasDebit = g.some((p) => p.doc > 0n);
    const hasCredit = g.some((p) => p.doc < 0n);
    if (!hasDebit || !hasCredit) continue;
    const [accountNumber = '', aux = '', currency = '', documentRef = ''] = key.split('\u0000');
    const remaining = g.reduce((s, p) => s + p.doc, 0n);
    suggestions.push({
      accountNumber,
      auxiliaryAccountNumber: aux === '' ? null : aux,
      currency: currency as ReportingCurrency,
      documentRef,
      lineRefs: g.map((p) => p.ref).sort(byString),
      status: remaining === 0n ? 'full' : 'partial',
      remaining: formatCents(remaining),
      bookDifference: formatCents(g.reduce((s, p) => s + p.book, 0n)),
    });
  }
  return { version: ACCOUNTING_REPORTING_VERSION, suggestions };
}

// ─── État courant à partir des événements ────────────────────────────────────

export interface LetteringEvent {
  code: string;
  action: 'letter' | 'unletter';
  /** Lignes visées par `letter` ; ignoré pour `unletter` (le code suffit). */
  lineRefs?: readonly LineRef[];
  at: ReportingDayTime;
}
/** Horodatage ou jour, comparable lexicographiquement (ISO 8601). */
export type ReportingDayTime = string;

export interface LetteringState {
  version: string;
  /** Lettrages actifs, par code. */
  active: { code: string; lineRefs: LineRef[]; letteredAt: ReportingDayTime }[];
  /** Ligne → code actif. */
  byLine: Record<LineRef, string>;
  /** Événements rejetés, dans l'ordre : jamais appliqués. */
  rejected: {
    position: number;
    code: string;
    reason: 'CODE_ALREADY_ACTIVE' | 'CODE_NOT_ACTIVE' | 'LINE_ALREADY_LETTERED' | 'EMPTY';
  }[];
}

/** Rejoue les événements dans l'ordre reçu (ajout seul) ; ne vérifie pas les montants. */
export function resolveLettering(events: readonly LetteringEvent[]): LetteringState {
  const active = new Map<string, { lineRefs: LineRef[]; at: string }>();
  const byLine = new Map<LineRef, string>();
  const rejected: LetteringState['rejected'] = [];
  events.forEach((e, position) => {
    if (e.action === 'letter') {
      const refs = [...new Set(e.lineRefs ?? [])];
      if (refs.length === 0) return void rejected.push({ position, code: e.code, reason: 'EMPTY' });
      if (active.has(e.code)) {
        return void rejected.push({ position, code: e.code, reason: 'CODE_ALREADY_ACTIVE' });
      }
      if (refs.some((r) => byLine.has(r))) {
        return void rejected.push({ position, code: e.code, reason: 'LINE_ALREADY_LETTERED' });
      }
      active.set(e.code, { lineRefs: refs.sort(byString), at: e.at });
      for (const r of refs) byLine.set(r, e.code);
      return;
    }
    const a = active.get(e.code);
    if (a === undefined) return void rejected.push({ position, code: e.code, reason: 'CODE_NOT_ACTIVE' });
    for (const r of a.lineRefs) byLine.delete(r);
    active.delete(e.code);
  });
  return {
    version: ACCOUNTING_REPORTING_VERSION,
    active: [...active.entries()]
      .sort(([a], [b]) => byString(a, b))
      .map(([code, a]) => ({ code, lineRefs: a.lineRefs, letteredAt: a.at })),
    byLine: Object.fromEntries([...byLine.entries()].sort(([a], [b]) => byString(a, b))),
    rejected,
  };
}

