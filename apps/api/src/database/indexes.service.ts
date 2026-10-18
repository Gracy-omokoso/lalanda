// Index MongoDB en production (S25a).
//
// ── Le défaut que ce fichier corrige ──────────────────────────────────────────
// `app.module.ts` désactive `autoIndex` en production — à juste titre : Mongoose
// déclencherait sinon des constructions d'index implicites à chaque démarrage.
// Mais la contrepartie prévue (« migrations contrôlées », apps/api/migrations)
// n'a jamais reçu de runner. Constat du 18 oct. 2026 : AUCUNE collection de
// production n'avait d'index secondaire. Les index UNIQUES déclarés dans les
// schémas — anti-doublon des événements de paiement, versions de plan, une
// adhésion par (organisation, utilisateur), acceptation des conditions… —
// n'existaient pas : les garde-fous qui s'en remettent à une erreur E11000 ne
// gardaient rien.
//
// ── Ce que fait ce service ────────────────────────────────────────────────────
// Au démarrage en production, il crée les index MANQUANTS de chaque modèle
// Mongoose (`createIndexes`, jamais `syncIndexes` : on ajoute, on ne supprime
// rien) et ceux des collections de better-auth, que personne ne déclare. Un index
// qui ne peut pas être construit (doublons déjà présents) est JOURNALISÉ en
// erreur, sans empêcher l'API de démarrer : mieux vaut un service dégradé et
// signalé qu'un site arrêté.
//
// Avant le premier déploiement, les doublons ont été recherchés en production
// pour chacun des index uniques : aucun.

import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

/**
 * Index des collections de better-auth (adaptateur MongoDB). La bibliothèque ne
 * les crée pas ; sans `user.email` unique, deux inscriptions simultanées à la
 * même adresse ne seraient départagées que par une lecture préalable.
 */
export const AUTH_INDEXES: ReadonlyArray<{
  collection: string;
  keys: Record<string, 1>;
  unique?: boolean;
}> = [
  { collection: 'user', keys: { email: 1 }, unique: true },
  { collection: 'session', keys: { token: 1 }, unique: true },
  { collection: 'session', keys: { userId: 1 } },
  { collection: 'account', keys: { userId: 1 } },
  { collection: 'account', keys: { providerId: 1, accountId: 1 } },
  { collection: 'verification', keys: { identifier: 1 } },
];

export interface IndexReport {
  ensured: string[];
  failed: Array<{ target: string; error: string }>;
}

@Injectable()
export class IndexesService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Indexes');

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async onApplicationBootstrap(): Promise<void> {
    // En dehors de la production, `autoIndex` fait déjà ce travail.
    if (process.env['NODE_ENV'] !== 'production') return;
    const report = await this.ensureAll();
    const summary = `${report.ensured.length} collection(s) vérifiée(s), ${report.failed.length} échec(s)`;
    if (report.failed.length === 0) this.logger.log(`Index MongoDB : ${summary}.`);
    else this.logger.error(`Index MongoDB : ${summary}.`);
  }

  /** Crée les index manquants. Idempotent : un index existant n'est pas reconstruit. */
  async ensureAll(): Promise<IndexReport> {
    const report: IndexReport = { ensured: [], failed: [] };

    for (const model of Object.values(this.connection.models)) {
      const target = model.collection.collectionName;
      try {
        await model.createIndexes();
        report.ensured.push(target);
      } catch (err) {
        report.failed.push({ target, error: describe(err) });
        this.logger.error(`Index de « ${target} » non créés : ${describe(err)}`);
      }
    }

    for (const spec of AUTH_INDEXES) {
      const target = `${spec.collection} ${JSON.stringify(spec.keys)}`;
      try {
        await this.connection
          .collection(spec.collection)
          .createIndex(spec.keys, spec.unique ? { unique: true } : {});
        report.ensured.push(target);
      } catch (err) {
        report.failed.push({ target, error: describe(err) });
        this.logger.error(`Index ${target} non créé : ${describe(err)}`);
      }
    }
    return report;
  }
}

function describe(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}
