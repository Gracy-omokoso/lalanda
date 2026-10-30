// Rapports RH et registre du personnel — ADR-0045 § 3.3, § 7. ADR-0045 — H5.
//
// TOUS les chiffres viennent du moteur RH : `headcount`, `movements` (taux de sortie,
// indicateur Lalanda), `absenteeism` (PAR SERVICE, jamais par personne), `seniority`.
// Lectures limitées aux fiches (`hr_employees`, projection explicite), demandes
// approuvées (type et dates, jamais le motif), types (drapeau d'absentéisme), fériés et
// services : AUCUNE lecture de `hr_employee_private`, aucun salaire, aucun type
// d'absence nommé dans la réponse.
//
// Registre CSV : `hr.read` + `report.export`, colonnes non sensibles, sans note libre ;
// séparateur « ; », BOM, formules neutralisées (`toCsv`, motif du CSV du CRM) ; audit
// STRICT `hr.register.exported` écrit AVANT l'envoi (sans trace, pas de fichier).

import {
  absenteeism,
  employeeStatusOf,
  headcount,
  HR_VERSION,
  movements,
  seniority,
  type HrEmployeeInput,
} from '@lalanda/engine';
import {
  HR_REGISTER_COLUMNS,
  type HrRegisterExportQuery,
  type HrReportCount,
  type HrReportsQuery,
  type HrReportsView,
} from '@lalanda/shared/hr';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { toCsv } from '../../crm/crm-csv.js';
import type { CsvFile } from '../../crm/crm-csv.service.js';
import type { HrActor } from '../departments/hr-departments.service.js';
import {
  Department,
  type DepartmentDocument,
  type DepartmentLean,
} from '../departments/department.schema.js';
import {
  Employee,
  type EmployeeDocument,
  type EmployeeLean,
} from '../employees/employee.schema.js';
import { Holiday, type HolidayDocument, type HolidayLean } from '../holidays/holiday.schema.js';
import { displayNameOf } from '../leave/display-name.js';
import {
  LeaveRequest,
  type LeaveRequestDocument,
  type LeaveRequestLean,
} from '../leave/leave-request.schema.js';
import {
  LeaveType,
  type LeaveTypeDocument,
  type LeaveTypeLean,
} from '../leave/leave-type.schema.js';
import { departmentNotFound, hrToday } from '../scope/hr-errors.js';
import { engineEmployeeOf } from '../scope/hr-scope.service.js';
import { HrSettingsService } from '../settings/hr-settings.service.js';

/** Projection des fiches : champs NON sensibles du registre et des calculs. */
const EMPLOYEE_FIELDS = {
  firstName: 1,
  lastName: 1,
  preferredName: 1,
  sortName: 1,
  employeeNumber: 1,
  userId: 1,
  jobTitle: 1,
  departmentId: 1,
  managerEmployeeId: 1,
  contractType: 1,
  startDate: 1,
  probationEndDate: 1,
  contractEndDate: 1,
  endDate: 1,
  exitCategory: 1,
  status: 1,
  workPattern: 1,
  workLocation: 1,
} as const;

const NO_DEPARTMENT = 'Sans service';
const NO_CONTRACT = 'Sans type de contrat';

const STATUS_LABELS: Record<string, string> = {
  upcoming: 'À venir',
  probation: 'En période d’essai',
  active: 'Actif',
  exited: 'Sorti',
  anonymized: 'Anonymisé',
};

const EXIT_LABELS: Record<string, string> = {
  resignation: 'Démission',
  end_of_contract: 'Fin de contrat',
  dismissal: 'Licenciement',
  mutual_agreement: 'Rupture d’un commun accord',
  retirement: 'Retraite',
  death: 'Décès',
  other: 'Autre',
};

