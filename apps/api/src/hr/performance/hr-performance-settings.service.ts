// Réglages `performance.*` et conservation des évaluations (ADR-0051 § 2.7). ADR-0051 — H15.
//
// Même document `hr_settings` que les réglages d'ADR-0045 (schéma souple) : ce lot y LIT
// et y ÉCRIT seulement `performance.enabled`, `performance.managerChainDepth` et
// `retention.reviewsYearsAfterExit`, par une route qui lui est propre
// (`PUT /hr/settings/performance`, `hr.manage`), avec la même révision attendue que
// `PUT /hr/settings`. Une valeur absente ou hors contrat retombe sur le défaut :
//   - évaluations ÉTEINTES (décision ouverte n° 11) ;
//   - manager direct seul (`managerChainDepth = 1`, décision ouverte n° 12) ;
//   - aucune purge (`reviewsYearsAfterExit = null`, J4) : la durée appartient au juriste,
//     aucune tâche ne la lit dans ce lot.

import {
  HR_PERFORMANCE_SETTINGS_DEFAULTS,
  HR_REVIEWS_RETENTION_DEFAULT,
  PERFORMANCE_LIMITS,
} from '@lalanda/shared/hr';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { z } from 'zod';

import { AuditService } from '../../authz/audit.service.js';
import { isDuplicateKey, staleRevision } from '../../sales/sales.errors.js';
import { HrSettings, type HrSettingsDocument } from '../settings/hr-settings.schema.js';

export interface HrPerformanceSettingsView {
  enabled: boolean;
  managerChainDepth: number;
  reviewsYearsAfterExit: number | null;
  /** Révision du document `hr_settings` (0 tant que rien n'est enregistré). */
  revision: number;
  /** Aucun réglage enregistré : valeurs par défaut. */
  isDefault: boolean;
}

/** `PUT /hr/settings/performance` — seuls les champs fournis sont écrits. */
export const UpdatePerformanceSettingsBody = z
  .object({
    expectedRevision: z.number().int().min(0),
    enabled: z.boolean().optional(),
    managerChainDepth: z
      .number()
      .int()
      .min(PERFORMANCE_LIMITS.managerChainDepthMin)
      .max(PERFORMANCE_LIMITS.managerChainDepthMax)
      .optional(),
    reviewsYearsAfterExit: z
      .number()
      .int()
      .min(1)
      .max(PERFORMANCE_LIMITS.retentionYearsMax)
      .nullable()
      .optional(),
  })
  .strict();
export type UpdatePerformanceSettingsBody = z.output<typeof UpdatePerformanceSettingsBody>;

export function performanceSettingsViewOf(
  doc: Record<string, unknown> | null,
): HrPerformanceSettingsView {
  const raw = doc ?? {};
  const perf = (raw['performance'] ?? {}) as Record<string, unknown>;
  const retention = (raw['retention'] ?? {}) as Record<string, unknown>;
  const depth = perf['managerChainDepth'];
  const years = retention['reviewsYearsAfterExit'];
  return {
    enabled:
      typeof perf['enabled'] === 'boolean'
        ? perf['enabled']
        : HR_PERFORMANCE_SETTINGS_DEFAULTS.enabled,
    managerChainDepth:
      typeof depth === 'number' &&
      Number.isInteger(depth) &&
      depth >= PERFORMANCE_LIMITS.managerChainDepthMin &&
      depth <= PERFORMANCE_LIMITS.managerChainDepthMax
        ? depth
        : HR_PERFORMANCE_SETTINGS_DEFAULTS.managerChainDepth,
    reviewsYearsAfterExit:
      typeof years === 'number' &&
      Number.isInteger(years) &&
      years >= 1 &&
      years <= PERFORMANCE_LIMITS.retentionYearsMax
        ? years
        : HR_REVIEWS_RETENTION_DEFAULT,
    revision: typeof raw['revision'] === 'number' ? raw['revision'] : 0,
    isDefault: doc === null,
  };
}

/** Fonction éteinte par réglage (ADR-0051 § 6). */
export function performanceDisabled(): never {
  throw new ConflictException({
    code: 'HR_FEATURE_DISABLED',
    message:
      'Les objectifs et évaluations sont désactivés pour cette organisation : un responsable RH peut les activer dans les réglages.',
  });
}

@Injectable()
export class HrPerformanceSettingsService {
  constructor(
    @InjectModel(HrSettings.name) private readonly settings: Model<HrSettingsDocument>,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async view(organizationId: string): Promise<HrPerformanceSettingsView> {
    const doc = await this.settings
      .findOne({ organizationId })
      .lean<Record<string, unknown>>()
      .exec();
    return performanceSettingsViewOf(doc ?? null);
  }

  /** Lève `409 HR_FEATURE_DISABLED` si les évaluations sont éteintes. */
  async requireEnabled(organizationId: string): Promise<HrPerformanceSettingsView> {
    const v = await this.view(organizationId);
    if (!v.enabled) performanceDisabled();
    return v;
  }

  async update(
    organizationId: string,
    body: UpdatePerformanceSettingsBody,
    actor: { userId: string; role: string },
  ): Promise<HrPerformanceSettingsView> {
    const before = await this.view(organizationId);
    if (before.revision !== body.expectedRevision) staleRevision(before.revision);
    const set: Record<string, unknown> = {};
    if (body.enabled !== undefined) set['performance.enabled'] = body.enabled;
    if (body.managerChainDepth !== undefined) {
      set['performance.managerChainDepth'] = body.managerChainDepth;
    }
    if (body.reviewsYearsAfterExit !== undefined) {
      set['retention.reviewsYearsAfterExit'] = body.reviewsYearsAfterExit;
    }
    if (Object.keys(set).length === 0) return before;

    if (before.isDefault) {
      try {
        const nested: Record<string, Record<string, unknown>> = {};
        for (const [path, v] of Object.entries(set)) {
          const [head, leaf] = path.split('.') as [string, string];
          (nested[head] ??= {})[leaf] = v;
        }
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
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision((await this.view(organizationId)).revision);
    }
    const after = await this.view(organizationId);
    const pick = (v: HrPerformanceSettingsView) => ({
      enabled: v.enabled,
      managerChainDepth: v.managerChainDepth,
      reviewsYearsAfterExit: v.reviewsYearsAfterExit,
    });
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.settings.updated',
      targetType: 'hr_settings',
      targetId: organizationId,
      metadata: { fields: Object.keys(set).sort(), before: pick(before), after: pick(after) },
    });
    return after;
  }
}
