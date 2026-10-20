// Outil d'étalonnage des arrondis — ADR-0024 § 7 et critères F4.
// VRAI client e-MCF contre le faux serveur du dépôt (HTTP local), dont les
// totaux sont calculés par le moteur sous une politique choisie par le test.

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CALIBRATION_ROUNDING_POLICIES, DGI_ROUNDING_POLICY } from '@lalanda/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Secret } from '../../integrations/secret-value.js';
import type { FakeEdefScenarioInput } from '../testing/fake-edef-server.js';
import { decideVerdict } from './calibration-analysis.js';
import { selectCalibrationCases } from './calibration-cases.js';
import { restrictToCalibration, runCalibration, type CalibrationDeps } from './calibration-run.js';
import { REPOSITORY_ROOT } from './report.js';
import { CalibrationRefusal } from './safety.js';
import { FAKE_NIF, startHarness, type Harness } from './testing/fake-server-harness.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKEN = 'jeton-TEST-etalonnage-9f8e7d6c5b4a3210';
const NOW = new Date('2026-10-19T09:30:00.000Z');
const rn = (caseId: string, mode: 'ttc' | 'ht') => `CAL-20261019-${caseId}-${mode}`;

let dir: string;
let h: Harness | null = null;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lalanda-etalonnage-'));
});
afterEach(async () => {
  await h?.close();
  h = null;
  rmSync(dir, { recursive: true, force: true });
});

async function setup(
  opts: {
    policy?: (typeof CALIBRATION_ROUNDING_POLICIES)[number];
    scenarios?: Record<string, FakeEdefScenarioInput>;
  } = {},
  deps: Partial<CalibrationDeps> = {},
) {
  h = await startHarness(TOKEN, opts.policy ? { policy: opts.policy } : {});
  for (const [r, s] of Object.entries(opts.scenarios ?? {})) h.server.setInvoiceScenario(r, s);
  const harness = h;
  const lines: string[] = [];
  const readToken = vi.fn(async () => new Secret(TOKEN));
  const run = () =>
    runCalibration({
      edef: harness.client,
      target: { testUrl: harness.server.baseUrl, productionUrl: 'https://edef.dgirdc.cd' },
      isfTest: 'ISF-TEST-01',
      readToken,
      out: (l) => lines.push(l),
      reportPath: join(dir, 'etalonnage.json'),
      now: () => NOW,
      sleep: async () => undefined,
      ...deps,
    });
  return { h: harness, server: harness.server, lines, readToken, run };
}

function allFilesText(root: string): string {
  return readdirSync(root)
    .map((f) => readFileSync(join(root, f), 'utf8'))
    .join('\n');
}

/** Chaque POST est suivi IMMÉDIATEMENT de l'annulation de la demande qu'il a créée. */
function expectEachSubmitCancelled(server: Harness['server']): void {
  const seq = server.requests.filter((r) => r.path.startsWith('/api/invoice'));
  expect(seq.some((r) => r.method === 'POST')).toBe(true);
  seq.forEach((r, i) => {
    if (r.method !== 'POST') return;
    const created = server.invoicesByRn(JSON.parse(r.body!).rn as string);
    expect(created).toHaveLength(1);
    expect({ method: seq[i + 1]?.method, path: seq[i + 1]?.path }).toEqual({
      method: 'PUT',
      path: `/api/invoice/${created[0]!.uid}/cancel`,
    });
  });
}

describe('étalonnage contre le faux serveur — politique désignée', () => {
  it.each(CALIBRATION_ROUNDING_POLICIES.map((p) => [p.id, p] as const))(
    'faux serveur sous %s → cette politique, et aucune autre ; envoi puis annulation, aucun confirm',
    async (id, policy) => {
      const { server, run } = await setup({ policy });
      const { report, proposal } = await run();
      expect(report.verdict).toMatchObject({ decided: true, policyId: id });
      // Aucune autre politique ne reproduit tous les cas décisifs.
      const decisive = report.cases.filter((c) => c.decisive);
      expect(decisive.every((c) => c.status === 'compared')).toBe(true);
      for (const other of CALIBRATION_ROUNDING_POLICIES.filter((p) => p.id !== id)) {
        expect(
          decisive.some((c) => !c.matchedPolicies!.includes(other.id)),
          other.id,
        ).toBe(true);
      }
      expect(proposal!.requiresNewPolicy).toBe(id !== DGI_ROUNDING_POLICY.id);
      const text = readFileSync(proposal!.path, 'utf8');
      expect(text).toContain("status: 'calibrated'");
      // Une politique autre que la politique par défaut (dgi-cd-2026.2, calcul 1.1.0)
      // appellerait la suivante, jamais un identifiant déjà pris.
      expect(text).toContain(
        id === DGI_ROUNDING_POLICY.id ? "policyId: 'dgi-cd-2026.2'" : "policyId: 'dgi-cd-2026.3'",
      );
      if (id !== DGI_ROUNDING_POLICY.id) expect(text).toContain("passe à '1.2.0'");
      expect(text).toContain("cases: Object.freeze<RoundingCalibrationRecord['cases']>([");
      // Envoi puis annulation, jamais de confirmation.
      expect(server.callsTo('confirm')).toHaveLength(0);
      expect(server.callsTo('cancel')).toHaveLength(server.callsTo('submit').length);
      expectEachSubmitCancelled(server);
      expect(server.invoices().every((i) => i.status === 'cancelled')).toBe(true);
    },
  );
});

