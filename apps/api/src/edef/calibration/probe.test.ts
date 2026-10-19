// Sondes de comportement de l'e-MCF — ADR-0024 § 7.4 et critères F4.
// VRAI client e-MCF contre le faux serveur du dépôt (HTTP local).

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Secret } from '../../integrations/secret-value.js';
import type { FakeEdefScenarioInput } from '../testing/fake-edef-server.js';
import { CONFIRMATION_WORD, runProbes, type ProbeDeps, type ProbeName } from './probe.js';
import { CalibrationRefusal } from './safety.js';
import { FAKE_NIF, startHarness, type Harness } from './testing/fake-server-harness.js';

const TOKEN = 'jeton-TEST-sondes-0011223344556677';
const NOW = new Date('2026-10-19T10:00:00.000Z');
const rnOf = (probe: ProbeName) => `SONDE-20261019-100000-${probe}`;

let dir: string;
let h: Harness | null = null;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lalanda-sondes-'));
});
afterEach(async () => {
  await h?.close();
  h = null;
  rmSync(dir, { recursive: true, force: true });
});

async function setup(
  probes: ProbeName[],
  scenarios: Partial<Record<ProbeName, FakeEdefScenarioInput>> = {},
  deps: Partial<ProbeDeps> = {},
) {
  h = await startHarness(TOKEN);
  const harness = h;
  for (const [name, s] of Object.entries(scenarios)) {
    harness.server.setInvoiceScenario(rnOf(name as ProbeName), s);
  }
  const lines: string[] = [];
  const ask = vi.fn(async () => CONFIRMATION_WORD);
  const readToken = vi.fn(async () => new Secret(TOKEN));
  const run = () =>
    runProbes({
      edef: harness.client,
      target: { testUrl: harness.server.baseUrl, productionUrl: 'https://edef.dgirdc.cd' },
      isfTest: 'ISF-TEST-01',
      probes,
      readToken,
      ask,
      out: (l) => lines.push(l),
      reportPath: join(dir, 'sondes.json'),
      now: () => NOW,
      // Le temps « attendu » fait avancer l'horloge du faux serveur.
      sleep: async (ms) => harness.server.advanceClock(ms),
      ...deps,
    });
  return { server: harness.server, lines, ask, readToken, run };
}

describe('sondes — désactivées par défaut', () => {
  it('aucune sonde nommée → refus, ni jeton demandé ni appel', async () => {
    const { server, run, readToken } = await setup([]);
    await expect(run()).rejects.toBeInstanceOf(CalibrationRefusal);
    expect(readToken).not.toHaveBeenCalled();
    expect(server.requests).toEqual([]);
  });

  it('URL de production → refus avant tout', async () => {
    const { server, run, readToken } = await setup(
      ['apres-annulation'],
      {},
      {
        target: { testUrl: 'https://edef.dgirdc.cd', productionUrl: 'https://edef.dgirdc.cd' },
      },
    );
    await expect(run()).rejects.toThrow(/PRODUCTION/);
    expect(readToken).not.toHaveBeenCalled();
    expect(server.requests).toEqual([]);
  });
});

