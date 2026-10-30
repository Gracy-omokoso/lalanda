// Échéances RH d'une organisation (ADR-0045 § 3.3, § 6.4). ADR-0045 — H4.
//
// Calcul : moteur `hrDeadlines` (fins d'essai, fins de contrat, documents qui
// expirent, pièces d'identité) — l'API ne fait que lire et nommer. Les pièces
// d'identité se lisent sur `idExpiries`, EN CLAIR sans numéro, recopiées par H2 :
// rien n'est déchiffré ici. Partagé par `GET /hr/deadlines` et la tâche `hr.reminders`.

import {
  hrDeadlines,
  type DeadlineDocumentInput,
  type DeadlineHorizons,
  type HrDeadlinesResult,
  type IdExpiryInput,
} from '@lalanda/engine';
import {
  HR_MASKED_DOCUMENT_LABEL,
  type HrDeadlineView,
  type HrDeadlinesView,
  type HrIdDocumentKind,
} from '@lalanda/shared/hr';
import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { HrDocument, type HrDocumentDocument } from '../documents/hr-document.schema.js';
import {
  Employee,
  type EmployeeDocument,
  type EmployeeLean,
} from '../employees/employee.schema.js';
import { displayNameOf } from '../leave/display-name.js';
import { hrToday } from '../scope/hr-errors.js';
import { engineEmployeeOf } from '../scope/hr-scope.service.js';
import { hrSettingsViewOf } from '../settings/hr-settings.service.js';

export interface OrgDeadlines {
  result: HrDeadlinesResult;
  horizons: DeadlineHorizons;
  employees: ReadonlyMap<string, EmployeeLean>;
  documents: ReadonlyMap<string, { label: string; sensitive: boolean }>;
}

@Injectable()
export class HrDeadlinesService {
  constructor(
    @InjectModel(Employee.name) private readonly employees: Model<EmployeeDocument>,
    @InjectModel(HrDocument.name) private readonly documents: Model<HrDocumentDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /** Échéances de l'organisation sous les délais des réglages (ou `within` pour tous). */
  async of(organizationId: string, today: string, within?: number): Promise<OrgDeadlines> {
    const [settingsDoc, employees] = await Promise.all([
      this.connection.collection('hr_settings').findOne({ organizationId }),
      this.employees.find({ organizationId, status: 'active' }).lean<EmployeeLean[]>().exec(),
    ]);
    const reminders = hrSettingsViewOf(settingsDoc as Record<string, unknown> | null).reminders;
    const horizons: DeadlineHorizons =
      within === undefined
        ? { ...reminders }
        : { probationEnd: within, contractEnd: within, documentExpiry: within };
    const ids = employees.map((e) => String(e._id));
    const [docs, privates] = await Promise.all([
      this.documents
        .find(
          { organizationId, employeeId: { $in: ids }, deletedAt: null, expiresOn: { $ne: null } },
          { employeeId: 1, expiresOn: 1, label: 1, sensitive: 1 },
        )
        .lean<
          {
            _id: unknown;
            employeeId: string;
            expiresOn: string;
            label: string;
            sensitive: boolean;
          }[]
        >()
        .exec(),
      // Projection STRICTE : jamais une section chiffrée, seulement les expirations.
      this.connection
        .collection('hr_employee_private')
        .find(
          { organizationId, employeeId: { $in: ids }, 'idExpiries.0': { $exists: true } },
          { projection: { _id: 0, employeeId: 1, idExpiries: 1 } },
        )
        .toArray(),
    ]);
    const docInputs: DeadlineDocumentInput[] = docs.map((d) => ({
      id: String(d._id),
      employeeId: d.employeeId,
      expiresOn: d.expiresOn,
    }));
    const idInputs: IdExpiryInput[] = [];
    for (const p of privates) {
      for (const x of (p['idExpiries'] ?? []) as { kind: string; expiresOn: string }[]) {
        idInputs.push({
          employeeId: String(p['employeeId']),
          kind: x.kind,
          expiresOn: x.expiresOn,
        });
      }
    }
    const result = hrDeadlines(
      employees.map(engineEmployeeOf),
      docInputs,
      idInputs,
      today,
      horizons,
    );
    return {
      result,
      horizons,
      employees: new Map(employees.map((e) => [String(e._id), e])),
      documents: new Map(
        docs.map((d) => [String(d._id), { label: d.label, sensitive: d.sensitive }]),
      ),
    };
  }

  /** `GET /hr/deadlines` : nommées ; libellés et natures sensibles masqués hors ayants droit. */
  async view(
    organizationId: string,
    seesSensitive: boolean,
    within?: number,
  ): Promise<HrDeadlinesView> {
    const today = hrToday();
    const d = await this.of(organizationId, today, within);
    const items: HrDeadlineView[] = d.result.deadlines.map((x) => {
      const employee = d.employees.get(x.employeeId);
      const doc = x.documentId ? d.documents.get(x.documentId) : undefined;
      return {
        kind: x.kind,
        employeeId: x.employeeId,
        employeeName: employee ? displayNameOf(employee) : 'Collaborateur',
        date: x.date,
        daysLeft: x.daysLeft,
        documentId: x.documentId,
        documentLabel: doc
          ? doc.sensitive && !seesSensitive
            ? HR_MASKED_DOCUMENT_LABEL
            : doc.label
          : null,
        idKind: seesSensitive ? ((x.idKind as HrIdDocumentKind | null) ?? null) : null,
      };
    });
    return {
      today,
      horizons: d.horizons,
      items,
      counts: d.result.counts,
      total: d.result.total,
    };
  }
}
