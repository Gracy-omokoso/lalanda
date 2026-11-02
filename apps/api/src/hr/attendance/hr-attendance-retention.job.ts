// Tâche `hr.attendance.retention` — purge des pointages au-delà de la durée réglée.
// ADR-0054 (décision de la dirigeante du 3 nov. 2026), complète ADR-0051 H12.
//
// H12 enregistrait `hr_settings.retention.attendanceMonths` sans rien effacer. Depuis
// ADR-0054 :
//   - durée par défaut : 60 mois (cinq ans), CHOIX PRODUIT PRUDENT, réglable par
//     l'organisation (1 à 600 mois) ; `null` posé par l'organisation = aucune purge ;
//   - chaque jour, pour chaque organisation qui a des pointages, sont effacés :
//       · les pointages (`hr_attendance_events`) dont l'instant précède le début du jour
//         (Kinshasa) situé `attendanceMonths` mois avant aujourd'hui ;
//       · les demandes de correction (`hr_attendance_corrections`) portant sur un jour
//         antérieur à ce même jour ;
//   - idempotente : une seconde passe le même jour ne trouve plus rien et n'écrit rien ;
//   - journalisée : une entrée `hr.attendance.purged` au journal de l'organisation
//     (acteur `system`) quand au moins un document a été effacé, avec les nombres et la
//     date limite — jamais le contenu des pointages.
//
// Aucune autre donnée RH n'est touchée (dossiers, absences, évaluations : `hr.retention`).

import { HR_ATTENDANCE_RETENTION_DEFAULT } from '@lalanda/shared/hr';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { SchedulerService } from '../../scheduler/scheduler.service.js';
import { addMonthsToDay } from '../retention/hr-retention.job.js';
import { hrToday } from '../scope/hr-errors.js';
import {
  AttendanceCorrection,
  AttendanceEvent,
  type AttendanceCorrectionDocument,
  type AttendanceEventDocument,
} from './attendance.schemas.js';
import { presenceSettingsViewOf } from './hr-presence-settings.js';

export const HR_ATTENDANCE_RETENTION_JOB = 'hr.attendance.retention';
export const HR_ATTENDANCE_RETENTION_EVERY_MS = 24 * 3_600_000;
const SYSTEM = { userId: 'system', role: 'system' } as const;

export interface HrAttendanceRetentionReport {
  /** Organisations examinées (pointages anciens présents). */
  organizations: number;
  /** Organisations dont au moins un document a été effacé. */
  purgedOrganizations: number;
  events: number;
  corrections: number;
}

/**
 * Jour limite (Kinshasa, `AAAA-MM-JJ`) : tout pointage antérieur au début de ce jour est
 * effacé. `null` : aucune purge. Fonction pure, testée.
 */
export function attendanceCutoffDay(today: string, months: number | null): string | null {
  if (months === null) return null;
  return addMonthsToDay(today, -months);
}

/** Début du jour `day` à Kinshasa (UTC+1, sans heure d'été). */
export function kinshasaDayStart(day: string): Date {
  return new Date(`${day}T00:00:00+01:00`);
}

@Injectable()
export class HrAttendanceRetentionJob implements OnModuleInit {
  private readonly logger = new Logger('RhPointagesConservation');

  constructor(
    @InjectModel(AttendanceEvent.name)
    private readonly events: Model<AttendanceEventDocument>,
    @InjectModel(AttendanceCorrection.name)
    private readonly corrections: Model<AttendanceCorrectionDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
  ) {}

  onModuleInit(): void {
    this.scheduler.every(
      HR_ATTENDANCE_RETENTION_JOB,
      HR_ATTENDANCE_RETENTION_EVERY_MS,
      async (_p, ctx) => {
        await this.run(ctx.now);
      },
    );
  }

  async run(now: Date = new Date()): Promise<HrAttendanceRetentionReport> {
    const report: HrAttendanceRetentionReport = {
      organizations: 0,
      purgedOrganizations: 0,
      events: 0,
      corrections: 0,
    };
    const today = hrToday(now);
    // La plus courte durée réglable est d'un mois : seules les organisations qui ont des
    // pointages ou des corrections de plus d'un mois peuvent avoir quelque chose à purger.
    const earliest = attendanceCutoffDay(today, 1)!;
    const [fromEvents, fromCorrections] = await Promise.all([
      this.events.distinct('organizationId', { at: { $lt: kinshasaDayStart(earliest) } }).exec(),
      this.corrections.distinct('organizationId', { date: { $lt: earliest } }).exec(),
    ]);
    const organizationIds = [...new Set([...fromEvents, ...fromCorrections].map(String))].sort();
    for (const organizationId of organizationIds) {
      report.organizations += 1;
      try {
        const settings = await this.connection
          .collection('hr_settings')
          .findOne({ organizationId });
        const months = presenceSettingsViewOf((settings as Record<string, unknown> | null) ?? null)
          .retention.attendanceMonths;
        const cutoff = attendanceCutoffDay(today, months);
        if (cutoff === null) continue;
        const [ev, co] = await Promise.all([
          this.events.deleteMany({ organizationId, at: { $lt: kinshasaDayStart(cutoff) } }).exec(),
          this.corrections.deleteMany({ organizationId, date: { $lt: cutoff } }).exec(),
        ]);
        const events = ev.deletedCount ?? 0;
        const corrections = co.deletedCount ?? 0;
        if (events + corrections === 0) continue;
        report.purgedOrganizations += 1;
        report.events += events;
        report.corrections += corrections;
        await this.audit.record({
          organizationId,
          actorUserId: SYSTEM.userId,
          actorRole: SYSTEM.role,
          action: 'hr.attendance.purged',
          targetType: 'hr_settings',
          targetId: organizationId,
          metadata: {
            events,
            corrections,
            cutoffDay: cutoff,
            retentionMonths: months ?? HR_ATTENDANCE_RETENTION_DEFAULT,
          },
        });
        this.logger.log(
          `Pointages purgés (organisation ${organizationId}) : ${events} pointage(s), ${corrections} correction(s) antérieurs au ${cutoff}.`,
        );
      } catch (err) {
        this.logger.warn(
          `Purge des pointages non appliquée (organisation ${organizationId}) : ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return report;
  }
}
