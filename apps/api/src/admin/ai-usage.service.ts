// Comptage de la consommation d'IA (S21b).
//
// `record()` NE FAIT PAS ÉCHOUER l'appel qu'il compte : perdre une ligne de
// statistique est sans commune mesure avec refuser une réponse à un utilisateur.
// C'est le raisonnement inverse de celui de l'audit des secrets, et la différence
// est délibérée — un compteur n'est pas une preuve.

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AiUsageEvent, type AiUsageEventDocument } from './ai-usage.schema.js';

@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(
    @InjectModel(AiUsageEvent.name) private readonly events: Model<AiUsageEventDocument>,
  ) {}

  async record(input: {
    organizationId: string;
    userId: string;
    action: string;
    source: 'llm' | 'fallback';
  }): Promise<void> {
    try {
      await this.events.create({ ...input, _schemaVersion: 1 });
    } catch (err) {
      this.logger.warn(
        `comptage IA impossible (${input.action}) : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Compte les appels FACTURÉS d'une organisation depuis `since`.
   *
   * Base du quota mensuel (`ai-quota.service.ts`). Deux choix à ne pas défaire :
   *
   * - `source: 'llm'` est dans le filtre, pas seulement dans le résultat. Compter
   *   les replis déterministes ferait payer à l'utilisateur une panne de NOTRE
   *   configuration : le jour où une clé expire, tous les appels basculent en
   *   repli et un quota gratuit se viderait en vingt requêtes sans qu'aucun
   *   modèle n'ait été appelé.
   * - `countDocuments` et non une agrégation : c'est un simple décompte servi par
   *   l'index `{organizationId, source, createdAt}`, et il est appelé AVANT
   *   chaque réponse de l'assistant. Une agrégation ici coûterait à chaque
   *   message.
   *
   * Contrairement à `record()`, cette lecture NE rattrape PAS ses erreurs :
   * un comptage qui échoue doit remonter. Répondre « 0 consommé » sur une panne
   * de base transformerait l'incident en quota illimité pour tout le monde.
   */
  async countBilledForOrganizationSince(organizationId: string, since: Date): Promise<number> {
    return this.events.countDocuments({
      organizationId,
      source: 'llm',
      createdAt: { $gte: since },
    });
  }

  /** Compte les appels d'une fenêtre, ventilés par source. */
  async countSince(since: Date): Promise<{ llm: number; fallback: number; total: number }> {
    const rows = await this.events.aggregate<{ _id: string; n: number }>([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$source', n: { $sum: 1 } } },
    ]);
    const bySource = new Map(rows.map((r) => [r._id, r.n]));
    const llm = bySource.get('llm') ?? 0;
    const fallback = bySource.get('fallback') ?? 0;
    return { llm, fallback, total: llm + fallback };
  }
}
