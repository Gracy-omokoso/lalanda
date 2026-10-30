import { describe, expect, it } from 'vitest';

import {
  ListNotificationsQuery,
  NOTIFICATION_ENTITY_TYPES,
  NOTIFICATION_KINDS,
  NOTIFICATION_SOURCE_MODULES,
  PutNotificationPreferencesBody,
  isNotificationHref,
} from './index.js';

describe('notifications — contrats partagés', () => {
  it('déclare six types work, cinq crm, un organization et sept purchases, préfixés par leur module', () => {
    expect(NOTIFICATION_KINDS).toHaveLength(19);
    for (const kind of NOTIFICATION_KINDS) {
      const module = kind.split('.')[0]!;
      expect(NOTIFICATION_SOURCE_MODULES as readonly string[]).toContain(module);
    }
    expect(NOTIFICATION_KINDS.filter((k) => k.startsWith('crm.'))).toEqual([
      'crm.activity_assigned',
      'crm.activity_due_soon',
      'crm.activity_overdue',
      'crm.opportunity_assigned',
      'crm.opportunity_won',
    ]);
    expect(NOTIFICATION_ENTITY_TYPES).toEqual([
      'task',
      'project',
      'activity',
      'opportunity',
      'account',
      'membership',
      'purchase_order',
      'supplier_invoice',
      'supplier',
    ]);
    // ADR-0041 — A4.
    expect(NOTIFICATION_KINDS.filter((k) => k.startsWith('organization.'))).toEqual([
      'organization.permissions_changed',
    ]);
    // ADR-0044 — P0 (§ 6.5) : sept types, un module, trois natures d'entité.
    expect(NOTIFICATION_KINDS.filter((k) => k.startsWith('purchases.'))).toEqual([
      'purchases.approval_requested',
      'purchases.request_approved',
      'purchases.request_rejected',
      'purchases.invoice_variance',
      'purchases.invoice_due_soon',
      'purchases.invoice_overdue',
      'purchases.supplier_payment_details_changed',
    ]);
    expect(NOTIFICATION_SOURCE_MODULES).toContain('purchases');
  });

  it('un lien est un chemin relatif de l’application, jamais une URL absolue', () => {
    expect(isNotificationHref('/projets/abc?tache=def')).toBe(true);
    for (const bad of [
      'https://evil.example/x',
      '//evil.example/x',
      '/\\evil.example',
      'projets/abc',
      'javascript:alert(1)',
      '/a b',
      '',
    ]) {
      expect(isNotificationHref(bad), bad).toBe(false);
    }
  });

  it('liste : non lues seulement, limite bornée', () => {
    expect(ListNotificationsQuery.parse({ unreadOnly: 'true' })).toEqual({
      unreadOnly: true,
      limit: 20,
    });
    expect(ListNotificationsQuery.safeParse({ limit: '101' }).success).toBe(false);
    expect(ListNotificationsQuery.safeParse({ autre: '1' }).success).toBe(false);
  });

  it('préférences : types connus, sans doublon', () => {
    expect(
      PutNotificationPreferencesBody.safeParse({ mutedKinds: ['work.mentioned'] }).success,
    ).toBe(true);
    expect(PutNotificationPreferencesBody.safeParse({ mutedKinds: ['crm.inconnu'] }).success).toBe(
      false,
    );
    expect(
      PutNotificationPreferencesBody.safeParse({
        mutedKinds: ['work.mentioned', 'work.mentioned'],
      }).success,
    ).toBe(false);
  });
});