describe('sonde apres-confirmation — confirmation explicite', () => {
  it('réponse autre que CONFIRMER → sonde passée, aucune facture envoyée ni confirmée', async () => {
    const ask = vi.fn(async () => 'oui');
    const { server, run } = await setup(['apres-confirmation'], {}, { ask });
    const { report } = await run();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(report.probes[0]).toMatchObject({ status: 'skipped' });
    expect(server.callsTo('submit')).toHaveLength(0);
    expect(server.callsTo('confirm')).toHaveLength(0);
  });

  it('CONFIRMER → une seule confirmation, puis lecture du détail et de la liste', async () => {
    const { server, run, ask } = await setup(['apres-confirmation']);
    const { report } = await run();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(server.callsTo('confirm')).toHaveLength(1);
    expect(server.invoicesByRn(rnOf('apres-confirmation'))[0]!.status).toBe('confirmed');
    const kinds = server.requests
      .filter((r) => r.path.startsWith('/api/invoice'))
      .map((r) => `${r.method} ${r.path.replace(/\/api\/invoice\/[^/]+/, '/api/invoice/{uid}')}`);
    expect(kinds).toEqual([
      'POST /api/invoice',
      'PUT /api/invoice/{uid}/confirm',
      'GET /api/invoice/{uid}',
      'GET /api/invoice',
    ]);
    expect(report.probes[0]!.findings.join(' ')).toContain('éléments de sécurité PRÉSENTS');
  });

  it('détail sans éléments de sécurité après confirmation : observé et consigné', async () => {
    const { run } = await setup(['apres-confirmation'], {
      'apres-confirmation': 'details_without_security',
    });
    const { report } = await run();
    expect(report.probes[0]!.findings.join(' ')).toContain('éléments de sécurité ABSENTS');
  });

  it('écart de totaux → annulation, JAMAIS de confirmation', async () => {
    const { server, run } = await setup(['apres-confirmation'], {
      'apres-confirmation': 'totals_offset:vab',
    });
    const { report } = await run();
    expect(server.callsTo('confirm')).toHaveLength(0);
    expect(server.callsTo('cancel')).toHaveLength(1);
    expect(report.probes[0]).toMatchObject({ status: 'aborted' });
  });

  it('les autres sondes ne demandent aucune confirmation et ne confirment jamais', async () => {
    const { server, run, ask } = await setup([
      'apres-annulation',
      'apres-expiration',
      'rn-en-attente',
      'rn-apres-annulation',
      'rn-apres-expiration',
    ]);
    await run();
    expect(ask).not.toHaveBeenCalled();
    expect(server.callsTo('confirm')).toHaveLength(0);
  });
});

describe('sondes — observations', () => {
  it('apres-annulation : détail et liste après annulation', async () => {
    const { run } = await setup(['apres-annulation']);
    const { report } = await run();
    const findings = report.probes[0]!.findings.join(' ');
    expect(findings).toContain('après annulation');
    expect(findings).toContain('ne figure PAS');
  });

  it('apres-expiration : attend l’expiration, puis observe et tente une annulation', async () => {
    const { run } = await setup(['apres-expiration'], {}, { expiryWaitMs: 150_000 });
    const { report } = await run();
    const findings = report.probes[0]!.findings.join(' ');
    expect(findings).toContain('après expiration');
    expect(findings).toContain('ne figure PAS');
    expect(findings).toContain('Annulation après expiration : refusée');
  });

  it('rn-en-attente : le même numéro est refusé (63) puis la demande est annulée', async () => {
    const { server, run } = await setup(['rn-en-attente']);
    const { report } = await run();
    expect(report.probes[0]!.findings.join(' ')).toContain('code DGI 63');
    expect(server.invoices().every((i) => i.status === 'cancelled')).toBe(true);
  });

  it('rn-apres-annulation : renvoi observé, seconde demande annulée si créée', async () => {
    const { server, run } = await setup(['rn-apres-annulation']);
    const { report } = await run();
    expect(report.probes[0]!.findings.join(' ')).toMatch(/Même numéro renvoyé après annulation/);
    expect(server.invoices().every((i) => i.status === 'cancelled')).toBe(true);
  });

  it('le jeton, le NIF et les éléments de sécurité n’apparaissent ni dans la sortie ni sur disque', async () => {
    const { server, run, lines } = await setup(['apres-confirmation', 'rn-en-attente']);
    await run();
    const security = server.invoicesByRn(rnOf('apres-confirmation'))[0]!.security!;
    const files = readdirSync(dir)
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n');
    for (const text of [lines.join('\n'), files]) {
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain(FAKE_NIF);
      expect(text).not.toContain(security.codeDEFDGI);
      expect(text).not.toContain(security.qrCode);
    }
    expect(JSON.stringify(h!.journal.entries)).not.toContain(TOKEN);
  });
});
