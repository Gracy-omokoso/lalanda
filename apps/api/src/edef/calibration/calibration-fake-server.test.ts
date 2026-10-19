// Étalonnage de bout en bout PAR LA LIGNE DE COMMANDE : `main` (jeton tapé à
// l'invite), VRAI client e-MCF (`EdefClient`) et faux serveur du dépôt
// (`../testing/fake-edef-server.ts`) en HTTP local, dont les totaux sont
// calculés par le moteur sous une politique choisie par le test. Aucun appel à
// la DGI réelle.

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { CALIBRATION_ROUNDING_POLICIES } from '@lalanda/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EdefClient } from '../edef.client.js';
import { startFakeEdefServer, type FakeEdefServer } from '../testing/fake-edef-server.js';
import { main } from './calibrate.js';
import { createMemoryJournal, type MemoryJournal } from './memory-journal.js';
import { FAKE_NIF, HARNESS_TAX_GROUPS } from './testing/fake-server-harness.js';

const TOKEN = 'jeton-TEST-faux-serveur-5566778899aabbcc';

let dir: string;
let server: FakeEdefServer;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lalanda-etalonnage-e2e-'));
  server = await startFakeEdefServer({
    tokens: { [TOKEN]: { nif: FAKE_NIF, nim: 'NIM-FICTIF', tokenValid: '2027-01-01T00:00:00' } },
    taxGroups: HARNESS_TAX_GROUPS,
  });
});
afterEach(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('edef:calibrate de bout en bout contre le faux serveur (client réel)', () => {
  it.each(CALIBRATION_ROUNDING_POLICIES.map((p) => [p.id, p] as const))(
    'faux serveur sous %s : cette politique est désignée, chaque envoi annulé, aucun confirm, jeton invisible',
    async (id, policy) => {
      server.setRoundingPolicy(policy);
      let journal: MemoryJournal | null = null;
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
          return new EdefClient(config, journal.journal);
        },
      });
      setTimeout(() => stdin.write(`${TOKEN}\r`), 10);
      const code = await done;
      expect(err).toBe('');
      expect(code).toBe(0);

      // La politique réglée sur le faux serveur, et elle seule.
      expect(out).toContain(`Verdict : politique ${id} `);
      const reportName = readdirSync(dir).find((f) => /^etalonnage-\d{8}-\d{6}\.json$/.test(f))!;
      const report = JSON.parse(readFileSync(join(dir, reportName), 'utf8'));
      expect(report.verdict).toMatchObject({ decided: true, policyId: id });

      // Chaque envoi est suivi immédiatement de son annulation ; aucun confirm.
      expect(server.callsTo('confirm')).toHaveLength(0);
      const submits = server.callsTo('submit');
      expect(submits.length).toBeGreaterThan(0);
      expect(server.callsTo('cancel')).toHaveLength(submits.length);
      const seq = server.requests.filter((r) => r.path.startsWith('/api/invoice'));
      seq.forEach((r, i) => {
        if (r.method !== 'POST') return;
        const [created] = server.invoicesByRn(JSON.parse(r.body!).rn as string);
        expect(seq[i + 1]?.method).toBe('PUT');
        expect(seq[i + 1]?.path).toBe(`/api/invoice/${created!.uid}/cancel`);
      });
      expect(server.invoices().every((i) => i.status === 'cancelled')).toBe(true);

      // Le jeton a servi (en-tête Authorization), mais n'apparaît nulle part ailleurs.
      expect(server.requests.every((r) => r.authorization === `Bearer ${TOKEN}`)).toBe(true);
      const disk = readdirSync(dir)
        .map((f) => readFileSync(join(dir, f), 'utf8'))
        .join('\n');
      const journalText = JSON.stringify((journal as MemoryJournal | null)?.entries ?? []);
      expect(journalText.length).toBeGreaterThan(2);
      for (const text of [out, err, disk, journalText]) expect(text).not.toContain(TOKEN);
      expect(disk).not.toContain(FAKE_NIF);
    },
  );
});
