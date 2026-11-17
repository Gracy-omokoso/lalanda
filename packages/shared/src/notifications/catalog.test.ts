// Catalogue des événements et modes — ADR-0079 § 2 et § 4.

import { describe, expect, it } from 'vitest';

import {
  CONFIGURABLE_NOTIFICATION_KINDS,
  NOTIFICATION_CATALOG,
  NOTIFICATION_FAMILIES,
  NOTIFICATION_KINDS,
  PutNotificationOrgSettingsBody,
  PutNotificationSettingsBody,
  burstTitle,
  defaultChannelsFor,
  effectiveChannels,
  inQuietHours,
  isModeCustomized,
  kinshasaHourOf,
  modeDisplayLabel,
  notificationSpecOf,
  overridesFor,
  tierActiveIn,
} from './index.js';

const spec = (k: string) => notificationSpecOf(k)!;

describe('catalogue des notifications (ADR-0079 § 2)', () => {
  it('couvre chaque type de la boîte commune sauf l’annonce et le test', () => {
    const expected = NOTIFICATION_KINDS.filter(
      (k) => k !== 'platform.announcement' && k !== 'organization.notification_test',
    );
    expect([...CONFIGURABLE_NOTIFICATION_KINDS].sort()).toEqual([...expected].sort());
    for (const k of CONFIGURABLE_NOTIFICATION_KINDS) {
      const s = NOTIFICATION_CATALOG[k]!;
      expect(s.kind).toBe(k);
      expect(k.startsWith(`${s.module}.`)).toBe(true);
      expect(s.family.startsWith(`${s.module}.`)).toBe(true);
      expect(Object.keys(NOTIFICATION_FAMILIES)).toContain(s.family);
      expect(s.label.length).toBeGreaterThan(5);
      expect(s.audience.length).toBeGreaterThan(0);
      expect(s.channels).toContain('bell');
    }
  });

  it('les familles des Projets demandées existent toutes', () => {
    const families = new Set(
      CONFIGURABLE_NOTIFICATION_KINDS.filter((k) => k.startsWith('work.')).map(
        (k) => spec(k).family,
      ),
    );
    expect([...families].sort()).toEqual(
      [
        'work.approvals',
        'work.exchanges',
        'work.milestones',
        'work.project',
        'work.tasks',
        'work.time',
      ].sort(),
    );
  });

  it('RH : jamais Slack ni WhatsApp (confidentialité)', () => {
    for (const k of CONFIGURABLE_NOTIFICATION_KINDS.filter((x) => x.startsWith('hr.'))) {
      expect(spec(k).channels).toEqual(['bell', 'email']);
      expect(spec(k).whatsappTemplate).toBeNull();
    }
  });

  it('les anciens événements des Projets gardent leurs modèles WhatsApp (ADR-0065)', () => {
    expect(spec('work.task_assigned').whatsappTemplate).toBe('lalanda_tache_assignee');
    expect(spec('work.mentioned').whatsappTemplate).toBe('lalanda_mention');
    expect(spec('work.task_overdue').whatsappTemplate).toBe('lalanda_echeance_depassee');
    expect(spec('work.comment_on_followed').whatsappTemplate).toBe('lalanda_notification_projet');
    expect(spec('crm.activity_assigned').whatsappTemplate).toBe('lalanda_notification_generale');
  });
});