describe('étalonnage — déroulé', () => {
  it('envoie les cas calibration + exemples DGI + contre-valeur, rn CAL-AAAAMMJJ-<cas>-<mode>', async () => {
    const { server, run } = await setup();
    const { report } = await run();
    const submitted = server.callsTo('submit').map((r) => JSON.parse(r.body!).rn as string);
    expect(submitted).toEqual(
      expect.arrayContaining([
        rn('cal-tva-ht', 'ht'),
        rn('cal-tva-ttc-1pct', 'ttc'),
        rn('dgi-modele', 'ttc'),
        rn('devise-contre-valeur', 'ttc'),
      ]),
    );
    const skipped = report.cases.filter((c) => c.status === 'skipped').map((c) => c.id);
    expect(skipped).toEqual(expect.arrayContaining(['dgi-ts-a-19', 'dgi-ts-pct-a-19']));
    expect(submitted.length).toBe(report.cases.filter((c) => c.status === 'compared').length);
    expect(submitted.some((r) => r.includes('refus-'))).toBe(false);
  });

  it('la proposition porte l’empreinte du rapport écrit, datée et sourcée', async () => {
    const { run } = await setup();
    const { reportFile, proposal } = await run();
    const sha = createHash('sha256')
      .update(readFileSync(reportFile.path, 'utf8'), 'utf8')
      .digest('hex');
    expect(reportFile.sha256).toBe(sha);
    const text = readFileSync(proposal!.path, 'utf8');
    expect(text).toContain(`reportSha256: '${sha}'`);
    expect(text).toContain("calibratedAt: '2026-10-19'");
    expect(text).toContain("policyId: 'dgi-cd-2026.2'");
    expect(text).toContain("caseId: 'cal-ligne'");
  });

  it('un écart qu’aucune politique n’explique → « non décidé », aucune proposition', async () => {
    const { run, lines } = await setup({
      scenarios: { [rn('dgi-modele', 'ttc')]: 'totals_offset:vab' },
    });
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
    const { run } = await setup({
      scenarios: { [rn('devise-contre-valeur', 'ttc')]: 'totals_offset:curTotal' },
    });
    const { report } = await run();
    const devise = report.cases.find((c) => c.id === 'devise-contre-valeur')!;
    expect(devise.status).toBe('compared');
    expect(devise.matchedPolicies).toEqual([]);
    expect(devise.comparisons![0]!.differences.map((d) => d.field)).toEqual(['curTotal']);
    expect(devise.dgiTotals!['curRate']).toBe('1');
    expect(report.verdict.decided).toBe(false);
  });

  it('cas décisif refusé par la DGI → étalonnage incomplet, non décidé', async () => {
    const { run } = await setup({
      scenarios: { [rn('cal-ligne', 'ht')]: 'post_business_error:7' },
    });
    const { report } = await run();
    const c = report.cases.find((x) => x.id === 'cal-ligne')!;
    expect(c.status).toBe('refused');
    expect(c.dgiError).toMatchObject({ kind: 'business', dgiErrorCode: '7' });
    expect((report.verdict as { reason: string }).reason).toContain('incomplet');
  });

  it('arrêt au premier 401 : les cas suivants ne partent pas', async () => {
    let flipped = false;
    const { server, run } = await setup(
      {},
      {
        // Le jeton devient invalide après le deuxième envoi.
        sleep: async () => {
          if (!flipped && server.callsTo('submit').length === 2) {
            flipped = true;
            server.setToken(TOKEN, {
              nif: FAKE_NIF,
              nim: 'NIM-FICTIF',
              tokenValid: '2027-01-01T00:00:00',
              behaviour: 'unauthorized',
            });
          }
        },
      },
    );
    const { report } = await run();
    expect(report.stoppedEarly).toContain('401');
    expect(report.cases.filter((c) => c.status === 'not_sent').length).toBeGreaterThan(0);
    const unauthorizedAt = report.cases.findIndex(
      (c) => c.cancel?.error?.kind === 'unauthorized' || c.dgiError?.kind === 'unauthorized',
    );
    expect(
      report.cases
        .slice(unauthorizedAt + 1)
        .every((c) => c.status === 'not_sent' || c.status === 'skipped'),
    ).toBe(true);
    expect(server.callsTo('submit').length).toBeLessThanOrEqual(3);
  });

  it('arrêt à la première erreur DGI 1 (e-MCF saturé)', async () => {
    const { run } = await setup({ scenarios: { [rn('dgi-modele', 'ttc')]: 'pending_full' } });
    const { report } = await run();
    expect(report.stoppedEarly).toContain('erreur DGI 1');
  });

  it('POST sans réponse : signalé, aucune annulation (pas d’uid), la demande expirera', async () => {
    const { server, run } = await setup({
      scenarios: { [rn('cal-tva-ht', 'ht')]: 'post_timeout_after_create' },
    });
    const { report } = await run();
    const c = report.cases.find((x) => x.id === 'cal-tva-ht')!;
    expect(c.status).toBe('no_response');
    expect(c.reason).toContain('expirera');
    const uid = server.invoicesByRn(rn('cal-tva-ht', 'ht'))[0]!.uid;
    expect(server.callsTo('cancel').some((r) => r.path.includes(uid))).toBe(false);
    expect(server.callsTo('confirm')).toHaveLength(0);
  });

  it('annulation sans réponse : signalée dans le rapport', async () => {
    const { run } = await setup({ scenarios: { [rn('cal-ts-ht', 'ht')]: 'cancel_timeout' } });
    const { report } = await run();
    const c = report.cases.find((x) => x.id === 'cal-ts-ht')!;
    expect(c.cancel).toMatchObject({ ok: false });
    expect(c.cancel!.note).toContain('expirera');
  });

  it('un appel à la fois, 500 ms d’écart entre deux appels', async () => {
    const sleep = vi.fn(async () => undefined);
    const { server, run } = await setup({}, { sleep });
    await run();
    expect(sleep).toHaveBeenCalledTimes(server.requests.length - 1);
    expect(sleep.mock.calls.every(([ms]) => ms === 500)).toBe(true);
  });

  it('n’écrit jamais rounding-calibration.ts (c’est une personne qui valide)', async () => {
    const file = join(
      REPOSITORY_ROOT,
      'packages/engine/src/invoice-totals/rounding-calibration.ts',
    );
    const before = readFileSync(file, 'utf8');
    const { run } = await setup();
    await run();
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(before).toContain("status: 'calibrated'");
  });
});

