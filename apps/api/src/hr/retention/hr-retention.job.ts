// Tâche `hr.retention` — conservation des données des anciens salariés (ADR-0045
// § 2.2, § 6.4, décision ouverte n° 14). ADR-0045 — H4.
//
// ÉTEINTE PAR DÉFAUT : Lalanda ne fixe AUCUNE durée de conservation (question ouverte
// au juriste, docs/28 § 1.3). Tant que `hr_settings.retention` est vide (`null` partout,
// valeur par défaut), la tâche ne lit aucune fiche et ne fait RIEN. Seule une
// organisation qui a elle-même réglé une durée voit, pour chaque collaborateur dont la
// sortie a eu lieu :
//   - `privateDataMonthsAfterExit` mois après `endDate` : sections sensibles et
//     documents sensibles effacés (transaction, audit STRICT `hr.retention.private_purged`) ;
//   - `anonymizeYearsAfterExit` ans après `endDate` : anonymisation (même chemin que la
//     route manuelle : demandes et grand livre conservés pour les rapports).
// Les durées viennent du paramétrage de l'organisation, jamais de Lalanda.

import { employeeStatusOf } from '@lalanda/engine';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { SchedulerService } from '../../scheduler/scheduler.service.js';
import { HrDocumentsService } from '../documents/hr-documents.service.js';
import {
  Employee,
  type EmployeeDocument,
  type EmployeeLean,
} from '../employees/employee.schema.js';
import { HrEmployeesService } from '../employees/hr-employees.service.js';
import { HrPrivateService } from '../private/hr-private.service.js';
import { hrToday, inHrTransaction } from '../scope/hr-errors.js';
import { engineEmployeeOf } from '../scope/hr-scope.service.js';
import { hrSettingsViewOf } from '../settings/hr-settings.service.js';

export const HR_RETENTION_JOB = 'hr.retention';
export const HR_RETENTION_EVERY_MS = 24 * 3_600_000;
const SYSTEM = { userId: 'system', role: 'system' } as const;

export interface HrRetentionReport {
  organizations: number;
  purged: number;
  anonymized: number;
}

/** `AAAA-MM-JJ` + `months` mois, quantième ramené à la fin du mois si besoin. */
export function addMonthsToDay(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(Math.min(d, last))}`;
}

/** Vrai si une organisation a réglé au moins une durée (sinon : rien à faire). */
export function retentionEnabled(retention: {
  privateDataMonthsAfterExit: number | null;
  anonymizeYearsAfterExit: number | null;
}): boolean {
  return (
    retention.privateDataMonthsAfterExit !== null || retention.anonymizeYearsAfterExit !== null
  );
}

@Injectable()
export class HrRetentionJob implements OnModuleInit {
  private readonly logger = new Logger('RhConservation');

  constructor(
    @InjectModel(Employee.name) private readonly employees: Model<EmployeeDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(HrEmployeesService) private readonly employeesService: HrEmployeesService,
    @Inject(HrPrivateService) private readonly privates: HrPrivateService,
    @Inject(HrDocumentsService) private readonly documents: HrDocumentsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
  ) {}

  onModuleInit(): void {
    this.scheduler.every(HR_RETENTION_JOB, HR_RETENTION_EVERY_MS, async (_p, ctx) => {
      await this.run(ctx.now);
    });
  }

  async run(now: Date = new Date()): Promise<HrRetentionReport> {
    const report: HrRetentionReport = { organizations: 0, purged: 0, anonymized: 0 };
    // Défaut `null` partout : aucune organisation n'est retenue, aucune fiche n'est lue.
    const settings = await this.connection
      .collection('hr_settings')
      .find({
        $or: [
          { 'retention.privateDataMonthsAfterExit': { $type: 'number' } },
          { 'retention.anonymizeYearsAfterExit': { $type: 'number' } },
        ],
      })
      .toArray();
    const today = hrToday(now);
    for (const doc of settings) {
      const organizationId = String(doc['organizationId']);
      const retention = hrSettingsViewOf(doc as Record<string, unknown>).retention;
      if (!retentionEnabled(retention)) continue;
      try {
        await this.runOrg(organizationId, retention, today, report);
        report.organizations += 1;
      } catch (err) {
        this.logger.warn(
          `Conservation non appliquée (organisation ${organizationId}) : ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return report;
  }

  private async runOrg(
    organizationId: string,
    retention: {
      privateDataMonthsAfterExit: number | null;
      anonymizeYearsAfterExit: number | null;
    },
    today: string,
    report: HrRetentionReport,
  ): Promise<void> {
    const exited = await this.employees
      .find({ organizationId, status: 'exited', endDate: { $type: 'string' } })
      .lean<EmployeeLean[]>()
      .exec();
    for (const e of exited) {
      const employeeId = String(e._id);
      if (employeeStatusOf(engineEmployeeOf(e), today) !== 'exited') continue;
      const endDate = e.endDate!;
      if (
        retention.anonymizeYearsAfterExit !== null &&
        addMonthsToDay(endDate, retention.anonymizeYearsAfterExit * 12) <= today
      ) {
        await this.employeesService.anonymize(organizationId, employeeId, e.revision, SYSTEM);
        report.anonymized += 1;
        continue;
      }
      if (
        retention.privateDataMonthsAfterExit !== null &&
        addMonthsToDay(endDate, retention.privateDataMonthsAfterExit) <= today
      ) {
        if (await this.purge(organizationId, employeeId)) report.purged += 1;
      }
    }
  }

  /** Efface sections et documents sensibles ; faux s'il n'y avait plus rien. */
  private async purge(organizationId: string, employeeId: string): Promise<boolean> {
    const [privateDoc, sensitiveDocs] = await Promise.all([
      this.connection
        .collection('hr_employee_private')
        .findOne({ organizationId, employeeId }, { projection: { _id: 1 } }),
      this.connection
        .collection('hr_documents')
        .countDocuments({ organizationId, employeeId, sensitive: true, deletedAt: null }),
    ]);
    if (!privateDoc && sensitiveDocs === 0) return false;
    const objectIds = await inHrTransaction(this.connection, async (session) => {
      await this.privates.erase(organizationId, employeeId, session);
      const ids = await this.documents.eraseSensitive(
        organizationId,
        employeeId,
        SYSTEM.userId,
        session,
      );
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: SYSTEM.userId,
          actorRole: SYSTEM.role,
          action: 'hr.retention.private_purged',
          targetType: 'employee',
          targetId: employeeId,
          metadata: { documents: ids.length },
        },
        { session },
      );
      return ids;
    });
    await this.documents.drop(objectIds);
    return true;
  }
}
