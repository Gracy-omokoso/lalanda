// Seaux de débit de la connexion externe — revue de sécurité M2 (ADR-0078).

import { beforeAll, describe, expect, it } from 'vitest';

import {
  ExternalRequestEmailThrottlerGuard,
  ExternalVerifyEmailThrottlerGuard,
  ExternalVerifyIpThrottlerGuard,
} from './work-external-throttler.guard.js';

type Tracker = { trackerOf(req: Record<string, unknown>): string };
const tracker = (cls: { prototype: object }): Tracker => Object.create(cls.prototype) as Tracker;
const req = (email: string, ip: string) => ({ body: { email }, ip, ips: [] });

describe('seaux de la connexion externe', () => {
  beforeAll(() => {
    process.env['AUTH_SECRET'] ??= 'test-secret-non-production-0123456789abcdef';
  });

  it('compte les vérifications par (adresse + IP) : un tiers qui tourne d’IP n’épuise pas le seau du titulaire', () => {
    const t = tracker(ExternalVerifyEmailThrottlerGuard);
    const victime = t.trackerOf(req('client@exemple.test', '10.0.0.1'));
    expect(t.trackerOf(req('CLIENT@exemple.test', '10.0.0.1'))).toBe(victime);
    expect(t.trackerOf(req('client@exemple.test', '10.0.0.2'))).not.toBe(victime);
    expect(t.trackerOf(req('autre@exemple.test', '10.0.0.1'))).not.toBe(victime);
  });

  it('fait de même pour les demandes de code ; le seau par IP ignore l’adresse', () => {
    const d = tracker(ExternalRequestEmailThrottlerGuard);
    expect(d.trackerOf(req('a@exemple.test', '10.0.0.1'))).not.toBe(
      d.trackerOf(req('a@exemple.test', '10.0.0.9')),
    );
    const ip = tracker(ExternalVerifyIpThrottlerGuard);
    expect(ip.trackerOf(req('a@exemple.test', '10.0.0.1'))).toBe(
      ip.trackerOf(req('b@exemple.test', '10.0.0.1')),
    );
  });

  it('ne laisse aucune adresse ni IP en clair dans la clé', () => {
    const key = tracker(ExternalVerifyEmailThrottlerGuard).trackerOf(
      req('client@exemple.test', '10.0.0.1'),
    );
    expect(key).not.toContain('client');
    expect(key).not.toContain('10.0.0.1');
  });
});
