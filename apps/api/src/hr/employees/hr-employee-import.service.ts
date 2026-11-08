// Import du personnel existant (.xlsx ou .csv) — ADR-0068 § 4.
//
// Lecture : `readTable` d'ADR-0062 (même contrôle zip, sans formule ni macro, 2 Mo,
// lignes plafonnées). Validation ligne par ligne, en français : une ERREUR écarte la
// ligne (nom, poste, date d'entrée, contrat, e-mail, matricule en double ou déjà
// porté) ; un AVERTISSEMENT signale une correction (service inconnu → sans service).
// L'application crée chaque ligne valide par le service des fiches (même règles, même
// audit) : les matricules du fichier sont CONSERVÉS et poussent le compteur, les autres
// sont attribués. Invitation en masse : même règle que la fiche (`members.invite`).

import {
  CreateEmployeeBody,
  EMPLOYEE_IMPORT_FIELDS,
  employeeNumberKey,
  type EmployeeImportField,
  type EmployeeImportIssue,
  type EmployeeImportPreview,
  type EmployeeImportResult,
  type EmployeeImportRowView,
} from '@lalanda/shared/hr';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { normalizeLabel } from '../../work/work-plan-builder.js';
import { parseDay, readTable, type ImportTable } from '../../work/work-import.parser.js';
import { HrDepartmentsService, type HrActor } from '../departments/hr-departments.service.js';
import { HrSettingsService } from '../settings/hr-settings.service.js';
import { Employee, type EmployeeDocument } from './employee.schema.js';
import {
  HrEmployeeInvitationsService,
  type HrInviteActor,
} from './hr-employee-invitations.service.js';
import { HrEmployeesService } from './hr-employees.service.js';

/** En-têtes du modèle, dans l'ordre. */
export const EMPLOYEE_IMPORT_COLUMNS: readonly { field: EmployeeImportField; header: string }[] = [
  { field: 'employeeNumber', header: 'Matricule' },
  { field: 'lastName', header: 'Nom' },
  { field: 'firstName', header: 'Prénom' },
  { field: 'jobTitle', header: 'Poste' },
  { field: 'department', header: 'Service' },
  { field: 'contractType', header: 'Type de contrat' },
  { field: 'startDate', header: 'Date d’entrée' },
  { field: 'contractEndDate', header: 'Fin de contrat' },
  { field: 'workEmail', header: 'E-mail professionnel' },
  { field: 'workPhone', header: 'Téléphone professionnel' },
  { field: 'workLocation', header: 'Lieu de travail' },
];

const ALIASES: Record<EmployeeImportField, readonly string[]> = {
  employeeNumber: [
    'matricule',
    'n matricule',
    'no matricule',
    'numero matricule',
    'mat',
    'employee number',
    'employee id',
  ],
  lastName: ['nom', 'nom de famille', 'last name', 'surname'],
  firstName: ['prenom', 'prenoms', 'first name'],
  jobTitle: ['poste', 'fonction', 'intitule du poste', 'job title', 'emploi'],
  department: ['service', 'departement', 'direction', 'department'],
  contractType: ['type de contrat', 'contrat', 'contract', 'contract type'],
  startDate: [
    'date d entree',
    'date entree',
    'entree',
    'date d embauche',
    'embauche',
    'start date',
  ],
  contractEndDate: ['fin de contrat', 'date de fin', 'date fin contrat', 'end date'],
  workEmail: [
    'e mail professionnel',
    'email professionnel',
    'e mail',
    'email',
    'courriel',
    'adresse e mail',
    'adresse email',
  ],
  workPhone: ['telephone professionnel', 'telephone', 'tel', 'phone', 'gsm'],
  workLocation: ['lieu de travail', 'lieu', 'site', 'ville'],
};

