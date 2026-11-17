// ─────────────────────────────────────────────────────────────────────────────
// Récapitulatif temps × taux d'achat d'un consultant (ADR-0078 § 2.4)
//
// Base de la facture fournisseur d'un consultant : par MOIS (AAAA-MM) et par
// projet, minutes saisies et montant au taux d'achat en vigueur au jour travaillé
// (même règle que la marge : le taux le plus récent dont `effectiveFrom ≤ jour`).
//
// - Une ligne par (mois, projet, devise du taux) ; Σ (minutes × centimes) exacte,
//   divisée par 60 avec UN SEUL arrondi au centime par ligne (demi vers le haut).
// - Totaux par devise = somme des lignes arrondies (ce que porterait une facture
//   ligne à ligne) ; aucune conversion entre devises.
// - Une saisie sans taux n'est jamais valorisée à zéro : ses minutes forment une
//   ligne sans devise ni montant et sont comptées dans `minutesWithoutRate`.
// - Rien n'est écrit : ni pièce comptable, ni facture fournisseur.
// ─────────────────────────────────────────────────────────────────────────────

import { isCalendarDate } from '../receivables/calendar.js';
import { formatPositive, type Fixed } from '../receivables/money.js';
import { hourlyCents, minuteCentsToCents, rateAt, ratesByUser } from './margin.js';
import type { WorkMarginCurrency, WorkMarginDay, WorkMarginRateInput } from './types.js';

export const CONSULTANT_RECAP_VERSION = '1.0.0';

export interface ConsultantRecapEntryInput {
  /** Compte du consultant (clé des taux). */
  userId: string;
  projectId: string;
  workedOn: WorkMarginDay;
  minutes: number;
}

export interface ConsultantRecapInput {
  entries: readonly ConsultantRecapEntryInput[];
  rates: readonly WorkMarginRateInput[];
  from: WorkMarginDay | null;
  to: WorkMarginDay | null;
}

export interface ConsultantRecapLine {
  period: string;
  projectId: string;
  currency: WorkMarginCurrency | null;
  minutes: number;
  amount: string | null;
}

export interface ConsultantRecapResult {
  version: string;
  from: WorkMarginDay | null;
  to: WorkMarginDay | null;
  rows: ConsultantRecapLine[];
  totals: { currency: WorkMarginCurrency; minutes: number; amount: string }[];
  minutesWithoutRate: number;
}

function checkDay(value: unknown, what: string): WorkMarginDay {
  if (!isCalendarDate(value)) throw new RangeError(`${what} : date illisible ${String(value)}`);
  return value;
}

export function consultantTimeRecap(input: ConsultantRecapInput): ConsultantRecapResult {
  const from = input.from === null ? null : checkDay(input.from, 'Début de période');
  const to = input.to === null ? null : checkDay(input.to, 'Fin de période');
  if (from !== null && to !== null && to < from) {
    throw new RangeError(`Période inversée : ${from} → ${to}`);
  }
  const rates = ratesByUser(input.rates);
  const lines = new Map<
    string,
    {
      period: string;
      projectId: string;
      currency: WorkMarginCurrency | null;
      minutes: number;
      minuteCents: bigint;
    }
  >();
  let minutesWithoutRate = 0;
  for (const entry of input.entries) {
    const day = checkDay(entry.workedOn, 'Saisie de temps');
    if (!Number.isSafeInteger(entry.minutes) || entry.minutes <= 0) {
      throw new RangeError(
        `Saisie de temps : minutes entières positives attendues (${entry.minutes})`,
      );
    }
    if ((from !== null && day < from) || (to !== null && day > to)) continue;
    const rate = rateAt(rates.get(entry.userId), day);
    const period = day.slice(0, 7);
    const currency = rate?.currency ?? null;
    const key = `${period}|${entry.projectId}|${currency ?? '-'}`;
    const line = lines.get(key) ?? {
      period,
      projectId: entry.projectId,
      currency,
      minutes: 0,
      minuteCents: 0n,
    };
    line.minutes += entry.minutes;
    if (rate === null) minutesWithoutRate += entry.minutes;
    else line.minuteCents += BigInt(entry.minutes) * hourlyCents(rate.hourlyCost);
    lines.set(key, line);
  }

  const totals = new Map<WorkMarginCurrency, { minutes: number; amount: Fixed }>();
  const rows: ConsultantRecapLine[] = [...lines.values()]
    .sort((a, b) =>
      a.period !== b.period
        ? a.period < b.period
          ? -1
          : 1
        : a.projectId !== b.projectId
          ? a.projectId < b.projectId
            ? -1
            : 1
          : (a.currency ?? '') < (b.currency ?? '')
            ? -1
            : 1,
    )
    .map((l) => {
      if (l.currency === null) {
        return {
          period: l.period,
          projectId: l.projectId,
          currency: null,
          minutes: l.minutes,
          amount: null,
        };
      }
      const amount = minuteCentsToCents(l.minuteCents);
      const t = totals.get(l.currency) ?? { minutes: 0, amount: 0n };
      t.minutes += l.minutes;
      t.amount += amount;
      totals.set(l.currency, t);
      return {
        period: l.period,
        projectId: l.projectId,
        currency: l.currency,
        minutes: l.minutes,
        amount: formatPositive(amount),
      };
    });

  return {
    version: CONSULTANT_RECAP_VERSION,
    from,
    to,
    rows,
    totals: [...totals]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([currency, t]) => ({ currency, minutes: t.minutes, amount: formatPositive(t.amount) })),
    minutesWithoutRate,
  };
}
