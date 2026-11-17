// Préférences de notification des Projets — ADR-0061 § 2, ROUTE DE COMPATIBILITÉ depuis
// ADR-0079 § 4.4.
//
// Les canaux vivent désormais dans les réglages communs (`notification_settings` : mode
// et surcharges par mode). Cette route les PRÉSENTE et les ÉCRIT dans l'ancienne forme
// (douze événements × quatre canaux) pour les clients N-1 :
//
//   - GET rend les canaux EFFECTIFS de ces douze événements (mode appliqué hors des
//     projets que la personne dirige, surcharges, obligations) ; le résumé quotidien et
//     la révision restent ceux de `work_notification_preferences` ;
//   - PUT enregistre comme avant dans `work_notification_preferences` (rien n'est perdu,
//     le résumé quotidien y reste) ET convertit les cases en surcharges du mode choisi
//     (des trois modes si la personne suit le défaut de l'organisation).
//
// Écrites par l'utilisateur lui-même, jamais par un tiers.

import {
  effectiveChannels,
  notificationSpecOf,
  type NotificationChannelOverride,
  type NotificationKind,
} from '@lalanda/shared/notifications';
import {
  WORK_NOTIFICATION_EVENTS,
  notificationKindOf,
  resolveWorkNotificationPreferences,
  type PutWorkNotificationPreferencesBody,
  type WorkNotificationChannels,
  type WorkNotificationEvent,
  type WorkNotificationPreferencesView,
} from '@lalanda/shared/work';
import { ConflictException, Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { NotificationSettingsService } from '../../notifications/notification-settings.service.js';
import { isDuplicateKey } from '../../sales/sales.errors.js';
import {
  WHATSAPP_NOTIFIER,
  type WhatsAppNotifierPort,
} from '../../whatsapp/whatsapp-notifier.service.js';
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
    @Inject(NotificationSettingsService) private readonly settings: NotificationSettingsService,
    @Optional()
    @Inject(WHATSAPP_NOTIFIER)
    private readonly whatsapp: WhatsAppNotifierPort | null = null,
  ) {}

  async get(organizationId: string, userId: string): Promise<WorkNotificationPreferencesView> {
    const [doc, s, org] = await Promise.all([
      this.prefs.findOne({ organizationId, userId }).lean<WorkNotificationPreferencesLean>().exec(),
      this.settings.one(organizationId, userId),
      this.settings.org(organizationId),
    ]);
    const legacy = resolveWorkNotificationPreferences(doc);
    // ADR-0079 § 4.4 : canaux EFFECTIFS des douze événements (mode hors projets dirigés).
    const mode = NotificationSettingsService.modeFor(s, org, false);
    const events = {} as Record<WorkNotificationEvent, WorkNotificationChannels>;
    for (const e of WORK_NOTIFICATION_EVENTS) {
      events[e] = effectiveChannels({
        spec: notificationSpecOf(notificationKindOf(e))!,
        mode,
        overrides: s.overrides[mode],
        mutedKinds: s.mutedKinds,
        mandatory: org.mandatory,
      });
    }
    return { events, digest: legacy.digest, revision: doc?.revision ?? 0 };
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
    // ADR-0065 § 3 : même règle pour WhatsApp ; ALLUMER un événement exige un numéro
    // vérifié (garder une valeur déjà enregistrée, elle, est toujours permis).
    // ADR-0076 § 6 : les événements récents sont facultatifs (client N-1) — absents, la
    // valeur enregistrée est gardée.
    const sent = Object.entries(body.events).filter(
      (entry): entry is [string, NonNullable<(typeof entry)[1]>] => entry[1] !== undefined,
    );
    const turnsOnWhatsApp = sent.some(
      ([e, c]) => c.whatsapp === true && !current.events[e as keyof typeof current.events].whatsapp,
    );
    if (turnsOnWhatsApp && !(await this.whatsapp?.isVerified(organizationId, userId))) {
      throw new ConflictException({
        code: 'WHATSAPP_NUMBER_NOT_VERIFIED',
        message: 'Vérifiez d’abord votre numéro WhatsApp pour activer cette notification.',
      });
    }
    const events = Object.fromEntries([
      ...Object.entries(current.events).filter(([e]) => !sent.some(([k]) => k === e)),
      ...sent.map(([e, c]) => {
        const stored = current.events[e as keyof typeof current.events];
        return [
          e,
          {
            bell: c.bell,
            email: c.email,
            slack: c.slack ?? stored.slack,
            whatsapp: c.whatsapp ?? stored.whatsapp,
          },
        ];
      }),
    ]);
    const values = {
      events,
      digest: body.digest,
      digestEnabled: body.digest.enabled,
    };
    // ADR-0079 § 4.4 : les cases deviennent des surcharges des réglages communs.
    const wanted: Partial<Record<NotificationKind, NotificationChannelOverride>> = {};
    for (const [e, c] of Object.entries(events)) {
      wanted[notificationKindOf(e as WorkNotificationEvent)] = c as NotificationChannelOverride;
    }
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
    await this.settings.applyLegacyWork(organizationId, userId, wanted);
    return this.get(organizationId, userId);
  }

  /**
   * ADR-0079 § 8 : le résumé quotidien seul (écran unique « Mes notifications »). Les
   * cases des événements ne sont pas touchées.
   */
  async putDigest(
    organizationId: string,
    userId: string,
    body: Pick<PutWorkNotificationPreferencesBody, 'expectedRevision' | 'digest'>,
  ): Promise<WorkNotificationPreferencesView> {
    const doc = await this.prefs
      .findOne({ organizationId, userId })
      .lean<WorkNotificationPreferencesLean>()
      .exec();
    const revision = doc?.revision ?? 0;
    if (revision !== body.expectedRevision) staleRevision(revision);
    const values = { digest: body.digest, digestEnabled: body.digest.enabled };
    if (!doc) {
      try {
        // `events` vide : les canaux restent ceux des réglages communs (aucune surcharge).
        await this.prefs.create({
          organizationId,
          userId,
          events: {},
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
