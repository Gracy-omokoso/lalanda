// Feuille de temps hebdomadaire en LECTURE — ADR-0045 O5, § 6.3. ADR-0045 — H5.
//
// Grille jour × projet des saisies de temps EXISTANTES (`work_time_entries`) d'un
// membre, croisée avec ses absences approuvées (demi-journées, jamais le type) et les
// jours fériés de l'organisation ; constats `TIME_ON_LEAVE_DAY` et
// `NO_TIME_ON_WORKING_DAY`. Tout le calcul : moteur RH `weeklyTimesheet`. AUCUNE
// saisie, AUCUNE validation, AUCUN verrou ; la marge n'est pas touchée.
//
// Accès : soi (`work.read`, au guard) ; autrui avec `work.manage` (droits effectifs) ou
// en étant son manager (relation, décidée par le moteur RH). Hors portée, ou membre
// d'une autre organisation : 404 (on ne confirme pas l'existence).

import { weeklyTimesheet } from '@lalanda/engine';
import {
  addDays,
  kinshasaDayOf,
  type WeeklyTimesheetQuery,
  type WeeklyTimesheetView,
} from '@lalanda/shared/work';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import {
  WORK_ABSENCES_SOURCE,
  noWorkAbsences,
  type WorkAbsencesSource,
} from '../work-absences.port.js';
import { WorkMembersService } from '../work-members.service.js';
import { WorkProjectsService } from '../work-projects.service.js';
import { actorCan, memberNotFound, type WorkActor } from '../work.common.js';
import { WorkTimeEntry, type WorkTimeEntryDocument } from '../work.schemas.js';

/** Lundi de la semaine qui contient `day` (`AAAA-MM-JJ`). */
export function mondayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDays(day, -weekday);
}

@Injectable()
export class WorkTimesheetsService {
  private readonly absences: WorkAbsencesSource;

  constructor(
    @InjectModel(WorkTimeEntry.name) private readonly time: Model<WorkTimeEntryDocument>,
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
    @Inject(WorkProjectsService) private readonly projects: WorkProjectsService,
    @Optional() @Inject(WORK_ABSENCES_SOURCE) absences: WorkAbsencesSource | null = null,
  ) {
    this.absences = absences ?? noWorkAbsences;
  }

  async weekly(
    organizationId: string,
    query: WeeklyTimesheetQuery,
    actor: WorkActor,
    now = new Date(),
  ): Promise<WeeklyTimesheetView> {
    const today = kinshasaDayOf(now);
    const week = query.week ?? mondayOf(today);
    const sunday = addDays(week, 6);
    const userId = query.userId ?? actor.userId;
    if (userId !== actor.userId) {
      // Membre de CETTE organisation, sinon 404.
      const role = await this.members.roleOf(organizationId, userId);
      if (role === undefined) memberNotFound();
    }
    const context = await this.absences.timesheetContextOf(
      organizationId,
      actor.userId,
      userId,
      week,
      sunday,
    );
    if (userId !== actor.userId && !actorCan(actor, 'work.manage') && !context.viewerIsManager) {
      memberNotFound();
    }
    const entries = await this.time
      .find(
        { organizationId, userId, deletedAt: null, workedOn: { $gte: week, $lte: sunday } },
        { projectId: 1, workedOn: 1, minutes: 1 },
      )
      .lean<{ projectId: string; workedOn: string; minutes: number }[]>()
      .exec();
    const result = weeklyTimesheet(
      entries.map((e) => ({ projectId: e.projectId, workedOn: e.workedOn, minutes: e.minutes })),
      context.absences,
      context.holidays,
      context.workPattern,
      week,
      { today },
    );
    const [refs, names] = await Promise.all([
      this.members.refs([userId]),
      this.projects.namesOf(
        organizationId,
        result.projects.map((p) => p.projectId),
      ),
    ]);
    return {
      version: result.version,
      user: WorkMembersService.refOf(refs, userId),
      week: result.week,
      employeeLinked: context.employeeLinked,
      days: result.days,
      projects: result.projects.map((p) => ({ ...p, projectName: names.get(p.projectId) ?? '' })),
      totalMinutes: result.totalMinutes,
      findings: result.findings,
    };
  }
}
