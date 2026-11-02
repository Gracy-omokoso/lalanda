// ADR-0053 — P5 : vue du journal plateforme (liste blanche, période, curseur, CSV).

import { describe, expect, it } from 'vitest';

import {
  PLATFORM_AUDIT_CSV_HEADER,
  decodeCursor,
  encodeCursor,
  minimizeMetadata,
  platformAuditCsv,
  platformAuditCsvFilename,
  resolvePeriod,
  type PlatformAuditEventView,
} from './audit-view.js';

describe('minimizeMetadata — liste blanche', () => {
  it('garde motifs, références et marques', () => {
    const r = minimizeMetadata({
      reason: 'support',
      internalNote: 'Dépôt constaté.',
      reference: 'LLD-1',
      soleOperator: true,
      revokedSessions: 2,
      expiresAt: null,
    });
    expect(r.redactedKeys).toBe(0);
    expect(r.metadata).toEqual({
      reason: 'support',
      internalNote: 'Dépôt constaté.',
      reference: 'LLD-1',
      soleOperator: true,
      revokedSessions: 2,
      expiresAt: null,
    });
  });

  it('retire montants, devise, adresse IP, agent, et toute clé inconnue', () => {
    const r = minimizeMetadata({
      plan: 'pro',
      amountDueCents: 4900,
      currency: 'USD',
      ip: '203.0.113.7',
      userAgent: 'Mozilla',
      salary: 1200,
      clientLabel: 'Facture Acme',
    });
    expect(r.metadata).toEqual({ plan: 'pro' });
    expect(r.redactedKeys).toBe(6);
  });

  it('retire les valeurs composées, même sous une clé permise', () => {
    const r = minimizeMetadata({ keys: { a: 1 }, role: ['x'] });
    expect(r.metadata).toEqual({});
    expect(r.redactedKeys).toBe(2);
  });

  it('accepte des métadonnées absentes', () => {
    expect(minimizeMetadata(undefined)).toEqual({ metadata: {}, redactedKeys: 0 });
  });
});

describe('resolvePeriod', () => {
  it('un jour vaut son début (from) et le début du lendemain (to, exclu)', () => {
    const p = resolvePeriod('2026-11-01', '2026-11-02');
    expect(p.from?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(p.to?.toISOString()).toBe('2026-11-03T00:00:00.000Z');
  });
  it('un instant ISO est pris tel quel', () => {
    const p = resolvePeriod('2026-11-01T10:00:00Z', undefined);
    expect(p.from?.toISOString()).toBe('2026-11-01T10:00:00.000Z');
    expect(p.to).toBeUndefined();
  });
});

describe('curseur', () => {
  it('aller-retour', () => {
    const c = encodeCursor({ createdAt: '2026-11-02T08:00:00.000Z', id: 'A'.repeat(24) });
    expect(decodeCursor(c)).toEqual({
      createdAt: new Date('2026-11-02T08:00:00.000Z'),
      id: 'a'.repeat(24),
    });
  });
  it('refuse un curseur altéré', () => {
    expect(decodeCursor('pas-un-curseur')).toBeNull();
    expect(decodeCursor('2026-13-45_' + 'a'.repeat(24))).toBeNull();
    expect(decodeCursor('2026-11-02T08:00:00.000Z_zz')).toBeNull();
  });
});

describe('platformAuditCsv', () => {
  const evt = (m: PlatformAuditEventView['metadata']): PlatformAuditEventView => ({
    id: 'b'.repeat(24),
    action: 'user.disabled',
    actorUserId: 'op1',
    actorRole: 'platform_super_admin',
    targetType: 'user',
    targetId: 'u1',
    metadata: m,
    redactedKeys: 0,
    createdAt: '2026-11-02T08:00:00.000Z',
  });

  it('en-tête stable, BOM, séparateur « ; », motif et référence extraits', () => {
    const csv = platformAuditCsv([
      evt({ internalNote: 'Spam répété.', reasonCategory: 'abuse', ref: 'r1', soleOperator: true }),
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    const [entete, ligne] = csv.slice(1).split('\r\n');
    expect(entete).toBe(PLATFORM_AUDIT_CSV_HEADER.join(';'));
    expect(ligne).toContain(';Spam répété.;abuse;r1;oui;');
  });

  it('neutralise une formule de tableur dans une note', () => {
    const csv = platformAuditCsv([evt({ internalNote: '=HYPERLINK("x")' })]);
    expect(csv).toContain(`'=HYPERLINK`);
    expect(csv).not.toMatch(/;=HYPERLINK/);
  });

  it('le nom du fichier ne porte que la date', () => {
    expect(platformAuditCsvFilename(new Date('2026-11-02T23:00:00Z'))).toBe(
      'journal-plateforme-2026-11-02.csv',
    );
  });
});
