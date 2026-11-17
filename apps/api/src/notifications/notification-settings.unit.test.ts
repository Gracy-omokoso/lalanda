// Réglages de notification — règles pures (ADR-0079 § 4.3, § 5, § 7).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  NOTIFICATION_MODES,
  effectiveChannels,
  notificationSpecOf,
} from '@lalanda/shared/notifications';
import { WORK_NOTIFICATION_EVENTS, defaultWorkNotificationPreferences } from '@lalanda/shared/work';
import { describe, expect, it } from 'vitest';

import {
  externalPreferenceToken,
  readExternalPreferenceToken,
} from '../work/external/work-external-crypto.js';
import { externalPreferenceAllows } from '../work/external/work-external-notifier.js';
import { deferredGroupTitle, quietEndAfter } from './notification-deferred.service.js';
import { kinshasaDayStart } from './notification-deliveries.service.js';
import { maskEmail } from './notification-dispatcher.js';
import { decodeKind, encodeKind } from './notification-settings.schemas.js';
import {
  decodeOverrides,
  defaultQuietHours,
  encodeOverrides,
  overridesFromLegacy,
} from './notification-settings.service.js';
import {
  WHATSAPP_PENDING_TEMPLATES,
  isTemplateApproved,
  workTemplateMessage,
} from '../whatsapp/whatsapp-templates.js';

describe('conversion des préférences ADR-0061 (§ 4.3)', () => {
  it('chaque case réglée donne EXACTEMENT le même résultat, quel que soit le mode', () => {
    const legacy = defaultWorkNotificationPreferences();
    // Une personne qui avait tout réglé à sa façon.
    legacy.events.task_assigned = { bell: false, email: true, slack: false, whatsapp: false };
    legacy.events.comment_on_followed = { bell: true, email: true, slack: true, whatsapp: false };
    legacy.events.project_at_risk = { bell: false, email: false, slack: false, whatsapp: false };
    legacy.events.task_status_changed = { bell: false, email: true, slack: false, whatsapp: true };
    const overrides = overridesFromLegacy(legacy);
    for (const mode of NOTIFICATION_MODES) {
      for (const e of WORK_NOTIFICATION_EVENTS) {
        const spec = notificationSpecOf(`work.${e}`)!;
        expect(
          effectiveChannels({ spec, mode, overrides: overrides[mode] }),
          `${mode} ${e}`,
        ).toEqual(legacy.events[e]);
      }
    }
  });

  it('les anciens défauts sont reproduits aussi (personne qui avait enregistré sans rien changer)', () => {
    const legacy = defaultWorkNotificationPreferences();
    const overrides = overridesFromLegacy(legacy);
    for (const e of WORK_NOTIFICATION_EVENTS) {
      const spec = notificationSpecOf(`work.${e}`)!;
      expect(
        effectiveChannels({ spec, mode: 'essentiel', overrides: overrides.essentiel }),
      ).toEqual(legacy.events[e]);
    }
  });

  it('clés de document : le point devient deux-points, aller-retour sans perte', () => {
    expect(encodeKind('work.task_assigned')).toBe('work:task_assigned');
    expect(decodeKind('work:task_assigned')).toBe('work.task_assigned');
    const over = {
      perroquet: { 'work.task_assigned': { whatsapp: false } },
      essentiel: { 'hr.leave_requested': { email: false } },
    };
    const stored = encodeOverrides(over);
    expect(Object.keys(stored['perroquet']!)).toEqual(['work:task_assigned']);
    expect(decodeOverrides(stored)).toEqual({ ...over, attenue: {} });
    // Type inconnu ou retiré : ignoré à la lecture.
    expect(decodeOverrides({ perroquet: { 'work:disparu': { bell: true } } }).perroquet).toEqual(
      {},
    );
  });
});

describe('garde-fous (§ 5)', () => {
  it('heures calmes par défaut : 21 h – 7 h, coupables par l’environnement', () => {
    expect(defaultQuietHours({})).toEqual({ enabled: true, start: 21, end: 7 });
    expect(defaultQuietHours({ NOTIFICATIONS_QUIET_HOURS_DEFAULT: 'off' }).enabled).toBe(false);
    expect(defaultQuietHours({ NOTIFICATIONS_QUIET_HOURS_DEFAULT: '22-6' })).toEqual({
      enabled: true,
      start: 22,
      end: 6,
    });
    expect(defaultQuietHours({ NOTIFICATIONS_QUIET_HOURS_DEFAULT: '99-1' }).start).toBe(21);
  });

  it('jour de Kinshasa : minuit à Kinshasa = 23 h UTC la veille', () => {
    expect(kinshasaDayStart(new Date('2026-11-17T23:30:00Z')).toISOString()).toBe(
      '2026-11-17T23:00:00.000Z',
    );
    expect(kinshasaDayStart(new Date('2026-11-17T10:00:00Z')).toISOString()).toBe(
      '2026-11-16T23:00:00.000Z',
    );
  });

  it('adresse masquée dans l’état des canaux', () => {
    expect(maskEmail('gracy@exemple.cd')).toBe('g***@exemple.cd');
  });
});

