// ─────────────────────────────────────────────────────────────────────────────
// Tableau de bord des devis — RUN › Ventes › Devis (ADR-0067)
//
// Un seul calcul, côté serveur, pour les cartes de chiffres, les graphiques et les
// compteurs des filtres de la liste : l'écran ne fait qu'afficher.
//
// Règles (ADR-0067, sur le modèle d'ADR-0056) :
// - Statut lu : celui de la liste (`sent` dont la validité est passée = `expired`,
//   au jour `asOf` de Kinshasa). Les compteurs ont les définitions des filtres de
//   `GET /sales/quotes` : les onglets concordent avec la liste.
// - Montants TTC du devis, dans la DEVISE DE RÉFÉRENCE donnée par l'appelant. Un
//   devis ne porte AUCUN taux figé : un devis dans une autre devise est EXCLU DES
//   MONTANTS ET COMPTÉ, avec son total dans sa devise (comme une facture sans
//   taux, ADR-0056). Aucun taux du jour, aucune conversion inventée.
// - « En cours » : devis envoyés, encore valables au jour `asOf`.
// - « Expire bientôt » : en cours, validité au plus tard `asOf` + 7 jours.
// - « Émis » : devis par mois de PREMIER envoi (toutes versions) ; « acceptés » :
//   par mois d'acceptation.
// - Taux de transformation : devis dont le premier envoi tombe dans les 90 derniers
//   jours (`asOf` compris), part de ceux qui sont acceptés aujourd'hui, en % entier.
//   Compté en nombre de devis : il ne dépend d'aucune devise.
//
// Aucune horloge : `asOf` est fourni.
// ─────────────────────────────────────────────────────────────────────────────

import type { Fixed } from '../invoice-totals/decimal.js';
import { isCalendarDate, monthOfDate } from './calendar.js';
import { formatPositive, trustedAmount } from './money.js';
import {
  addDaysTo,
  addMonths,
  convertAtRatio,
  referenceRatioOf,
  type StatsCurrency,
} from './reference-rate.js';
import type { DecimalString } from '../invoice-totals/types.js';
import type { CalendarDate, CalendarMonth } from './types.js';

/** Version du calcul du tableau de bord des devis. */
export const QUOTE_STATS_VERSION = '1.0.0';

/** Fenêtre du taux de transformation, en jours (ADR-0067). */
export const QUOTE_CONVERSION_WINDOW_DAYS = 90;
/** Horizon des devis « qui expirent bientôt », en jours (ADR-0067). */
export const QUOTE_EXPIRING_WITHIN_DAYS = 7;

export const QUOTE_STATS_STATUSES = ['draft', 'sent', 'accepted', 'refused', 'expired'] as const;
export type QuoteStatsStatus = (typeof QUOTE_STATS_STATUSES)[number];

/** Devis tel que le tableau de bord le lit (version courante). */
export interface QuoteStatsQuote {
  id: string;
  /** Statut enregistré : `draft`, `sent`, `accepted`, `refused`. */
  status: string;
  /** Dernier jour de validité inclus. */
  validUntil: CalendarDate;
  currency: StatsCurrency;
  /** Total TTC du devis dans sa devise, `null` s'il n'est pas calculable. */
  total: DecimalString | null;
  /** Jour de Kinshasa du PREMIER envoi, toutes versions confondues ; `null` : jamais envoyé. */
  firstSentOn: CalendarDate | null;
  /** Jour de Kinshasa de l'acceptation, `null` sinon. */
  acceptedOn: CalendarDate | null;
  /** Converti en brouillon de facture. */
  converted: boolean;
}

export interface QuoteStatsInput {
  referenceCurrency: StatsCurrency;
  asOf: CalendarDate;
  /** Nombre de mois civils de la fenêtre, le mois d'`asOf` compris (1 à 36). */
  months: number;
  quotes: readonly QuoteStatsQuote[];
}

export interface QuoteStatsAmount {
  count: number;
  /** Somme des devis de la devise de référence. */
  amount: string;
  /** Devis d'une autre devise : exclus du montant, comptés, total dans leur devise. */
  notConvertible: { currency: StatsCurrency; count: number; total: string }[];
}

export interface QuoteStatsMonth {
  month: CalendarMonth;
  /** Devis envoyés pour la première fois ce mois. */
  sent: number;
  /** Devis acceptés ce mois. */
  accepted: number;
  /** Montant accepté ce mois, devise de référence. */
  acceptedAmount: string;
}

export interface QuoteStatsResult {
  currency: StatsCurrency;
  asOf: CalendarDate;
  from: CalendarMonth;
  to: CalendarMonth;
  months: QuoteStatsMonth[];
  open: QuoteStatsAmount;
  acceptedThisMonth: QuoteStatsAmount;
  expiringSoon: QuoteStatsAmount & { until: CalendarDate; withinDays: number };
  conversion: {
    windowDays: number;
    since: CalendarDate;
    sent: number;
    accepted: number;
    /** Acceptés / envoyés, % entier demi vers le haut ; `null` si rien d'envoyé. */
    ratePercent: number | null;
  };
  statusCounts: Record<QuoteStatsStatus | 'all', number>;
  /** Devis acceptés déjà convertis en brouillon de facture. */
  converted: number;
  excluded: {
    /** Devis sans total calculable : comptés, sans montant. */
    withoutAmount: number;
    /** Tous les devis hors devise de référence, par devise. */
    notConvertible: { currency: StatsCurrency; count: number; total: string }[];
  };
  version: string;
}

