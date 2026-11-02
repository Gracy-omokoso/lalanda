// ADR-0053 — P5 : classification et synthèse des événements de sécurité.

import { describe, expect, it } from 'vitest';

import { PLATFORM_SECURITY_EVENT_KINDS } from '@lalanda/shared/platform';

import {
  SECURITY_AUDIT_ACTIONS,
  buildSecuritySummary,
  classifySecurityResponse,
  securityPeriod,
} from './security-events.js';

describe('classifySecurityResponse — table de vérité', () => {
  const cas: Array<[string, string, number, string | null, string | null]> = [
    // Compte bloqué : partout, console ou organisation.
    ['GET', '/projects', 403, 'ACCOUNT_BLOCKED', 'blocked_session_refused'],
    ['GET', '/admin/overview', 403, 'ACCOUNT_BLOCKED', 'blocked_session_refused'],
    // Ré-authentification : les deux routes, POST seulement.
    ['POST', '/admin/reauth', 201, null, 'reauth_succeeded'],
    ['POST', '/me/reauth', 201, null, 'reauth_succeeded'],
    ['POST', '/me/reauth', 401, 'INVALID_PASSWORD', 'reauth_failed'],
    ['GET', '/me/reauth', 200, null, null],
    // Console.
    ['POST', '/admin/users/x/block', 401, 'REAUTH_REQUIRED', 'reauth_required'],
    ['GET', '/admin/audit-events', 403, 'FORBIDDEN', 'console_forbidden'],
    ['POST', '/admin/billing/grants', 409, 'PLATFORM_SELF_DEALING', 'gesture_refused'],
    ['POST', '/admin/users/x/platform-roles', 409, 'SELF_GRANT_FORBIDDEN', 'gesture_refused'],
    ['POST', '/admin/organizations/x/suspend', 409, 'ORGANIZATION_ALREADY_SUSPENDED', null],
    [
      'GET',
      '/admin/audit-events/export.csv',
      429,
      'PLATFORM_AUDIT_EXPORT_RATE_LIMITED',
      'console_rate_limited',
    ],
    ['GET', '/admin/overview', 200, null, null],
    // Espace organisation : rien d'autre n'est compté.
    ['GET', '/projects', 403, 'FORBIDDEN', null],
    ['GET', '/administration', 403, 'FORBIDDEN', null],
    ['POST', '/sales/invoices', 409, 'PLATFORM_SELF_DEALING', null],
  ];
  it.each(cas)('%s %s %i %s → %s', (method, path, status, code, attendu) => {
    expect(classifySecurityResponse({ method, path, status, code })).toBe(attendu);
  });
});

describe('securityPeriod', () => {
  const now = new Date('2026-11-02T15:00:00Z');
  it('30 derniers jours par défaut, aujourd’hui compris', () => {
    const p = securityPeriod(undefined, undefined, now);
    expect(p).toMatchObject({ ok: true, from: '2026-10-04', to: '2026-11-02' });
    if (p.ok) expect(p.end.toISOString()).toBe('2026-11-03T00:00:00.000Z');
  });
  it('refuse plus de 92 jours, ou un début après la fin', () => {
    expect(securityPeriod('2026-01-01', '2026-11-02', now).ok).toBe(false);
    expect(securityPeriod('2026-11-03', '2026-11-02', now).ok).toBe(false);
    expect(securityPeriod('2026-08-03', '2026-11-02', now).ok).toBe(true);
  });
});

describe('buildSecuritySummary', () => {
  it('tous les jours, zéros compris ; compteurs et journal additionnés par nature', () => {
    const s = buildSecuritySummary({
      from: '2026-11-01',
      to: '2026-11-03',
      counters: [
        { day: '2026-11-01', kind: 'console_forbidden', count: 3 },
        { day: '2026-11-03', kind: 'reauth_failed', count: 1 },
        // Hors période, nature inconnue, nature de source `audit` : ignorés.
        { day: '2026-10-31', kind: 'console_forbidden', count: 9 },
        { day: '2026-11-01', kind: 'inconnue', count: 9 },
        { day: '2026-11-01', kind: 'account_blocked', count: 9 },
      ],
      audit: [
        { day: '2026-11-02', action: 'user.disabled', count: 2 },
        { day: '2026-11-02', action: 'platform.audit.exported', count: 1 },
        { day: '2026-11-02', action: 'billing.sweep', count: 5 },
      ],
      blockedAccountsNow: 4,
    });
    expect(s.days.map((d) => d.day)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(s.days[0]!.counts.console_forbidden).toBe(3);
    expect(s.days[1]!.counts.account_blocked).toBe(2);
    expect(s.totals).toMatchObject({
      console_forbidden: 3,
      reauth_failed: 1,
      account_blocked: 2,
      audit_exported: 1,
    });
    expect(Object.values(s.totals).reduce((a, b) => a + b, 0)).toBe(7);
    expect(s.blockedAccountsNow).toBe(4);
    expect(s.kinds).toEqual(PLATFORM_SECURITY_EVENT_KINDS);
  });

  it('la synthèse ne contient que des jours, des natures et des nombres', () => {
    const s = buildSecuritySummary({
      from: '2026-11-01',
      to: '2026-11-01',
      counters: [],
      audit: [],
      blockedAccountsNow: 0,
    });
    expect(Object.keys(s).sort()).toEqual(
      ['blockedAccountsNow', 'days', 'from', 'kinds', 'to', 'totals'].sort(),
    );
    expect(Object.keys(s.days[0]!).sort()).toEqual(['counts', 'day']);
  });

  it('les actions comptées depuis le journal sont exactement celles du catalogue', () => {
    expect([...SECURITY_AUDIT_ACTIONS.keys()].sort()).toEqual(
      [
        'platform.audit.exported',
        'platform_role.granted',
        'platform_role.revoked',
        'user.disabled',
        'user.enabled',
      ].sort(),
    );
  });
});
