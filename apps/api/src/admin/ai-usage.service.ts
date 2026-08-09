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
