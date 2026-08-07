import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import {
  Canvas,
  CanvasRevision,
  type CanvasBlocks,
  type CanvasDocument,
  type CanvasRevisionDocument,
} from './canvas.schema.js';

/** Nombre maximal de révisions conservées par projet (docs/05 § Versionnement — rétention légère). */
export const MAX_CANVAS_REVISIONS = 20;

@Injectable()
export class CanvasService {
  constructor(
    @InjectModel(Canvas.name) private readonly canvasModel: Model<CanvasDocument>,
    @InjectModel(CanvasRevision.name)
    private readonly revisionModel: Model<CanvasRevisionDocument>,
  ) {}

  /** Canvas d'un projet, ou null s'il n'a jamais été sauvegardé. Scope org TOUJOURS appliqué. */
  find(organizationId: string, projectId: string): Promise<CanvasDocument | null> {
    return this.canvasModel.findOne({ organizationId, projectId }).exec();
  }

  /**
   * Remplace intégralement le canvas (sémantique PUT) :
   * 1. upsert du document unique {projectId} avec `version` incrémentée;
   * 2. snapshot dans `canvas_revisions` (version identique);
   * 3. purge des révisions au-delà des MAX_CANVAS_REVISIONS dernières.
   *
   * Les versions étant strictement croissantes, la purge par
   * `version <= version - MAX` équivaut à « garder les N dernières ».
   */
  async replace(
    organizationId: string,
    projectId: string,
    updatedBy: string,
    blocs: CanvasBlocks,
  ): Promise<CanvasDocument> {
    const doc = await this.canvasModel
      .findOneAndUpdate(
        { organizationId, projectId },
        {
          $set: { blocs, updatedBy },
          $inc: { version: 1 },
          $setOnInsert: { organizationId, projectId, _schemaVersion: 1 },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    // Snapshot de la version fraîchement écrite. En cas de course sur la même
    // version (deux PUT simultanés), l'index unique {projectId, version} fait
    // échouer le second snapshot — le canvas, lui, reste cohérent (dernier écrit gagne).
    await this.revisionModel.create({
      organizationId,
      projectId,
      version: doc.version,
      blocs,
      savedBy: updatedBy,
    });

    await this.revisionModel
      .deleteMany({
        organizationId,
        projectId,
        version: { $lte: doc.version - MAX_CANVAS_REVISIONS },
      })
      .exec();

    return doc;
  }

  /** Révisions d'un projet, plus récentes en premier (au plus MAX_CANVAS_REVISIONS). */
  listRevisions(organizationId: string, projectId: string): Promise<CanvasRevisionDocument[]> {
    return this.revisionModel
      .find({ organizationId, projectId })
      .sort({ version: -1 })
      .limit(MAX_CANVAS_REVISIONS)
      .exec();
  }
}
