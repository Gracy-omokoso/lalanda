// ─────────────────────────────────────────────────────────────────────────────
// Finances du site Lalanda (ADR-0053 § 6.8 — lot P7)
//
// Fonctions PURES et déterministes, sans horloge ni base : l'API leur passe des
// métadonnées de paiement (jamais un contenu d'organisation) et sert leur résultat
// tel quel à la console et à l'export CSV (CLAUDE.md : le moteur est l'unique source
// des calculs).
//
// ── Ce que ces nombres sont, et ne sont pas ──────────────────────────────────
//
// - « Encaissements constatés » : sommes des dépôts manuels CONFIRMÉS par un
//   opérateur, au montant figé dans la demande. Ce n'est PAS un chiffre d'affaires
//   au sens fiscal ou comptable : aucune pièce n'est remise aux abonnés tant
//   qu'ADR-0047 n'est pas tranché, et Lalanda ne tient pas ici sa comptabilité.
// - Les octrois sans paiement (ADR-0053 § 6.2) ne créent aucune demande manuelle
//   ni aucun paiement : ils n'entrent JAMAIS dans les encaissements.
// - Les rappels Stripe et PayPal ne conservent pas de montant (`payment_events`) :
//   ils sont COMPTÉS à part, sans montant, plutôt que d'en inventer un.
// - « Revenu récurrent déclaré » : abonnements actifs déjà payés au moins une fois,
//   au tarif publié de la grille, ramenés au mois. Un indicateur de pilotage, pas
//   une créance.
// - Aucune conversion de devise : tout est présenté PAR DEVISE.
//
// Montants en centimes entiers (docs/26), aucun flottant. Versionné à part
// (`PLATFORM_REVENUE_VERSION`) ; ne touche aucun calcul de plan.
// ─────────────────────────────────────────────────────────────────────────────

export const PLATFORM_REVENUE_VERSION = '1.0.0';

/** Mois au format `AAAA-MM`, en temps universel. */
export type RevenueMonth = string;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isRevenueMonth(value: unknown): value is RevenueMonth {
  return typeof value === 'string' && MONTH_RE.test(value);
}

