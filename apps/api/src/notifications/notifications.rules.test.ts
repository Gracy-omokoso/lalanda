import { describe, expect, it } from 'vitest';

import type { NotificationInput } from './notifications.port.js';
import { heldActions, knownKinds, rejectEmission, retentionDays } from './notifications.rules.js';

const base: NotificationInput = {
  organizationId: 'org-1',
  recipientUserId: 'u-dest',
  kind: 'work.task_assigned',
  requiredAction: 'work.read',
  source: { module: 'work', entityType: 'task', entityId: 't-1', projectId: 'p-1' },
  title: 'Kevin vous a assigné #12 Poser le carrelage',
  href: '/projets/p-1?tache=t-1',
  actorUserId: 'u-kevin',
};

describe('notifications — règles pures', () => {
  it('une émission bien formée est recevable', () => {
    expect(rejectEmission(base)).toBeNull();
    expect(rejectEmission({ ...base, actorUserId: null, dedupeKey: 'k' })).toBeNull();
  });

  it("l'auteur n'est jamais notifié de son propre geste", () => {
    expect(rejectEmission({ ...base, actorUserId: 'u-dest' })).toBe('self_notification');
  });

  it('refuse type, action, lien, titre et clé invalides', () => {
    expect(rejectEmission({ ...base, kind: 'crm.inconnu' as never })).toBe('invalid_kind');
    expect(rejectEmission({ ...base, requiredAction: 'work.tout' as never })).toBe(
      'invalid_action',
    );
    expect(rejectEmission({ ...base, href: 'https://evil.example' })).toBe('invalid_href');
    expect(rejectEmission({ ...base, href: '//evil.example' })).toBe('invalid_href');
    expect(rejectEmission({ ...base, title: '' })).toBe('invalid_title');
    expect(rejectEmission({ ...base, title: 'x'.repeat(201) })).toBe('invalid_title');
    expect(rejectEmission({ ...base, dedupeKey: '' })).toBe('invalid_dedupe_key');
    expect(rejectEmission({ ...base, source: { ...base.source, module: 'autre' as never } })).toBe(
      'invalid_source',
    );
    expect(rejectEmission({ ...base, recipientUserId: '' })).toBe('invalid_recipient');
  });

  it('actions détenues : un Conseiller ne détient pas work.read, un Lecteur oui', () => {
    expect(heldActions('advisor')).not.toContain('work.read');
    expect(heldActions('viewer')).toContain('work.read');
    expect(heldActions('viewer')).toContain('analytics.read');
    expect(heldActions('accountant')).not.toContain('period.close');
    expect(heldActions('accountant', { canClosePeriods: true })).toContain('period.close');
  });

  it('conservation : 180 jours par défaut, bornée de 30 à 365', () => {
    expect(retentionDays({})).toBe(180);
    expect(retentionDays({ NOTIFICATIONS_RETENTION_DAYS: '90' })).toBe(90);
    expect(retentionDays({ NOTIFICATIONS_RETENTION_DAYS: '29' })).toBe(180);
    expect(retentionDays({ NOTIFICATIONS_RETENTION_DAYS: '366' })).toBe(180);
    expect(retentionDays({ NOTIFICATIONS_RETENTION_DAYS: 'abc' })).toBe(180);
  });

  it('types coupés : les types inconnus sont ignorés', () => {
    expect(knownKinds(['work.mentioned', 'crm.disparu'])).toEqual(['work.mentioned']);
    expect(knownKinds(undefined)).toEqual([]);
  });
});
