// Prévision pondérée et montant des lignes (ADR-0040 § 7.1, § 2.6). ADR-0040 — C2.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  CRM_INDICATORS_VERSION,
  estimatedLinesAmount,
  probabilitiesFromPercents,
  probabilitiesFromWinRates,
  stageWinRates,
  weightedForecast,
  type ForecastOpportunity,
} from '../index.js';

const opp = (
  id: string,
  stageKey: string,
  amount: string | null,
  currency = 'USD',
): ForecastOpportunity => ({
  id,
  stageKey,
  amount,
  currency,
  expectedCloseDate: null,
  ownerId: 'u1',
});

describe('weightedForecast (ADR-0040 § 7.1)', () => {
  it('critère 13 : une étape indisponible est comptée à part ; une autre devise, jamais additionnée', () => {
    const f = weightedForecast({
      opportunities: [
        opp('1', 'qualif', '1000.00'),
        opp('2', 'nego', '2000.00'),
        opp('3', 'nouveau', '500.00'),
        opp('4', 'nego', '300000.00', 'CDF'),
      ],
      probabilities: {
        qualif: { status: 'available', numerator: 1, denominator: 4 },
        nego: { status: 'available', numerator: 1, denominator: 2 },
        nouveau: { status: 'unavailable' },
      },
      probabilitySource: 'historical',
    });
    expect(f).toEqual({
      version: CRM_INDICATORS_VERSION,
      basis: 'estimated',
      probabilitySource: 'historical',
      currencies: [
        {
          currency: 'CDF',
          weighted: '150000.00',
          unweighted: '300000.00',
          count: 1,
          notWeightable: { total: '0.00', count: 0 },
        },
        {
          currency: 'USD',
          weighted: '1250.00',
          unweighted: '3500.00',
          count: 3,
          notWeightable: { total: '500.00', count: 1 },
        },
      ],
    });
  });

  it('fraction exacte (pas le pourcentage arrondi) et un seul arrondi par devise', () => {
    // Trois montants de 0.01 à 1/3 : chaque terme arrondi donnerait 0.00 ; exact : 0.01.
    const f = weightedForecast({
      opportunities: [opp('1', 's', '0.01'), opp('2', 's', '0.01'), opp('3', 's', '0.01')],
      probabilities: { s: { status: 'available', numerator: 1, denominator: 3 } },
      probabilitySource: 'historical',
    });
    expect(f.currencies[0]!.weighted).toBe('0.01');
  });

  it('demi vers le haut au centime', () => {
    const f = weightedForecast({
      opportunities: [opp('1', 's', '0.01')],
      probabilities: { s: { status: 'available', numerator: 1, denominator: 2 } },
      probabilitySource: 'historical',
    });
    expect(f.currencies[0]!.weighted).toBe('0.01');
  });

  it('montant absent : non pondérable, compté sans montant', () => {
    const f = weightedForecast({
      opportunities: [opp('1', 's', null), opp('2', 's', '10.00')],
      probabilities: { s: { status: 'available', numerator: 1, denominator: 1 } },
      probabilitySource: 'historical',
    });
    expect(f.currencies[0]).toMatchObject({
      weighted: '10.00',
      unweighted: '10.00',
      count: 2,
      notWeightable: { total: '0.00', count: 1 },
    });
  });

  it('branché sur stageWinRates : won / sample, sous le seuil indisponible', () => {
    const closed = [
      ...Array.from({ length: 3 }, () => ({ stagesVisited: ['a'], won: true })),
      ...Array.from({ length: 7 }, () => ({ stagesVisited: ['a'], won: false })),
    ];
    const rates = stageWinRates({ stages: ['a', 'b'], closed, minSample: 10 });
    const p = probabilitiesFromWinRates(rates);
    expect(p).toEqual({
      a: { status: 'available', numerator: 3, denominator: 10 },
      b: { status: 'unavailable' },
    });
    const f = weightedForecast({
      opportunities: [opp('1', 'a', '100.00'), opp('2', 'b', '50.00')],
      probabilities: p,
      probabilitySource: 'historical',
    });
    expect(f.currencies[0]).toMatchObject({
      weighted: '30.00',
      notWeightable: { total: '50.00', count: 1 },
    });
  });

  it('mode manuel : pourcentages saisis, étiquetés « manual »', () => {
    const f = weightedForecast({
      opportunities: [opp('1', 'a', '200.00')],
      probabilities: probabilitiesFromPercents({ a: 25, b: null }),
      probabilitySource: 'manual',
    });
    expect(f.probabilitySource).toBe('manual');
    expect(f.currencies[0]!.weighted).toBe('50.00');
    expect(() => probabilitiesFromPercents({ a: 101 })).toThrow(RangeError);
  });

  it('propriétés à graine fixe : weighted ≤ unweighted, indépendant de l’ordre', () => {
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let run = 0; run < 50; run += 1) {
      const items = Array.from({ length: 1 + rnd(12) }, (_, i) =>
        opp(
          String(i),
          `s${rnd(3)}`,
          rnd(5) === 0 ? null : `${rnd(100000)}.${rnd(10)}${rnd(10)}`,
          rnd(2) ? 'USD' : 'CDF',
        ),
      );
      const probabilities = {
        s0: { status: 'available' as const, numerator: rnd(8), denominator: 7 + 1 },
        s1: { status: 'available' as const, numerator: 1, denominator: 3 },
        s2: { status: 'unavailable' as const },
      };
      const a = weightedForecast({
        opportunities: items,
        probabilities,
        probabilitySource: 'historical',
      });
      const b = weightedForecast({
        opportunities: [...items].reverse(),
        probabilities,
        probabilitySource: 'historical',
      });
      expect(b).toEqual(a);
      for (const c of a.currencies) {
        expect(BigInt(c.weighted.replace('.', ''))).toBeLessThanOrEqual(
          BigInt(c.unweighted.replace('.', '')),
        );
      }
    }
  });

  it('refuse une probabilité incohérente', () => {
    expect(() =>
      weightedForecast({
        opportunities: [opp('1', 's', '1.00')],
        probabilities: { s: { status: 'available', numerator: 3, denominator: 2 } },
        probabilitySource: 'historical',
      }),
    ).toThrow(RangeError);
  });
});