describe('modes (ADR-0079 § 4)', () => {
  it('paliers : Essentiel ⊂ Atténué ⊂ Perroquet', () => {
    expect(tierActiveIn('essentiel', 'essentiel')).toBe(true);
    expect(tierActiveIn('attenue', 'essentiel')).toBe(false);
    expect(tierActiveIn('attenue', 'attenue')).toBe(true);
    expect(tierActiveIn('perroquet', 'attenue')).toBe(false);
    expect(tierActiveIn('perroquet', 'perroquet')).toBe(true);
  });

  it('table importance × mode', () => {
    const urgent = spec('work.task_assigned');
    for (const m of ['essentiel', 'attenue', 'perroquet'] as const) {
      expect(defaultChannelsFor(urgent, m)).toEqual({
        bell: true,
        email: true,
        slack: true,
        whatsapp: true,
      });
    }
    const important = spec('work.task_due_soon');
    expect(defaultChannelsFor(important, 'essentiel')).toEqual({
      bell: true,
      email: true,
      slack: false,
      whatsapp: false,
    });
    expect(defaultChannelsFor(important, 'attenue').slack).toBe(true);
    expect(defaultChannelsFor(important, 'perroquet').whatsapp).toBe(true);
    const info = spec('work.comment_on_followed');
    expect(defaultChannelsFor(info, 'essentiel')).toEqual({
      bell: true,
      email: false,
      slack: false,
      whatsapp: false,
    });
    expect(defaultChannelsFor(info, 'perroquet')).toEqual({
      bell: true,
      email: true,
      slack: true,
      whatsapp: false,
    });
    // Palier Atténué : rien en Essentiel.
    expect(defaultChannelsFor(spec('work.task_created'), 'essentiel').bell).toBe(false);
    expect(defaultChannelsFor(spec('work.task_created'), 'attenue').bell).toBe(true);
  });

  it('canaux permis : une surcharge ne peut pas ouvrir WhatsApp aux RH', () => {
    const s = spec('hr.leave_requested');
    expect(defaultChannelsFor(s, 'perroquet')).toEqual({
      bell: true,
      email: true,
      slack: false,
      whatsapp: false,
    });
    const eff = effectiveChannels({
      spec: s,
      mode: 'perroquet',
      overrides: { 'hr.leave_requested': { whatsapp: true, slack: true } },
    });
    expect(eff.whatsapp).toBe(false);
    expect(eff.slack).toBe(false);
  });

  it('surcharges, types coupés et obligations', () => {
    const s = spec('work.task_approval_requested');
    const eff = effectiveChannels({
      spec: s,
      mode: 'perroquet',
      overrides: { 'work.task_approval_requested': { bell: false, whatsapp: false } },
      mandatory: [{ kind: 'work.task_approval_requested', channel: 'bell' }],
    });
    // L'obligation l'emporte sur la surcharge ; la surcharge coupe WhatsApp.
    expect(eff).toEqual({ bell: true, email: true, slack: true, whatsapp: false });
    const muted = effectiveChannels({
      spec: spec('work.mentioned'),
      mode: 'essentiel',
      mutedKinds: ['work.mentioned'],
    });
    expect(muted.bell).toBe(false);
  });

  it('personnalisé : seulement si une surcharge diffère du défaut', () => {
    expect(isModeCustomized('essentiel', {})).toBe(false);
    expect(isModeCustomized('essentiel', { 'work.task_assigned': { bell: true } })).toBe(false);
    expect(isModeCustomized('essentiel', { 'work.task_assigned': { bell: false } })).toBe(true);
    expect(modeDisplayLabel('perroquet', true)).toBe('Perroquet (personnalisé)');
    expect(modeDisplayLabel('attenue', false)).toBe('Atténué');
  });

  it('conversion : surcharges minimales qui reproduisent un réglage', () => {
    const over = overridesFor('essentiel', {
      'work.task_assigned': { bell: true, email: false, slack: true, whatsapp: true },
      'work.comment_on_followed': { bell: true, email: false, slack: false, whatsapp: false },
    });
    expect(over).toEqual({ 'work.task_assigned': { email: false } });
    const eff = effectiveChannels({
      spec: spec('work.task_assigned'),
      mode: 'essentiel',
      overrides: over,
    });
    expect(eff).toEqual({ bell: true, email: false, slack: true, whatsapp: true });
  });
});

describe('garde-fous (ADR-0079 § 5)', () => {
  it('heures calmes à l’heure de Kinshasa (UTC+1), y compris de part et d’autre de minuit', () => {
    expect(kinshasaHourOf(new Date('2026-11-17T20:30:00Z'))).toBe(21);
    const q = { enabled: true, start: 21, end: 7 };
    expect(inQuietHours(q, new Date('2026-11-17T20:30:00Z'))).toBe(true); // 21 h 30
    expect(inQuietHours(q, new Date('2026-11-17T05:59:00Z'))).toBe(true); // 6 h 59
    expect(inQuietHours(q, new Date('2026-11-17T06:00:00Z'))).toBe(false); // 7 h
    expect(inQuietHours({ ...q, enabled: false }, new Date('2026-11-17T22:00:00Z'))).toBe(false);
    expect(
      inQuietHours({ enabled: true, start: 12, end: 14 }, new Date('2026-11-17T11:00:00Z')),
    ).toBe(true);
  });

  it('titre de rafale borné', () => {
    expect(burstTitle(3, 'nouveaux commentaires', 'Gracy a commenté #1 Maquette')).toBe(
      '3 nouveaux commentaires — Gracy a commenté #1 Maquette',
    );
    expect(burstTitle(2, 'x', 'y'.repeat(300))).toHaveLength(200);
  });
});

describe('corps des réglages', () => {
  it('réglages personnels : types inconnus refusés, modes fermés', () => {
    const ok = PutNotificationSettingsBody.safeParse({
      expectedRevision: 0,
      mode: 'perroquet',
      overrides: { perroquet: { 'work.task_assigned': { whatsapp: false } } },
      notifyOwnActions: true,
      quietHours: { enabled: true, start: 21, end: 7 },
    });
    expect(ok.success).toBe(true);
    const bad = PutNotificationSettingsBody.safeParse({
      expectedRevision: 0,
      mode: 'bavard',
      overrides: { perroquet: { 'work.inconnu': { bell: false } } },
      notifyOwnActions: false,
      quietHours: { enabled: true, start: 25, end: 7 },
    });
    expect(bad.success).toBe(false);
    const announcement = PutNotificationSettingsBody.safeParse({
      expectedRevision: 0,
      mode: null,
      overrides: { essentiel: { 'platform.announcement': { bell: false } } },
      notifyOwnActions: false,
      quietHours: { enabled: false, start: 21, end: 7 },
    });
    expect(announcement.success).toBe(false);
  });

  it('réglages d’organisation : plafond borné', () => {
    const base = {
      expectedRevision: 0,
      projectLeadMode: 'attenue',
      memberMode: 'essentiel',
      byRole: { owner: 'perroquet' },
      mandatory: [{ kind: 'work.task_approval_requested', channel: 'bell' }],
      whatsappDailyCap: 20,
    };
    expect(PutNotificationOrgSettingsBody.safeParse(base).success).toBe(true);
    expect(
      PutNotificationOrgSettingsBody.safeParse({ ...base, whatsappDailyCap: 1000 }).success,
    ).toBe(false);
  });
});
