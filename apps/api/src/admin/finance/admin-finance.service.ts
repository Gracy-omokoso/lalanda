// Finances du site (ADR-0053 § 6.8 — lot P7).
//
// Rassemble les métadonnées de paiement et confie TOUT le calcul au moteur
// (`@lalanda/engine`, module `platform-revenue`) : CLAUDE.md, le moteur est l'unique
// source des calculs ; la console et l'export consomment son résultat.
//
// Lectures (projection minimale, aucune coordonnée du payeur, aucun nom d'organisation) :
//   - `manual_payment_requests` : offre, périodicité, montant figé, devise, moyen, état,
//     dates — les dépôts CONFIRMÉS forment les « encaissements constatés » ;
//   - `payment_events` : rappels Stripe/PayPal traités, COMPTÉS sans montant (Lalanda
//     n'en conserve aucun) ;
//   - `subscriptions` : offre, état, périodicité, dernier paiement.
//
// Les octrois sans paiement (`platform_plan_grants`, lot P3) ne produisent ni demande
// manuelle ni paiement : ils n'entrent jamais dans les encaissements, et un abonnement
// jamais payé est exclu du revenu récurrent déclaré.
//
// Aucun taux de change, aucune règle fiscale ou comptable : ADR-0047 n'est pas tranché.

import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import {
  computePlatformRevenue,
  defaultRevenuePeriod,
  isRevenueMonth,
  revenueMonthEnd,
  revenueMonthStart,
  revenueMonthsBetween,
  type ManualPaymentRecord,
  type PlatformRevenueReport,
  type ProviderPaymentRecord,
  type SubscriptionRecord,
} from '@lalanda/engine';
import { BILLING_CURRENCY, PLAN_PRICES } from '@lalanda/shared/pricing';

/** Plus longue période servie, en mois (bornée pour la lecture). */
export const FINANCE_MAX_MONTHS = 60;

export interface FinancePeriodQuery {
  from?: string;
  to?: string;
}

const asDate = (v: unknown): Date | null => (v instanceof Date ? v : null);

/** Période demandée, validée ; défaut : douze derniers mois, mois courant compris. */
export function parseFinancePeriod(
  query: FinancePeriodQuery,
  now: Date,
): { from: string; to: string } {
  const defaut = defaultRevenuePeriod(now);
  const from = query.from || defaut.from;
  const to = query.to || defaut.to;
  if (!isRevenueMonth(from) || !isRevenueMonth(to)) {
    throw new BadRequestException({
      code: 'INVALID_PERIOD',
      message: 'Période attendue en mois AAAA-MM (from, to).',
    });
  }
  const months = revenueMonthsBetween(from, to).length;
  if (months === 0 || months > FINANCE_MAX_MONTHS) {
    throw new BadRequestException({
      code: 'INVALID_PERIOD',
      message: `Début avant la fin, ${FINANCE_MAX_MONTHS} mois au plus.`,
    });
  }
  return { from, to };
}

@Injectable()
export class AdminFinanceService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async report(query: FinancePeriodQuery, now: Date = new Date()): Promise<PlatformRevenueReport> {
    const { from, to } = parseFinancePeriod(query, now);
    const db = this.connection.db;
    if (!db) throw new Error('Base indisponible.');
    const start = revenueMonthStart(from);
    const end = revenueMonthEnd(to);

    const [manual, events, subs] = await Promise.all([
      db
        .collection('manual_payment_requests')
        .find(
          {
            $or: [
              { decidedAt: { $gte: start, $lt: end } },
              { expiresAt: { $gte: start, $lt: end } },
              { status: 'pending' },
            ],
          },
          {
            projection: {
              plan: 1,
              interval: 1,
              amountDueCents: 1,
              currency: 1,
              method: 1,
              status: 1,
              createdAt: 1,
              expiresAt: 1,
              decidedAt: 1,
            },
          },
        )
        .toArray(),
      db
        .collection('payment_events')
        .find(
          {
            provider: { $ne: 'manual' },
            mappedEvent: 'payment.succeeded',
            status: 'processed',
            createdAt: { $gte: start, $lt: end },
          },
          { projection: { provider: 1, mappedEvent: 1, status: 1, createdAt: 1 } },
        )
        .toArray(),
      db
        .collection('subscriptions')
        .find({}, { projection: { plan: 1, status: 1, billingInterval: 1, lastPaymentAt: 1 } })
        .toArray(),
    ]);

    const manualPayments: ManualPaymentRecord[] = manual.map((m) => ({
      plan: String(m['plan']),
      interval: m['interval'] === 'year' ? 'year' : 'month',
      amountDueCents: Number(m['amountDueCents']),
      currency: String(m['currency'] ?? BILLING_CURRENCY),
      method: m['method'] === 'bank_transfer' ? 'bank_transfer' : 'mobile_money',
      status: m['status'] as ManualPaymentRecord['status'],
      createdAt: asDate(m['createdAt']) ?? new Date(0),
      expiresAt: asDate(m['expiresAt']) ?? new Date(0),
      decidedAt: asDate(m['decidedAt']),
    }));
    const providerPayments: ProviderPaymentRecord[] = events.map((e) => ({
      provider: String(e['provider']),
      mappedEvent: (e['mappedEvent'] as string | null) ?? null,
      status: e['status'] as ProviderPaymentRecord['status'],
      at: asDate(e['createdAt']) ?? new Date(0),
    }));
    const subscriptions: SubscriptionRecord[] = subs.map((s) => ({
      plan: String(s['plan']),
      status: String(s['status']),
      billingInterval: s['billingInterval'] === 'year' ? 'year' : 'month',
      lastPaymentAt: asDate(s['lastPaymentAt']),
    }));

    return computePlatformRevenue({
      from,
      to,
      now,
      manualPayments,
      providerPayments,
      subscriptions,
      tariffs: PLAN_PRICES,
      tariffCurrency: BILLING_CURRENCY,
    });
  }
}
