// Campagne d'homologation réelle — arguments, plan, état, rapports (ADR-0026 § 7).

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CampaignRefusal,
  DEFAULT_CAMPAIGN_ID,
  REPORT_MD,
  buildPlan,
  buildReport,
  missingOrigins,
  newState,
  parseCampaignArgs,
  parseCaseList,
  pdfFileName,
  readState,
  stepKey,
  writeReports,
  writeState,
  type CampaignEntry,
} from './campaign-plan.js';

const ORG = '0123456789abcdef01234567';
const USER = '89abcdef0123456789abcdef';
const base = ['--org', ORG, '--operator', USER];

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lalanda-campagne-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('arguments', () => {
  it('défauts : les deux modes, les 29 cas, campagne sfe-v1.2', () => {
    const o = parseCampaignArgs([...base, '--out', dir]);
    expect(o).toMatchObject({
      organizationId: ORG,
      operatorUserId: USER,
      modes: ['ttc', 'ht'],
      outDir: dir,
      dryRun: false,
      yes: false,
      campaignId: DEFAULT_CAMPAIGN_ID,
    });
    expect(o.cases).toHaveLength(29);
    expect(DEFAULT_CAMPAIGN_ID).toBe('sfe-v1.2');
  });

  it('--org, --operator obligatoires ; --out obligatoire hors --dry-run', () => {
    expect(() => parseCampaignArgs(['--operator', USER, '--out', dir])).toThrow(/--org/);
    expect(() => parseCampaignArgs(['--org', ORG, '--out', dir])).toThrow(/--operator/);
    expect(() => parseCampaignArgs(base)).toThrow(/--out/);
    expect(parseCampaignArgs([...base, '--dry-run']).outDir).toBeNull();
  });

  it('un argument inconnu (un jeton collé par erreur) est refusé sans être réaffiché', () => {
    const jeton = 'jeton-secret-0123456789abcdef';
    try {
      parseCampaignArgs([...base, '--out', dir, '--token', jeton]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CampaignRefusal);
      expect((err as Error).message).not.toContain(jeton);
      expect((err as Error).message).not.toContain('--token');
    }
  });

  it('--modes : ordre de campagne (TTC puis HT) quel que soit l’ordre saisi', () => {
    expect(parseCampaignArgs([...base, '--dry-run', '--modes', 'ht,ttc']).modes).toEqual([
      'ttc',
      'ht',
    ]);
    expect(parseCampaignArgs([...base, '--dry-run', '--modes', 'ht']).modes).toEqual(['ht']);
    expect(() => parseCampaignArgs([...base, '--dry-run', '--modes', 'tva'])).toThrow(
      CampaignRefusal,
    );
  });

  it('--cases : plages et listes, bornées à 1–29', () => {
    expect(parseCaseList('1-3,10,12-12')).toEqual([1, 2, 3, 10, 12]);
    expect(parseCaseList('3,1,3')).toEqual([1, 3]);
    for (const bad of ['0', '30', '5-2', 'a', '1-']) {
      expect(() => parseCaseList(bad), bad).toThrow(CampaignRefusal);
    }
  });
});

describe('plan', () => {
  it('58 normalisations : 29 cas en TTC, puis 29 en HT, origines avant leurs avoirs', () => {
    const steps = buildPlan({ modes: ['ttc', 'ht'], cases: parseCaseList('1-29') });
    expect(steps).toHaveLength(58);
    expect(steps[0]!.key).toBe('ttc-01');
    expect(steps[29]!.key).toBe('ht-01');
    for (const [origin, credit] of [
      [1, 10],
      [3, 11],
      [6, 12],
      [15, 16],
    ] as const) {
      for (const mode of ['ttc', 'ht'] as const) {
        const i = steps.findIndex((s) => s.key === stepKey(mode, credit));
        expect(steps[i]!.originCase).toBe(origin);
        expect(steps.findIndex((s) => s.key === stepKey(mode, origin))).toBeLessThan(i);
      }
    }
    expect(missingOrigins(steps, new Set())).toEqual([]);
  });

  it('un avoir sans son origine (ni au plan, ni déjà faite) est signalé', () => {
    const steps = buildPlan({ modes: ['ht'], cases: [10, 12] });
    expect(missingOrigins(steps, new Set())).toHaveLength(2);
    expect(missingOrigins(steps, new Set([stepKey('ht', 1), stepKey('ht', 6)]))).toEqual([]);
    // L'origine dans l'AUTRE mode ne compte pas.
    expect(missingOrigins(steps, new Set([stepKey('ttc', 1), stepKey('ttc', 6)]))).toHaveLength(2);
  });

  it('nom de PDF : cas sur deux chiffres, mode, numéro lu du document (caractères sûrs)', () => {
    expect(pdfFileName(7, 'ttc', 'TEST-2026-000042')).toBe('cas-07-ttc-TEST-2026-000042.pdf');
    expect(pdfFileName(12, 'ht', 'IN2610/000042')).toBe('cas-12-ht-IN2610_000042.pdf');
  });
});

describe('état et rapports', () => {
  const entry = (key: 'ttc-01'): CampaignEntry => ({
    key,
    caseNumber: 1,
    mode: 'ttc',
    title: 'Vente mixte 16 % et 5 %',
    type: 'FV',
    invoiceId: 'abc',
    number: 'N-1',
    codeDefDgi: 'CODE',
    nim: 'NIM',
    counters: '1/1 FV',
    dgiDateTime: null,
    uid: 'uid-1',
    totals: {
      lalanda: { total: '100.00', vatTotal: '16.00', specificTax: '0.00' },
      dgi: { total: '100.00', vtotal: '16.00', ts: null },
      identical: true,
      differences: [],
    },
    durationMs: 12,
    normalizedAt: null,
    recoveredFromDatabase: false,
    pdfFile: 'cas-01-ttc-N-1.pdf',
  });

  it('écrit puis relit l’état ; refuse l’état d’une autre organisation ou campagne', () => {
    const now = new Date('2026-10-21T10:00:00Z');
    const state = newState('sfe-v1.2', ORG, now);
    state.entries['ttc-01'] = entry('ttc-01');
    writeState(dir, state, now);
    expect(
      readState(dir, { campaignId: 'sfe-v1.2', organizationId: ORG })?.entries['ttc-01'],
    ).toEqual(entry('ttc-01'));
    expect(() => readState(dir, { campaignId: 'sfe-v1.2', organizationId: USER })).toThrow(
      CampaignRefusal,
    );
    expect(() => readState(dir, { campaignId: 'autre', organizationId: ORG })).toThrow(
      CampaignRefusal,
    );
    expect(readState(join(dir, 'vide'), { campaignId: 'x', organizationId: ORG })).toBeNull();
  });

  it('rapport : une ligne par normalisation prévue, les manquantes marquées', () => {
    const now = new Date('2026-10-21T10:00:00Z');
    const state = newState('sfe-v1.2', ORG, now);
    state.entries['ttc-01'] = entry('ttc-01');
    const steps = buildPlan({ modes: ['ttc'], cases: [1, 2] });
    const report = buildReport(state, steps, now);
    expect(report).toMatchObject({ planned: 2, normalized: 1, complete: false });
    writeReports(dir, report);
    const md = readFileSync(join(dir, REPORT_MD), 'utf8');
    expect(md).toContain('| 1 | TTC | FV | N-1 | CODE | NIM | 1/1 FV | 100.00 | 100.00 |');
    expect(md).toContain('| 2 | TTC | — | non normalisé |');
    expect(md).toContain('1 / 2 (incomplet)');
  });
});
