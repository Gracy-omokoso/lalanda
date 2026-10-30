// Lecture des réglages RH avec valeurs par défaut (ADR-0045 § 2.2). ADR-0045 — H2.
//
// Chaque champ est relu et VÉRIFIÉ : une valeur absente ou hors contrat retombe sur
// la valeur par défaut (décisions ouvertes n° 5, 6, 8, 9, 11 et 14). Aucune règle
// légale : seulement les choix de l'organisation.

import {
  HR_APPROVAL_FLOWS,
  HR_ORG_CHART_VISIBILITIES,
  HR_SETTINGS_DEFAULTS,
  HR_TEAM_CALENDAR_VISIBILITIES,
  HrContractTypeSchema,
  HrMonthDay,
  HrWorkPatternSchema,
  type HrContractType,
  type HrSettingsView,
} from '@lalanda/shared/hr';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { HrSettings, type HrSettingsDocument } from './hr-settings.schema.js';

const D = HR_SETTINGS_DEFAULTS;

function intIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

function nullableIntIn(value: unknown, min: number, max: number, fallback: number | null) {
  if (value === null) return null;
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

function oneOf<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Vue complète des réglages, valeurs par défaut comprises. */
export function hrSettingsViewOf(doc: Record<string, unknown> | null): HrSettingsView {
  const raw = doc ?? {};
  const pattern = HrWorkPatternSchema.safeParse(raw['workPattern']);
  const leaveYear = HrMonthDay.safeParse(raw['leaveYearStart']);
  const types = Array.isArray(raw['contractTypes'])
    ? raw['contractTypes'].map((t) => HrContractTypeSchema.safeParse(t))
    : [];
  const contractTypes: HrContractType[] =
    types.length > 0 && types.every((t) => t.success)
      ? types.map((t) => t.data!)
      : D.contractTypes.map((t) => ({ ...t }));
  const reminders = (raw['reminders'] ?? {}) as Record<string, unknown>;
  const retention = (raw['retention'] ?? {}) as Record<string, unknown>;
  return {
    workPattern: pattern.success ? pattern.data : { ...D.workPattern },
    leaveYearStart: leaveYear.success ? leaveYear.data : D.leaveYearStart,
    approvalFlow: oneOf(HR_APPROVAL_FLOWS, raw['approvalFlow'], D.approvalFlow),
    allowSoleApprover:
      typeof raw['allowSoleApprover'] === 'boolean'
        ? raw['allowSoleApprover']
        : D.allowSoleApprover,
    contractTypes,
    reminders: {
      probationEnd: intIn(reminders['probationEnd'], 0, 120, D.reminders.probationEnd),
      contractEnd: intIn(reminders['contractEnd'], 0, 120, D.reminders.contractEnd),
      documentExpiry: intIn(reminders['documentExpiry'], 0, 120, D.reminders.documentExpiry),
    },
    teamCalendarVisibility: oneOf(
      HR_TEAM_CALENDAR_VISIBILITIES,
      raw['teamCalendarVisibility'],
      D.teamCalendarVisibility,
    ),
    orgChartVisibility: oneOf(
      HR_ORG_CHART_VISIBILITIES,
      raw['orgChartVisibility'],
      D.orgChartVisibility,
    ),
    retention: {
      privateDataMonthsAfterExit: nullableIntIn(
        retention['privateDataMonthsAfterExit'],
        1,
        600,
        D.retention.privateDataMonthsAfterExit,
      ),
      anonymizeYearsAfterExit: nullableIntIn(
        retention['anonymizeYearsAfterExit'],
        1,
        50,
        D.retention.anonymizeYearsAfterExit,
      ),
    },
    revision: typeof raw['revision'] === 'number' ? raw['revision'] : 0,
    isDefault: doc === null,
  };
}

@Injectable()
export class HrSettingsService {
  constructor(@InjectModel(HrSettings.name) private readonly settings: Model<HrSettingsDocument>) {}

  async view(organizationId: string): Promise<HrSettingsView> {
    const doc = await this.settings
      .findOne({ organizationId })
      .lean<Record<string, unknown>>()
      .exec();
    return hrSettingsViewOf(doc ?? null);
  }
}
