// Outil d'étalonnage des arrondis — ADR-0024 § 7 et critères F4.
// Aucun appel réseau : doublure en mémoire calculant avec le moteur sous une
// politique choisie par le test.

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CALIBRATION_ROUNDING_POLICIES, DGI_ROUNDING_POLICY } from '@lalanda/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Secret } from '../../integrations/secret-value.js';
import { decideVerdict } from './calibration-analysis.js';
import { selectCalibrationCases } from './calibration-cases.js';
import { restrictToCalibration, runCalibration, type CalibrationDeps } from './calibration-run.js';
import { REPOSITORY_ROOT } from './report.js';
import { CalibrationRefusal } from './safety.js';
import { MEMORY_NIF, createMemoryEdef, type MemoryEdefOptions } from './testing/memory-edef.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKEN = 'jeton-TEST-etalonnage-9f8e7d6c5b4a3210';
const NOW = new Date('2026-10-19T09:30:00.000Z');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lalanda-etalonnage-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup(options: Partial<MemoryEdefOptions> = {}, deps: Partial<CalibrationDeps> = {}) {
  const edef = createMemoryEdef({ token: TOKEN, ...options });
  const lines: string[] = [];
  const readToken = vi.fn(async () => new Secret(TOKEN));
  const run = () =>
    runCalibration({
      edef,
      target: {
        testUrl: 'https://developper.dgirdc.cd/edef',
        productionUrl: 'https://edef.dgirdc.cd',
      },
      isfTest: 'ISF-TEST-01',
      readToken,
      out: (l) => lines.push(l),
      reportPath: join(dir, 'etalonnage.json'),
      now: () => NOW,
      sleep: async () => undefined,
      ...deps,
    });
  return { edef, lines, readToken, run };
}

function allFilesText(root: string): string {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) =>
      readFileSync(join(e.parentPath ?? (e as unknown as { path: string }).path, e.name), 'utf8'),
    )
    .join('\n');
}

