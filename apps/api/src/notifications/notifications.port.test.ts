import { describe, expect, it } from 'vitest';

import {
  NOTIFICATIONS_PORT,
  noNotifications,
  type NotificationInput,
} from './notifications.port.js';

describe('port de notifications (ADR-0039 O6)', () => {
  it('le fournisseur nul accepte toute émission sans rien faire', async () => {
    const input: NotificationInput = {
      organizationId: '64b7f0c2a1b2c3d4e5f60718',
      recipientUserId: '64b7f0c2a1b2c3d4e5f60719',
      kind: 'work.task_assigned',
      requiredAction: 'work.read',
      source: { module: 'work', entityType: 'task', entityId: '64b7f0c2a1b2c3d4e5f6071a' },
      title: 'Kevin vous a assigné #12 Poser le carrelage',
      href: '/projets/64b7f0c2a1b2c3d4e5f6071b?tache=64b7f0c2a1b2c3d4e5f6071a',
      actorUserId: '64b7f0c2a1b2c3d4e5f6071c',
    };
    await expect(noNotifications.notify(input)).resolves.toBeUndefined();
  });

  it('le jeton est un symbole unique', () => {
    expect(typeof NOTIFICATIONS_PORT).toBe('symbol');
    expect(NOTIFICATIONS_PORT.description).toBe('NOTIFICATIONS_PORT');
  });
});
