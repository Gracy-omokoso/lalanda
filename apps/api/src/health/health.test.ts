// Test unitaire minimal du HealthController — sans booter tout Nest.

import { describe, expect, it } from 'vitest';
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
