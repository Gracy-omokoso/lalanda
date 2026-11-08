// Import du personnel existant (.xlsx ou .csv) — ADR-0068 § 4.
//
// Lecture : `readTable` d'ADR-0062 (même contrôle zip, sans formule ni macro, 2 Mo,
// lignes plafonnées). Validation ligne par ligne, en français : une ERREUR écarte la
// ligne (nom, poste, date d'entrée, contrat, e-mail, matricule en double ou déjà
// porté) ; un AVERTISSEMENT signale une correction (service inconnu → sans service).
// L'application crée chaque ligne valide par le service des fiches (même règles, même
// audit) : les matricules du fichier sont CONSERVÉS et poussent le compteur, les autres
// sont attribués. Invitation en masse : même règle que la fiche (`members.invite`).
//
// Amendement du 8 nov. 2026 : colonne « Service » (service créé si l'option est
// cochée), colonne « Manager » (matricule ou e-mail d'un existant OU d'une ligne du
// fichier ; moteur `resolveImportManagers`, deux passes, cycles refusés), modèle XLSX.

import { resolveImportManagers, type ImportManagerIssue } from '@lalanda/engine';
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
import ExcelJS from 'exceljs';
import type { Model } from 'mongoose';

import { normalizeLabel } from '../../work/work-plan-builder.js';
import { parseDay, readTable, type ImportTable } from '../../work/work-import.parser.js';
import { HrDepartmentsService, type HrActor } from '../departments/hr-departments.service.js';
import { HrSettingsService } from '../settings/hr-settings.service.js';
import { Employee, type EmployeeDocument, type EmployeeLean } from './employee.schema.js';
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
  { field: 'manager', header: 'Manager (matricule ou e-mail)' },
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
  manager: [
    'manager',
    'responsable',
    'responsable hierarchique',
    'superieur hierarchique',
    'superieur',
    'chef',
    'n 1',
    'matricule du manager',
    'e mail du manager',
  ],
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

/** Lignes d'exemple inventées (la seconde a pour manager la première, du même fichier). */
const TEMPLATE_EXAMPLES: readonly (readonly string[])[] = [
  [
    '',
    'Mbuyi',
    'Aline',
    'Responsable administrative',
    'Administration',
    '',
    'CDI',
    '05/01/2026',
    '',
    'aline.mbuyi@exemple.cd',
    '+243 810 000 000',
    'Kinshasa',
  ],
  [
    '',
    'Kasongo',
    'Paul',
    'Assistant administratif',
    'Administration',
    'aline.mbuyi@exemple.cd',
    'CDD',
    '02/02/2026',
    '31/01/2027',
    '',
    '',
    'Kinshasa',
  ],
];

/** Modèle CSV (« ; », UTF-8 avec BOM) : en-têtes et deux lignes d'exemple inventées. */
export function buildEmployeeImportTemplateCsv(): string {
  const head = EMPLOYEE_IMPORT_COLUMNS.map((c) => c.header).join(';');
  const lines = TEMPLATE_EXAMPLES.map((r) => r.join(';'));
  return `\uFEFF${[head, ...lines].join('\r\n')}\r\n`;
}

const TEMPLATE_GUIDE: Record<EmployeeImportField, string> = {
  employeeNumber: 'Facultatif. Conservé tel quel ; vide : attribué automatiquement.',
  lastName: 'Obligatoire.',
  firstName: 'Obligatoire.',
  jobTitle: 'Obligatoire. Intitulé affiché sur la fiche.',
  department: 'Facultatif. Nom d’un service existant ; inconnu : créé si l’option est cochée.',
  manager:
    'Facultatif. Matricule ou e-mail professionnel d’un collaborateur existant ou d’une autre ligne du fichier.',
  contractType: 'Facultatif. Type de contrat de l’organisation (CDI, CDD…) ; vide : CDI.',
  startDate: 'Obligatoire. JJ/MM/AAAA.',
  contractEndDate: 'Obligatoire pour un contrat à durée déterminée. JJ/MM/AAAA.',
  workEmail: 'Facultatif. Sert à l’invitation sur Lalanda.',
  workPhone: 'Facultatif.',
  workLocation: 'Facultatif.',
};