/** Mois UTC d'une date. */
export function revenueMonthOf(date: Date): RevenueMonth {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Début (inclus) du mois, en UTC. */
export function revenueMonthStart(month: RevenueMonth): Date {
  const m = MONTH_RE.exec(month);
  if (!m) throw new RangeError(`Mois invalide : ${month}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
}

/** Début (exclu) du mois suivant, en UTC. */
export function revenueMonthEnd(month: RevenueMonth): Date {
  const start = revenueMonthStart(month);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
}

/** Mois de `from` à `to`, bornes incluses ; vide si `from` > `to`. */
export function revenueMonthsBetween(from: RevenueMonth, to: RevenueMonth): RevenueMonth[] {
  const out: RevenueMonth[] = [];
  const end = revenueMonthStart(to).getTime();
  let cursor = revenueMonthStart(from);
  while (cursor.getTime() <= end) {
    out.push(revenueMonthOf(cursor));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return out;
}

/** Période par défaut : les douze derniers mois, mois courant compris. */
export function defaultRevenuePeriod(now: Date): { from: RevenueMonth; to: RevenueMonth } {
  const to = revenueMonthOf(now);
  const from = revenueMonthOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)));
  return { from, to };
}

// ── Entrées ─────────────────────────────────────────────────────────────────

export type ManualPaymentStatus = 'pending' | 'confirmed' | 'rejected' | 'expired';
export type ManualPaymentMethod = 'mobile_money' | 'bank_transfer';

/** Une demande de paiement manuel (métadonnées, aucune coordonnée du payeur). */
export interface ManualPaymentRecord {
  plan: string;
  interval: 'month' | 'year';
  /** Montant figé à la demande, en centimes entiers. */
  amountDueCents: number;
  currency: string;
  method: ManualPaymentMethod;
  status: ManualPaymentStatus;
  createdAt: Date;
  expiresAt: Date;
  /** Date de la décision (confirmation ou refus) ; `null` tant qu'ouverte. */
  decidedAt: Date | null;
}

/** Rappel d'un fournisseur en ligne : Lalanda n'en conserve aucun montant. */
export interface ProviderPaymentRecord {
  provider: string;
  /** Événement métier appliqué (`payment.succeeded`…). */
  mappedEvent: string | null;
  status: 'received' | 'processed' | 'ignored' | 'failed';
  at: Date;
}

/** Abonnement (métadonnées seulement). */
export interface SubscriptionRecord {
  plan: string;
  status: string;
  billingInterval: 'month' | 'year';
  /** `null` : jamais payé (essai, octroi, ancien changement de plan sans paiement). */
  lastPaymentAt: Date | null;
}

/** Tarif publié d'une offre ; `null` = sans montant publié (sur devis). */
export interface PlanTariff {
  monthCents: number | null;
  yearCents: number | null;
}

export interface PlatformRevenueInput {
  from: RevenueMonth;
  to: RevenueMonth;
  /** Instant du calcul : décide qu'une demande en attente est échue. */
  now: Date;
  manualPayments: readonly ManualPaymentRecord[];
  providerPayments: readonly ProviderPaymentRecord[];
  subscriptions: readonly SubscriptionRecord[];
  tariffs: Readonly<Record<string, PlanTariff>>;
  /** Devise de la grille publiée (aucune conversion n'est faite vers elle). */
  tariffCurrency: string;
}

// ── Sorties ─────────────────────────────────────────────────────────────────

export interface AmountByCurrency {
  currency: string;
  totalCents: number;
  count: number;
}

export interface MonthlyReceipts {
  month: RevenueMonth;
  /** Une ligne par devise rencontrée sur la période, même à zéro ce mois-là. */
  byCurrency: AmountByCurrency[];
}

export interface PlanReceipts {
  plan: string;
  byCurrency: AmountByCurrency[];
}

export interface MethodReceipts {
  /** Moyen : `mobile_money` ou `bank_transfer` (circuit `manual`). */
  method: ManualPaymentMethod;
  byCurrency: AmountByCurrency[];
}

export interface ProviderEventCount {
  provider: string;
  /** Rappels « paiement reçu » traités sur la période ; montant non conservé. */
  count: number;
}

export interface DeclaredRecurring {
  currency: string;
  /** Somme des abonnements mensuels actifs, en centimes. */
  monthlySubscriptionsCents: number;
  /** Somme des abonnements annuels actifs (montant annuel), en centimes. */
  yearlySubscriptionsCents: number;
  /** Total ramené au mois : mensuels + annuels ÷ 12, arrondi au centime le plus proche. */
  monthlyEquivalentCents: number;
  /** Abonnements retenus. */
  subscriptions: number;
}

export interface RecurringExclusions {
  /** Actifs jamais payés (octroi, ancien changement de plan sans paiement). */
  neverPaid: number;
  /** Actifs sur une offre sans montant publié (Expert, sur devis). */
  withoutPublishedTariff: number;
}

export interface ManualQueueSummary {
  /** Demandes encore ouvertes et non échues à `now` : montants ATTENDUS, pas encaissés. */
  pending: AmountByCurrency[];
  /** Demandes échues sans décision sur la période (statut `expired`, ou ouverte et échue). */
  expired: AmountByCurrency[];
  /** Demandes refusées sur la période. */
  rejected: AmountByCurrency[];
}

export interface PlatformRevenueReport {
  version: string;
  period: { from: RevenueMonth; to: RevenueMonth };
  receipts: {
    total: AmountByCurrency[];
    byMonth: MonthlyReceipts[];
    byPlan: PlanReceipts[];
    byMethod: MethodReceipts[];
  };
  providerEventsWithoutAmount: ProviderEventCount[];
  declaredRecurring: DeclaredRecurring[];
  recurringExclusions: RecurringExclusions;
  manualQueue: ManualQueueSummary;
  subscriptionsAtRisk: { pastDue: number; grace: number };
}

// ── Calcul ──────────────────────────────────────────────────────────────────

function assertCents(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${what} : centimes entiers positifs attendus, reçu ${value}`);
  }
}

class CurrencyBag {
  private readonly map = new Map<string, AmountByCurrency>();

  add(currency: string, cents: number): void {
    const row = this.map.get(currency) ?? { currency, totalCents: 0, count: 0 };
    row.totalCents += cents;
    row.count += 1;
    this.map.set(currency, row);
  }

