// Réglages des présences et des plannings (ADR-0051 § 2.7). ADR-0051 — H12.
//
// Champs ajoutés au document `hr_settings` de l'organisation (schéma souple, ADR-0045
// § 2.2) : `attendance.*`, `planning.*` et `retention.attendanceMonths`. Lus ICI, sans
// toucher au service des réglages d'ADR-0045 : chaque champ absent ou hors contrat
// retombe sur sa valeur par défaut, la plus prudente.
//
// - Pointage et plannings ÉTEINTS par défaut (décisions ouvertes n° 8 et 9) ; ils
//   s'activent par réglage de l'organisation (`hr.manage`).
// - Aucune règle de droit du travail : la tolérance de retard et le seuil hebdomadaire
//   sont des valeurs SAISIES, vides par défaut (constats éteints) ; aucune durée
//   légale, aucun repos, aucune majoration (J3).
// - Conservation des pointages : 60 mois par défaut (ADR-0054, choix produit prudent du
//   3 nov. 2026), réglable ; `null` posé par l'organisation = aucune purge. La purge est
//   faite par `HrAttendanceRetentionJob`.
//
// L'écriture partage la révision du document `hr_settings` (`expectedRevision`, `0` tant
// que rien n'est enregistré) : un autre écrivain des réglages RH invalide la révision.

import {
  ATTENDANCE_LIMITS,
  HR_ATTENDANCE_RETENTION_DEFAULT,
  HR_ATTENDANCE_SETTINGS_DEFAULTS,
  HR_PLANNING_SETTINGS_DEFAULTS,
  PLANNING_LIMITS,
  hrFr,
} from '@lalanda/shared/hr';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { z } from 'zod';

import { AuditService } from '../../authz/audit.service.js';
import { conflict, isDuplicateKey, staleRevision } from '../../sales/sales.errors.js';
import type { HrActor } from '../departments/hr-departments.service.js';
import { HrSettings, type HrSettingsDocument } from '../settings/hr-settings.schema.js';

