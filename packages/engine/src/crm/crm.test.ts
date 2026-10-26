import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  CRM_INDICATORS_VERSION,
  DEFAULT_WIN_RATE_MIN_SAMPLE,
  sumAmountsByCurrency,
  stageWinRates,
} from '../index.js';

describe('sumAmountsByCurrency (ADR-0035 § 2)', () => {
  it('additionne par devise, sans jamais convertir, dans l’ordre des devises', () => {
    expect(
      sumAmountsByCurrency([
        { amount: '1500.00', currency: 'USD' },
        { amount: '0.10', currency: 'CDF' },
        { amount: '0.20', currency: 'CDF' },
        { amount: null, currency: 'USD' },
        { amount: '2500.5', currency: 'USD' },
      ]),
    ).toEqual([
      { currency: 'CDF', total: '0.30', count: 2 },
      { currency: 'USD', total: '4000.50', count: 2 },
    ]);
  });

  it('exact au-delà de 2⁵³ (aucun flottant)', () => {
    expect(
      sumAmountsByCurrency([
        { amount: '9007199254740993.01', currency: 'CDF' },
        { amount: '0.01', currency: 'CDF' },
      ]),
    ).toEqual([{ currency: 'CDF', total: '9007199254740993.02', count: 2 }]);
  });

  it('liste vide, montants tous absents : aucun total', () => {
    expect(sumAmountsByCurrency([])).toEqual([]);
    expect(sumAmountsByCurrency([{ amount: null, currency: 'USD' }])).toEqual([]);
  });

  it('refuse un montant illisible ou trop précis', () => {
    expect(() => sumAmountsByCurrency([{ amount: '1.001', currency: 'USD' }])).toThrow(RangeError);
    expect(() => sumAmountsByCurrency([{ amount: '-1', currency: 'USD' }])).toThrow(RangeError);
    expect(() => sumAmountsByCurrency([{ amount: '1e3', currency: 'USD' }])).toThrow(RangeError);
  });
});

describe('stageWinRates (ADR-0035 O5)', () => {
  const gagnee = (...s: string[]) => ({ stagesVisited: s, won: true });
  const perdue = (...s: string[]) => ({ stagesVisited: s, won: false });

  it('indisponible sous l’échantillon minimal, avec la taille de l’échantillon', () => {
    const r = stageWinRates({
      stages: ['lead', 'proposal'],
      closed: [gagnee('lead', 'proposal', 'won'), perdue('lead', 'lost')],
    });
    expect(r['lead']).toEqual({
      status: 'unavailable',
      sample: 2,
      won: 1,
      requiredSample: DEFAULT_WIN_RATE_MIN_SAMPLE,
    });
    expect(r['proposal']).toMatchObject({ status: 'unavailable', sample: 1, won: 1 });
  });

  it('disponible au seuil : part gagnée arrondie à l’entier (demi vers le haut)', () => {
    const closed = [
      gagnee('lead', 'proposal'),
      gagnee('lead', 'proposal'),
      perdue('lead', 'proposal'),
      perdue('lead'),
      perdue('lead'),
      perdue('lead'),
      perdue('lead'),
      perdue('lead'),
    ];
    const r = stageWinRates({ stages: ['lead', 'proposal', 'negotiation'], closed, minSample: 3 });
    // 2 / 8 = 25 % ; 2 / 3 = 66,67 % → 67 ; étape jamais visitée → indisponible.
    expect(r['lead']).toEqual({ status: 'available', ratePercent: '25', sample: 8, won: 2 });
    expect(r['proposal']).toEqual({ status: 'available', ratePercent: '67', sample: 3, won: 2 });
    expect(r['negotiation']).toEqual({
      status: 'unavailable',
      sample: 0,
      won: 0,
      requiredSample: 3,
    });
  });

  it('demi exact arrondi vers le haut ; une étape revisitée compte une fois', () => {
    const closed = [gagnee('a', 'b', 'a'), perdue('a')];
    expect(stageWinRates({ stages: ['a'], closed, minSample: 2 })['a']).toEqual({
      status: 'available',
      ratePercent: '50',
      sample: 2,
      won: 1,
    });
    const huit = [gagnee('x'), ...Array.from({ length: 7 }, () => perdue('x'))];
    // 1 / 8 = 12,5 % → 13.
    expect(stageWinRates({ stages: ['x'], closed: huit, minSample: 8 })['x']).toMatchObject({
      ratePercent: '13',
    });
  });

  it('refuse un échantillon minimal invalide', () => {
    expect(() => stageWinRates({ stages: [], closed: [], minSample: 0 })).toThrow(RangeError);
  });

  it('version distincte, et aucun nombre flottant pour un montant dans les sources', () => {
    expect(CRM_INDICATORS_VERSION).toBe('1.0.0');
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8');
    expect(src).not.toMatch(/parseFloat|Number\(|toFixed|Math\./);
  });
});
