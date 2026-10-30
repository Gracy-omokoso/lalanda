// Lecture des réglages RH avec valeurs par défaut (ADR-0045 § 2.2). ADR-0045 — H2.
//
// Chaque champ est relu et VÉRIFIÉ : une valeur absente ou hors contrat retombe sur
// la valeur par défaut (décisions ouvertes n° 5, 6, 8, 9, 11 et 14). Aucune règle
// légale : seulement les choix de l'organisation.
//
// ADR-0045 — H3 : écriture (`PUT /hr/settings`, `hr.manage` ; circuit par
// `PUT /hr/settings/approval`, `leave.approve` + `hr.manage`). Révision attendue
// (`0` tant que rien n'est enregistré) ; seuls les champs fournis sont écrits, les
// autres gardent leur valeur ou leur défaut. Un type de contrat porté par une fiche
// active ne disparaît pas (`409 CONTRACT_TYPE_IN_USE`). Audit `hr.settings.updated`.

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
import type { UpdateHrApprovalSettingsBody, UpdateHrSettingsBody } from '@lalanda/shared/hr';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { conflict, isDuplicateKey, staleRevision } from '../../sales/sales.errors.js';
import type { HrActor } from '../departments/hr-departments.service.js';
import { Employee, type EmployeeDocument } from '../employees/employee.schema.js';
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
  constructor(
    @InjectModel(HrSettings.name) private readonly settings: Model<HrSettingsDocument>,
    // ADR-0045 — H3 : types de contrat encore portés ; audit des écritures.
    @InjectModel(Employee.name) private readonly employees: Model<EmployeeDocument>,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async view(organizationId: string): Promise<HrSettingsView> {
    const doc = await this.settings
      .findOne({ organizationId })
      .lean<Record<string, unknown>>()
      .exec();
    return hrSettingsViewOf(doc ?? null);
  }

  // ── ADR-0045 — H3 : écriture ─────────────────────────────────────────────

  /** `PUT /hr/settings` — tout sauf le circuit de validation. */
  async update(
    organizationId: string,
    body: UpdateHrSettingsBody,
    actor: HrActor,
  ): Promise<HrSettingsView> {
    const { expectedRevision, ...patch } = body;
    if (patch.contractTypes) {
      const kept = new Set(patch.contractTypes.map((t) => t.key));
      const used = (await this.employees
        .distinct('contractType', { organizationId, status: 'active' })
        .exec()) as string[];
      const missing = used.filter((k) => !kept.has(k)).sort();
      if (missing.length > 0) {
        conflict(
          'CONTRACT_TYPE_IN_USE',
          'Un type de contrat retiré est encore porté par un collaborateur actif : archivez-le plutôt (actif : non).',
          { keys: missing },
        );
      }
    }
    return this.write(organizationId, expectedRevision, patch, actor);
  }

  /** `PUT /hr/settings/approval` — changer qui valide exige d'être soi-même validateur. */
  async updateApproval(
    organizationId: string,
    body: UpdateHrApprovalSettingsBody,
    actor: HrActor,
  ): Promise<HrSettingsView> {
    const { expectedRevision, ...patch } = body;
    return this.write(organizationId, expectedRevision, patch, actor);
  }

  private async write(
    organizationId: string,
    expectedRevision: number,
    patch: Record<string, unknown>,
    actor: HrActor,
  ): Promise<HrSettingsView> {
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) set[k] = v;
    const before = await this.view(organizationId);
    if (before.revision !== expectedRevision) staleRevision(before.revision);
    if (Object.keys(set).length > 0) {
      if (before.isDefault) {
        try {
          await this.settings.create({
            organizationId,
            ...set,
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
          )
          .exec();
        if (res.matchedCount !== 1) staleRevision((await this.view(organizationId)).revision);
      }
      const keys = Object.keys(set).sort();
      const pick = (v: HrSettingsView) =>
        Object.fromEntries(
          keys
            .filter((k) => k === 'approvalFlow' || k === 'allowSoleApprover')
            .map((k) => [k, v[k as 'approvalFlow' | 'allowSoleApprover']]),
        );
      const after = await this.view(organizationId);
      await this.audit.record({
        organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'hr.settings.updated',
        targetType: 'hr_settings',
        targetId: organizationId,
        metadata: { fields: keys, before: pick(before), after: pick(after) },
      });
      return after;
    }
    return before;
  }
}