export interface HrPresenceSettingsView {
  attendance: {
    enabled: boolean;
    selfClock: boolean;
    lateToleranceMinutes: number | null;
  };
  planning: {
    enabled: boolean;
    indicativeMaxMinutesPerWeek: number | null;
  };
  retention: { attendanceMonths: number | null };
  revision: number;
  isDefault: boolean;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function nullableIntIn(value: unknown, min: number, max: number, fallback: number | null) {
  if (value === null) return null;
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

function objectOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Vue des réglages, valeurs par défaut comprises (pure, testée). */
export function presenceSettingsViewOf(
  doc: Record<string, unknown> | null,
): HrPresenceSettingsView {
  const raw = doc ?? {};
  const a = objectOf(raw['attendance']);
  const p = objectOf(raw['planning']);
  const r = objectOf(raw['retention']);
  const A = HR_ATTENDANCE_SETTINGS_DEFAULTS;
  const P = HR_PLANNING_SETTINGS_DEFAULTS;
  return {
    attendance: {
      enabled: bool(a['enabled'], A.enabled),
      selfClock: bool(a['selfClock'], A.selfClock),
      lateToleranceMinutes: nullableIntIn(
        a['lateToleranceMinutes'],
        0,
        ATTENDANCE_LIMITS.lateToleranceMinutesMax,
        A.lateToleranceMinutes,
      ),
    },
    planning: {
      enabled: bool(p['enabled'], P.enabled),
      indicativeMaxMinutesPerWeek: nullableIntIn(
        p['indicativeMaxMinutesPerWeek'],
        1,
        PLANNING_LIMITS.indicativeMaxMinutesPerWeekMax,
        P.indicativeMaxMinutesPerWeek,
      ),
    },
    retention: {
      attendanceMonths: nullableIntIn(
        r['attendanceMonths'],
        1,
        ATTENDANCE_LIMITS.retentionMonthsMax,
        HR_ATTENDANCE_RETENTION_DEFAULT,
      ),
    },
    revision: typeof raw['revision'] === 'number' ? raw['revision'] : 0,
    isDefault: doc === null,
  };
}

/** `PUT /hr/attendance/settings` — `hr.manage` (§ 2.7). Seuls les champs fournis changent. */
export const UpdatePresenceSettingsBody = z
  .object({
    expectedRevision: z.number(hrFr('Révision attendue.')).int().min(0),
    attendance: z
      .object({
        enabled: z.boolean().optional(),
        selfClock: z.boolean().optional(),
        lateToleranceMinutes: z
          .number()
          .int()
          .min(0)
          .max(ATTENDANCE_LIMITS.lateToleranceMinutesMax)
          .nullable()
          .optional(),
      })
      .strict()
      .optional(),
    planning: z
      .object({
        enabled: z.boolean().optional(),
        indicativeMaxMinutesPerWeek: z
          .number()
          .int()
          .min(1)
          .max(PLANNING_LIMITS.indicativeMaxMinutesPerWeekMax)
          .nullable()
          .optional(),
      })
      .strict()
      .optional(),
    retention: z
      .object({
        attendanceMonths: z
          .number()
          .int()
          .min(1)
          .max(ATTENDANCE_LIMITS.retentionMonthsMax)
          .nullable()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type UpdatePresenceSettingsBody = z.output<typeof UpdatePresenceSettingsBody>;

/** `409 HR_FEATURE_DISABLED` : fonction éteinte par réglage (§ 6). */
export function featureDisabled(feature: 'attendance' | 'planning' | 'selfClock'): never {
  const message =
    feature === 'attendance'
      ? 'Le pointage n’est pas activé dans votre organisation.'
      : feature === 'planning'
        ? 'Les plannings ne sont pas activés dans votre organisation.'
        : 'Le pointage par soi n’est pas autorisé : votre manager ou les RH saisissent vos présences.';
  conflict('HR_FEATURE_DISABLED', message, { feature });
}

@Injectable()
export class HrPresenceSettingsService {
  constructor(
    @InjectModel(HrSettings.name) private readonly settings: Model<HrSettingsDocument>,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async view(organizationId: string): Promise<HrPresenceSettingsView> {
    const doc = await this.settings
      .findOne({ organizationId })
      .lean<Record<string, unknown>>()
      .exec();
    return presenceSettingsViewOf(doc ?? null);
  }

  async requireAttendance(organizationId: string): Promise<HrPresenceSettingsView> {
    const s = await this.view(organizationId);
    if (!s.attendance.enabled) featureDisabled('attendance');
    return s;
  }

  async requirePlanning(organizationId: string): Promise<HrPresenceSettingsView> {
    const s = await this.view(organizationId);
    if (!s.planning.enabled) featureDisabled('planning');
    return s;
  }

  async update(
    organizationId: string,
    body: UpdatePresenceSettingsBody,
    actor: HrActor,
  ): Promise<HrPresenceSettingsView> {
    const set: Record<string, unknown> = {};
    for (const section of ['attendance', 'planning', 'retention'] as const) {
      for (const [k, v] of Object.entries(body[section] ?? {})) {
        if (v !== undefined) set[`${section}.${k}`] = v;
      }
    }
    const before = await this.view(organizationId);
    if (before.revision !== body.expectedRevision) staleRevision(before.revision);
    if (Object.keys(set).length === 0) return before;
    if (before.isDefault) {
      const nested: Record<string, Record<string, unknown>> = {};
      for (const [path, v] of Object.entries(set)) {
        const [section, key] = path.split('.') as [string, string];
        (nested[section] ??= {})[key] = v;
      }
      try {
        await this.settings.create({
          organizationId,
          ...nested,
          revision: 1,
          createdBy: actor.userId,
          updatedBy: actor.userId,
          _schemaVersion: 1,
        });
      } catch (err) {
        if (isDuplicateKey(err)) staleRevision((await this.view(organizationId)).revision);
        throw err;
      }
    } else {
      const res = await this.settings
        .updateOne(
          { organizationId, revision: before.revision },
          { $set: { ...set, updatedBy: actor.userId }, $inc: { revision: 1 } },
          { strict: false },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision((await this.view(organizationId)).revision);
    }
    const after = await this.view(organizationId);
    const fields = Object.keys(set).sort();
    const flat = (v: HrPresenceSettingsView) =>
      Object.fromEntries(
        fields.map((f) => {
          const [section, key] = f.split('.') as [keyof HrPresenceSettingsView, string];
          return [f, (v[section] as Record<string, number | boolean | null>)[key] ?? null];
        }),
      );
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.settings.updated',
      targetType: 'hr_settings',
      targetId: organizationId,
      metadata: { fields, before: flat(before), after: flat(after) },
    });
    return after;
  }
}