describe('étalonnage — déroulé contre la doublure', () => {
  it('chaque POST réussi est suivi IMMÉDIATEMENT de l’annulation du même uid ; aucune confirmation', async () => {
    const { edef, run } = setup();
    await run();
    const invoiceCalls = edef.calls.filter((c) => c.op !== 'status' && c.op !== 'list');
    expect(invoiceCalls.length).toBeGreaterThan(0);
    for (let i = 0; i < invoiceCalls.length; i += 1) {
      const call = invoiceCalls[i]!;
      if (call.op === 'submit' && call.ok) {
        expect(invoiceCalls[i + 1]).toMatchObject({ op: 'cancel', uid: call.uid, ok: true });
      }
    }
    expect(edef.calls.some((c) => c.op === 'confirm')).toBe(false);
    expect([...edef.invoices.values()].every((i) => i.state === 'cancelled')).toBe(true);
  });

  it('envoie les cas calibration + exemples DGI + contre-valeur, rn CAL-AAAAMMJJ-<cas>-<mode>', async () => {
    const { edef, run } = setup();
    const { report } = await run();
    const submitted = edef.calls.filter((c) => c.op === 'submit').map((c) => c.rn);
    expect(submitted).toContain('CAL-20261019-cal-tva-ht-ht');
    expect(submitted).toContain('CAL-20261019-cal-tva-ttc-1pct-ttc');
    expect(submitted).toContain('CAL-20261019-dgi-modele-ttc');
    expect(submitted).toContain('CAL-20261019-devise-contre-valeur-ttc');
    // Les exemples « recalculés à 19 % » n'ont pas d'objet face au taux publié (16 %).
    const skipped = report.cases.filter((c) => c.status === 'skipped').map((c) => c.id);
    expect(skipped).toEqual(expect.arrayContaining(['dgi-ts-a-19', 'dgi-ts-pct-a-19']));
    expect(submitted.length).toBe(report.cases.filter((c) => c.status === 'compared').length);
    // Les cas de refus du moteur ne partent jamais.
    expect(submitted.some((rn) => rn?.includes('refus-'))).toBe(false);
  });

  it.each(CALIBRATION_ROUNDING_POLICIES.map((p) => [p.id, p] as const))(
    'DGI sous %s → cette politique, seule, est proposée',
    async (id, policy) => {
      const { run } = setup({ policy });
      const { report, proposal } = await run();
      expect(report.verdict).toMatchObject({ decided: true, policyId: id });
      expect(proposal).not.toBeNull();
      expect(proposal!.requiresNewPolicy).toBe(id !== DGI_ROUNDING_POLICY.id);
      const text = readFileSync(proposal!.path, 'utf8');
      expect(text).toContain("status: 'calibrated'");
    },
  );

  it('la proposition porte l’empreinte du rapport écrit, datée et sourcée', async () => {
    const { run } = setup();
    const { reportFile, proposal } = await run();
    const bytes = readFileSync(reportFile.path, 'utf8');
    const sha = createHash('sha256').update(bytes, 'utf8').digest('hex');
    expect(reportFile.sha256).toBe(sha);
    const text = readFileSync(proposal!.path, 'utf8');
    expect(text).toContain(`reportSha256: '${sha}'`);
    expect(text).toContain("calibratedAt: '2026-10-19'");
    expect(text).toContain("policyId: 'dgi-cd-2026.1'");
    expect(text).toContain("caseId: 'cal-ligne'");
  });

  it('un écart qu’aucune politique n’explique → « non décidé », aucune proposition', async () => {
    const { run, lines } = setup({ scenarios: { 'dgi-modele-ttc': 'offset:vab' } });
    const { report, proposal } = await run();
    expect(report.verdict.decided).toBe(false);
    expect(proposal).toBeNull();
    const modele = report.cases.find((c) => c.id === 'dgi-modele')!;
    expect(modele.matchedPolicies).toEqual([]);
    expect(modele.comparisons![0]!.differences).toEqual([
      { field: 'vab', ours: '64.00', dgi: '64.01' },
    ]);
    expect(lines.join('\n')).toContain('NON DÉCIDÉ');
    expect(readdirSync(dir).filter((f) => f.includes('proposition'))).toEqual([]);
  });

  it('contre-valeur : curTotal comparé à usdCounterValue', async () => {
    const { run } = setup({ scenarios: { 'devise-contre-valeur': 'offset:curTotal' } });
    const { report } = await run();
    const devise = report.cases.find((c) => c.id === 'devise-contre-valeur')!;
    expect(devise.status).toBe('compared');
    expect(devise.matchedPolicies).toEqual([]);
    expect(devise.comparisons![0]!.differences.map((d) => d.field)).toEqual(['curTotal']);
    expect(devise.dgiTotals!['curRate']).toBe('2262.32');
    expect(report.verdict.decided).toBe(false);
  });

  it('cas décisif refusé par la DGI → étalonnage incomplet, non décidé', async () => {
    const { run } = setup({ scenarios: { 'cal-ligne-ht': 'business:7' } });
    const { report } = await run();
    const c = report.cases.find((x) => x.id === 'cal-ligne')!;
    expect(c.status).toBe('refused');
    expect(c.dgiError).toMatchObject({ kind: 'business', dgiErrorCode: '7' });
    expect(report.verdict).toMatchObject({ decided: false });
    expect((report.verdict as { reason: string }).reason).toContain('incomplet');
  });

  it('arrêt au premier 401 : les cas suivants ne partent pas', async () => {
    const { edef, run } = setup({ scenarios: { 'dgi-remise': 'unauthorized' } });
    const { report } = await run();
    expect(report.stoppedEarly).toContain('401');
    const idx = report.cases.findIndex((c) => c.id === 'dgi-remise');
    expect(report.cases.slice(idx + 1).every((c) => c.status === 'not_sent')).toBe(true);
    const submits = edef.calls.filter((c) => c.op === 'submit');
    expect(submits.at(-1)!.rn).toContain('dgi-remise');
  });

  it('arrêt à la première erreur DGI 1 (e-MCF saturé)', async () => {
    const { run } = setup({ scenarios: { 'dgi-modele-ttc': 'business:1' } });
    const { report } = await run();
    expect(report.stoppedEarly).toContain('erreur DGI 1');
  });

  it('POST sans réponse : signalé, aucune annulation possible (pas d’uid), la demande expirera', async () => {
    const { edef, run } = setup({ scenarios: { 'cal-tva-ht': 'timeout' } });
    const { report } = await run();
    const c = report.cases.find((x) => x.id === 'cal-tva-ht')!;
    expect(c.status).toBe('no_response');
    expect(c.reason).toContain('expirera');
    expect(edef.calls.filter((x) => x.op === 'cancel' && x.rn?.includes('cal-tva-ht'))).toEqual([]);
  });

  it('annulation sans réponse : signalée dans le rapport', async () => {
    const { run } = setup({ scenarios: { 'cal-ts-ht': 'cancel_timeout' } });
    const { report } = await run();
    const c = report.cases.find((x) => x.id === 'cal-ts-ht')!;
    expect(c.cancel).toMatchObject({ ok: false });
    expect(c.cancel!.note).toContain('expirera');
  });

  it('un appel à la fois, 500 ms d’écart entre deux appels', async () => {
    const sleep = vi.fn(async () => undefined);
    const { edef, run } = setup({}, { sleep });
    await run();
    expect(sleep).toHaveBeenCalledTimes(edef.calls.length - 1);
    expect(sleep.mock.calls.every(([ms]) => ms === 500)).toBe(true);
  });

  it('n’écrit jamais rounding-calibration.ts (c’est une personne qui valide)', async () => {
    const file = join(
      REPOSITORY_ROOT,
      'packages/engine/src/invoice-totals/rounding-calibration.ts',
    );
    const before = readFileSync(file, 'utf8');
    const { run } = setup();
    await run();
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(before).toContain("status: 'not_calibrated'");
  });
});

