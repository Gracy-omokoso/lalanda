// ADR-0053 — P5 : contrats du journal plateforme et des événements de sécurité.

import { describe, expect, it } from 'vitest';

import {
  PLATFORM_AUDIT_LIMITS,
  PLATFORM_SECURITY_EVENTS,
  PLATFORM_SECURITY_EVENT_KINDS,
  PlatformAuditExportQuerySchema,
  PlatformAuditQuerySchema,
  PlatformSecurityQuerySchema,
} from './index.js';

describe('PlatformAuditQuerySchema', () => {
  it('une chaîne vide vaut « absente »', () => {
    const r = PlatformAuditQuerySchema.safeParse({ action: '', from: '', limit: '' });
    expect(r.success && r.data).toEqual({});
  });
  it('accepte un jour ou un instant ISO, refuse le reste', () => {
    expect(PlatformAuditQuerySchema.safeParse({ from: '2026-11-01' }).success).toBe(true);
    expect(PlatformAuditQuerySchema.safeParse({ to: '2026-11-01T10:00:00Z' }).success).toBe(true);
    expect(PlatformAuditQuerySchema.safeParse({ from: 'hier' }).success).toBe(false);
  });
  it('borne la page et refuse un filtre qui ressemble à un opérateur Mongo', () => {
    expect(PlatformAuditQuerySchema.safeParse({ limit: '500' }).success).toBe(true);
    expect(PlatformAuditQuerySchema.safeParse({ limit: '501' }).success).toBe(false);
    expect(PlatformAuditQuerySchema.safeParse({ action: '$ne' }).success).toBe(false);
    expect(PlatformAuditQuerySchema.safeParse({ actorUserId: { $ne: null } }).success).toBe(false);
  });
});

describe('PlatformAuditExportQuerySchema', () => {
  it('motif obligatoire, pris dans la liste du § 2.6', () => {
    expect(PlatformAuditExportQuerySchema.safeParse({}).success).toBe(false);
    expect(PlatformAuditExportQuerySchema.safeParse({ reason: 'curiosité' }).success).toBe(false);
    expect(PlatformAuditExportQuerySchema.safeParse({ reason: 'security' }).success).toBe(true);
  });
});

describe('PlatformSecurityQuerySchema', () => {
  it('des jours seulement', () => {
    expect(PlatformSecurityQuerySchema.safeParse({ from: '2026-11-01' }).success).toBe(true);
    expect(PlatformSecurityQuerySchema.safeParse({ from: '2026-11-01T00:00:00Z' }).success).toBe(
      false,
    );
  });
});

describe('catalogue des événements de sécurité', () => {
  it('chaque nature a un libellé ; chaque nature `audit` nomme son action', () => {
    expect(Object.keys(PLATFORM_SECURITY_EVENTS).sort()).toEqual(
      [...PLATFORM_SECURITY_EVENT_KINDS].sort(),
    );
    for (const k of PLATFORM_SECURITY_EVENT_KINDS) {
      const def = PLATFORM_SECURITY_EVENTS[k];
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.source === 'audit', k).toBe(Boolean(def.auditAction));
    }
  });
  it('bornes prudentes', () => {
    expect(PLATFORM_AUDIT_LIMITS.securityMaxDays).toBeLessThanOrEqual(92);
    expect(PLATFORM_AUDIT_LIMITS.exportMaxRows).toBe(5_000);
  });
});
