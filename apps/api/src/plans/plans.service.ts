import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import type { EvaluationView } from '../evaluate/evaluation-view.js';
import { FinancialPlan, type FinancialPlanDocument } from './plan.schema.js';

export interface ApprovePlanInput {
  organizationId: string;
  projectId: string;
  approvedBy: string;
  driverValues: Record<string, number>;
  templateSlug: string;
  templateVersion: string;
  parameterPackSlug?: string;
  packVersion?: string;
  engineVersion: string;
  result: EvaluationView;
  fingerprint: string;
}

@Injectable()
export class PlansService {
  constructor(
    @InjectModel(FinancialPlan.name) private readonly model: Model<FinancialPlanDocument>,
  ) {}

  /**
   * Fige un plan validé en version N+1 et marque les versions précédentes `superseded`.
   *
   * Règle 409 : si l'empreinte est identique à celle du dernier plan du projet,
   * rien n'a changé depuis la dernière validation → on refuse de créer un doublon.
   *
   * Ordre des écritures : création de vN+1 D'ABORD, puis bascule des anciennes en
   * `superseded`. En cas de course, l'index unique {projectId, version} fait échouer
   * la seconde création (11000) → traduit en 409 CONFLICT.
   */
  async approve(input: ApprovePlanInput): Promise<FinancialPlanDocument> {
    const latest = await this.model
      .findOne({ projectId: input.projectId, organizationId: input.organizationId })
      .sort({ version: -1 })
      .exec();

    if (latest && latest.fingerprint === input.fingerprint) {
      throw new ConflictException({
        code: 'PLAN_UNCHANGED',
        message: `Les entrées sont identiques au plan validé v${latest.version} — aucune nouvelle version créée.`,
        version: latest.version,
      });
    }

    let doc: FinancialPlanDocument;
    try {
      doc = await this.model.create({
        organizationId: input.organizationId,
        projectId: input.projectId,
        version: (latest?.version ?? 0) + 1,
        status: 'approved',
        driverValues: input.driverValues,
        templateSlug: input.templateSlug,
        templateVersion: input.templateVersion,
        parameterPackSlug: input.parameterPackSlug,
        packVersion: input.packVersion,
        engineVersion: input.engineVersion,
        result: input.result,
        fingerprint: input.fingerprint,
        approvedAt: new Date(),
        approvedBy: input.approvedBy,
        _schemaVersion: 1,
      });
    } catch (err) {
      // Duplicate key sur {projectId, version} — validation concurrente.
      if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
        throw new ConflictException({
          code: 'PLAN_VERSION_CONFLICT',
          message: 'Une validation concurrente a créé cette version — réessayez.',
        });
      }
      throw err;
    }

    // Seule mutation autorisée sur un plan existant : approved → superseded.
    await this.model
      .updateMany(
        {
          projectId: input.projectId,
          organizationId: input.organizationId,
          _id: { $ne: doc._id },
          status: 'approved',
        },
        { $set: { status: 'superseded' } },
      )
      .exec();

    return doc;
  }

  /** Versions d'un projet, plus récentes en premier. Le scope org est TOUJOURS appliqué. */
  listByProject(organizationId: string, projectId: string): Promise<FinancialPlanDocument[]> {
    return this.model
      .find({ organizationId, projectId })
      .sort({ version: -1 })
      .exec();
  }

  /** Détail d'une version précise. 404 si absente ou hors scope org. */
  async findVersion(
    organizationId: string,
    projectId: string,
    version: number,
  ): Promise<FinancialPlanDocument> {
    if (!Number.isInteger(version) || version < 1) {
      throw new NotFoundException({ code: 'PLAN_NOT_FOUND' });
    }
    const doc = await this.model.findOne({ organizationId, projectId, version }).exec();
    if (!doc) throw new NotFoundException({ code: 'PLAN_NOT_FOUND' });
    return doc;
  }
}
