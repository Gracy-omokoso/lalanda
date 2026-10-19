// Sondes de comportement de l'e-MCF — ADR-0024 § 7.4 et critères F4.

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Secret } from '../../integrations/secret-value.js';
import { CONFIRMATION_WORD, runProbes, type ProbeDeps, type ProbeName } from './probe.js';
import { CalibrationRefusal } from './safety.js';
import { MEMORY_NIF, createMemoryEdef, type MemoryEdefOptions } from './testing/memory-edef.js';

const TOKEN = 'jeton-TEST-sondes-0011223344556677';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lalanda-sondes-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup(
  probes: ProbeName[],
  options: Partial<MemoryEdefOptions> = {},
  deps: Partial<ProbeDeps> = {},
) {
  let now = Date.parse('2026-10-19T10:00:00.000Z');
  const edef = createMemoryEdef({
    token: TOKEN,
    clock: () => now,
    pendingTtlMs: 120_000,
    ...options,
  });
  const lines: string[] = [];
  const ask = vi.fn(async () => CONFIRMATION_WORD);
  const readToken = vi.fn(async () => new Secret(TOKEN));
  const run = () =>
    runProbes({
      edef,
      target: {
        testUrl: 'https://developper.dgirdc.cd/edef',
        productionUrl: 'https://edef.dgirdc.cd',
      },
      isfTest: 'ISF-TEST-01',
      probes,
      readToken,
      ask,
      out: (l) => lines.push(l),
      reportPath: join(dir, 'sondes.json'),
      now: () => new Date(now),
      // L'horloge de la doublure avance du temps « attendu ».
      sleep: async (ms) => {
        now += ms;
      },
      ...deps,
    });
  return { edef, lines, ask, readToken, run };
}

describe('sondes — désactivées par défaut', () => {
  it('aucune sonde nommée → refus, ni jeton demandé ni appel', async () => {
    const { edef, run, readToken } = setup([]);
    await expect(run()).rejects.toBeInstanceOf(CalibrationRefusal);
    expect(readToken).not.toHaveBeenCalled();
    expect(edef.calls).toEqual([]);
  });

  it('URL de production → refus avant tout', async () => {
    const { edef, run, readToken } = setup(
      ['apres-annulation'],
      {},
      {
        target: { testUrl: 'https://edef.dgirdc.cd', productionUrl: 'https://edef.dgirdc.cd' },
      },
    );
    await expect(run()).rejects.toThrow(/PRODUCTION/);
    expect(readToken).not.toHaveBeenCalled();
    expect(edef.calls).toEqual([]);
  });
});

describe('sonde apres-confirmation — confirmation explicite', () => {
  it('réponse autre que CONFIRMER → sonde passée, aucune facture envoyée ni confirmée', async () => {
    const ask = vi.fn(async () => 'oui');
    const { edef, run } = setup(['apres-confirmation'], {}, { ask });
    const { report } = await run();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(report.probes[0]).toMatchObject({ status: 'skipped' });
    expect(edef.calls.filter((c) => c.op === 'submit' || c.op === 'confirm')).toEqual([]);
  });

  it('CONFIRMER → une seule confirmation, puis lecture du détail et de la liste', async () => {
    const { edef, run, ask } = setup(['apres-confirmation']);
    const { report } = await run();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(edef.calls.filter((c) => c.op === 'confirm')).toHaveLength(1);
    const ops = edef.calls.filter((c) => c.op !== 'status' && c.op !== 'list').map((c) => c.op);
    expect(ops).toEqual(['submit', 'confirm', 'details', 'pending']);
    expect(report.probes[0]!.findings.join(' ')).toContain('éléments de sécurité PRÉSENTS');
  });

  it('détail sans éléments de sécurité après confirmation : observé et consigné', async () => {
    const { run } = setup(['apres-confirmation'], { detailsAfterConfirm: 'without_security' });
    const { report } = await run();
    expect(report.probes[0]!.findings.join(' ')).toContain('éléments de sécurité ABSENTS');
  });

  it('écart de totaux → annulation, JAMAIS de confirmation', async () => {
    const { edef, run } = setup(['apres-confirmation'], {
      scenarios: { 'apres-confirmation': 'offset:vab' },
    });
    const { report } = await run();
    expect(edef.calls.some((c) => c.op === 'confirm')).toBe(false);
    expect(edef.calls.filter((c) => c.op === 'cancel')).toHaveLength(1);
    expect(report.probes[0]).toMatchObject({ status: 'aborted' });
  });

  it('les autres sondes ne demandent aucune confirmation et ne confirment jamais', async () => {
    const { edef, run, ask } = setup([
      'apres-annulation',
      'apres-expiration',
      'rn-en-attente',
      'rn-apres-annulation',
      'rn-apres-expiration',
    ]);
    await run();
    expect(ask).not.toHaveBeenCalled();
    expect(edef.calls.some((c) => c.op === 'confirm')).toBe(false);
  });
});

describe('sondes — observations', () => {
  it('apres-annulation : détail et liste après annulation', async () => {
    const { run } = setup(['apres-annulation']);
    const { report } = await run();
    const findings = report.probes[0]!.findings.join(' ');
    expect(findings).toContain('après annulation');
    expect(findings).toContain('ne figure PAS');
  });

  it('apres-expiration : attend l’expiration, puis observe et tente une annulation', async () => {
    const sleep = vi.fn(async () => undefined);
    let now = Date.parse('2026-10-19T10:00:00.000Z');
    const { run } = setup(
      ['apres-expiration'],
      { clock: () => now },
      {
        sleep: async (ms) => {
          await sleep(ms);
          now += ms;
        },
        expiryWaitMs: 150_000,
      },
    );
    const { report } = await run();
    expect(sleep).toHaveBeenCalledWith(150_000);
    const findings = report.probes[0]!.findings.join(' ');
    expect(findings).toContain('après expiration');
    expect(findings).toContain('Annulation après expiration : refusée');
  });

  it('rn-en-attente : le même numéro est refusé (63) puis la demande est annulée', async () => {
    const { edef, run } = setup(['rn-en-attente']);
    const { report } = await run();
    expect(report.probes[0]!.findings.join(' ')).toContain('code DGI 63');
    expect([...edef.invoices.values()].every((i) => i.state === 'cancelled')).toBe(true);
  });

  it('rn-apres-annulation : renvoi accepté par la doublure, seconde demande annulée', async () => {
    const { edef, run } = setup(['rn-apres-annulation']);
    const { report } = await run();
    expect(report.probes[0]!.findings.join(' ')).toContain('ACCEPTÉ');
    expect([...edef.invoices.values()].every((i) => i.state === 'cancelled')).toBe(true);
  });

  it('le jeton, le NIF et les éléments de sécurité n’apparaissent ni dans la sortie ni sur disque', async () => {
    const { run, lines } = setup(['apres-confirmation', 'rn-en-attente']);
    await run();
    const files = readdirSync(dir)
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n');
    for (const text of [lines.join('\n'), files]) {
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain(MEMORY_NIF);
      expect(text).not.toContain('DEF-FICTIF');
      expect(text).not.toContain('QR-FICTIF');
    }
  });
});
