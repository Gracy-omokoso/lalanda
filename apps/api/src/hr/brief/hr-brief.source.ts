// Fournisseur réel du port `HR_SOURCE` du brief du matin — ADR-0045 § 6.5. ADR-0045 — H5.
//
// LECTURE SEULE, dans l'organisation de la session seulement. Trois nombres, chacun
// derrière sa propre garde, décidée par la portée du moteur (`hrViewerScope`) sur les
// droits EFFECTIFS du membre, jamais sur un rôle :
//   - absences approuvées de la portée : l'organisation avec `hr.read`, l'équipe
//     (subordonnés directs et indirects) d'un manager ; sinon `null` (fait masqué) ;
//   - demandes que l'appelant peut traiter (lecteur partagé avec « Mes tâches ») :
//     manager ou `leave.approve` ; sinon `null` ;
//   - échéances RH (moteur `hrDeadlines`) : `hr.read` ; sinon `null`.
// Rien d'autre ne sort d'ici : ni nom, ni type d'absence, ni motif, ni montant. Le
// moteur du brief décide qui est absent « aujourd'hui » au jour de Kinshasa.

import {
  hrDeadlines,
  hrViewerScope,
  type BriefHrAbsenceInput,
  type BriefHrInput,
} from '@lalanda/engine';
import { addDays, kinshasaDayOf } from '@lalanda/shared/work';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import type { HrSource } from '../../morning-brief/morning-brief.ports.js';
import { HrLeaveApprovalsReader } from '../agenda/hr-leave-approvals.reader.js';
import type { EmployeeLean } from '../employees/employee.schema.js';
import { engineEmployeeOf } from '../scope/hr-scope.service.js';
import { hrSettingsViewOf } from '../settings/hr-settings.service.js';

/** Absences lues au plus pour un brief : un tableau de bord n'est pas un export. */
export const MAX_BRIEF_ABSENCES = 2000;

@Injectable()
export class HrBriefSource implements HrSource {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(HrLeaveApprovalsReader) private readonly approvals: HrLeaveApprovalsReader,
  ) {}

  async hrOf(
    organizationId: string,
    userId: string,
    actions: readonly string[],
    now: Date,
  ): Promise<BriefHrInput> {
    const [rows, settingsDoc] = await Promise.all([
      this.connection
        .collection('hr_employees')
        .find(
          { organizationId },
          {
            projection: {
              userId: 1,
              status: 1,
              startDate: 1,
              endDate: 1,
              probationEndDate: 1,
              contractEndDate: 1,
              contractType: 1,
              departmentId: 1,
              managerEmployeeId: 1,
              workPattern: 1,
              exitCategory: 1,
              sortName: 1,
            },
          },
        )
        .toArray() as unknown as Promise<EmployeeLean[]>,
      this.connection.collection('hr_settings').findOne({ organizationId }),
    ]);
    const settings = hrSettingsViewOf(settingsDoc as Record<string, unknown> | null);
    const employees = rows.map(engineEmployeeOf);
    const scope = hrViewerScope({
      viewerUserId: userId,
      employees,
      effectiveActions: actions,
      settings: {
        teamCalendarVisibility: settings.teamCalendarVisibility,
        orgChartVisibility: settings.orgChartVisibility,
      },
    });
    const today = kinshasaDayOf(now);

    // Portée des absences : toute l'organisation (`hr.read`) ou l'équipe d'un manager.
    const scoped = scope.seesAll
      ? employees.filter((e) => e.status === 'active').map((e) => e.id)
      : scope.teamEmployeeIds;
    const absencesVisible = scope.seesAll || scope.teamEmployeeIds.length > 0;

    const [absences, pending, deadlines] = await Promise.all([
      absencesVisible ? this.absencesOf(organizationId, scoped, today) : Promise.resolve(null),
      scope.holdsLeaveApprove || scope.isManager
        ? this.approvals
            .pendingFor(organizationId, userId, scope.holdsLeaveApprove)
            .then((p) => p.requests.length)
        : Promise.resolve(null),
      scope.seesAll
        ? this.deadlineCount(organizationId, employees, today, settings.reminders)
        : Promise.resolve(null),
    ]);
    return {
      status: 'known',
      absences: absences === null ? null : absences.items,
      pendingApprovalCount: pending,
      deadlineCount: deadlines,
      truncated: absences?.truncated ?? false,
    };
  }

  /**
   * Absences APPROUVÉES des collaborateurs donnés qui touchent la veille, le jour ou
   * le lendemain (marge de fuseau) ; le moteur garde celles d'aujourd'hui.
   */
  private async absencesOf(
    organizationId: string,
    employeeIds: readonly string[],
    today: string,
  ): Promise<{ items: BriefHrAbsenceInput[]; truncated: boolean }> {
    if (employeeIds.length === 0) return { items: [], truncated: false };
    const rows = (await this.connection
      .collection('hr_leave_requests')
      .find(
        {
          organizationId,
          status: 'approved',
          employeeId: { $in: [...employeeIds] },
          'start.date': { $lte: addDays(today, 1) },
          'end.date': { $gte: addDays(today, -1) },
        },
        // Ni type, ni motif : seulement qui et quand.
        { projection: { employeeId: 1, 'start.date': 1, 'end.date': 1 } },
      )
      .limit(MAX_BRIEF_ABSENCES + 1)
      .toArray()) as unknown as {
      employeeId: string;
      start: { date: string };
      end: { date: string };
    }[];
    return {
      items: rows.slice(0, MAX_BRIEF_ABSENCES).map((r) => ({
        employeeId: r.employeeId,
        startDate: r.start.date,
        endDate: r.end.date,
      })),
      truncated: rows.length > MAX_BRIEF_ABSENCES,
    };
  }

  /** Échéances RH (moteur `hrDeadlines`), sans jamais déchiffrer : `idExpiries` est en clair. */
  private async deadlineCount(
    organizationId: string,
    employees: ReturnType<typeof engineEmployeeOf>[],
    today: string,
    reminders: { probationEnd: number; contractEnd: number; documentExpiry: number },
  ): Promise<number> {
    const [documents, privates] = await Promise.all([
      this.connection
        .collection('hr_documents')
        .find(
          { organizationId, expiresOn: { $nin: [null, ''] } },
          { projection: { employeeId: 1, expiresOn: 1, deletedAt: 1 } },
        )
        .toArray(),
      this.connection
        .collection('hr_employee_private')
        .find(
          { organizationId, 'idExpiries.0': { $exists: true } },
          { projection: { employeeId: 1, idExpiries: 1 } },
        )
        .toArray(),
    ]);
    const result = hrDeadlines(
      employees,
      documents.map((d) => ({
        id: String(d['_id']),
        employeeId: String(d['employeeId']),
        expiresOn: String(d['expiresOn']),
        deleted: d['deletedAt'] !== null && d['deletedAt'] !== undefined,
      })),
      privates.flatMap((p) =>
        ((p['idExpiries'] ?? []) as { kind: string; expiresOn: string }[]).map((x) => ({
          employeeId: String(p['employeeId']),
          kind: x.kind,
          expiresOn: x.expiresOn,
        })),
      ),
      today,
      reminders,
    );
    return result.total;
  }
}
