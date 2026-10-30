// Fournisseur réel du port `WORK_ABSENCES_SOURCE` — ADR-0045 § 6.2, § 6.3. ADR-0045 — H5.
//
// LECTURE SEULE, dans l'organisation de la session. Un compte est relié à au plus une
// fiche (`{ organizationId, userId }` unique) ; une fiche anonymisée n'a plus de compte.
// Ne lit que `employeeId`, `start` et `end` des demandes APPROUVÉES : ni type, ni motif,
// ni pièce. La relation de manager (feuille de temps d'autrui) est décidée par le moteur
// (`hrViewerScope`) sur les fiches, jamais sur un rôle.

import {
  hrViewerScope,
  type HolidayInput,
  type LeaveBound,
  type LeavePeriod,
} from '@lalanda/engine';
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import type {
  WorkAbsencesSource,
  WorkMemberAbsence,
  WorkTimesheetContext,
} from '../../work/work-absences.port.js';
import type { EmployeeLean } from '../employees/employee.schema.js';
import { engineEmployeeOf } from '../scope/hr-scope.service.js';
import { hrSettingsViewOf } from '../settings/hr-settings.service.js';

/** Absences lues au plus par appel (borne de sûreté d'une vue de projet). */
export const MAX_WORK_ABSENCES = 2000;

interface RequestRow {
  employeeId: string;
  start: LeaveBound;
  end: LeaveBound;
}

const EMPLOYEE_PROJECTION = {
  userId: 1,
  status: 1,
  startDate: 1,
  endDate: 1,
  departmentId: 1,
  managerEmployeeId: 1,
  workPattern: 1,
  sortName: 1,
} as const;

@Injectable()
export class HrWorkAbsencesSource implements WorkAbsencesSource {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private approved(
    organizationId: string,
    employeeIds: readonly string[],
    from: string,
    to: string,
  ): Promise<RequestRow[]> {
    if (employeeIds.length === 0) return Promise.resolve([]);
    return this.connection
      .collection('hr_leave_requests')
      .find(
        {
          organizationId,
          status: 'approved',
          employeeId: { $in: [...employeeIds] },
          'start.date': { $lte: to },
          'end.date': { $gte: from },
        },
        { projection: { _id: 0, employeeId: 1, start: 1, end: 1 } },
      )
      .sort({ 'start.date': 1 })
      .limit(MAX_WORK_ABSENCES)
      .toArray() as unknown as Promise<RequestRow[]>;
  }

  async absencesOf(
    organizationId: string,
    userIds: readonly string[],
    from: string,
    to: string,
  ): Promise<WorkMemberAbsence[]> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return [];
    const employees = (await this.connection
      .collection('hr_employees')
      .find(
        { organizationId, userId: { $in: ids }, status: { $ne: 'anonymized' } },
        { projection: { userId: 1 } },
      )
      .toArray()) as unknown as { _id: unknown; userId: string }[];
    const userOf = new Map(employees.map((e) => [String(e._id), e.userId]));
    const rows = await this.approved(organizationId, [...userOf.keys()], from, to);
    return rows.flatMap((r) => {
      const userId = userOf.get(r.employeeId);
      return userId ? [{ userId, start: r.start, end: r.end }] : [];
    });
  }

  async timesheetContextOf(
    organizationId: string,
    viewerUserId: string,
    userId: string,
    from: string,
    to: string,
  ): Promise<WorkTimesheetContext> {
    const [rows, settingsDoc, holidays] = await Promise.all([
      this.connection
        .collection('hr_employees')
        .find({ organizationId }, { projection: EMPLOYEE_PROJECTION })
        .toArray() as unknown as Promise<EmployeeLean[]>,
      this.connection.collection('hr_settings').findOne({ organizationId }),
      this.connection
        .collection('hr_holidays')
        .find({ organizationId }, { projection: { _id: 0, date: 1, halfDay: 1, recurring: 1 } })
        .toArray() as unknown as Promise<HolidayInput[]>,
    ]);
    const settings = hrSettingsViewOf(settingsDoc as Record<string, unknown> | null);
    const employees = rows.map(engineEmployeeOf);
    const target = employees.find((e) => e.status !== 'anonymized' && e.userId === userId) ?? null;
    let viewerIsManager = false;
    if (target !== null && viewerUserId !== userId) {
      // Portée de l'appelant SANS droit : seule la relation de manager compte ici.
      const scope = hrViewerScope({
        viewerUserId,
        employees,
        effectiveActions: [],
        settings: {
          teamCalendarVisibility: settings.teamCalendarVisibility,
          orgChartVisibility: settings.orgChartVisibility,
        },
      });
      viewerIsManager = scope.teamEmployeeIds.includes(target.id);
    }
    const absences: LeavePeriod[] =
      target === null
        ? []
        : (await this.approved(organizationId, [target.id], from, to)).map((r) => ({
            start: r.start,
            end: r.end,
          }));
    return {
      employeeLinked: target !== null,
      viewerIsManager,
      workPattern: target?.workPattern ?? settings.workPattern,
      absences,
      holidays: holidays.map((h) => ({
        date: h.date,
        halfDay: h.halfDay ?? null,
        recurring: h.recurring === true,
      })),
    };
  }
}
