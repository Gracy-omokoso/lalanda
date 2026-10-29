// Fournisseur RÉEL du point d'extension `WORK_SOURCE` du brief du matin —
// ADR-0039 § 6.5 (lot L4b), branché par `morning-brief.module.ts`.
//
// LECTURE SEULE de `work_projects` et `work_tasks`, et aucun calcul ici : la
// source remet au moteur `morning-brief` les tâches non terminées dont
// l'échéance est aujourd'hui ou passée (jour de Kinshasa), et le moteur décide
// de ce qui est « en retard », « du jour » ou « à risque » (seuil S7).
//
// Isolation : `organizationId` vient de la session (brief) ou de la
// membership vérifiée (e-mail), jamais d'une requête. Les projets archivés
// sont exclus, comme dans « Mes tâches » (`GET /work/my-tasks`).

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import type { BriefWorkInput, BriefWorkTaskInput } from '@lalanda/engine';
import { kinshasaDayOf } from '@lalanda/shared/work';

import type { WorkSource } from '../../morning-brief/morning-brief.ports.js';
import {
  WorkProject,
  WorkTask,
  type WorkProjectDocument,
  type WorkTaskDocument,
} from '../work.schemas.js';

/** Tâches lues au plus pour un brief : au-delà, le brief le signale (`truncated`). */
export const MAX_BRIEF_WORK_TASKS = 5000;

interface ProjectRow {
  _id: unknown;
  status: string;
}

interface TaskRow {
  projectId: string;
  dueDate: string;
  isMilestone: boolean;
  assigneeUserId: string | null;
}

@Injectable()
export class WorkBriefSource implements WorkSource {
  constructor(
    @InjectModel(WorkProject.name) private readonly projects: Model<WorkProjectDocument>,
    @InjectModel(WorkTask.name) private readonly tasks: Model<WorkTaskDocument>,
  ) {}

  async workOf(organizationId: string, userId: string, now: Date): Promise<BriefWorkInput> {
    const projects = (await this.projects
      .find({ organizationId, status: { $ne: 'archived' } }, { _id: 1, status: 1 })
      .lean()
      .exec()) as unknown as ProjectRow[];
    if (projects.length === 0) return { status: 'known', tasks: [], truncated: false };

    const active = new Set(projects.filter((p) => p.status === 'active').map((p) => String(p._id)));
    const today = kinshasaDayOf(now);
    const rows = (await this.tasks
      .find(
        {
          organizationId,
          done: false,
          projectId: { $in: projects.map((p) => String(p._id)) },
          // `AAAA-MM-JJ` : l'ordre des chaînes est celui des jours ; `null` exclu.
          dueDate: { $ne: null, $lte: today },
        },
        { _id: 0, projectId: 1, dueDate: 1, isMilestone: 1, assigneeUserId: 1 },
      )
      .sort({ dueDate: 1, _id: 1 })
      .limit(MAX_BRIEF_WORK_TASKS + 1)
      .lean()
      .exec()) as unknown as TaskRow[];

    const truncated = rows.length > MAX_BRIEF_WORK_TASKS;
    const tasks: BriefWorkTaskInput[] = rows.slice(0, MAX_BRIEF_WORK_TASKS).map((t) => ({
      projectId: t.projectId,
      dueDate: t.dueDate,
      isMilestone: t.isMilestone === true,
      mine: t.assigneeUserId === userId,
      projectActive: active.has(t.projectId),
    }));
    return { status: 'known', tasks, truncated };
  }
}
