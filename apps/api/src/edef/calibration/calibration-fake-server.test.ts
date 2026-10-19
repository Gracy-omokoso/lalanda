// Étalonnage de bout en bout : VRAI client e-MCF (`EdefClient`) contre le faux
// serveur du dépôt (`../testing/fake-edef-server.ts`), en HTTP local. Aucun
// appel à la DGI réelle.
//
// Les routes de facturation du client et du faux serveur sont livrées par le
// chantier F1 (ADR-0024). Tant qu'elles ne le sont pas, le client lève
// `Error('F1')` : ces tests se déclarent alors SAUTÉS (et le disent), au lieu
// de passer en silence.

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Secret } from '../../integrations/secret-value.js';
import { EdefClient } from '../edef.client.js';
import { startFakeEdefServer, type FakeEdefServer } from '../testing/fake-edef-server.js';
import { main } from './calibrate.js';
import { createMemoryJournal, type MemoryJournal } from './memory-journal.js';

const TOKEN = 'jeton-TEST-faux-serveur-5566778899aabbcc';

let dir: string;
let server: FakeEdefServer;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lalanda-etalonnage-e2e-'));
  server = await startFakeEdefServer({
    tokens: {
      [TOKEN]: { nif: 'A0000000Z-FICTIF', nim: 'NIM-FICTIF', tokenValid: '2027-01-01T00:00:00' },
    },
  });
});
afterEach(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Vrai si le client e-MCF a ses routes de facturation (chantier F1). */
async function invoiceRoutesAvailable(client: EdefClient): Promise<boolean> {
  try {
    await client.getPendingRequests({
      environment: 'test',
      token: new Secret(TOKEN),
      organizationId: null,
      pointOfSaleId: null,
    });
    return true;
  } catch (err) {
    if (err instanceof Error && err.message === 'F1') return false;
    throw err;
  }
}

describe('étalonnage contre le faux serveur e-MCF (client réel)', () => {
  it('POST puis annulation, aucune confirmation, jeton absent de la sortie, du journal et du disque', async (ctx) => {
    let journal: MemoryJournal | null = null;
    let client: EdefClient | null = null;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let out = '';
    let err = '';
    stdout.on('data', (c: Buffer) => (out += c.toString('utf8')));
    stderr.on('data', (c: Buffer) => (err += c.toString('utf8')));

    const done = main(['--sortie', dir], {
      stdin,
      stdout,
      stderr,
      env: {
        DGI_EDEF_TEST_URL: server.baseUrl,
        DGI_ISF_TEST: 'ISF-TEST-01',
        DGI_HTTP_TIMEOUT_MS: '10000',
      },
      requireTty: false,
      spacingMs: 0,
      makeClient: (config) => {
        journal = createMemoryJournal();
        client = new EdefClient(config, journal.journal);
        return client;
      },
    });

    // Le client est créé avant l'invite : on vérifie d'abord ses capacités.
    await new Promise((r) => setTimeout(r, 20));
    const available = client !== null && (await invoiceRoutesAvailable(client));
    stdin.write(`${TOKEN}\r`);
    const code = await done;
    const journalText = (): string =>
      JSON.stringify((journal as MemoryJournal | null)?.entries ?? []);

    if (!available) {
      // Partie jouable sans F1 : statut et listes par le vrai client, puis arrêt
      // à l'envoi de la première facture (corps de la route non livré).
      expect(code).toBe(1);
      expect(err).toContain('F1');
      expect(server.requests.map((r) => r.path)).toEqual([
        '/api/info/status',
        '/api/info/taxGroups',
        '/api/info/currencyRates',
        '/api/info/clientTypes',
      ]);
      expect(server.requests.every((r) => r.authorization === `Bearer ${TOKEN}`)).toBe(true);
      expect(readdirSync(dir)).toEqual([]);
      for (const text of [out, err, journalText()]) expect(text).not.toContain(TOKEN);
      ctx.skip(
        'Routes de facturation du client e-MCF non livrées (chantier F1) : partie facture sautée.',
      );
      return;
    }
    expect(err).toBe('');
    expect(code).toBe(0);

    const invoiceRequests = server.requests.filter((r) => r.path.startsWith('/api/invoice'));
    expect(invoiceRequests.length).toBeGreaterThan(0);
    expect(invoiceRequests.some((r) => /\/confirm$/.test(r.path))).toBe(false);
    for (let i = 0; i < invoiceRequests.length; i += 1) {
      const r = invoiceRequests[i]!;
      if (r.method === 'POST' && r.path === '/api/invoice') {
        const next = invoiceRequests[i + 1];
        expect(next?.method).toBe('PUT');
        expect(next?.path).toMatch(/^\/api\/invoice\/[^/]+\/cancel$/);
      }
    }
    // Le jeton a bien servi (en-tête Authorization)…
    expect(server.requests.every((r) => r.authorization === `Bearer ${TOKEN}`)).toBe(true);
    // … mais n'apparaît nulle part ailleurs.
    const disk = readdirSync(dir)
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n');
    for (const text of [out, err, disk, journalText()]) expect(text).not.toContain(TOKEN);
  });
});
