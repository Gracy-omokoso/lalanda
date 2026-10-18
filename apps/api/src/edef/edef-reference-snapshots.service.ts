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
   * Enregistre la liste si son contenu diffère de tout instantané déjà conservé.
   * `created` dit si un document a été écrit. Idempotent sous concurrence : deux
   * lectures simultanées du même contenu se rencontrent sur l'index unique.
   */
  async record(
    environment: EdefEnvironment,
    list: EdefReferenceList,
    payload: unknown,
  ): Promise<{ sha256: string; created: boolean }> {
    const sha256 = createHash('sha256').update(canonicalJson(payload)).digest('hex');
    const res = await this.model
      .updateOne(
        { environment, list, sha256 },
        { $setOnInsert: { payload, fetchedAt: new Date(), _schemaVersion: 1 } },
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
}
