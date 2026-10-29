import { describe, expect, it } from 'vitest';

import {
  ListNotificationsQuery,
  NOTIFICATION_KINDS,
  PutNotificationPreferencesBody,
  isNotificationHref,
} from './index.js';

describe('notifications — contrats partagés', () => {
  it('déclare les six types du module work, préfixés par leur module', () => {
    expect(NOTIFICATION_KINDS).toHaveLength(6);
    for (const kind of NOTIFICATION_KINDS) expect(kind.startsWith('work.')).toBe(true);
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
