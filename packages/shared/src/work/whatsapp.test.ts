import { describe, expect, it } from 'vitest';

import {
  PostWhatsAppNumberBody,
  PutWorkNotificationPreferencesBody,
  VerifyWhatsAppNumberBody,
  defaultWorkNotificationPreferences,
  maskWhatsAppPhone,
  normalizeWhatsAppPhone,
  resolveWorkNotificationPreferences,
} from './index.js';

describe('WhatsApp — contrats (ADR-0065)', () => {
  it('normalise un numéro en E.164, +243 proposé par défaut', () => {
    expect(normalizeWhatsAppPhone('+243 81 234 5612')).toBe('+243812345612');
    expect(normalizeWhatsAppPhone('0812345612')).toBe('+243812345612');
    expect(normalizeWhatsAppPhone('812345612')).toBe('+243812345612');
    expect(normalizeWhatsAppPhone('00243 (81) 234-56-12')).toBe('+243812345612');
    expect(normalizeWhatsAppPhone('+33 6 12 34 56 78')).toBe('+33612345678');
    expect(normalizeWhatsAppPhone('+2438123')).toBeNull();
    expect(normalizeWhatsAppPhone('+24381234561299')).toBeNull();
    expect(normalizeWhatsAppPhone('+243 08 123 4567')).toBeNull();
    expect(normalizeWhatsAppPhone('abc')).toBeNull();
    expect(normalizeWhatsAppPhone('+0123456789')).toBeNull();
    expect(normalizeWhatsAppPhone('')).toBeNull();
  });

  it('masque le numéro (journaux, audit)', () => {
    expect(maskWhatsAppPhone('+243812345612')).toBe('+243 81 *** **12');
    expect(maskWhatsAppPhone('+33612345678')).toBe('+336 *** **78');
    expect(maskWhatsAppPhone('+243812345612')).not.toContain('2345');
  });

  it('préférences : WhatsApp par défaut pour l’assignation, la mention, l’échéance dépassée', () => {
    const d = defaultWorkNotificationPreferences();
    const avec = Object.entries(d.events)
      .filter(([, c]) => c.whatsapp)
      .map(([e]) => e);
    expect(avec).toEqual(['task_assigned', 'mentioned', 'task_overdue']);
    const r = resolveWorkNotificationPreferences({ events: { mentioned: { bell: false } } });
    expect(r.events.mentioned).toEqual({ bell: false, email: true, slack: true, whatsapp: true });
  });

  it('PUT des préférences : colonne WhatsApp facultative, booléenne', () => {
    const d = defaultWorkNotificationPreferences();
    const base = { expectedRevision: 0, digest: d.digest };
    const legacy = Object.fromEntries(
      Object.entries(d.events).map(([e, c]) => [e, { bell: c.bell, email: c.email }]),
    );
    expect(PutWorkNotificationPreferencesBody.safeParse({ ...base, events: legacy }).success).toBe(
      true,
    );
    expect(
      PutWorkNotificationPreferencesBody.safeParse({ ...base, events: d.events }).success,
    ).toBe(true);
    const faux = { ...d.events, mentioned: { bell: true, email: true, whatsapp: 1 } };
    expect(PutWorkNotificationPreferencesBody.safeParse({ ...base, events: faux }).success).toBe(
      false,
    );
  });

  it('corps : numéro borné, code à 6 chiffres, aucun champ en trop', () => {
    expect(PostWhatsAppNumberBody.safeParse({ phone: '+243812345612' }).success).toBe(true);
    expect(PostWhatsAppNumberBody.safeParse({ phone: '' }).success).toBe(false);
    expect(PostWhatsAppNumberBody.safeParse({ phone: '1', userId: 'x' }).success).toBe(false);
    expect(VerifyWhatsAppNumberBody.safeParse({ code: '012345' }).success).toBe(true);
    expect(VerifyWhatsAppNumberBody.safeParse({ code: '12345' }).success).toBe(false);
    expect(VerifyWhatsAppNumberBody.safeParse({ code: '12345a' }).success).toBe(false);
  });
});