describe('modèles WhatsApp proposés (§ 7)', () => {
  it('indisponibles tant que non déclarés approuvés ; ceux d’ADR-0065 restent utilisables', () => {
    expect(isTemplateApproved('lalanda_tache_assignee', {})).toBe(true);
    expect(isTemplateApproved('lalanda_notification_generale', {})).toBe(false);
    expect(
      isTemplateApproved('lalanda_notification_generale', {
        WHATSAPP_APPROVED_TEMPLATES: 'lalanda_validation_attendue, lalanda_notification_generale',
      }),
    ).toBe(true);
    expect(isTemplateApproved('inconnu', { WHATSAPP_APPROVED_TEMPLATES: 'inconnu' })).toBe(false);
  });

  it('règles Meta et recopie exacte dans le guide', () => {
    const guide = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docs/integrations/whatsapp.md'),
      'utf8',
    );
    for (const t of Object.values(WHATSAPP_PENDING_TEMPLATES)) {
      const vars = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      expect(vars).toEqual(t.params.map((_, i) => i + 1));
      expect(t.examples).toHaveLength(t.params.length);
      expect(t.body).not.toMatch(/\}\}\s*\{\{/);
      expect(t.body).not.toMatch(/montant|facture|USD|CDF|€|\$/i);
      expect(guide, t.name).toContain(`\`${t.name}\``);
      expect(guide, t.name).toContain(t.body);
      for (const ex of t.examples) expect(guide, `${t.name} exemple`).toContain(ex);
    }
  });

  it('message générique : événement, détail, organisation', () => {
    const m = workTemplateMessage({
      to: '+243810000012',
      template: 'lalanda_notification_generale',
      eventLabel: 'Une relance m’est assignée',
      title: 'Appeler Kin Services',
      projectName: null,
      organizationName: 'Go freelance',
      href: '/crm/agenda',
    });
    expect(m.name).toBe('lalanda_notification_generale');
    const body = m.components[0] as { parameters: { text: string }[] };
    expect(body.parameters.map((p) => p.text)).toEqual([
      'Une relance m’est assignée',
      'Appeler Kin Services',
      'Go freelance',
    ]);
    // Un événement des Projets sans modèle dédié prend le modèle générique des Projets.
    expect(
      workTemplateMessage({
        to: '+243810000012',
        template: 'lalanda_notification_projet',
        eventLabel: 'Une tâche est terminée',
        title: '#3 Maquette',
        projectName: 'Site',
        organizationName: 'Go freelance',
        href: '/projets/x',
      }).name,
    ).toBe('lalanda_notification_projet');
  });
});

describe('file des heures calmes (§ 5)', () => {
  it('fin des heures calmes : le jour même ou le lendemain, à l’heure de Kinshasa', () => {
    const q = { enabled: true, start: 21, end: 7 };
    // 22 h 30 à Kinshasa (21 h 30 UTC) → 7 h le lendemain (6 h UTC).
    expect(quietEndAfter(q, new Date('2026-11-17T21:30:00Z')).toISOString()).toBe(
      '2026-11-18T06:00:00.000Z',
    );
    // 3 h à Kinshasa (2 h UTC) → 7 h le même jour.
    expect(quietEndAfter(q, new Date('2026-11-18T02:10:00Z')).toISOString()).toBe(
      '2026-11-18T06:00:00.000Z',
    );
    expect(deferredGroupTitle(3, ['A', 'B'])).toBe(
      '3 notifications pendant les heures calmes : A ; B',
    );
    expect(deferredGroupTitle(30, ['x'.repeat(400)])).toHaveLength(200);
  });
});

describe('e-mails vers les externes (§ 9)', () => {
  it('préférence : tout, validations seulement, rien', () => {
    expect(externalPreferenceAllows(undefined, 'shared_comment')).toBe(true);
    expect(externalPreferenceAllows('approvals', 'shared_comment')).toBe(false);
    expect(externalPreferenceAllows('approvals', 'approval_requested')).toBe(true);
    expect(externalPreferenceAllows('none', 'approval_requested')).toBe(false);
  });

  it('jeton de désinscription signé, refusé s’il est altéré', () => {
    process.env['AUTH_SECRET'] ??= 'secret-de-test-unitaire-0123456789abcdef';
    const org = '64b7f0c2a1b2c3d4e5f60718';
    const acc = '64b7f0c2a1b2c3d4e5f60719';
    const t = externalPreferenceToken(org, acc);
    expect(readExternalPreferenceToken(t)).toEqual({ organizationId: org, accountId: acc });
    expect(
      readExternalPreferenceToken(`${t.slice(0, -1)}${t.endsWith('A') ? 'B' : 'A'}`),
    ).toBeNull();
    expect(readExternalPreferenceToken(t.replace(acc, org))).toBeNull();
    expect(readExternalPreferenceToken('nimporte-quoi')).toBeNull();
  });
});