describe('étalonnage — le jeton n’apparaît nulle part', () => {
  it('ni dans la sortie, ni dans le rapport, ni dans la proposition, ni dans aucun fichier écrit', async () => {
    const { run, lines, readToken } = setup();
    const { report } = await run();
    expect(readToken).toHaveBeenCalledTimes(1);
    const everything = [lines.join('\n'), JSON.stringify(report), allFilesText(dir)].join('\n');
    expect(everything).not.toContain(TOKEN);
    // Ni le NIF (lu sur la réponse DGI, remplacé à l'écriture).
    expect(allFilesText(dir)).not.toContain(MEMORY_NIF);
  });
});

describe('étalonnage — garde-fous avant tout appel', () => {
  it.each([
    ['URL de production DGI codée en dur', 'https://edef.dgirdc.cd', 'https://autre.example'],
    [
      'URL égale à la production configurée',
      'https://prod.example.cd/edef',
      'https://prod.example.cd',
    ],
    ['http hors machine locale', 'http://developper.dgirdc.cd/edef', 'https://edef.dgirdc.cd'],
  ])(
    '%s → refus de démarrer, aucun jeton demandé, aucun appel',
    async (_l, testUrl, productionUrl) => {
      const { edef, run, readToken } = setup({}, { target: { testUrl, productionUrl } });
      await expect(run()).rejects.toBeInstanceOf(CalibrationRefusal);
      expect(readToken).not.toHaveBeenCalled();
      expect(edef.calls).toEqual([]);
    },
  );

  it('ISF de test absent → refus avant le jeton', async () => {
    const { run, readToken } = setup({}, { isfTest: null });
    await expect(run()).rejects.toThrow(/DGI_ISF_TEST/);
    expect(readToken).not.toHaveBeenCalled();
  });

  it('chemin de rapport suivi par git → refus avant le jeton', async () => {
    const { edef, run, readToken } = setup({}, { reportPath: join(HERE, 'rapport-interdit.json') });
    await expect(run()).rejects.toThrow(/suivi par git/);
    expect(readToken).not.toHaveBeenCalled();
    expect(edef.calls).toEqual([]);
  });

  it('jeton refusé au statut → arrêt, rien n’est envoyé', async () => {
    const { edef, run } = setup(
      {},
      { readToken: async () => new Secret('mauvais-jeton-000000000') },
    );
    await expect(run()).rejects.toBeInstanceOf(CalibrationRefusal);
    expect(edef.calls.filter((c) => c.op === 'submit')).toEqual([]);
  });
});

