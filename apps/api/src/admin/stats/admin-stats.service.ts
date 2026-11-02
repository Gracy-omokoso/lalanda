// Lecture des statistiques agrégées (ADR-0053 § 6.7 — lot P7).
//
// Ce service ne fait que RASSEMBLER des métadonnées de plateforme ; tout calcul, et le
// seuil de diffusion, vivent dans `stats.ts` (fonctions pures testées).
//
// Lectures, toutes en projection minimale :
//   - `organizations` : identifiant, pays, type, date de création ;
//   - `subscriptions` : offre, état, essai, dernier paiement, octroi en cours ;
//   - `user`, `session`, `memberships` : comptes, nouveaux, actifs (sessions) ;
//   - `ai_usage_events`, `pdf_export_events` : volumes de la fenêtre ;
//   - collections des modules : `distinct('organizationId')` SEULEMENT — la clé de
//     locataire, jamais un champ de contenu ni un montant (§ 6.7 : « nombre
//     d'organisations qui ont au moins un document dans un module »).

import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import { PLATFORM_LIMITS } from '@lalanda/shared/platform';
import { PLANS, type Plan } from '@lalanda/shared/pricing';

import { effectivePlanAt } from '../../billing/subscription-lifecycle.js';
import type { SubscriptionStatus } from '../../billing/subscription-state.js';
import {
  computePlatformStats,
  STATS_MODULE_COLLECTIONS,
  STATS_MODULES,
  type PlatformStats,
  type StatsModule,
} from './stats.js';

/** Fenêtre « actif » et « nouveau » (§ 6.7 : actives sur 30 jours). */
export const STATS_WINDOW_DAYS = 30;

const asDate = (v: unknown): Date | null => (v instanceof Date ? v : null);

@Injectable()
export class AdminStatsService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async stats(now: Date = new Date()): Promise<PlatformStats> {
    const db = this.connection.db;
    if (!db) throw new Error('Base indisponible.');
    const since = new Date(now.getTime() - STATS_WINDOW_DAYS * 86_400_000);

    const [orgRows, subRows, userTotal, usersCreated, activeUserIds, aiCalls, pdfExports] =
      await Promise.all([
        db
          .collection('organizations')
          .find({}, { projection: { _id: 1, pays: 1, type: 1, createdAt: 1 } })
          .toArray(),
        db
          .collection('subscriptions')
          .find(
            {},
            {
              projection: {
                organizationId: 1,
                plan: 1,
                status: 1,
                trialStartedAt: 1,
                lastPaymentAt: 1,
                grantPlan: 1,
                grantStartsAt: 1,
                grantEndsAt: 1,
              },
            },
          )
          .toArray(),
        db.collection('user').countDocuments({}),
        db.collection('user').countDocuments({ createdAt: { $gte: since } }),
        db.collection('session').distinct('userId', { updatedAt: { $gte: since } }),
        db.collection('ai_usage_events').countDocuments({ createdAt: { $gte: since } }),
        db.collection('pdf_export_events').countDocuments({ createdAt: { $gte: since } }),
      ]);

    const activeUsers = activeUserIds.map(String);
    const activeOrganizationIds =
      activeUsers.length === 0
        ? []
        : (
            await db
              .collection('memberships')
              .distinct('organizationId', { userId: { $in: activeUsers } })
          ).map(String);

    const moduleAdoption: Partial<Record<StatsModule, string[]>> = {};
    await Promise.all(
      STATS_MODULES.map(async (m) => {
        const lists = await Promise.all(
          STATS_MODULE_COLLECTIONS[m].map((c) => db.collection(c).distinct('organizationId')),
        );
        moduleAdoption[m] = lists.flat().map(String);
      }),
    );

    return computePlatformStats({
      now,
      windowDays: STATS_WINDOW_DAYS,
      minCell: PLATFORM_LIMITS.statsMinCell,
      plans: PLANS,
      organizations: orgRows.map((o) => ({
        id: String(o['_id']),
        pays: typeof o['pays'] === 'string' ? o['pays'] : 'inconnu',
        type: typeof o['type'] === 'string' ? o['type'] : 'inconnu',
        createdAt: asDate(o['createdAt']),
      })),
      subscriptions: subRows.map((s) => ({
        organizationId: String(s['organizationId']),
        effectivePlan: effectivePlanAt(
          {
            plan: s['plan'] as Plan,
            status: s['status'] as SubscriptionStatus,
            grantPlan: (s['grantPlan'] as Plan | null | undefined) ?? null,
            grantStartsAt: asDate(s['grantStartsAt']),
            grantEndsAt: asDate(s['grantEndsAt']),
          },
          now,
        ),
        status: String(s['status']),
        trialStartedAt: asDate(s['trialStartedAt']),
        lastPaymentAt: asDate(s['lastPaymentAt']),
      })),
      users: {
        total: userTotal,
        createdInWindow: usersCreated,
        activeInWindow: activeUsers.length,
      },
      activeOrganizationIds,
      moduleAdoption,
      usage: { aiCallsInWindow: aiCalls, pdfExportsInWindow: pdfExports },
    });
  }
}
