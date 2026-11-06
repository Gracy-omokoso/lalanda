import { describe, expect, it } from 'vitest';

import {
  PutWorkNotificationPreferencesBody,
  PutWorkProjectSlackChannelBody,
  SLACK_BOT_SCOPES,
  defaultWorkNotificationPreferences,
  resolveWorkNotificationPreferences,
} from './index.js';

describe('Slack — contrats (ADR-0064)', () => {
  it('portées minimales, dans l’ordre du manifeste', () => {
    expect([...SLACK_BOT_SCOPES]).toEqual([
      'chat:write',
      'chat:write.public',
      'users:read',
      'users:read.email',
      'im:write',
      'channels:read',
    ]);
  });

  it('préférences : Slack par défaut pour l’assignation et la mention seulement', () => {
    const d = defaultWorkNotificationPreferences();
    const avecSlack = Object.entries(d.events)
      .filter(([, c]) => c.slack)
      .map(([e]) => e);
    expect(avecSlack).toEqual(['task_assigned', 'mentioned']);
    // Document antérieur sans colonne Slack : complété par le défaut.
    const r = resolveWorkNotificationPreferences({ events: { mentioned: { bell: false } } });
    expect(r.events.mentioned).toEqual({ bell: false, email: true, slack: true, whatsapp: true });
  });

  it('PUT des préférences : colonne Slack facultative, booléenne', () => {
    const d = defaultWorkNotificationPreferences();
    const legacy = Object.fromEntries(
      Object.entries(d.events).map(([e, c]) => [e, { bell: c.bell, email: c.email }]),
    );
    const base = { expectedRevision: 0, digest: d.digest };
    expect(PutWorkNotificationPreferencesBody.safeParse({ ...base, events: legacy }).success).toBe(
      true,
    );
    expect(
      PutWorkNotificationPreferencesBody.safeParse({ ...base, events: d.events }).success,
    ).toBe(true);
    const faux = { ...d.events, mentioned: { bell: true, email: true, slack: 'oui' } };
    expect(PutWorkNotificationPreferencesBody.safeParse({ ...base, events: faux }).success).toBe(
      false,
    );
  });

  it('canal d’un projet : identifiant de canal PUBLIC seulement, null retire', () => {
    const ok = (v: unknown) => PutWorkProjectSlackChannelBody.safeParse(v).success;
    expect(ok({ channelId: 'C0123ABCD' })).toBe(true);
    expect(ok({ channelId: null })).toBe(true);
    expect(ok({ channelId: 'G0123ABCD' })).toBe(false);
    expect(ok({ channelId: 'D0123ABCD' })).toBe(false);
    expect(ok({ channelId: 'C0123ABCD', channelName: '<script>' })).toBe(false);
    expect(ok({ channelId: 'C0123ABCD', autre: 1 })).toBe(false);
  });
});
