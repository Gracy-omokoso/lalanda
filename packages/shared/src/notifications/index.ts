// `@lalanda/shared/notifications` — boîte de notifications in-app commune à tout
// Lalanda (ADR-0039 § 2.11, O6). Le module générique de l'API stocke,
// déduplique, sert et marque comme lu ; il ne connaît aucun module producteur.
// Les producteurs émettent par le port `NOTIFICATIONS_PORT`
// (`apps/api/src/notifications/notifications.port.ts`).
//
// Ajouter un type : l'ajouter à `NOTIFICATION_KINDS` (union fermée), avec son
// module d'origine en préfixe (ex. `crm.follow_up_due`).

import { z } from 'zod';

/** Types de notification (union fermée). */
export const NOTIFICATION_KINDS = [
  'work.task_assigned',
  'work.mentioned',
  'work.comment_on_followed',
  'work.task_due_soon',
  'work.task_overdue',
  'work.milestone_completed',
  // ADR-0040 — C4 § 5.4 : relances et opportunités du CRM. `crm.opportunity_won`
  // est déclaré ici et émis par le lot C7 (opportunité gagnée → projet).
  'crm.activity_assigned',
  'crm.activity_due_soon',
  'crm.activity_overdue',
  'crm.opportunity_assigned',
  'crm.opportunity_won',
  // ADR-0041 — A4 : « Vos autorisations ont changé » (titre, ajouts, retraits, clôture).
  'organization.permissions_changed',
  // ADR-0044 — P0 (§ 6.5) : achats et fournisseurs. Déclarés ici, émis par P2 (coordonnées),
  // P3 (approbations), P4 (écarts) et P6 (rappels d'échéance) ; refiltrés à la lecture
  // par `purchase.read`.
  'purchases.approval_requested',
  'purchases.request_approved',
  'purchases.request_rejected',
  'purchases.invoice_variance',
  'purchases.invoice_due_soon',
  'purchases.invoice_overdue',
  'purchases.supplier_payment_details_changed',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Modules producteurs connus. */
// ADR-0041 — A4 : `organization` (gestion des membres). ADR-0044 — P0 : `purchases`.
export const NOTIFICATION_SOURCE_MODULES = ['work', 'crm', 'organization', 'purchases'] as const;
export type NotificationSourceModule = (typeof NOTIFICATION_SOURCE_MODULES)[number];

/** Natures de l'entité d'origine (ADR-0040 — C4 § 5.4 : `activity`, `opportunity`, `account`). */
export const NOTIFICATION_ENTITY_TYPES = [
  'task',
  'project',
  'activity',
  'opportunity',
  'account',
  // ADR-0041 — A4 : appartenance dont les autorisations ont changé.
  'membership',
  // ADR-0044 — P0 (§ 6.5) : demande ou commande, facture fournisseur, fiche fournisseur.
  'purchase_order',
  'supplier_invoice',
  'supplier',
] as const;
export type NotificationEntityType = (typeof NOTIFICATION_ENTITY_TYPES)[number];

/** Bornes (ADR-0039 § 2.11). */
export const NOTIFICATION_LIMITS = {
  titleMax: 200,
  hrefMax: 500,
  dedupeKeyMax: 200,
  /** Nombre affiché dans le panneau de la cloche. */
  bellPanelSize: 20,
  /** Intervalle d'interrogation du compteur quand l'onglet est visible (ms). */
  unreadPollMs: 60_000,
  pageDefault: 20,
  pageMax: 100,
  /** Rétention (TTL sur `createdAt`), `NOTIFICATIONS_RETENTION_DAYS`. */
  retentionDaysDefault: 180,
  retentionDaysMin: 30,
  retentionDaysMax: 365,
} as const;

/**
 * Lien d'une notification : chemin RELATIF de l'application, jamais une URL
 * absolue ni un chemin réseau (`//hôte`). Pas d'espace ni de barre oblique
 * inverse (certains navigateurs la lisent comme `/`).
 */
export const NOTIFICATION_HREF_PATTERN = /^\/(?![/\\])[^\s\\]*$/;

export function isNotificationHref(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= NOTIFICATION_LIMITS.hrefMax &&
    NOTIFICATION_HREF_PATTERN.test(value)
  );
}

/** Origine d'une notification. */
export interface NotificationSource {
  module: NotificationSourceModule;
  entityType: NotificationEntityType;
  entityId: string;
  projectId?: string;
}

/**
 * Ce qu'un module producteur émet (port `NotificationsPort.notify`). Le titre est
 * FIGÉ à l'émission ; `requiredAction` est une action RBAC que le destinataire
 * doit encore détenir pour voir la notification (filtrée à la lecture).
 */
export interface NotificationEmission<A extends string = string> {
  organizationId: string;
  recipientUserId: string;
  kind: NotificationKind;
  requiredAction: A;
  source: NotificationSource;
  title: string;
  href: string;
  /** `null` pour un rappel automatique. L'auteur n'est jamais notifié de son geste. */
  actorUserId: string | null;
  /** Ex. `work.task_due_soon:<taskId>:<dueDate>` : une seule notification par clé. */
  dedupeKey?: string;
}

/** Notification servie au destinataire. */
export interface NotificationView {
  id: string;
  kind: NotificationKind;
  source: NotificationSource;
  title: string;
  href: string;
  actorUserId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPageView {
  items: NotificationView[];
  nextCursor: string | null;
}

export interface UnreadCountView {
  unread: number;
}

export interface NotificationPreferencesView {
  mutedKinds: NotificationKind[];
}

/** `GET /notifications` — les siennes, organisation active. */
export const ListNotificationsQuery = z
  .object({
    unreadOnly: z
      .enum(['true', 'false'], { error: 'Valeur attendue : true ou false.' })
      .transform((v) => v === 'true')
      .optional(),
    limit: z
      .string()
      .regex(/^\d{1,3}$/, `Limite : un entier de 1 à ${NOTIFICATION_LIMITS.pageMax}.`)
      .transform((v) => Number.parseInt(v, 10))
      .pipe(z.number().int().min(1).max(NOTIFICATION_LIMITS.pageMax))
      .prefault(String(NOTIFICATION_LIMITS.pageDefault)),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type ListNotificationsQuery = z.output<typeof ListNotificationsQuery>;

/** `PUT /notifications/preferences` — remplace la liste des types coupés. */
export const PutNotificationPreferencesBody = z
  .object({
    mutedKinds: z
      .array(z.enum(NOTIFICATION_KINDS, { error: 'Type de notification inconnu.' }))
      .max(NOTIFICATION_KINDS.length)
      .superRefine((kinds, ctx) => {
        if (new Set(kinds).size !== kinds.length) {
          ctx.addIssue({
            code: 'custom',
            message: 'Un type est coupé deux fois.',
            params: { code: 'NOTIFICATION_KIND_DUPLICATE' },
          });
        }
      }),
  })
  .strict();
export type PutNotificationPreferencesBody = z.output<typeof PutNotificationPreferencesBody>;
