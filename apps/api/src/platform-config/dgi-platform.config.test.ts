// Paramètres plateforme DGI (ADR-0021 §5) — lecture, défauts et refus de démarrer.

import 'reflect-metadata';

import { Inject, Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CONFIRM_DEADLINE_MS,
  DGI_PENDING_EXPIRY_MS,
  DGI_PLATFORM_CONFIG,
  RECONCILE_DELAY_MS,
  UNCERTAINTY_CAP_MS,
  loadDgiPlatformConfig,
  type DgiPlatformConfig,
} from './dgi-platform.config.js';
import { PlatformConfigModule } from './platform-config.module.js';

describe('loadDgiPlatformConfig', () => {
  it('défauts : URL officielles, aucun ISF, production fermée, 15 s', () => {
    expect(loadDgiPlatformConfig({})).toEqual({
      baseUrl: { test: 'https://developper.dgirdc.cd/edef', production: 'https://edef.dgirdc.cd' },
      isf: { test: null, production: null },
      productionEnabled: false,
      httpTimeoutMs: 15_000,
      normalizationTimings: {
        confirmDeadlineMs: 90_000,
        pendingExpiryMs: 120_000,
        reconcileDelayMs: 150_000,
        uncertaintyCapMs: 1_800_000,
      },
    });
  });

  it('délais de la normalisation conformes à ADR-0024 § 6', () => {
    expect(CONFIRM_DEADLINE_MS).toBe(90_000);
    expect(DGI_PENDING_EXPIRY_MS).toBe(120_000);
    expect(CONFIRM_DEADLINE_MS).toBeLessThan(DGI_PENDING_EXPIRY_MS);
    expect(RECONCILE_DELAY_MS).toBeGreaterThan(DGI_PENDING_EXPIRY_MS);
    expect(UNCERTAINTY_CAP_MS).toBe(30 * 60_000);
  });

  it('refuse la production ouverte tant que les arrondis ne sont pas étalonnés (ADR-0024 § 7.3)', () => {
    expect(() =>
      loadDgiPlatformConfig(
        {
          DGI_PRODUCTION_ENABLED: 'true',
          DGI_ISF_PRODUCTION: 'AB1-CD2-E3',
        },
        { status: 'not_calibrated' },
      ),
    ).toThrow(/étalonnage des arrondis/);
  });

  it('le relevé versionné (étalonné le 20 oct. 2026) ne bloque plus l’ouverture à lui seul', () => {
    const config = loadDgiPlatformConfig({
      DGI_PRODUCTION_ENABLED: 'true',
      DGI_ISF_PRODUCTION: 'AB1-CD2-E3',
    });
    expect(config.productionEnabled).toBe(true);
  });

  it('une chaîne vide vaut absence (comme dans .env.production.example)', () => {
    const config = loadDgiPlatformConfig({ DGI_ISF_TEST: '', DGI_ISF_PRODUCTION: '' });
    expect(config.isf).toEqual({ test: null, production: null });
  });

  it('refuse la production ouverte sans ISF, avec un message explicite', () => {
    expect(() => loadDgiPlatformConfig({ DGI_PRODUCTION_ENABLED: 'true' })).toThrow(
      /DGI_PRODUCTION_ENABLED=true exige DGI_ISF_PRODUCTION/,
    );
  });

  it('ouvre la production avec un ISF valide et un étalonnage enregistré', () => {
    const config = loadDgiPlatformConfig(
      {
        DGI_PRODUCTION_ENABLED: 'true',
        DGI_ISF_PRODUCTION: 'AB1-CD2-E3',
        DGI_ISF_TEST: 'TEST-01',
      },
      { status: 'calibrated' },
    );
    expect(config.productionEnabled).toBe(true);
    expect(config.isf).toEqual({ test: 'TEST-01', production: 'AB1-CD2-E3' });
  });

  it('accepte le faux serveur local hors production, sans barre oblique finale', () => {
    const config = loadDgiPlatformConfig({ DGI_EDEF_TEST_URL: 'http://127.0.0.1:41234/' });
    expect(config.baseUrl.test).toBe('http://127.0.0.1:41234');
  });

  it('refuse le http local en production', () => {
    expect(() =>
      loadDgiPlatformConfig({
        NODE_ENV: 'production',
        DGI_EDEF_TEST_URL: 'http://127.0.0.1:41234',
      }),
    ).toThrow(/https en production/);
  });

  it('renvoie une configuration gelée : on n’ouvre pas la production en mémoire', () => {
    const config = loadDgiPlatformConfig({});
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.baseUrl)).toBe(true);
    expect(Object.isFrozen(config.isf)).toBe(true);
    expect(Object.isFrozen(config.normalizationTimings)).toBe(true);
  });
});

describe('PlatformConfigModule', () => {
  const avant = process.env['DGI_PRODUCTION_ENABLED'];
  afterEach(() => {
    if (avant === undefined) delete process.env['DGI_PRODUCTION_ENABLED'];
    else process.env['DGI_PRODUCTION_ENABLED'] = avant;
  });

  @Injectable()
  class Consommateur {
    constructor(@Inject(DGI_PLATFORM_CONFIG) readonly config: DgiPlatformConfig) {}
  }

  // Module consommateur qui N'IMPORTE PAS PlatformConfigModule : prouve qu'il est global.
  @Module({ providers: [Consommateur] })
  class ModuleConsommateur {}

  it('fournit DGI_PLATFORM_CONFIG à un module qui ne l’importe pas (@Global)', async () => {
    @Module({ imports: [PlatformConfigModule, ModuleConsommateur] })
    class Racine {}
    const ctx = await NestFactory.createApplicationContext(Racine, { logger: false });
    expect(ctx.get(Consommateur).config.productionEnabled).toBe(false);
    await ctx.close();
  });

  it('fait échouer le démarrage sur une configuration invalide', async () => {
    process.env['DGI_PRODUCTION_ENABLED'] = 'true';
    // `abortOnError: false` : sans lui, Nest appelle `process.exit` au lieu de rejeter.
    await expect(
      NestFactory.createApplicationContext(PlatformConfigModule, {
        logger: false,
        abortOnError: false,
      }),
    ).rejects.toThrow(/DGI_ISF_PRODUCTION/);
  });
});