function headerKey(raw: string): string {
  return normalizeLabel(raw)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function importFieldOf(raw: string): EmployeeImportField | null {
  const k = headerKey(raw);
  for (const field of EMPLOYEE_IMPORT_FIELDS) {
    if (
      ALIASES[field].includes(k) ||
      headerKey(EMPLOYEE_IMPORT_COLUMNS.find((c) => c.field === field)!.header) === k
    ) {
      return field;
    }
  }
  return null;
}

/** Modèle CSV (« ; », UTF-8 avec BOM) : en-têtes et une ligne d'exemple inventée. */
export function buildEmployeeImportTemplateCsv(): string {
  const head = EMPLOYEE_IMPORT_COLUMNS.map((c) => c.header).join(';');
  const example = [
    '',
    'Mbuyi',
    'Aline',
    'Assistante administrative',
    'Administration',
    'CDI',
    '05/01/2026',
    '',
    'aline.mbuyi@exemple.cd',
    '+243 810 000 000',
    'Kinshasa',
  ].join(';');
  return `\uFEFF${head}\r\n${example}\r\n`;
}

interface PreparedRow {
  view: EmployeeImportRowView;
  body: CreateEmployeeBody | null;
}

const FIELD_OF_PATH: Record<string, EmployeeImportField> = {
  firstName: 'firstName',
  lastName: 'lastName',
  jobTitle: 'jobTitle',
  employeeNumber: 'employeeNumber',
  contractType: 'contractType',
  startDate: 'startDate',
  contractEndDate: 'contractEndDate',
  workEmail: 'workEmail',
  workPhone: 'workPhone',
  workLocation: 'workLocation',
  departmentId: 'department',
};

@Injectable()
export class HrEmployeeImportService {
  constructor(
    @InjectModel(Employee.name) private readonly employees: Model<EmployeeDocument>,
    @Inject(HrEmployeesService) private readonly fiches: HrEmployeesService,
    @Inject(HrEmployeeInvitationsService)
    private readonly invitations: HrEmployeeInvitationsService,
    @Inject(HrDepartmentsService) private readonly departments: HrDepartmentsService,
    @Inject(HrSettingsService) private readonly settings: HrSettingsService,
  ) {}

  private async prepare(
    organizationId: string,
    buf: Buffer,
  ): Promise<{
    table: ImportTable;
    columns: EmployeeImportPreview['columns'];
    rows: PreparedRow[];
  }> {
    const table = await readTable(buf);
    const fields = table.headers.map((h) => importFieldOf(h));
    const columns = table.headers.map((header, i) => ({ header, field: fields[i] ?? null }));
    const col = (field: EmployeeImportField): number => fields.indexOf(field);

    const [departments, settings, takenKeys] = await Promise.all([
      this.departments.all(organizationId),
      this.settings.view(organizationId),
      this.employees
        .distinct('employeeNumberKey', { organizationId, employeeNumberKey: { $type: 'string' } })
        .exec() as Promise<string[]>,
    ]);
    const deptByName = new Map(
      departments.filter((d) => d.active).map((d) => [normalizeLabel(d.name), String(d._id)]),
    );
    const activeTypes = settings.contractTypes.filter((t) => t.active);
    const typeOf = (raw: string): string | null => {
      const k = normalizeLabel(raw);
      return (
        activeTypes.find((t) => t.key === raw.trim() || normalizeLabel(t.label) === k)?.key ?? null
      );
    };
    const defaultType = activeTypes.find((t) => !t.hasEndDate)?.key ?? activeTypes[0]?.key ?? '';
    const taken = new Set(takenKeys);
    const inFile = new Map<string, number>();

    const rows: PreparedRow[] = table.rows.map(({ row, cells }) => {
      const cell = (field: EmployeeImportField): string => {
        const i = col(field);
        return i < 0 ? '' : (cells[i] ?? '').trim();
      };
      const issues: EmployeeImportIssue[] = [];
      const error = (field: EmployeeImportField | null, message: string) =>
        issues.push({ level: 'error', field, message });

      const employeeNumber = cell('employeeNumber') || null;
      if (employeeNumber) {
        const key = employeeNumberKey(employeeNumber);
        if (taken.has(key))
          error('employeeNumber', 'Ce matricule est déjà porté (ou réservé) dans l’organisation.');
        else if (inFile.has(key)) {
          error(
            'employeeNumber',
            `Matricule en double dans le fichier (ligne ${inFile.get(key)}).`,
          );
        } else inFile.set(key, row);
      }

      let departmentId: string | null = null;
      const departmentName = cell('department') || null;
      if (departmentName) {
        departmentId = deptByName.get(normalizeLabel(departmentName)) ?? null;
        if (!departmentId) {
          issues.push({
            level: 'warning',
            field: 'department',
            message: `Service « ${departmentName} » inconnu : la fiche sera créée sans service.`,
          });
        }
      }

      const rawType = cell('contractType');
      let contractType: string | null = rawType ? typeOf(rawType) : defaultType;
      if (rawType && !contractType) {
        error('contractType', `Type de contrat « ${rawType} » inconnu de l’organisation.`);
        contractType = null;
      }

      const day = (field: 'startDate' | 'contractEndDate'): string | null => {
        const raw = cell(field);
        const d = parseDay(raw);
        if (d === undefined) {
          error(field, `Date illisible « ${raw} » : attendu JJ/MM/AAAA.`);
          return null;
        }
        return d;
      };
      const startDate = day('startDate');
      const contractEndDate = day('contractEndDate');
      if (startDate === null && !issues.some((i) => i.field === 'startDate')) {
        error('startDate', 'Date d’entrée obligatoire.');
      }

      const candidate = {
        firstName: cell('firstName'),
        lastName: cell('lastName'),
        jobTitle: cell('jobTitle'),
        contractType: contractType ?? '',
        startDate: startDate ?? '',
        ...(employeeNumber ? { employeeNumber } : {}),
        ...(contractEndDate ? { contractEndDate } : {}),
        ...(departmentId ? { departmentId } : {}),
        ...(cell('workEmail') ? { workEmail: cell('workEmail') } : {}),
        ...(cell('workPhone') ? { workPhone: cell('workPhone') } : {}),
        ...(cell('workLocation') ? { workLocation: cell('workLocation') } : {}),
      };
      const parsed = CreateEmployeeBody.safeParse(candidate);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const field = FIELD_OF_PATH[String(issue.path[0] ?? '')] ?? null;
          // Date et contrat déjà signalés en français ci-dessus.
          if (field && issues.some((i) => i.level === 'error' && i.field === field)) continue;
          error(field, issue.message);
        }
      }
      if (contractType && contractEndDate === null) {
        const type = activeTypes.find((t) => t.key === contractType);
        if (type?.hasEndDate) {
          error(
            'contractEndDate',
            `Une date de fin est attendue pour un contrat « ${type.label} ».`,
          );
        }
      }
      if (startDate && contractEndDate && contractEndDate < startDate) {
        error('contractEndDate', 'La fin de contrat précède la date d’entrée.');
      }
      const valid = !issues.some((i) => i.level === 'error');
      return {
        view: {
          row,
          valid,
          firstName: candidate.firstName,
          lastName: candidate.lastName,
          employeeNumber,
          jobTitle: candidate.jobTitle,
          departmentName: departmentId ? departmentName : null,
          contractType,
          startDate,
          workEmail: cell('workEmail') || null,
          issues,
        },
        body: valid && parsed.success ? parsed.data : null,
      };
    });
    return { table, columns, rows };
  }

  async preview(organizationId: string, buf: Buffer): Promise<EmployeeImportPreview> {
    const { table, columns, rows } = await this.prepare(organizationId, buf);
    return this.previewOf(table, columns, rows);
  }

  /** Crée les lignes valides ; chacune seule (pas de transaction globale). */
  async apply(
    organizationId: string,
    buf: Buffer,
    options: { invite: boolean; skipInvalid: boolean },
    actor: HrInviteActor,
  ): Promise<EmployeeImportResult | { blocked: EmployeeImportPreview }> {
    const { table, columns, rows } = await this.prepare(organizationId, buf);
    const invalid = rows.filter((r) => r.body === null);
    if (invalid.length > 0 && !options.skipInvalid) {
      return { blocked: this.previewOf(table, columns, rows) };
    }
    const created: EmployeeImportResult['created'] = [];
    const skippedRows = invalid.map((r) => r.view.row);
    const hrActor: HrActor = { userId: actor.userId, role: actor.role };
    for (const r of rows) {
      if (!r.body) continue;
      try {
        const view = await this.fiches.create(organizationId, r.body, hrActor);
        let invitation: EmployeeImportResult['created'][number]['invitation'] = 'not_requested';
        if (options.invite) {
          invitation = (await this.invitations.invite(organizationId, view.id, actor)).outcome;
        }
        created.push({
          row: r.view.row,
          employeeId: view.id,
          employeeNumber: view.employeeNumber,
          invitation,
        });
      } catch (err) {
        // Refus métier (matricule saisi entre l'aperçu et l'application, service archivé…) :
        // la ligne est sautée et listée. Toute autre panne remonte.
        if (!(err instanceof HttpException)) throw err;
        skippedRows.push(r.view.row);
      }
    }
    return { created, skippedRows: skippedRows.sort((a, b) => a - b) };
  }

  private previewOf(
    table: ImportTable,
    columns: EmployeeImportPreview['columns'],
    rows: PreparedRow[],
  ): EmployeeImportPreview {
    const views = rows.map((r) => r.view);
    return {
      format: table.format,
      columns,
      rows: views,
      counts: {
        total: views.length,
        valid: views.filter((v) => v.valid).length,
        invalid: views.filter((v) => !v.valid).length,
        warnings: views.filter((v) => v.issues.some((i) => i.level === 'warning')).length,
      },
    };
  }
}
