import { describe, expect, it } from 'vitest';

import type { TreasuryForecast } from '@/lib/treasury-api';

import {
  FORECAST_FINDING_LABELS,
  RECONCILIATION_FINDING_LABELS,
  SYNC_STATUS_LABELS,
  TREASURY_TABS,
  estNegatif,
  formatMontantSigne,
  geometrieGraphique,
  graduation,
  hypothesesLisibles,
  libelleMois,
  lireMontantSigne,
  lirePourcent,
  peutConsulterTresorerie,
  peutGererTresorerie,
  peutRelier,
  segmentTresorerie,
} from './treasury-model';

describe('navigation et droits', () => {
  it('trois onglets, tous ouverts à treasury.read', () => {
    expect(TREASURY_TABS.map((t) => t.label)).toEqual([
      'Dépenses',
      'Trésorerie',
      'Réalisé vs prévu',
    ]);
    expect(TREASURY_TABS.every((t) => t.action === 'treasury.read')).toBe(true);
  });

  it('segment courant, « depenses » par défaut', () => {
    expect(segmentTresorerie('/tresorerie')).toBe('depenses');
    expect(segmentTresorerie('/tresorerie/comptes')).toBe('comptes');
    expect(segmentTresorerie('/tresorerie/realise/x')).toBe('realise');
  });

  it('lire, gérer, relier : chacun exige ses actions', () => {
    expect(peutConsulterTresorerie(null)).toBe(false);
    expect(peutConsulterTresorerie(['treasury.read'])).toBe(true);
    expect(peutGererTresorerie(['treasury.read'])).toBe(false);
    expect(peutGererTresorerie(['treasury.manage'])).toBe(true);
    expect(peutRelier(['treasury.read'])).toBe(false);
    expect(peutRelier(['treasury.read', 'actuals.import'])).toBe(true);
  });
});

describe('montants', () => {
  it('met en forme sans arrondir, signe compris', () => {
    expect(formatMontantSigne('1234.5', 'USD')).toBe('1 234,50 USD');
    expect(formatMontantSigne('-700.00', 'CDF')).toBe('−700,00 CDF');
    expect(formatMontantSigne('-0.00', 'USD')).toBe('0,00 USD');
    expect(formatMontantSigne('1234567.125', 'USD')).toBe('1 234 567,125 USD');
    expect(formatMontantSigne('n/a', 'USD')).toBe('n/a USD');
  });

  it('négatif par lecture du texte', () => {
    expect(estNegatif('-0.01')).toBe(true);
    expect(estNegatif('-0.00')).toBe(false);
    expect(estNegatif('12.00')).toBe(false);
  });

  it('lit un montant saisi à la française, signe permis', () => {
    expect(lireMontantSigne('1 234,5')).toEqual({ ok: true, valeur: '1234.5' });
    expect(lireMontantSigne('−20')).toEqual({ ok: true, valeur: '-20' });
    expect(lireMontantSigne('12,345').ok).toBe(false);
    expect(lireMontantSigne('').ok).toBe(false);
  });

  it('pourcentages et hypothèses lisibles', () => {
    expect(lirePourcent('90')).toBe(0.9);
    expect(lirePourcent('12,5 %')).toBe(0.125);
    expect(lirePourcent('abc')).toBeNull();
    const h = hypothesesLisibles({
      receivableCollectionRate: 0.9,
      receivableDelayDays: 15,
      noDueDateDays: 30,
      recurringFactor: 1.1,
      planRevenueRate: 0.8,
      planChargesRate: 1,
    });
    expect(h.map((x) => x.valeur)).toEqual(['90 %', '15 j', '30 j', '110 %', '80 %', '100 %']);
  });

  it('libellés de mois et graduations', () => {
    expect(libelleMois('2026-03')).toBe('mars 2026');
    expect(graduation(-1_500_000)).toBe('−1,5 M');
    expect(graduation(12_400)).toBe('12 k');
  });
});

describe('libellés exhaustifs', () => {
  it('chaque constat et chaque statut a un libellé', () => {
    for (const code of [
      'RECEIVABLES_WITHOUT_DUE_DATE',
      'RECEIVABLES_OTHER_CURRENCY',
      'ACCOUNTS_OTHER_CURRENCY',
      'NO_ACCOUNT',
      'EXPENSES_WITHOUT_ACCOUNT',
      'OVERDUE_RECURRING',
      'PLAN_NOT_USED',
      'RECEIPTS_NOT_INTEGRATED',
    ]) {
      expect(FORECAST_FINDING_LABELS[code], code).toBeTruthy();
    }
    expect(Object.keys(RECONCILIATION_FINDING_LABELS)).toHaveLength(5);
    expect(Object.keys(SYNC_STATUS_LABELS)).toHaveLength(7);
  });
});

describe('graphique de la prévision', () => {
  function forecast(balances: Record<string, number[]>, minimum = '0.00'): TreasuryForecast {
    const day = (d: number): string => `2026-10-${String(21 + d).padStart(2, '0')}`;
    return {
      version: '1.0.0',
      currency: 'USD',
      asOf: '2026-10-21',
      openingBalance: '100.00',
      accountsIncluded: [],
      minimumBalance: minimum,
      planUsed: false,
      scenarios: (['optimistic', 'probable', 'pessimistic'] as const).map((id) => ({
        id,
        hypotheses: {
          receivableCollectionRate: 1,
          receivableDelayDays: 0,
          noDueDateDays: 30,
          recurringFactor: 1,
          planRevenueRate: 1,
          planChargesRate: 1,
        },
        series: (balances[id] ?? []).map((b, d) => ({ date: day(d), balance: b.toFixed(2) })),
        horizons: [],
        alerts:
          id === 'pessimistic'
            ? [
                {
                  severity: 'critique' as const,
                  date: day(2),
                  dayIndex: 2,
                  horizon: 7 as const,
                  balance: '-50.00',
                  threshold: '0.00',
                  probableCause: null,
                },
              ]
            : [],
        flows: [],
      })),
      uncertainty: { horizons: [], findings: [] },
    };
  }

  it('place zéro dans le cadre, l’optimiste au-dessus du pessimiste, l’alerte sur la courbe', () => {
    const g = geometrieGraphique(
      forecast({
        optimistic: [100, 150, 200],
        probable: [100, 80, 60],
        pessimistic: [100, 20, -50],
      }),
      300,
      200,
    );
    expect(g.zeroY).not.toBeNull();
    const lastY = (p: string): number => Number(p.split(' ').at(-1)!.split(',')[1]);
    // Plus haut à l'écran = ordonnée plus petite.
    expect(lastY(g.paths.optimistic)).toBeLessThan(lastY(g.paths.probable));
    expect(lastY(g.paths.probable)).toBeLessThan(lastY(g.paths.pessimistic));
    expect(g.alerts).toEqual([
      {
        scenario: 'pessimistic',
        x: expect.any(Number),
        y: lastY(g.paths.pessimistic),
        severity: 'critique',
      },
    ]);
    expect(g.band.split(' ')).toHaveLength(6);
    expect(g.thresholdY).toBeNull();
  });

  it('série plate : domaine élargi, aucun NaN', () => {
    const g = geometrieGraphique(
      forecast({ optimistic: [100, 100], probable: [100, 100], pessimistic: [100, 100] }, '100.00'),
    );
    expect(g.paths.probable).not.toContain('NaN');
    expect(g.thresholdY).not.toBeNull();
  });
});