@Injectable()
export class HrReportsService {
  constructor(
    @InjectModel(Employee.name) private readonly employees: Model<EmployeeDocument>,
    @InjectModel(Department.name) private readonly departments: Model<DepartmentDocument>,
    @InjectModel(LeaveRequest.name) private readonly requests: Model<LeaveRequestDocument>,
    @InjectModel(LeaveType.name) private readonly types: Model<LeaveTypeDocument>,
    @InjectModel(Holiday.name) private readonly holidays: Model<HolidayDocument>,
    @Inject(HrSettingsService) private readonly settings: HrSettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Fiches de l'organisation, au besoin d'un seul service (404 pour un service d'ailleurs). */
  private async load(
    organizationId: string,
    departmentId: string | undefined,
  ): Promise<{ employees: EmployeeLean[]; departments: DepartmentLean[] }> {
    const departments = await this.departments
      .find({ organizationId }, { name: 1, parentId: 1, active: 1 })
      .lean<DepartmentLean[]>()
      .exec();
    if (departmentId !== undefined && !departments.some((d) => String(d._id) === departmentId)) {
      departmentNotFound();
    }
    const employees = await this.employees
      .find(
        { organizationId, ...(departmentId === undefined ? {} : { departmentId }) },
        EMPLOYEE_FIELDS,
      )
      .sort({ sortName: 1, _id: 1 })
      .lean<EmployeeLean[]>()
      .exec();
    return { employees, departments };
  }

  async reports(organizationId: string, query: HrReportsQuery): Promise<HrReportsView> {
    const [{ employees, departments }, settings] = await Promise.all([
      this.load(organizationId, query.departmentId),
      this.settings.view(organizationId),
    ]);
    const ids = employees.map((e) => String(e._id));
    const [requests, types, holidays] = await Promise.all([
      ids.length === 0
        ? []
        : this.requests
            .find(
              {
                organizationId,
                status: 'approved',
                employeeId: { $in: ids },
                'start.date': { $lte: query.to },
                'end.date': { $gte: query.from },
              },
              // Ni motif ni pièce : le type ne sert qu'au drapeau d'absentéisme.
              { employeeId: 1, typeId: 1, start: 1, end: 1, status: 1, days: 1 },
            )
            .lean<LeaveRequestLean[]>()
            .exec(),
      this.types
        .find({ organizationId }, { countsAsAbsenteeism: 1 })
        .lean<LeaveTypeLean[]>()
        .exec(),
      this.holidays
        .find({ organizationId }, { date: 1, halfDay: 1, recurring: 1 })
        .lean<HolidayLean[]>()
        .exec(),
    ]);
    const engine: HrEmployeeInput[] = employees.map(engineEmployeeOf);
    const deptName = new Map(departments.map((d) => [String(d._id), d.name]));
    const contractLabel = new Map(settings.contractTypes.map((c) => [c.key, c.label]));
    const label = (key: string | null, names: Map<string, string>, none: string): string =>
      key === null ? none : (names.get(key) ?? key);

    const byDept = headcount(engine, query.to, 'department');
    const byContract = headcount(engine, query.to, 'contract_type');
    const moves = movements(engine, query.from, query.to);
    const abs = absenteeism(
      requests.map((r) => ({
        id: String(r._id),
        days: r.days,
        employeeId: r.employeeId,
        typeId: r.typeId,
        status: r.status,
        start: r.start,
        end: r.end,
      })),
      types.map((t) => ({
        id: String(t._id),
        countsAsAbsenteeism: t.countsAsAbsenteeism === true,
      })),
      engine,
      holidays.map((h) => ({
        date: h.date,
        halfDay: h.halfDay ?? null,
        recurring: h.recurring === true,
      })),
      query.from,
      query.to,
      settings.workPattern,
    );
    const sen = seniority(engine, query.to);
    const counts = (
      groups: { key: string | null; count: number }[],
      names: Map<string, string>,
      none: string,
    ): HrReportCount[] =>
      groups.map((g) => ({ key: g.key, label: label(g.key, names, none), count: g.count }));

    return {
      version: HR_VERSION,
      from: query.from,
      to: query.to,
      departmentId: query.departmentId ?? null,
      headcount: {
        asOf: byDept.asOf,
        total: byDept.total,
        byDepartment: counts(byDept.groups, deptName, NO_DEPARTMENT),
        byContractType: counts(byContract.groups, contractLabel, NO_CONTRACT),
      },
      movements: {
        entries: moves.entries,
        exits: moves.exits,
        exitsByCategory: moves.exitsByCategory,
        averageHeadcount: moves.averageHeadcount,
        exitRatePercent: moves.exitRatePercent,
      },
      absenteeism: {
        groups: abs.groups.map((g) => ({
          ...g,
          label: label(g.departmentId, deptName, NO_DEPARTMENT),
        })),
        total: abs.total,
      },
      seniority: { asOf: sen.asOf, total: sen.total, buckets: sen.buckets },
    };
  }

  /** Registre non sensible (CSV) ; audit STRICT avant de rendre le fichier. */
  async exportRegister(
    organizationId: string,
    query: HrRegisterExportQuery,
    actor: HrActor,
    now = new Date(),
  ): Promise<CsvFile> {
    const [{ employees, departments }, settings] = await Promise.all([
      this.load(organizationId, query.departmentId),
      this.settings.view(organizationId),
    ]);
    const today = hrToday(now);
    const deptName = new Map(departments.map((d) => [String(d._id), d.name]));
    const contractLabel = new Map(settings.contractTypes.map((c) => [c.key, c.label]));
    // Le manager peut appartenir à un autre service : on le lit dans toute l'organisation.
    const managerIds = [
      ...new Set(employees.map((e) => e.managerEmployeeId).filter((m): m is string => !!m)),
    ];
    const managers =
      managerIds.length === 0
        ? []
        : await this.employees
            .find(
              { organizationId, _id: { $in: managerIds } },
              { firstName: 1, lastName: 1, preferredName: 1 },
            )
            .lean<EmployeeLean[]>()
            .exec();
    const managerName = new Map(managers.map((m) => [String(m._id), displayNameOf(m)]));
    const rows = employees.map((e) => [
      e.employeeNumber ?? null,
      e.lastName,
      e.firstName,
      e.preferredName ?? null,
      e.jobTitle,
      e.departmentId ? (deptName.get(e.departmentId) ?? null) : null,
      e.managerEmployeeId ? (managerName.get(e.managerEmployeeId) ?? null) : null,
      contractLabel.get(e.contractType) ?? e.contractType,
      e.startDate,
      e.probationEndDate ?? null,
      e.contractEndDate ?? null,
      e.endDate ?? null,
      e.exitCategory ? (EXIT_LABELS[e.exitCategory] ?? e.exitCategory) : null,
      STATUS_LABELS[employeeStatusOf(engineEmployeeOf(e), today)] ?? e.status,
      e.workLocation ?? null,
    ]);
    // Sans trace, pas de fichier (docs/12 R4, `report.export`).
    await this.audit.recordStrict({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.register.exported',
      targetType: 'hr_register',
      targetId: organizationId,
      metadata: { rows: rows.length, departmentId: query.departmentId ?? null },
    });
    return { fileName: `registre-personnel-${today}.csv`, body: toCsv(HR_REGISTER_COLUMNS, rows) };
  }
}