/** Modèle .xlsx (onglets « Guide » puis « Collaborateurs ») ; `exceljs`, déjà dépendance. */
export async function buildEmployeeImportTemplateXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Lalanda';
  wb.created = new Date(Date.UTC(2026, 10, 8));
  const guide = wb.addWorksheet('Guide');
  guide.columns = [{ width: 32 }, { width: 100 }];
  guide.addRow(['Importer des collaborateurs dans Lalanda']).font = { bold: true, size: 14 };
  guide.addRow([
    'Mode d’emploi',
    'Remplissez l’onglet « Collaborateurs » : une ligne par personne, sans changer la ligne d’en-tête. Lalanda affiche un aperçu avec les erreurs ligne par ligne AVANT de créer quoi que ce soit.',
  ]);
  guide.addRow([
    'Limites',
    '2 Mo au plus. Pas de formule ni de macro : seules les valeurs sont lues.',
  ]);
  guide.addRow([]);
  guide.addRow(['Colonne', 'Règle']).font = { bold: true };
  for (const c of EMPLOYEE_IMPORT_COLUMNS) guide.addRow([c.header, TEMPLATE_GUIDE[c.field]]);
  guide.eachRow((r) => {
    r.alignment = { wrapText: true, vertical: 'top' };
  });
  const sheet = wb.addWorksheet('Collaborateurs');
  sheet.columns = EMPLOYEE_IMPORT_COLUMNS.map((c) => ({ header: c.header, width: 24 }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of TEMPLATE_EXAMPLES) sheet.addRow([...r]);
  // Matricules et dates restent du TEXTE : aucune conversion régionale d'Excel.
  EMPLOYEE_IMPORT_COLUMNS.forEach((c, i) => {
    if (['employeeNumber', 'startDate', 'contractEndDate'].includes(c.field)) {
      sheet.getColumn(i + 1).numFmt = '@';
    }
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const MANAGER_MESSAGES: Record<ImportManagerIssue, string> = {
  MANAGER_NOT_FOUND:
    'Manager introuvable : matricule ou e-mail d’un collaborateur existant ou d’une ligne du fichier attendu.',
  MANAGER_AMBIGUOUS: 'Manager ambigu : cette référence désigne plusieurs personnes.',
  MANAGER_NOT_ACTIVE: 'Ce manager n’est plus un collaborateur actif.',
  MANAGER_SELF: 'Une personne ne peut pas être son propre manager.',
  MANAGER_ROW_INVALID: 'La ligne du manager est écartée : corrigez-la d’abord.',
  MANAGER_CYCLE: 'Cycle hiérarchique : ce manager dépend lui-même de cette personne.',
};

export interface EmployeeImportPrepareOptions {
  createDepartments: boolean;
}

interface PreparedRow {
  view: EmployeeImportRowView;
  body: CreateEmployeeBody | null;
  /** Service à créer (option cochée), nom tel que lu. */
  departmentToCreate: string | null;
  /** Manager = autre ligne du fichier (posé en seconde passe). */
  managerRow: number | null;
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
    options: EmployeeImportPrepareOptions,
  ): Promise<{
    table: ImportTable;
    columns: EmployeeImportPreview['columns'];
    rows: PreparedRow[];
  }> {
    const table = await readTable(buf);
    const fields = table.headers.map((h) => importFieldOf(h));
    const columns = table.headers.map((header, i) => ({ header, field: fields[i] ?? null }));
    const col = (field: EmployeeImportField): number => fields.indexOf(field);

    const [departments, settings, takenKeys, people] = await Promise.all([
      this.departments.all(organizationId),
      this.settings.view(organizationId),
      this.employees
        .distinct('employeeNumberKey', { organizationId, employeeNumberKey: { $type: 'string' } })
        .exec() as Promise<string[]>,
      this.employees
        .find(
          { organizationId, status: { $ne: 'anonymized' } },
          {
            firstName: 1,
            lastName: 1,
            preferredName: 1,
            employeeNumber: 1,
            workEmail: 1,
            managerEmployeeId: 1,
            status: 1,
          },
        )
        .lean<EmployeeLean[]>()
        .exec(),
    ]);
    const deptByName = new Map(
      departments.filter((d) => d.active).map((d) => [normalizeLabel(d.name), String(d._id)]),
    );
    const archivedNames = new Set(
      departments.filter((d) => !d.active).map((d) => normalizeLabel(d.name)),
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

    const managerRefs = new Map<number, string | null>();
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
      let departmentToCreate: string | null = null;
      const departmentName = cell('department') || null;
      if (departmentName) {
        const key = normalizeLabel(departmentName);
        departmentId = deptByName.get(key) ?? null;
        if (!departmentId && archivedNames.has(key)) {
          issues.push({
            level: 'warning',
            field: 'department',
            message: `Service « ${departmentName} » archivé : la fiche sera créée sans service.`,
          });
        } else if (!departmentId && options.createDepartments) {
          departmentToCreate = departmentName;
          issues.push({
            level: 'warning',
            field: 'department',
            message: `Service « ${departmentName} » inconnu : il sera créé à l’import.`,
          });
        } else if (!departmentId) {
          issues.push({
            level: 'warning',
            field: 'department',
            message: `Service « ${departmentName} » inconnu : la fiche sera créée sans service (ou cochez « Créer les services inconnus »).`,
          });
        }
      }
      managerRefs.set(row, cell('manager') || null);

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
          departmentName: departmentId || departmentToCreate ? departmentName : null,
          contractType,
          startDate,
          workEmail: cell('workEmail') || null,
          newDepartment: departmentToCreate !== null,
          managerRef: managerRefs.get(row) ?? null,
          manager: { kind: 'none' },
          issues,
        },
        body: valid && parsed.success ? parsed.data : null,
        departmentToCreate,
        managerRow: null,
      };
    });

    // Colonne « Manager » : deux passes du moteur (existants, puis lignes du fichier).
    const byId = new Map(people.map((e) => [String(e._id), e]));
    const { verdicts } = resolveImportManagers(
      people.map((e) => ({
        id: String(e._id),
        managerEmployeeId: e.managerEmployeeId ?? null,
        employeeNumber: e.employeeNumber ?? null,
        workEmail: e.workEmail ?? null,
        active: e.status === 'active',
      })),
      rows.map((r) => ({
        row: r.view.row,
        valid: r.view.valid,
        employeeNumber: r.view.employeeNumber,
        workEmail: r.view.workEmail,
        managerRef: r.view.managerRef,
      })),
    );
    verdicts.forEach((v, i) => {
      const r = rows[i]!;
      if (v.kind === 'error') {
        r.view.issues.push({
          level: 'error',
          field: 'manager',
          message: MANAGER_MESSAGES[v.issue],
        });
        r.view.valid = false;
        r.body = null;
      } else if (v.kind === 'existing') {
        const e = byId.get(v.employeeId)!;
        r.view.manager = {
          kind: 'existing',
          employeeId: v.employeeId,
          displayName: e.preferredName ?? `${e.firstName} ${e.lastName}`,
        };
        if (r.body) r.body = { ...r.body, managerEmployeeId: v.employeeId };
      } else if (v.kind === 'row') {
        r.view.manager = { kind: 'row', row: v.managerRow };
        r.managerRow = v.managerRow;
      }
    });
    return { table, columns, rows };
  }

  async preview(
    organizationId: string,
    buf: Buffer,
    options: EmployeeImportPrepareOptions = { createDepartments: false },
  ): Promise<EmployeeImportPreview> {
    const { table, columns, rows } = await this.prepare(organizationId, buf, options);
    return this.previewOf(table, columns, rows);
  }

  /**
   * Crée les lignes valides ; chacune seule (pas de transaction globale). Passe 1 :
   * services à créer, puis fiches (manager existant posé à la création). Passe 2 :
   * manager qui est une ligne du fichier, par la modification ordinaire.
   */
  async apply(
    organizationId: string,
    buf: Buffer,
    options: { invite: boolean; skipInvalid: boolean; createDepartments?: boolean },
    actor: HrInviteActor,
  ): Promise<EmployeeImportResult | { blocked: EmployeeImportPreview }> {
    const { table, columns, rows } = await this.prepare(organizationId, buf, {
      createDepartments: options.createDepartments === true,
    });
    const invalid = rows.filter((r) => r.body === null);
    if (invalid.length > 0 && !options.skipInvalid) {
      return { blocked: this.previewOf(table, columns, rows) };
    }
    const created: EmployeeImportResult['created'] = [];
    const skippedRows = invalid.map((r) => r.view.row);
    const hrActor: HrActor = { userId: actor.userId, role: actor.role };

    // Services inconnus, un par nom, seulement pour des lignes retenues.
    const createdDepartments: string[] = [];
    const newDept = new Map<string, string>();
    for (const r of rows) {
      if (!r.body || !r.departmentToCreate) continue;
      const key = normalizeLabel(r.departmentToCreate);
      if (newDept.has(key)) continue;
      try {
        const d = await this.departments.create(
          organizationId,
          { name: r.departmentToCreate },
          hrActor,
        );
        newDept.set(key, d.id);
        createdDepartments.push(d.name);
      } catch (err) {
        if (!(err instanceof HttpException)) throw err;
        // Créé entre-temps : on le reprend s'il est actif, sinon sans service.
        const again = (await this.departments.all(organizationId)).find(
          (d) => d.active && normalizeLabel(d.name) === key,
        );
        if (again) newDept.set(key, String(again._id));
      }
    }

    const createdByRow = new Map<number, string>();
    const results = new Map<number, EmployeeImportResult['created'][number]>();
    for (const r of rows) {
      if (!r.body) continue;
      const deptId = r.departmentToCreate
        ? newDept.get(normalizeLabel(r.departmentToCreate))
        : undefined;
      const body: CreateEmployeeBody = deptId ? { ...r.body, departmentId: deptId } : r.body;
      try {
        const view = await this.fiches.create(organizationId, body, hrActor);
        let invitation: EmployeeImportResult['created'][number]['invitation'] = 'not_requested';
        if (options.invite) {
          invitation = (await this.invitations.invite(organizationId, view.id, actor)).outcome;
        }
        const item = {
          row: r.view.row,
          employeeId: view.id,
          employeeNumber: view.employeeNumber,
          invitation,
          manager: (body.managerEmployeeId ? 'linked' : 'none') as 'linked' | 'none',
        };
        createdByRow.set(r.view.row, view.id);
        results.set(r.view.row, item);
        created.push(item);
      } catch (err) {
        // Refus métier (matricule saisi entre l'aperçu et l'application, service archivé…) :
        // la ligne est sautée et listée. Toute autre panne remonte.
        if (!(err instanceof HttpException)) throw err;
        skippedRows.push(r.view.row);
      }
    }

    // Passe 2 : manager = autre ligne du fichier.
    for (const r of rows) {
      const item = results.get(r.view.row);
      if (!item || r.managerRow === null) continue;
      const managerId = createdByRow.get(r.managerRow);
      if (!managerId) {
        item.manager = 'not_linked';
        continue;
      }
      try {
        const fresh = await this.fiches.requireOwn(organizationId, item.employeeId);
        await this.fiches.update(
          organizationId,
          item.employeeId,
          { expectedRevision: fresh.revision, managerEmployeeId: managerId },
          hrActor,
        );
        item.manager = 'linked';
      } catch (err) {
        if (!(err instanceof HttpException)) throw err;
        item.manager = 'not_linked';
      }
    }
    return { created, skippedRows: skippedRows.sort((a, b) => a - b), createdDepartments };
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
