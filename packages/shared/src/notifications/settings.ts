// Réglages de notification — ADR-0079 § 4 à § 6.
//
// PAR PERSONNE ET PAR ORGANISATION (`notification_settings`) : le mode choisi (ou `null`
// = défaut de l'organisation pour son rôle), les surcharges GARDÉES PAR MODE (changer de
// mode ne perd rien), « me notifier aussi de mes propres actions », les heures calmes
// (Kinshasa) de WhatsApp et Slack.
//
// PAR ORGANISATION (`notification_org_settings`, `organization.manage`) : mode par
// défaut du chef de projet (et de l'adjoint), par rôle d'organisation et des autres ;
// notifications OBLIGATOIRES (type × canal) ; plafond quotidien WhatsApp par personne.
//
// JOURNAL D'ENVOI (`notification_deliveries`) : par notification et par canal, envoyée
// ou ignorée et pourquoi — jamais le titre ni le contenu.

import { z } from 'zod';

import {
  CONFIGURABLE_NOTIFICATION_KINDS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_MODES,
  type MandatoryNotification,
  type NotificationChannel,
  type NotificationMode,
  type NotificationModeOverrides,
} from './catalog.js';
import type { NotificationKind, NotificationSourceModule } from './index.js';

export const NOTIFICATION_SETTINGS_LIMITS = {
  /** Fenêtre de regroupement des rafales (cloche, e-mail, Slack, WhatsApp). */
  burstWindowMinutes: 10,
  /** Plafond quotidien WhatsApp par personne (messages payants) — défaut et bornes. */
  whatsappDailyCapDefault: 20,
  whatsappDailyCapMin: 0,
  whatsappDailyCapMax: 200,
  /** Heures calmes par défaut (Kinshasa) : de 21 h à 7 h. */
  quietHoursStartDefault: 21,
  quietHoursEndDefault: 7,
  /** Journal d'envoi : conservation (jours) et page. */
  deliveriesRetentionDays: 90,
  deliveriesPageDefault: 50,
  deliveriesPageMax: 200,
  /** « M'envoyer un test » : au plus 5 par heure et par personne, tous canaux confondus. */
  testsPerHour: 5,
  mandatoryMax: 200,
} as const;

/** Rôle « chef de projet » : vaut pour le chef ET l'adjoint (ADR-0076). */
export const PROJECT_LEAD_ROLE_KEY = 'project_lead';

export interface QuietHours {
  enabled: boolean;
  /** Heure de Kinshasa (0 à 23) de début, incluse. */
  start: number;
  /** Heure de Kinshasa (0 à 23) de fin, exclue. */
  end: number;
}

/** Heure de Kinshasa (UTC+1, sans heure d'été). */
export function kinshasaHourOf(d: Date): number {
  return (d.getUTCHours() + 1) % 24;
}

/** `d` tombe-t-il dans les heures calmes ? (21 → 7 enjambe minuit.) */
export function inQuietHours(q: QuietHours, d: Date): boolean {
  if (!q.enabled || q.start === q.end) return false;
  const h = kinshasaHourOf(d);
  return q.start < q.end ? h >= q.start && h < q.end : h >= q.start || h < q.end;
}

// ── Vues ────────────────────────────────────────────────────────────────────

export interface NotificationOrgSettingsView {
  /** Mode par défaut du chef et de l'adjoint, pour les événements de LEUR projet. */
  projectLeadMode: NotificationMode;
  /** Mode par défaut de tout membre sans réglage par rôle. */
  memberMode: NotificationMode;
  /** Mode par défaut par rôle d'organisation (facultatif). */
  byRole: Partial<Record<string, NotificationMode>>;
  mandatory: MandatoryNotification[];
  whatsappDailyCap: number;
  revision: number;
  /** L'appelant peut-il modifier (`organization.manage`) ? */
  canManage: boolean;
}

export interface NotificationSettingsView {
  /** Mode choisi ; `null` = défaut de l'organisation. */
  mode: NotificationMode | null;
  /** Mode par défaut de l'appelant (rôle d'organisation). */
  defaultMode: NotificationMode;
  /** Mode par défaut pour les projets qu'il dirige (chef ou adjoint). */
  projectLeadMode: NotificationMode;
  /** Mode appliqué hors des projets qu'il dirige. */
  effectiveMode: NotificationMode;
  /** Surcharges gardées par mode. */
  overrides: Record<NotificationMode, NotificationModeOverrides>;
  customized: Record<NotificationMode, boolean>;
  notifyOwnActions: boolean;
  quietHours: QuietHours;
  /** Obligations de l'organisation (non désactivables). */
  mandatory: MandatoryNotification[];
  /** Types coupés depuis l'ancienne page `/notifications` (cloche). */
  mutedKinds: NotificationKind[];
  /** Ancien réglage ADR-0061 converti (mode personnalisé). */
  migratedFrom: 'adr-0061' | null;
  revision: number;
}

