// Ligne de commande de l'outil d'étalonnage et invite masquée — ADR-0024 § 7.2.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EdefClient } from '../edef.client.js';
import { main, parseArgs, type CliIo } from './calibrate.js';
import { CalibrationRefusal, assertNotTrackedByGit, readHiddenSecret } from './safety.js';
import { createMemoryEdef } from './testing/memory-edef.js';
import { DEFAULT_REPORT_DIR } from './report.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = resolve(HERE, '../../..');
const TOKEN = 'jeton-TEST-cli-a1b2c3d4e5f60718';

function sink(): PassThrough & { text: () => string } {
  const stream = new PassThrough() as PassThrough & { text: () => string };
  let buffer = '';
  stream.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
  });
  stream.text = () => buffer;
  return stream;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lalanda-cli-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function io(overrides: Partial<CliIo> = {}) {
  const stdin = new PassThrough();
  const stdout = sink();
  const stderr = sink();
  const makeClient = vi.fn(() => createMemoryEdef({ token: TOKEN }) as unknown as EdefClient);
  const value: CliIo = {
    stdin,
    stdout,
    stderr,
    env: { DGI_ISF_TEST: 'ISF-TEST-01' },
    requireTty: false,
    makeClient,
    sleep: async () => undefined,
    ...overrides,
  };
  return { io: value, stdin, stdout, stderr, makeClient };
}

describe('invite masquée', () => {
  it('rien de ce qui est tapé ne s’affiche ; retour arrière et séquences d’échappement gérés', async () => {
    const input = new PassThrough() as PassThrough & {
      isTTY: boolean;
      setRawMode: (m: boolean) => void;
    };
    input.isTTY = true;
    const modes: boolean[] = [];
    input.setRawMode = (m) => void modes.push(m);
    const output = sink();
    const pending = readHiddenSecret('Jeton :', { input, output });
    input.write('Zq9\u007f8\u001b[A\u001b[200~X\u001b[201~\r');
    const secret = await pending;
    expect(secret.expose()).toBe('Zq8X');
    expect(String(secret)).toBe('[redacted]');
    expect(output.text()).not.toMatch(/Zq|q8|8X|\*/);
    expect(modes).toEqual([true, false]);
  });

  it('Ctrl-C abandonne la saisie', async () => {
    const input = new PassThrough();
    const pending = readHiddenSecret('Jeton :', { input, output: sink() });
    input.write('abc\u0003');
    await expect(pending).rejects.toBeInstanceOf(CalibrationRefusal);
  });

  it('saisie vide refusée', async () => {
    const input = new PassThrough();
    const pending = readHiddenSecret('Jeton :', { input, output: sink() });
    input.write('\r');
    await expect(pending).rejects.toThrow(/Aucun jeton/);
  });
});

describe('arguments', () => {
  it('un argument inconnu (ex. un jeton passé en argument) est refusé SANS être réaffiché', () => {
    const attempt = () => parseArgs(['--jeton', TOKEN]);
    expect(attempt).toThrow(CalibrationRefusal);
    try {
      attempt();
    } catch (err) {
      expect((err as Error).message).not.toContain(TOKEN);
      expect((err as Error).message).toContain('JAMAIS');
    }
  });

  it('aucun paramètre ne permet la production', () => {
    for (const arg of ['--production', '--env=production', '--url']) {
      expect(() => parseArgs([arg])).toThrow(CalibrationRefusal);
    }
  });

  it('par défaut : étalonnage, rapport dans dgi/etalonnage/ (ignoré par git)', () => {
    const options = parseArgs([]);
    expect(options).toMatchObject({ command: 'etalonner', outDir: DEFAULT_REPORT_DIR });
    expect(() => assertNotTrackedByGit(join(DEFAULT_REPORT_DIR, 'x.json'))).not.toThrow();
  });
});

describe('main', () => {
  it('URL de test = production DGI → refus, aucune invite, aucun client créé', async () => {
    const {
      io: value,
      stdout,
      stderr,
      makeClient,
    } = io({
      env: { DGI_EDEF_TEST_URL: 'https://edef.dgirdc.cd', DGI_ISF_TEST: 'ISF' },
    });
    expect(await main([], value)).toBe(1);
    expect(stderr.text()).toContain('PRODUCTION');
    expect(stdout.text()).not.toContain('Jeton');
    expect(makeClient).not.toHaveBeenCalled();
  });

  it('sans terminal interactif → refus (le jeton ne passe pas par un tube)', async () => {
    const { io: value, stderr, makeClient } = io({ requireTty: true });
    expect(await main(['--sortie', dir], value)).toBe(1);
    expect(stderr.text()).toContain('terminal interactif');
    expect(makeClient).not.toHaveBeenCalled();
  });

  it('probe sans --sonde : liste les sondes, n’exécute rien', async () => {
    const { io: value, stdout, makeClient } = io();
    expect(await main(['probe'], value)).toBe(1);
    expect(stdout.text()).toContain('apres-confirmation  [CONFIRME une facture de test]');
    expect(makeClient).not.toHaveBeenCalled();
  });

  it('de bout en bout : jeton tapé, rapport écrit, jeton absent de la sortie et du disque', async () => {
    const { io: value, stdin, stdout, stderr } = io();
    const done = main(['--sortie', dir], value);
    setTimeout(() => stdin.write(`${TOKEN}\r`), 10);
    expect(await done).toBe(0);
    expect(stderr.text()).toBe('');
    expect(stdout.text()).toContain('Verdict : politique dgi-cd-2026.1');
    const files = readdirSync(dir);
    expect(files.some((f) => /^etalonnage-\d{8}-\d{6}\.json$/.test(f))).toBe(true);
    const disk = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
    expect(stdout.text() + disk).not.toContain(TOKEN);
  });
});

describe('script réel (processus séparé)', () => {
  it('refuse de démarrer contre l’URL de production, avant toute invite', () => {
    const tsx = join(API_ROOT, 'node_modules', '.bin', 'tsx');
    const result = spawnSync(tsx, ['src/edef/calibration/calibrate.ts'], {
      cwd: API_ROOT,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: process.env['HOME'] ?? '',
        DGI_EDEF_TEST_URL: 'https://edef.dgirdc.cd',
      },
      input: '',
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('PRODUCTION');
    expect(result.stdout).not.toContain('Jeton');
  }, 70_000);
});