describe('étalonnage — jamais de confirmation', () => {
  const CALIBRATION_FILES = [
    'calibrate.ts',
    'calibration-run.ts',
    'calibration-cases.ts',
    'calibration-analysis.ts',
    'report.ts',
    'safety.ts',
    'memory-journal.ts',
  ];

  it.each(CALIBRATION_FILES)(
    '%s ne contient aucun appel de confirmation (lecture des sources)',
    (f) => {
      const source = readFileSync(resolve(HERE, f), 'utf8');
      expect(source).not.toMatch(/confirmInvoice/);
      expect(source).not.toMatch(/\/confirm\b/);
    },
  );

  it('restrictToCalibration ne transmet que quatre routes, même avec un client complet', () => {
    const full = createMemoryEdef({ token: TOKEN });
    const restricted = restrictToCalibration(full) as unknown as Record<string, unknown>;
    expect(Object.keys(restricted).sort()).toEqual(
      ['cancelInvoice', 'getReferenceList', 'getStatus', 'submitInvoice'].sort(),
    );
    expect(restricted['confirmInvoice']).toBeUndefined();
    expect(Object.isFrozen(restricted)).toBe(true);
  });
});

describe('règle de choix (ADR-0024 § 7.3)', () => {
  const ids = CALIBRATION_ROUNDING_POLICIES.map((p) => p.id);

  it('une seule candidate → retenue', () => {
    expect(
      decideVerdict([
        { id: 'a', decisive: true, status: 'compared', matchedPolicies: [ids[0]!, ids[1]!] },
        { id: 'b', decisive: true, status: 'compared', matchedPolicies: [ids[0]!, ids[2]!] },
      ]),
    ).toMatchObject({ decided: true, policyId: ids[0] });
  });

  it('plusieurs candidates → non décidé', () => {
    const v = decideVerdict([
      { id: 'a', decisive: true, status: 'compared', matchedPolicies: ids },
    ]);
    expect(v).toMatchObject({ decided: false, candidates: ids });
  });

  it('aucune candidate commune → non décidé', () => {
    const v = decideVerdict([
      { id: 'a', decisive: true, status: 'compared', matchedPolicies: [ids[0]!] },
      { id: 'b', decisive: true, status: 'compared', matchedPolicies: [ids[1]!] },
    ]);
    expect(v).toMatchObject({ decided: false, candidates: [] });
  });

  it('un cas non décisif ne compte pas', () => {
    expect(
      decideVerdict([
        { id: 'a', decisive: true, status: 'compared', matchedPolicies: [ids[2]!] },
        { id: 'x', decisive: false, status: 'compared', matchedPolicies: [] },
      ]),
    ).toMatchObject({ decided: true, policyId: ids[2] });
  });

  it('les cas décisifs sont les cas calibration et les cas fiables', () => {
    for (const c of selectCalibrationCases()) {
      expect(c.decisive, c.id).toBe(
        c.origin === 'calibration' || c.reliability === 'reliable' || c.counterValue,
      );
    }
  });
});