/** Disponibilité d'un canal pour l'appelant (écran « état des canaux »). */
export interface NotificationChannelStatus {
  channel: NotificationChannel;
  ready: boolean;
  /** Raison quand `ready` est faux (`slack_not_connected`, `whatsapp_not_verified`…). */
  reason: NotificationSkipReason | null;
  /** Détail affichable (« espace Acme », « +243 81 *** **12 »). */
  detail: string | null;
}

export interface NotificationChannelsView {
  channels: NotificationChannelStatus[];
  /** Types pour lesquels le modèle WhatsApp est approuvé (sinon « indisponible »). */
  whatsappKinds: NotificationKind[];
  whatsappDailyCap: number;
  whatsappSentToday: number;
}

export const NOTIFICATION_DELIVERY_STATUSES = ['sent', 'queued', 'skipped', 'failed'] as const;
export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number];

/** Pourquoi un canal n'a pas servi. Liste fermée, affichée en clair. */
export const NOTIFICATION_SKIP_REASONS = [
  'channel_off',
  'not_permitted',
  'muted',
  'grouped',
  'duplicate',
  'quiet_hours',
  'daily_cap',
  'monthly_quota',
  'no_email',
  'mail_not_configured',
  'slack_unavailable',
  'slack_not_connected',
  'slack_unmatched',
  'whatsapp_unavailable',
  'whatsapp_not_verified',
  'template_unavailable',
  'provider_error',
  'not_member',
  'not_allowed',
  'error',
] as const;
export type NotificationSkipReason = (typeof NOTIFICATION_SKIP_REASONS)[number];

export const NOTIFICATION_SKIP_REASON_LABELS: Readonly<Record<NotificationSkipReason, string>> = {
  channel_off: 'Canal coupé dans vos réglages',
  not_permitted: 'Canal non permis pour cet événement',
  muted: 'Type coupé (ancienne page des notifications)',
  grouped: 'Regroupée avec la précédente (rafale)',
  duplicate: 'Déjà reçue',
  quiet_hours: 'Heures calmes',
  daily_cap: 'Plafond quotidien WhatsApp atteint',
  monthly_quota: 'Plafond mensuel WhatsApp de l’organisation atteint',
  no_email: 'Aucune adresse e-mail',
  mail_not_configured: 'Envoi d’e-mails non configuré',
  slack_unavailable: 'Slack indisponible sur Lalanda',
  slack_not_connected: 'Slack non connecté pour l’organisation',
  slack_unmatched: 'Votre adresse est introuvable dans l’espace Slack',
  whatsapp_unavailable: 'WhatsApp indisponible sur Lalanda',
  whatsapp_not_verified: 'Numéro WhatsApp non vérifié',
  template_unavailable: 'Modèle WhatsApp non approuvé pour cet événement',
  provider_error: 'Erreur du fournisseur',
  not_member: 'Plus membre de l’organisation',
  not_allowed: 'Droit requis non détenu',
  error: 'Erreur interne',
};

export interface NotificationChannelOutcome {
  status: NotificationDeliveryStatus;
  reason: NotificationSkipReason | null;
  at: string;
}

/** Une ligne du journal : une notification, un destinataire, ses canaux. */
export interface NotificationDeliveryView {
  id: string;
  kind: NotificationKind;
  module: NotificationSourceModule | 'organization';
  userId: string;
  /** Nom du destinataire — vue d'administration seulement. */
  userName?: string;
  channels: Partial<Record<NotificationChannel, NotificationChannelOutcome>>;
  test: boolean;
  createdAt: string;
}

export interface NotificationDeliveriesPageView {
  items: NotificationDeliveryView[];
  nextCursor: string | null;
}

export interface NotificationTestView {
  channel: NotificationChannel;
  outcome: NotificationChannelOutcome;
}

/** Notifications des AUTRES organisations de l'appelant (cloche, § 1). */
export interface UnreadElsewhereView {
  organizations: { organizationId: string; name: string; unread: number }[];
}

// ── Corps ───────────────────────────────────────────────────────────────────

