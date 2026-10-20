// Conservation des listes de référence e-MCF — ADR-0021 §6.

import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import type { EdefEnvironment } from '../platform-config/dgi-platform.config.js';
import {
  EdefReferenceSnapshot,
  type EdefReferenceSnapshotDocument,
} from './edef-reference-snapshot.schema.js';
import type { EdefReferenceList } from './edef.types.js';

/**
 * JSON canonique : clés d'objet triées, récursivement. Deux réponses identiques
 * dans un ordre de clés différent donnent la même empreinte — sinon un simple
 * réordonnancement côté DGI créerait un instantané « nouveau » sans changement.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

@Injectable()
export class EdefReferenceSnapshotsService {
  constructor(
    @InjectModel(EdefReferenceSnapshot.name)
    private readonly model: Model<EdefReferenceSnapshotDocument>,
  ) {}

  /**
   * Enregistre la liste si son contenu diffère de tout instantané déjà conservé,
   * et marque dans tous les cas ce contenu comme vu maintenant (`lastSeenAt`).
   * `created` dit si un document a été écrit. Idempotent sous concurrence : deux
   * lectures simultanées du même contenu se rencontrent sur l'index unique.
   *
   * Sans `lastSeenAt`, un retour à une valeur déjà conservée (5 % → 8 % → 5 %)
   * ne réécrivait rien et `latest()` continuait de servir la valeur
   * intermédiaire, devenue fausse (constat du 20 oct. 2026, chantier F2).
   */
  async record(
    environment: EdefEnvironment,
    list: EdefReferenceList,
    payload: unknown,
  ): Promise<{ sha256: string; created: boolean }> {
    const sha256 = createHash('sha256').update(canonicalJson(payload)).digest('hex');
    const now = new Date();
    const res = await this.model
      .updateOne(
        { environment, list, sha256 },
        {
          $setOnInsert: { payload, fetchedAt: now, _schemaVersion: 1 },
          $set: { lastSeenAt: now },
        },
        { upsert: true },
      )
      .exec()
      .catch((err: unknown) => {
        // Deux insertions concurrentes : la seconde perd sur l'index unique, le
        // contenu est donc déjà conservé.
        if ((err as { code?: number }).code === 11000) return { upsertedCount: 0 };
        throw err;
      });
    return { sha256, created: res.upsertedCount > 0 };
  }

  async count(environment: EdefEnvironment, list: EdefReferenceList): Promise<number> {
    return this.model.countDocuments({ environment, list }).exec();
  }

  /**
   * Dernier instantané conservé d'une liste dans un environnement, ou `null`
   * (ADR-0022 § S25c.4). « Dernier » = le contenu VU le plus récemment
   * (`lastSeenAt`), puis `fetchedAt`, puis le dernier inséré. Lecture seule :
   * aucun appel à la DGI.
   */
  async latest(
    environment: EdefEnvironment,
    list: EdefReferenceList,
  ): Promise<{ payload: unknown; fetchedAt: Date; sha256: string } | null> {
    const doc = await this.model
      .findOne({ environment, list })
      .sort({ lastSeenAt: -1, fetchedAt: -1, _id: -1 })
      .lean()
      .exec();
    if (!doc) return null;
    return { payload: doc.payload, fetchedAt: doc.fetchedAt, sha256: doc.sha256 };
  }
}