describe('étalonnage — le jeton n’apparaît nulle part', () => {
  it('ni dans la sortie, ni dans le journal, ni dans le rapport, ni sur disque (NIF non plus)', async () => {
    const { h: harness, server, run, lines, readToken } = await setup();
    const { report } = await run();
    expect(readToken).toHaveBeenCalledTimes(1);
    // Le jeton a bien servi (en-tête Authorization)…
    expect(server.requests.every((r) => r.authorization === `Bearer ${TOKEN}`)).toBe(true);
    // … mais n'apparaît nulle part ailleurs.
    const journal = JSON.stringify(harness.journal.entries);
    expect(harness.journal.entries.length).toBeGreaterThan(0);
    for (const text of [lines.join('\n'), JSON.stringify(report), allFilesText(dir), journal]) {
      expect(text).not.toContain(TOKEN);
    }
    expect(allFilesText(dir)).not.toContain(FAKE_NIF);
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
      const { server, run, readToken } = await setup({}, { target: { testUrl, productionUrl } });
      await expect(run()).rejects.toBeInstanceOf(CalibrationRefusal);
      expect(readToken).not.toHaveBeenCalled();
      expect(server.requests).toEqual([]);
    },
  );

  it('ISF de test absent → refus avant le jeton', async () => {
    const { run, readToken } = await setup({}, { isfTest: null });
    await expect(run()).rejects.toThrow(/DGI_ISF_TEST/);
    expect(readToken).not.toHaveBeenCalled();
  });

  it('chemin de rapport suivi par git → refus avant le jeton', async () => {
    const { server, run, readToken } = await setup(
      {},
      { reportPath: join(HERE, 'rapport-interdit.json') },
    );
    await expect(run()).rejects.toThrow(/suivi par git/);
    expect(readToken).not.toHaveBeenCalled();
    expect(server.requests).toEqual([]);
  });

  it('jeton refusé au statut → arrêt, rien n’est envoyé', async () => {
    const { server, run } = await setup(
      {},
      { readToken: async () => new Secret('mauvais-jeton-000000000') },
    );
    await expect(run()).rejects.toBeInstanceOf(CalibrationRefusal);
    expect(server.callsTo('submit')).toEqual([]);
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

  it('restrictToCalibration ne transmet que quatre routes, même avec le client complet', async () => {
    const { h: harness } = await setup();
    const restricted = restrictToCalibration(harness.client) as unknown as Record<string, unknown>;
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

  it('les cas décisifs sont les cas calibration, les cas fiables et la contre-valeur', () => {
    for (const c of selectCalibrationCases()) {
      expect(c.decisive, c.id).toBe(
        c.origin === 'calibration' || c.reliability === 'reliable' || c.counterValue,
      );
    }
  });
});
