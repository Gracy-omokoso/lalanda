// Règles pures du module de notifications (ADR-0039 § 2.11 et § 4) : validation
// d'une émission, actions détenues, durée de conservation. Sans Nest ni Mongo,
// testées par `notifications.rules.test.ts`.

import {
  NOTIFICATION_ENTITY_TYPES,
  NOTIFICATION_KINDS,
  NOTIFICATION_LIMITS,
  NOTIFICATION_SOURCE_MODULES,
  isNotificationHref,
  type NotificationKind,
} from '@lalanda/shared/notifications';

import {
  ACTIONS,
  can,
  isAction,
  type Action,
  type OrgPermissionContext,
  type OrgRole,
} from '../authz/permissions.js';
import type { NotificationInput } from './notifications.port.js';

/** Motif pour lequel une émission est écartée (journalisé, jamais levé). */
export type EmissionRejection =
  | 'invalid_kind'
  | 'invalid_action'
  | 'invalid_source'
  | 'invalid_title'
  | 'invalid_href'
  | 'invalid_dedupe_key'
  | 'invalid_recipient'
  | 'self_notification';

const KIND_SET = new Set<string>(NOTIFICATION_KINDS);
const MODULE_SET = new Set<string>(NOTIFICATION_SOURCE_MODULES);
// ADR-0040 — C4 : `activity`, `opportunity`, `account` (CRM) s'ajoutent à `task`, `project`.
const ENTITY_TYPE_SET = new Set<string>(NOTIFICATION_ENTITY_TYPES);

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === 'string' && KIND_SET.has(value);
}

function nonEmpty(value: unknown, max = 200): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

/**
 * Contrôle de FORME d'une émission, avant toute lecture en base. Rend `null` si
 * elle est recevable, sinon le motif du rejet. L'auteur n'est jamais notifié de
 * son propre geste.
 */
export function rejectEmission(input: NotificationInput): EmissionRejection | null {
  if (!nonEmpty(input.organizationId) || !nonEmpty(input.recipientUserId)) {
    return 'invalid_recipient';
  }
  if (input.actorUserId !== null && input.actorUserId === input.recipientUserId) {
    return 'self_notification';
  }
  if (!isNotificationKind(input.kind)) return 'invalid_kind';
  if (!isAction(input.requiredAction)) return 'invalid_action';
  const s = input.source as Partial<NotificationInput['source']> | undefined;
  if (
    !s ||
    !MODULE_SET.has(String(s.module)) ||
    !ENTITY_TYPE_SET.has(String(s.entityType)) ||
    !nonEmpty(s.entityId) ||
    (s.projectId !== undefined && !nonEmpty(s.projectId))
  ) {
    return 'invalid_source';
  }
  if (!nonEmpty(input.title, NOTIFICATION_LIMITS.titleMax)) return 'invalid_title';
  if (!isNotificationHref(input.href)) return 'invalid_href';
  if (
    input.dedupeKey !== undefined &&
    !nonEmpty(input.dedupeKey, NOTIFICATION_LIMITS.dedupeKeyMax)
  ) {
    return 'invalid_dedupe_key';
  }
  return null;
}

/** Actions détenues par un rôle : filtre de lecture sur `requiredAction`. */
export function heldActions(role: OrgRole, ctx: OrgPermissionContext = {}): Action[] {
  return ACTIONS.filter((a) => can(role, a, ctx));
}

/** `NOTIFICATIONS_RETENTION_DAYS` : entier de 30 à 365, sinon 180. */
export function retentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['NOTIFICATIONS_RETENTION_DAYS'];
  if (raw === undefined || raw.trim() === '') return NOTIFICATION_LIMITS.retentionDaysDefault;
  const n = Number(raw);
  return Number.isInteger(n) &&
    n >= NOTIFICATION_LIMITS.retentionDaysMin &&
    n <= NOTIFICATION_LIMITS.retentionDaysMax
    ? n
    : NOTIFICATION_LIMITS.retentionDaysDefault;
}

/** Types coupés connus (un type retiré de l'union est ignoré à la lecture). */
export function knownKinds(kinds: readonly unknown[] | null | undefined): NotificationKind[] {
  return (kinds ?? []).filter(isNotificationKind);
}
