// Réglages du module « work » — ADR-0039 § 2.1.
//
// Un document par organisation ; sans document, les réglages par défaut
// s'appliquent (révision 0). Retirer une étiquette encore posée sur une tâche
// est refusé (`409 WORK_LABEL_IN_USE`, avec le nombre de tâches).

import {
  DEFAULT_WORK_COLUMNS,
  WORK_LIMITS,
  type PutWorkSettingsBody,
  type WorkSettingsView,
} from '@lalanda/shared/work';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { isDuplicateKey } from '../sales/sales.errors.js';
import { conflict, staleRevision, type WorkActor } from './work.common.js';
import {
  WorkSettings,
  WorkTask,
  type WorkSettingsDocument,
  type WorkTaskDocument,
} from './work.schemas.js';

type SettingsLean = WorkSettings & { _id: unknown };

export function defaultWorkSettings(): WorkSettingsView {
  return {
    labels: [],
    defaultColumns: DEFAULT_WORK_COLUMNS.map((c) => ({ ...c })),
    dueSoonDays: WORK_LIMITS.dueSoonDaysDefault,
    revision: 0,
    updatedAt: null,
  };
}

@Injectable()
export class WorkSettingsService {
  constructor(
    @InjectModel(WorkSettings.name) private readonly settings: Model<WorkSettingsDocument>,
    @InjectModel(WorkTask.name) private readonly tasks: Model<WorkTaskDocument>,
  ) {}

  async get(organizationId: string): Promise<WorkSettingsView> {
    const doc = await this.settings.findOne({ organizationId }).lean<SettingsLean>().exec();
    if (!doc) return defaultWorkSettings();
    return {
      labels: doc.labels.map((l) => ({ key: l.key, label: l.label, color: l.color })),
      defaultColumns: doc.defaultColumns.map((c) => ({
        key: c.key,
        label: c.label,
        category: c.category,
      })),
      dueSoonDays: doc.dueSoonDays,
      revision: doc.revision,
      updatedAt: new Date(doc.updatedAt).toISOString(),
    };
  }

  /** Réglages de plusieurs organisations (tâche récurrente des rappels). */
  async dueSoonDaysOf(organizationIds: readonly string[]): Promise<Map<string, number>> {
    const docs = await this.settings
      .find(
        { organizationId: { $in: [...organizationIds] } },
        { organizationId: 1, dueSoonDays: 1 },
      )
      .lean<SettingsLean[]>()
      .exec();
    const out = new Map<string, number>();
    for (const id of organizationIds) out.set(id, WORK_LIMITS.dueSoonDaysDefault);
    for (const d of docs) out.set(d.organizationId, d.dueSoonDays);
    return out;
  }

  async put(
    organizationId: string,
    body: PutWorkSettingsBody,
    actor: WorkActor,
  ): Promise<WorkSettingsView> {
    const current = await this.get(organizationId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);

    const kept = new Set(body.labels.map((l) => l.key));
    for (const removed of current.labels.filter((l) => !kept.has(l.key))) {
      const count = await this.tasks
        .countDocuments({ organizationId, labelKeys: removed.key })
        .exec();
      if (count > 0) {
        conflict(
          'WORK_LABEL_IN_USE',
          `L’étiquette « ${removed.label} » est posée sur ${count} tâche(s) : retirez-la d’abord des tâches.`,
          { labelKey: removed.key, taskCount: count },
        );
      }
    }

    const values = {
      labels: body.labels,
      defaultColumns: body.defaultColumns,
      dueSoonDays: body.dueSoonDays,
      updatedBy: actor.userId,
    };
    if (body.expectedRevision === 0) {
      try {
        await this.settings.create({
          organizationId,
          ...values,
          revision: 1,
          createdBy: actor.userId,
          _schemaVersion: 1,
        });
      } catch (err) {
        if (isDuplicateKey(err)) staleRevision((await this.get(organizationId)).revision);
        throw err;
      }
    } else {
      const res = await this.settings
        .updateOne(
          { organizationId, revision: body.expectedRevision },
          { $set: values, $inc: { revision: 1 } },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision((await this.get(organizationId)).revision);
    }
    return this.get(organizationId);
  }
}
