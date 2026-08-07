import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { OBJECTIVE_KEYS, type PutObjectivesInput } from './objectives.dto.js';
import {
  FinancialObjectives,
  type FinancialObjectivesDocument,
} from './objectives.schema.js';

@Injectable()
export class ObjectivesService {
  constructor(
    @InjectModel(FinancialObjectives.name)
    private readonly model: Model<FinancialObjectivesDocument>,
  ) {}

  /** Objectifs d'un projet, ou null si jamais renseignés. Scope org TOUJOURS appliqué. */
  find(organizationId: string, projectId: string): Promise<FinancialObjectivesDocument | null> {
    return this.model.findOne({ organizationId, projectId }).exec();
  }

  /**
   * Remplacement complet (sémantique PUT) : les cibles fournies sont écrites,
   * les cibles absentes sont EFFACÉES ($unset) — pas de fusion silencieuse.
   */
  async replace(
    organizationId: string,
    projectId: string,
    input: PutObjectivesInput,
  ): Promise<FinancialObjectivesDocument> {
    const set: Record<string, number> = {};
    const unset: Record<string, 1> = {};
    for (const key of OBJECTIVE_KEYS) {
      const value = input[key];
      if (value === undefined) unset[key] = 1;
      else set[key] = value;
    }
    return this.model
      .findOneAndUpdate(
        { organizationId, projectId },
        {
          ...(Object.keys(set).length > 0 ? { $set: set } : {}),
          ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
          $setOnInsert: { organizationId, projectId, _schemaVersion: 1 },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
  }
}