const Mode = z.enum(NOTIFICATION_MODES, {
  error: 'Mode attendu : perroquet, attenue ou essentiel.',
});
const Hour = z.number({ error: 'Heure attendue (0 à 23).' }).int().min(0).max(23);
const Bool = z.boolean({ error: 'Vrai ou faux attendu.' });
const Kind = z.enum(CONFIGURABLE_NOTIFICATION_KINDS as [NotificationKind, ...NotificationKind[]], {
  error: 'Type de notification inconnu ou non réglable.',
});
const Channel = z.enum(NOTIFICATION_CHANNELS, { error: 'Canal inconnu.' });

const ChannelOverride = z
  .object(Object.fromEntries(NOTIFICATION_CHANNELS.map((c) => [c, Bool.optional()])))
  .strict();

const ModeOverrides = z.record(z.string(), ChannelOverride).superRefine((rec, ctx) => {
  for (const k of Object.keys(rec)) {
    if (!Kind.safeParse(k).success) {
      ctx.addIssue({
        code: 'custom',
        message: `Type de notification inconnu ou non réglable : ${k}.`,
        path: [k],
        params: { code: 'NOTIFICATION_KIND_UNKNOWN' },
      });
    }
  }
});

/** `PUT /notifications/settings` — remplace les réglages de l'appelant. */
export const PutNotificationSettingsBody = z
  .object({
    expectedRevision: z.number({ error: 'Révision attendue : un entier.' }).int().min(0),
    mode: Mode.nullable(),
    overrides: z
      .object(Object.fromEntries(NOTIFICATION_MODES.map((m) => [m, ModeOverrides.optional()])))
      .strict(),
    notifyOwnActions: Bool,
    quietHours: z.object({ enabled: Bool, start: Hour, end: Hour }).strict(),
  })
  .strict();
export type PutNotificationSettingsBody = z.output<typeof PutNotificationSettingsBody>;

const Mandatory = z.object({ kind: Kind, channel: Channel }).strict();

/** `PUT /notifications/organization-settings` (`organization.manage`). */
export const PutNotificationOrgSettingsBody = z
  .object({
    expectedRevision: z.number({ error: 'Révision attendue : un entier.' }).int().min(0),
    projectLeadMode: Mode,
    memberMode: Mode,
    byRole: z.record(z.string().min(1).max(40), Mode),
    mandatory: z.array(Mandatory).max(NOTIFICATION_SETTINGS_LIMITS.mandatoryMax),
    whatsappDailyCap: z
      .number({ error: 'Plafond attendu : un entier.' })
      .int()
      .min(NOTIFICATION_SETTINGS_LIMITS.whatsappDailyCapMin)
      .max(NOTIFICATION_SETTINGS_LIMITS.whatsappDailyCapMax),
  })
  .strict();
export type PutNotificationOrgSettingsBody = z.output<typeof PutNotificationOrgSettingsBody>;

/** `POST /notifications/test`. */
export const SendNotificationTestBody = z.object({ channel: Channel }).strict();
export type SendNotificationTestBody = z.output<typeof SendNotificationTestBody>;

/** `GET /notifications/deliveries` et `…/deliveries/organization`. */
export const ListNotificationDeliveriesQuery = z
  .object({
    limit: z
      .string()
      .regex(/^\d{1,3}$/, 'Limite : un entier.')
      .transform((v) => Number.parseInt(v, 10))
      .pipe(z.number().int().min(1).max(NOTIFICATION_SETTINGS_LIMITS.deliveriesPageMax))
      .prefault(String(NOTIFICATION_SETTINGS_LIMITS.deliveriesPageDefault)),
    cursor: z.string().min(1).max(512).optional(),
    channel: Channel.optional(),
    status: z.enum(NOTIFICATION_DELIVERY_STATUSES).optional(),
  })
  .strict();
export type ListNotificationDeliveriesQuery = z.output<typeof ListNotificationDeliveriesQuery>;

/** Obligations proposées par défaut : « une validation vous attend » dans la cloche. */
export const DEFAULT_MANDATORY_NOTIFICATIONS: readonly MandatoryNotification[] = [
  { kind: 'work.task_approval_requested', channel: 'bell' },
  { kind: 'work.timesheet_submitted', channel: 'bell' },
  { kind: 'purchases.approval_requested', channel: 'bell' },
  { kind: 'hr.leave_requested', channel: 'bell' },
  { kind: 'hr.expense_submitted', channel: 'bell' },
  { kind: 'hr.advance_submitted', channel: 'bell' },
  { kind: 'hr.attendance_correction_requested', channel: 'bell' },
  { kind: 'sales.contract_submitted', channel: 'bell' },
  { kind: 'stock.count_submitted', channel: 'bell' },
];
