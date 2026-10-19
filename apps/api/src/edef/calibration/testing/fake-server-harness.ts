// Banc d'essai de l'outil d'étalonnage et des sondes (chantier F4, ADR-0024 § 7) :
// le VRAI client e-MCF (`EdefClient`) branché, en HTTP local, sur le faux
// serveur du dépôt (`../../testing/fake-edef-server.ts`, chantier F1), dont les
// totaux sont calculés par le moteur sous une politique choisie par le test.
// AUCUN appel à la DGI réelle.

import type { RoundingPolicy } from '@lalanda/engine';

import {
  DEFAULT_NORMALIZATION_TIMINGS,
  type DgiPlatformConfig,
} from '../../../platform-config/dgi-platform.config.js';
import { EdefClient } from '../../edef.client.js';
import { startFakeEdefServer, type FakeEdefServer } from '../../testing/fake-edef-server.js';
import { createMemoryJournal, type MemoryJournal } from '../memory-journal.js';

/** Valeurs FICTIVES. */
export const FAKE_NIF = 'A0000000Z-FICTIF';
/** Groupes A–P utilisés par les cas d'étalonnage (valeurs de test, pas une source). */
export const HARNESS_TAX_GROUPS: Record<string, number> = { a: 0, b: 16, c: 5, m: 0, n: 0, o: 1 };

export interface Harness {
  server: FakeEdefServer;
  client: EdefClient;
  journal: MemoryJournal;
  config: DgiPlatformConfig;
  close(): Promise<void>;
}

export function harnessConfig(baseUrl: string, httpTimeoutMs = 1_500): DgiPlatformConfig {
  return Object.freeze({
    baseUrl: Object.freeze({ test: baseUrl, production: 'https://production-refusee.invalid' }),
    isf: Object.freeze({ test: 'ISF-TEST-01', production: null }),
    productionEnabled: false,
    httpTimeoutMs,
    normalizationTimings: DEFAULT_NORMALIZATION_TIMINGS,
  });
}

export async function startHarness(
  token: string,
  opts: { policy?: RoundingPolicy; httpTimeoutMs?: number } = {},
): Promise<Harness> {
  const server = await startFakeEdefServer({
    tokens: { [token]: { nif: FAKE_NIF, nim: 'NIM-FICTIF', tokenValid: '2027-01-01T00:00:00' } },
    taxGroups: HARNESS_TAX_GROUPS,
    ...(opts.policy ? { policy: opts.policy } : {}),
  });
  const config = harnessConfig(server.baseUrl, opts.httpTimeoutMs);
  const journal = createMemoryJournal();
  const client = new EdefClient(config, journal.journal);
  return { server, client, journal, config, close: () => server.close() };
}
