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
//
// ADR-0077 § 4.7 : plus le NOMBRE de semaines de temps soumises que le destinataire peut
// valider (même audience que « Mes tâches ») ; jamais un nom ni une durée.

import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import type { BriefWorkInput, BriefWorkTaskInput } from '@lalanda/engine';
import { kinshasaDayOf } from '@lalanda/shared/work';

import type { WorkSource } from '../../morning-brief/morning-brief.ports.js';
import { NO_OVERRIDES } from '../../authz/permissions.js';
import { projectDocFilter } from '../work-access.js';
import { WorkAccessService } from '../work-access.service.js';
import { WorkMembersService } from '../work-members.service.js';
import { WorkTimesheetApprovalsService } from '../timesheets/work-timesheet-approvals.service.js';
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
    @Inject(WorkAccessService) private readonly access: WorkAccessService,
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
    @Optional()
    @Inject(WorkTimesheetApprovalsService)
    private readonly timesheets: WorkTimesheetApprovalsService | null = null,
  ) {}

  async workOf(organizationId: string, userId: string, now: Date): Promise<BriefWorkInput> {
    // ADR-0060 § 5 : seulement les projets que le destinataire peut ouvrir (écran et
    // e-mail). Droits relus à chaque brief : un ancien membre ne voit rien.
    const member = await this.members.permissionsOf(organizationId, userId);
    const actor = { userId, role: member?.role, context: member?.context ?? NO_OVERRIDES };
    const scope = await this.access.scopeOf(organizationId, actor);
    // ADR-0077 § 4.7 : sans module de validation (tests), le fait est « non disponible ».
    const timesheetApprovalCount =
      this.timesheets === null
        ? undefined
        : member
          ? await this.timesheets.countFor(organizationId, actor)
          : null;
    const extra = timesheetApprovalCount === undefined ? {} : { timesheetApprovalCount };
    const projects = (await this.projects
      .find(
        { organizationId, status: { $ne: 'archived' }, ...projectDocFilter(scope) },
        { _id: 1, status: 1 },
      )
      .lean()
      .exec()) as unknown as ProjectRow[];
    if (projects.length === 0) {
      return { status: 'known', tasks: [], truncated: false, pendingApprovalCount: 0, ...extra };
    }

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

    // ADR-0076 § 3 : tâches soumises dont le destinataire est le validateur.
    const pendingApprovalCount = await this.tasks
      .countDocuments({
        organizationId,
        projectId: { $in: projects.map((p) => String(p._id)) },
        'approval.pendingApproverUserId': userId,
        'approval.state': 'pending',
      })
      .exec();
    const truncated = rows.length > MAX_BRIEF_WORK_TASKS;
    const tasks: BriefWorkTaskInput[] = rows.slice(0, MAX_BRIEF_WORK_TASKS).map((t) => ({
      projectId: t.projectId,
      dueDate: t.dueDate,
      isMilestone: t.isMilestone === true,
      mine: t.assigneeUserId === userId,
      projectActive: active.has(t.projectId),
    }));
    return { status: 'known', tasks, truncated, pendingApprovalCount, ...extra };
  }
}
