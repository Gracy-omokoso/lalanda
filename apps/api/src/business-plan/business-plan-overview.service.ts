// Vue d'ensemble des business plans d'une organisation (écran BUILD « Business plan »).
//
// Lecture seule, deux requêtes groupées (documents, dernières versions) quel que
// soit le nombre de projets.

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import type { ProjectDocument } from '../projects/project.schema.js';
import { BUSINESS_PLAN_SECTION_IDS } from './business-plan.sections.js';
import {
  BusinessPlan,
  BusinessPlanVersion,
  type BusinessPlanDocument,
  type BusinessPlanVersionDocument,
} from './business-plan.schemas.js';

export interface BusinessPlanOverviewItem {
  projectId: string;
  projectName: string;
  /** Sections dont le texte est renseigné, sur neuf. */
  filledSections: number;
  totalSections: number;
  planVersion: number | null;
  lastValidated: { version: number; approvedAt: string } | null;
}

@Injectable()
export class BusinessPlanOverviewService {
  constructor(
    @InjectModel(BusinessPlan.name) private readonly docs: Model<BusinessPlanDocument>,
    @InjectModel(BusinessPlanVersion.name)
    private readonly versions: Model<BusinessPlanVersionDocument>,
  ) {}

  async of(
    organizationId: string,
    projects: Pick<ProjectDocument, '_id' | 'name'>[],
  ): Promise<BusinessPlanOverviewItem[]> {
    const ids = projects.map((p) => String(p._id));
    const [docs, latest] = await Promise.all([
      this.docs
        .find(
          { organizationId, projectId: { $in: ids } },
          { projectId: 1, planVersion: 1, sections: 1 },
        )
        .lean()
        .exec(),
      this.versions
        .aggregate<{ _id: string; version: number; approvedAt: Date }>([
          { $match: { organizationId, projectId: { $in: ids } } },
          { $sort: { version: -1 } },
          {
            $group: {
              _id: '$projectId',
              version: { $first: '$version' },
              approvedAt: { $first: '$approvedAt' },
            },
          },
        ])
        .exec(),
    ]);
    const byProject = new Map(docs.map((d) => [d.projectId, d]));
    const lastByProject = new Map(latest.map((l) => [l._id, l]));
    return projects.map((p) => {
      const id = String(p._id);
      const d = byProject.get(id);
      const last = lastByProject.get(id);
      return {
        projectId: id,
        projectName: p.name,
        filledSections: BUSINESS_PLAN_SECTION_IDS.filter(
          (s) => (d?.sections?.[s]?.text ?? '').trim() !== '',
        ).length,
        totalSections: BUSINESS_PLAN_SECTION_IDS.length,
        planVersion: d?.planVersion ?? null,
        lastValidated: last
          ? { version: last.version, approvedAt: new Date(last.approvedAt).toISOString() }
          : null,
      };
    });
  }
}