  rows(currencies?: readonly string[]): AmountByCurrency[] {
    const keys = currencies ?? [...this.map.keys()].sort();
    return keys.map((c) => ({ ...(this.map.get(c) ?? { currency: c, totalCents: 0, count: 0 }) }));
  }
}

function inPeriod(date: Date | null, start: number, end: number): date is Date {
  return date !== null && date.getTime() >= start && date.getTime() < end;
}

/**
 * Rapport des finances du site sur les mois `from`..`to` (inclus, UTC).
 *
 * Seuls les dépôts manuels `confirmed` décidés dans la période forment les
 * encaissements constatés, au centime près.
 */
export function computePlatformRevenue(input: PlatformRevenueInput): PlatformRevenueReport {
  if (!isRevenueMonth(input.from) || !isRevenueMonth(input.to)) {
    throw new RangeError('Période invalide : mois AAAA-MM attendus.');
  }
  if (revenueMonthStart(input.from).getTime() > revenueMonthStart(input.to).getTime()) {
    throw new RangeError('Période invalide : début après la fin.');
  }
  const start = revenueMonthStart(input.from).getTime();
  const end = revenueMonthEnd(input.to).getTime();
  const months = revenueMonthsBetween(input.from, input.to);
  const now = input.now.getTime();

  const total = new CurrencyBag();
  const byMonth = new Map<RevenueMonth, CurrencyBag>(months.map((m) => [m, new CurrencyBag()]));
  const byPlan = new Map<string, CurrencyBag>();
  const byMethod = new Map<ManualPaymentMethod, CurrencyBag>();
  const pending = new CurrencyBag();
  const expired = new CurrencyBag();
  const rejected = new CurrencyBag();

  for (const p of input.manualPayments) {
    assertCents(p.amountDueCents, 'Montant d’une demande manuelle');
    if (p.status === 'confirmed') {
      if (!inPeriod(p.decidedAt, start, end)) continue;
      total.add(p.currency, p.amountDueCents);
      byMonth.get(revenueMonthOf(p.decidedAt))!.add(p.currency, p.amountDueCents);
      if (!byPlan.has(p.plan)) byPlan.set(p.plan, new CurrencyBag());
      byPlan.get(p.plan)!.add(p.currency, p.amountDueCents);
      if (!byMethod.has(p.method)) byMethod.set(p.method, new CurrencyBag());
      byMethod.get(p.method)!.add(p.currency, p.amountDueCents);
    } else if (p.status === 'rejected') {
      if (inPeriod(p.decidedAt, start, end)) rejected.add(p.currency, p.amountDueCents);
    } else if (p.status === 'pending' && p.expiresAt.getTime() > now) {
      // File de travail : vue à l'instant, quelle que soit la période.
      pending.add(p.currency, p.amountDueCents);
    } else if (inPeriod(p.expiresAt, start, end)) {
      // `expired`, ou `pending` dont l'échéance est passée sans que le balayage l'ait vue.
      expired.add(p.currency, p.amountDueCents);
    }
  }

  const receiptCurrencies = total.rows().map((r) => r.currency);

  const providerCounts = new Map<string, number>();
  for (const e of input.providerPayments) {
    if (e.provider === 'manual') continue; // déjà compté par sa demande confirmée
    if (e.mappedEvent !== 'payment.succeeded' || e.status !== 'processed') continue;
    if (!inPeriod(e.at, start, end)) continue;
    providerCounts.set(e.provider, (providerCounts.get(e.provider) ?? 0) + 1);
  }

  let monthly = 0;
  let yearly = 0;
  let retained = 0;
  let neverPaid = 0;
  let withoutTariff = 0;
  let pastDue = 0;
  let grace = 0;
  for (const s of input.subscriptions) {
    if (s.status === 'past_due') pastDue += 1;
    if (s.status === 'grace') grace += 1;
    if (s.status !== 'active') continue;
    const tariff = input.tariffs[s.plan];
    const cents = tariff
      ? s.billingInterval === 'year'
        ? tariff.yearCents
        : tariff.monthCents
      : null;
    if (cents === 0) continue; // offre gratuite : rien à déclarer
    if (s.lastPaymentAt === null) {
      neverPaid += 1;
      continue;
    }
    if (cents === null) {
      withoutTariff += 1;
      continue;
    }
    assertCents(cents, `Tarif ${s.plan}/${s.billingInterval}`);
    if (s.billingInterval === 'year') yearly += cents;
    else monthly += cents;
    retained += 1;
  }

  return {
    version: PLATFORM_REVENUE_VERSION,
    period: { from: input.from, to: input.to },
    receipts: {
      total: total.rows(),
      byMonth: months.map((month) => ({
        month,
        byCurrency: byMonth.get(month)!.rows(receiptCurrencies),
      })),
      byPlan: [...byPlan.keys()].sort().map((plan) => ({
        plan,
        byCurrency: byPlan.get(plan)!.rows(),
      })),
      byMethod: [...byMethod.keys()].sort().map((method) => ({
        method,
        byCurrency: byMethod.get(method)!.rows(),
      })),
    },
    providerEventsWithoutAmount: [...providerCounts.keys()]
      .sort()
      .map((provider) => ({ provider, count: providerCounts.get(provider)! })),
    declaredRecurring:
      retained === 0
        ? []
        : [
            {
              currency: input.tariffCurrency,
              monthlySubscriptionsCents: monthly,
              yearlySubscriptionsCents: yearly,
              monthlyEquivalentCents: monthly + Math.round(yearly / 12),
              subscriptions: retained,
            },
          ],
    recurringExclusions: { neverPaid, withoutPublishedTariff: withoutTariff },
    manualQueue: { pending: pending.rows(), expired: expired.rows(), rejected: rejected.rows() },
    subscriptionsAtRisk: { pastDue, grace },
  };
}

