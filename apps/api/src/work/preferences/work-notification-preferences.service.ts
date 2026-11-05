// Préférences de notification des Projets — ADR-0061 § 2.
//
// Lues par `WorkNotifier` (cloche, e-mail) à CHAQUE émission et par le résumé
// quotidien. Écrites par l'utilisateur lui-même (`PUT /work/notification-preferences`),
// jamais par un tiers.

import {
  resolveWorkNotificationPreferences,
  type PutWorkNotificationPreferencesBody,
  type WorkNotificationPreferences,
  type WorkNotificationPreferencesView,
} from '@lalanda/shared/work';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { isDuplicateKey } from '../../sales/sales.errors.js';
import { staleRevision } from '../work.common.js';
import {
  WorkNotificationPreferencesDoc,
  type WorkNotificationPreferencesDocument,
  type WorkNotificationPreferencesLean,
} from './work-notification-preferences.schema.js';

@Injectable()
export class WorkNotificationPreferencesService {
  constructor(
    @InjectModel(WorkNotificationPreferencesDoc.name)
    private readonly prefs: Model<WorkNotificationPreferencesDocument>,
  ) {}

  async get(organizationId: string, userId: string): Promise<WorkNotificationPreferencesView> {
    const doc = await this.prefs
      .findOne({ organizationId, userId })
      .lean<WorkNotificationPreferencesLean>()
      .exec();
    return { ...resolveWorkNotificationPreferences(doc), revision: doc?.revision ?? 0 };
  }

  /** Préférences de plusieurs destinataires (une émission, plusieurs personnes). */
  async many(
    organizationId: string,
    userIds: readonly string[],
  ): Promise<Map<string, WorkNotificationPreferences>> {
    const docs = await this.prefs
      .find({ organizationId, userId: { $in: [...new Set(userIds)] } })
      .lean<WorkNotificationPreferencesLean[]>()
      .exec();
    const byUser = new Map(docs.map((d) => [d.userId, d]));
    return new Map(
      userIds.map((u) => [u, resolveWorkNotificationPreferences(byUser.get(u) ?? null)]),
    );
  }

  async put(
    organizationId: string,
    userId: string,
    body: PutWorkNotificationPreferencesBody,
  ): Promise<WorkNotificationPreferencesView> {
    const current = await this.get(organizationId, userId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    // ADR-0064 : la colonne Slack est facultative dans le corps — absente (ancien
    // client), la valeur enregistrée est gardée au lieu de revenir au défaut.
    const events = Object.fromEntries(
      Object.entries(body.events).map(([e, c]) => [
        e,
        {
          bell: c.bell,
          email: c.email,
          slack: c.slack ?? current.events[e as keyof typeof current.events].slack,
        },
      ]),
    );
    const values = {
      events,
      digest: body.digest,
      digestEnabled: body.digest.enabled,
    };
    if (body.expectedRevision === 0) {
      try {
        await this.prefs.create({
          organizationId,
          userId,
          ...values,
          digestLastSentOn: null,
          revision: 1,
          _schemaVersion: 1,
        });
      } catch (err) {
        if (isDuplicateKey(err)) staleRevision((await this.get(organizationId, userId)).revision);
        throw err;
      }
    } else {
      const res = await this.prefs
        .updateOne(
          { organizationId, userId, revision: body.expectedRevision },
          { $set: values, $inc: { revision: 1 } },
        )
        .exec();
      if (res.matchedCount !== 1) staleRevision((await this.get(organizationId, userId)).revision);
    }
    return this.get(organizationId, userId);
  }
}
