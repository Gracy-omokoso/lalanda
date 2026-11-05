// Mes notifications des Projets — préférences PAR UTILISATEUR (ADR-0061 § 2).
//
// Pour chaque événement : cloche (boîte in-app) oui/non, e-mail oui/non. Plus un
// résumé quotidien par e-mail (oui/non, heure de Kinshasa, jours ouvrés seulement).
// Sans document : valeurs par défaut — cloche partout, e-mail pour l'assignation, la
// mention et l'échéance dépassée, pas de résumé. Le serveur APPLIQUE ces préférences
// à l'émission (`WorkNotifier`, rappels, résumé) : rien n'est décoratif.

import { z } from 'zod';

import type { NotificationKind } from '../notifications/index.js';

export const WORK_NOTIFICATION_EVENTS = [
  'task_assigned',
  'mentioned',
  'comment_on_followed',
  'task_due_soon',
  'task_overdue',
  'task_status_changed',
  'added_to_project',
  'project_at_risk',
] as const;
export type WorkNotificationEvent = (typeof WORK_NOTIFICATION_EVENTS)[number];

/** Libellés d'interface (écran « Mes notifications », e-mail). */
export const WORK_NOTIFICATION_EVENT_LABELS: Readonly<Record<WorkNotificationEvent, string>> = {
  task_assigned: 'Une tâche m’est assignée',
  mentioned: 'Je suis mentionné',
  comment_on_followed: 'Commentaire sur une tâche que je suis',
  task_due_soon: 'Échéance proche d’une de mes tâches',
  task_overdue: 'Échéance dépassée d’une de mes tâches',
  task_status_changed: 'Statut (colonne) d’une de mes tâches changé',
  added_to_project: 'Je suis ajouté à un projet',
  project_at_risk: 'Un de mes projets passe à risque',
};

/** Type de notification (boîte commune) d'un événement. */
export function notificationKindOf(event: WorkNotificationEvent): NotificationKind {
  return `work.${event}` as NotificationKind;
}

/** Événement d'un type de notification du module, ou `null`. */
export function workEventOf(kind: string): WorkNotificationEvent | null {
  const e = kind.startsWith('work.') ? kind.slice(5) : '';
  return (WORK_NOTIFICATION_EVENTS as readonly string[]).includes(e)
    ? (e as WorkNotificationEvent)
    : null;
}

export interface WorkNotificationChannels {
  bell: boolean;
  email: boolean;
}

export interface WorkDigestPreferences {
  enabled: boolean;
  /** Heure de Kinshasa (0 à 23) à partir de laquelle le résumé part. */
  hour: number;
  /** Seulement les jours ouvrés de l'organisation (réglage « Comportement »). */
  workingDaysOnly: boolean;
}

export interface WorkNotificationPreferences {
  events: Record<WorkNotificationEvent, WorkNotificationChannels>;
  digest: WorkDigestPreferences;
}

export interface WorkNotificationPreferencesView extends WorkNotificationPreferences {
  /** 0 tant que l'utilisateur n'a rien enregistré (défauts). */
  revision: number;
}

const EMAIL_BY_DEFAULT: readonly WorkNotificationEvent[] = [
  'task_assigned',
  'mentioned',
  'task_overdue',
];

export function defaultWorkNotificationPreferences(): WorkNotificationPreferences {
  const events = {} as Record<WorkNotificationEvent, WorkNotificationChannels>;
  for (const e of WORK_NOTIFICATION_EVENTS) {
    events[e] = { bell: true, email: EMAIL_BY_DEFAULT.includes(e) };
  }
  return { events, digest: { enabled: false, hour: 7, workingDaysOnly: true } };
}

/** Préférences stockées (éventuellement partielles) complétées par les défauts. */
export function resolveWorkNotificationPreferences(
  stored:
    | {
        events?: Partial<Record<string, Partial<WorkNotificationChannels>>> | null;
        digest?: Partial<WorkDigestPreferences> | null;
      }
    | null
    | undefined,
): WorkNotificationPreferences {
  const base = defaultWorkNotificationPreferences();
  for (const e of WORK_NOTIFICATION_EVENTS) {
    const s = stored?.events?.[e];
    if (s) {
      base.events[e] = {
        bell: typeof s.bell === 'boolean' ? s.bell : base.events[e].bell,
        email: typeof s.email === 'boolean' ? s.email : base.events[e].email,
      };
    }
  }
  const d = stored?.digest;
  if (d) {
    base.digest = {
      enabled: typeof d.enabled === 'boolean' ? d.enabled : base.digest.enabled,
      hour: typeof d.hour === 'number' ? d.hour : base.digest.hour,
      workingDaysOnly:
        typeof d.workingDaysOnly === 'boolean' ? d.workingDaysOnly : base.digest.workingDaysOnly,
    };
  }
  return base;
}

const Channels = z
  .object({
    bell: z.boolean({ error: 'Vrai ou faux attendu.' }),
    email: z.boolean({ error: 'Vrai ou faux attendu.' }),
  })
  .strict();

/** `PUT /work/notification-preferences` — remplace les préférences de l'appelant. */
export const PutWorkNotificationPreferencesBody = z
  .object({
    expectedRevision: z.number({ error: 'Révision attendue : un entier.' }).int().min(0),
    events: z
      .object(
        Object.fromEntries(WORK_NOTIFICATION_EVENTS.map((e) => [e, Channels])) as Record<
          WorkNotificationEvent,
          typeof Channels
        >,
      )
      .strict(),
    digest: z
      .object({
        enabled: z.boolean({ error: 'Vrai ou faux attendu.' }),
        hour: z.number({ error: 'Heure attendue (0 à 23).' }).int().min(0).max(23),
        workingDaysOnly: z.boolean({ error: 'Vrai ou faux attendu.' }),
      })
      .strict(),
  })
  .strict();
export type PutWorkNotificationPreferencesBody = z.output<
  typeof PutWorkNotificationPreferencesBody
>;