/** Statut lu d'un devis (même règle que la liste). */
export function quoteReadStatus(status: string, validUntil: string, asOf: string): string {
  return status === 'sent' && validUntil < asOf ? 'expired' : status;
}

class Bucket {
  count = 0;
  amount: Fixed = 0n;
  other = new Map<StatsCurrency, { count: number; total: Fixed }>();

  add(q: QuoteStatsQuote, ref: StatsCurrency): void {
    this.count += 1;
    if (q.total === null) return;
    const total = trustedAmount(q.total, 'Total du devis');
    const ratio = referenceRatioOf(
      {
        currency: q.currency,
        total: q.total,
        normalizedTotalCdf: null,
        conversion: null,
        usdCounterValue: null,
      },
      ref,
    );
    if (ratio !== null) {
      this.amount += convertAtRatio(total, ratio);
      return;
    }
    const n = this.other.get(q.currency) ?? { count: 0, total: 0n };
    n.count += 1;
    n.total += total;
    this.other.set(q.currency, n);
  }

  notConvertible(): QuoteStatsAmount['notConvertible'] {
    return [...this.other.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([currency, n]) => ({ currency, count: n.count, total: formatPositive(n.total) }));
  }

  result(): QuoteStatsAmount {
    return {
      count: this.count,
      amount: formatPositive(this.amount),
      notConvertible: this.notConvertible(),
    };
  }
}

export function computeQuoteStats(input: QuoteStatsInput): QuoteStatsResult {
  if (!isCalendarDate(input.asOf)) throw new RangeError(`Date du jour illisible : ${input.asOf}`);
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > 36) {
    throw new RangeError(`Fenêtre de mois invalide : ${input.months}`);
  }
  const ref = input.referenceCurrency;
  const asOf = input.asOf;
  const to = monthOfDate(asOf);
  const from = addMonths(to, -(input.months - 1));
  const monthKeys = Array.from({ length: input.months }, (_, i) => addMonths(from, i));
  const until = addDaysTo(asOf, QUOTE_EXPIRING_WITHIN_DAYS);
  const since = addDaysTo(asOf, -(QUOTE_CONVERSION_WINDOW_DAYS - 1));

  const sentByMonth = new Map<string, number>(monthKeys.map((m) => [m, 0]));
  const acceptedByMonth = new Map<string, Bucket>(monthKeys.map((m) => [m, new Bucket()]));
  const statusCounts: Record<QuoteStatsStatus | 'all', number> = {
    all: 0,
    draft: 0,
    sent: 0,
    accepted: 0,
    refused: 0,
    expired: 0,
  };
  const open = new Bucket();
  const acceptedThisMonth = new Bucket();
  const expiring = new Bucket();
  const everything = new Bucket();
  let converted = 0;
  let withoutAmount = 0;
  let windowSent = 0;
  let windowAccepted = 0;

  for (const q of input.quotes) {
    for (const d of [q.validUntil, q.firstSentOn, q.acceptedOn]) {
      if (d !== null && !isCalendarDate(d)) throw new RangeError(`Date illisible : ${d}`);
    }
    const status = quoteReadStatus(q.status, q.validUntil, asOf);
    statusCounts.all += 1;
    if (status in statusCounts) statusCounts[status as QuoteStatsStatus] += 1;
    if (q.total === null) withoutAmount += 1;
    everything.add(q, ref);

    if (status === 'sent') {
      open.add(q, ref);
      if (q.validUntil <= until) expiring.add(q, ref);
    }
    if (status === 'accepted' && q.converted) converted += 1;

    const sentOn = q.firstSentOn;
    if (sentOn !== null && sentOn <= asOf) {
      const m = sentOn.slice(0, 7);
      if (sentByMonth.has(m)) sentByMonth.set(m, (sentByMonth.get(m) ?? 0) + 1);
      if (sentOn >= since) {
        windowSent += 1;
        if (status === 'accepted') windowAccepted += 1;
      }
    }
    const acceptedOn = status === 'accepted' ? q.acceptedOn : null;
    if (acceptedOn !== null && acceptedOn <= asOf) {
      const m = acceptedOn.slice(0, 7);
      acceptedByMonth.get(m)?.add(q, ref);
      if (m === to) acceptedThisMonth.add(q, ref);
    }
  }

  return {
    currency: ref,
    asOf,
    from,
    to,
    months: monthKeys.map((m) => {
      const a = acceptedByMonth.get(m) as Bucket;
      return {
        month: m,
        sent: sentByMonth.get(m) ?? 0,
        accepted: a.count,
        acceptedAmount: formatPositive(a.amount),
      };
    }),
    open: open.result(),
    acceptedThisMonth: acceptedThisMonth.result(),
    expiringSoon: { ...expiring.result(), until, withinDays: QUOTE_EXPIRING_WITHIN_DAYS },
    conversion: {
      windowDays: QUOTE_CONVERSION_WINDOW_DAYS,
      since,
      sent: windowSent,
      accepted: windowAccepted,
      ratePercent:
        windowSent === 0
          ? null
          : Math.floor((windowAccepted * 200 + windowSent) / (windowSent * 2)),
    },
    statusCounts,
    converted,
    excluded: { withoutAmount, notConvertible: everything.notConvertible() },
    version: QUOTE_STATS_VERSION,
  };
}