describe('estimatedLinesAmount (ADR-0040 § 2.6)', () => {
  it('hors taxes : prix remisé au centime, ligne arrondie, puis somme', () => {
    const r = estimatedLinesAmount([
      { quantity: '2', unitPrice: '40000.00', discountPercent: null },
      { quantity: '3', unitPrice: '150000.00', discountPercent: '10' },
      { quantity: '1.5', unitPrice: '0.03', discountPercent: '0' },
    ]);
    // 80 000 + 3 × 135 000 + round(0.045) = 80 000 + 405 000 + 0.05
    expect(r).toEqual({
      version: CRM_INDICATORS_VERSION,
      basis: 'estimated',
      amount: '485000.05',
      linesWithoutPrice: [],
    });
  });

  it('ligne sans prix : comptée pour zéro et signalée ; aucune ligne prix → null', () => {
    expect(
      estimatedLinesAmount([
        { quantity: '1', unitPrice: null, discountPercent: null },
        { quantity: '1', unitPrice: '10.00', discountPercent: null },
      ]),
    ).toMatchObject({ amount: '10.00', linesWithoutPrice: [0] });
    expect(estimatedLinesAmount([])).toMatchObject({ amount: null, linesWithoutPrice: [] });
    expect(
      estimatedLinesAmount([{ quantity: '1', unitPrice: null, discountPercent: null }]),
    ).toMatchObject({ amount: null, linesWithoutPrice: [0] });
  });

  it('aucun nombre flottant pour un montant dans les sources', () => {
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), 'forecast.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/parseFloat|Number\(|toFixed|Math\./);
  });
});