// ── Présentation sans flottant ──────────────────────────────────────────────

/** `1900` → `"19.00"`. Entiers seulement : aucun arrondi caché. */
export function centsToDecimal(cents: number): string {
  assertCents(cents, 'Montant');
  const units = Math.trunc(cents / 100);
  const rest = cents % 100;
  return `${units}.${String(rest).padStart(2, '0')}`;
}

/** Une ligne de l'export CSV des finances du site. */
export interface PlatformRevenueCsvRow {
  section: string;
  key: string;
  currency: string;
  count: number;
  amount: string;
}

/**
 * Lignes de l'export : une par agrégat et par devise. Aucune donnée d'une organisation
 * (ni nom, ni identifiant, ni référence de dépôt) : seulement les agrégats du rapport.
 */
export function platformRevenueCsvRows(report: PlatformRevenueReport): PlatformRevenueCsvRow[] {
  const rows: PlatformRevenueCsvRow[] = [];
  const push = (section: string, key: string, list: readonly AmountByCurrency[]): void => {
    for (const r of list) {
      rows.push({
        section,
        key,
        currency: r.currency,
        count: r.count,
        amount: centsToDecimal(r.totalCents),
      });
    }
  };
  push('encaissements_constates', 'periode', report.receipts.total);
  for (const m of report.receipts.byMonth) push('encaissements_par_mois', m.month, m.byCurrency);
  for (const p of report.receipts.byPlan) push('encaissements_par_offre', p.plan, p.byCurrency);
  for (const m of report.receipts.byMethod) push('encaissements_par_moyen', m.method, m.byCurrency);
  for (const e of report.providerEventsWithoutAmount) {
    rows.push({
      section: 'rappels_sans_montant',
      key: e.provider,
      currency: '',
      count: e.count,
      amount: '',
    });
  }
  for (const d of report.declaredRecurring) {
    rows.push({
      section: 'revenu_recurrent_declare',
      key: 'equivalent_mensuel',
      currency: d.currency,
      count: d.subscriptions,
      amount: centsToDecimal(d.monthlyEquivalentCents),
    });
  }
  push('demandes_manuelles_en_attente', 'instant', report.manualQueue.pending);
  push('demandes_manuelles_expirees', 'periode', report.manualQueue.expired);
  push('demandes_manuelles_refusees', 'periode', report.manualQueue.rejected);
  return rows;
}

/** Sérialisation CSV (séparateur `;`, valeurs sans guillemet requis : codes et nombres). */
export function platformRevenueCsv(report: PlatformRevenueReport): string {
  const header = ['section', 'cle', 'devise', 'nombre', 'montant'];
  const escape = (v: string): string => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [header.join(';')];
  for (const r of platformRevenueCsvRows(report)) {
    lines.push([r.section, r.key, r.currency, String(r.count), r.amount].map(escape).join(';'));
  }
  return `${lines.join('\r\n')}\r\n`;
}
