// Test unitaire minimal du HealthController — sans booter tout Nest.

import { describe, expect, it } from 'vitest';
import { releaseVersionOf, resolveAppVersion } from './app-version.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('retourne un statut ok quand Mongo est connecté', () => {
    // On simule une connection Mongoose avec readyState = 1.
    const fakeConnection = { readyState: 1 } as unknown as import('mongoose').Connection;
    const controller = new HealthController(fakeConnection);
    const response = controller.check();
    expect(response.status).toBe('ok');
    expect(response.service).toBe('lalanda-api');
    expect(response.checks.mongo).toBe('up');
    expect(response.uptimeSec).toBeGreaterThanOrEqual(0);
  });

  it('retourne un statut degraded quand Mongo est déconnecté', () => {
    const fakeConnection = { readyState: 0 } as unknown as import('mongoose').Connection;
    const controller = new HealthController(fakeConnection);
    const response = controller.check();
    expect(response.status).toBe('degraded');
    expect(response.checks.mongo).toBe('down');
  });
});

describe('version du logiciel (ADR-0026 § 6.2)', () => {
  it('étiquette de release injectée au build : « v » retiré, forme X.Y.Z vérifiée', () => {
    expect(resolveAppVersion({ APP_VERSION: 'v0.9.3' })).toEqual({
      version: '0.9.3',
      source: 'release',
    });
    expect(resolveAppVersion({ APP_VERSION: '1.2.3-rc.1' }).version).toBe('1.2.3-rc.1');
    expect(releaseVersionOf('latest')).toBeNull();
    expect(releaseVersionOf('1.2')).toBeNull();
    expect(releaseVersionOf('1.2.3; rm -rf /')).toBeNull();
  });

  it('sans version injectée (développement) : repli sur le package.json, marqué comme tel', () => {
    const v = resolveAppVersion({});
    expect(v.source).toBe('package');
    expect(v.version).toMatch(/^\d+\.\d+\.\d+-dev$/);
  });

  it('/health expose la version et sa provenance', () => {
    const fakeConnection = { readyState: 1 } as unknown as import('mongoose').Connection;
    const response = new HealthController(fakeConnection).check();
    expect(response.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(['release', 'package']).toContain(response.versionSource);
  });
});
