// Rapports du CRM (ADR-0040 § 7.2, critère 14). ADR-0040 — C3.

import { describe, expect, it } from 'vitest';

import {
  CRM_INDICATORS_VERSION,
  CRM_REPORT_MIN_SAMPLE,
  crmReportPeriod,
  crmReports,
  type ForecastProbability,
  type ReportOpportunity,
  type ReportStage,
} from '../index.js';

const STAGES: ReportStage[] = [
  { key: 'lead', kind: 'open' },
  { key: 'qualified', kind: 'open' },
  { key: 'proposal', kind: 'open' },
  { key: 'won', kind: 'won' },
  { key: 'lost', kind: 'lost' },
];

const PERIOD = { from: '2026-01-01', to: '2026-06-30' };

let seq = 0;
function opp(over: Partial<ReportOpportunity>): ReportOpportunity {
  seq += 1;
  return {
    id: `o${seq}`,
    stageKey: 'lead',
    status: 'open',
    amount: '100.00',
    currency: 'USD',
    createdDay: '2026-02-01',
    closedDay: null,
    expectedCloseDate: null,
    ownerId: 'u1',
    lostReasonKey: null,
    stagesVisited: ['lead'],
    ...over,
  };
}

function wonOpp(createdDay: string, closedDay: string, over: Partial<ReportOpportunity> = {}) {
  return opp({
    stageKey: 'won',
    status: 'won',
    createdDay,
    closedDay,
    stagesVisited: ['lead', 'qualified', 'won'],
    ...over,
  });
}

function lostOpp(createdDay: string, closedDay: string, over: Partial<ReportOpportunity> = {}) {
  return opp({
    stageKey: 'lost',
    status: 'lost',
    createdDay,
    closedDay,
    stagesVisited: ['lead', 'lost'],
    lostReasonKey: 'price',
    ...over,
  });
}

const NO_PROBA: Record<string, ForecastProbability> = {};

function run(
  opportunities: ReportOpportunity[],
  extra: Partial<Parameters<typeof crmReports>[0]> = {},
) {
  return crmReports({
    period: PERIOD,
    asOf: '2026-06-15',
    stages: STAGES,
    opportunities,
    probabilities: NO_PROBA,
    probabilitySource: 'historical',
    ...extra,
  });
}

describe('crmReportPeriod (décision ouverte n° 12)', () => {
  it('12 mois glissants par défaut, jour de référence compris', () => {
    expect(crmReportPeriod({ today: '2026-10-29' })).toMatchObject({
      ok: true,
      from: '2025-10-30',
      to: '2026-10-29',
    });
    // Fin de mois plus courte : quantième ramené.
    expect(crmReportPeriod({ today: '2026-02-28', from: null, to: null })).toMatchObject({
      from: '2025-03-01',
      to: '2026-02-28',
    });
    // `to` seul : 12 mois avant `to`.
    expect(crmReportPeriod({ today: '2026-10-29', to: '2026-03-31' })).toMatchObject({
      from: '2025-04-01',
      to: '2026-03-31',
    });
  });

  it('24 mois au plus, pas un jour de plus', () => {
    expect(crmReportPeriod({ today: '2026-10-29', from: '2024-10-30' })).toMatchObject({
      ok: true,
    });
    expect(crmReportPeriod({ today: '2026-10-29', from: '2024-10-29' })).toMatchObject({
      ok: false,
      code: 'CRM_REPORT_PERIOD_TOO_LONG',
    });
  });

  it('début après fin, ou jour inexistant : invalide', () => {
    expect(crmReportPeriod({ today: '2026-10-29', from: '2026-10-30' })).toMatchObject({
      ok: false,
      code: 'CRM_REPORT_PERIOD_INVALID',
    });
    expect(crmReportPeriod({ today: '2026-10-29', to: '2026-02-31' })).toMatchObject({
      ok: false,
      code: 'CRM_REPORT_PERIOD_INVALID',
    });
  });
});

describe('crmReports (ADR-0040 § 7.2)', () => {
  it('étiquette : version et base estimée', () => {
    const r = run([]);
    expect(r.version).toBe(CRM_INDICATORS_VERSION);
    expect(r.basis).toBe('estimated');
    expect(r.minSample).toBe(CRM_REPORT_MIN_SAMPLE);
    expect(r.funnel).toEqual({
      created: 0,
      stages: [
        { stageKey: 'lead', count: 0, amounts: [] },
        { stageKey: 'qualified', count: 0, amounts: [] },
        { stageKey: 'proposal', count: 0, amounts: [] },
      ],
    });
  });

  it('critère 14 : sous dix clôturées, taux et durées indisponibles avec l’échantillon', () => {
    const items = [
      ...Array.from({ length: 5 }, () => wonOpp('2026-02-01', '2026-02-11')),
      ...Array.from({ length: 4 }, () => lostOpp('2026-02-01', '2026-02-05')),
    ];
    const r = run(items);
    expect(r.conversion.overall).toEqual({
      status: 'unavailable',
      sample: 9,
      count: 5,
      requiredSample: 10,
    });
    expect(r.cycle.won).toEqual({ status: 'unavailable', sample: 5, requiredSample: 10 });
    expect(r.cycle.lost).toEqual({ status: 'unavailable', sample: 4, requiredSample: 10 });
    expect(r.conversion.stages[0]!.rate).toMatchObject({ status: 'unavailable', sample: 9 });
    expect(r.byOwner[0]!.winRate).toMatchObject({ status: 'unavailable', sample: 9, count: 5 });
  });

  it('à dix clôturées : conversion globale, cycles moyen et médian arrondis demi vers le haut', () => {
    // Gagnées : 1, 2, …, 10 jours → moyenne 5,5 → 6 ; médiane (5 + 6) / 2 → 6.
    const won = Array.from({ length: 10 }, (_, i) =>
      wonOpp('2026-03-01', `2026-03-${String(2 + i).padStart(2, '0')}`),
    );
    // Perdues : 10 → taux 10 / 20 = 50 %.
    const lost = Array.from({ length: 10 }, () => lostOpp('2026-03-01', '2026-03-04'));
    const r = run([...won, ...lost]);
    expect(r.conversion.overall).toEqual({
      status: 'available',
      ratePercent: '50',
      sample: 20,
      count: 10,
    });
    expect(r.cycle.won).toEqual({ status: 'available', meanDays: 6, medianDays: 6, sample: 10 });
    expect(r.cycle.lost).toEqual({ status: 'available', meanDays: 3, medianDays: 3, sample: 10 });
  });

  it('entonnoir et conversion par étape : cohorte créée dans la période, montants par devise', () => {
    const items = [
      // 10 passées par lead ; 6 atteignent qualified ; 3 atteignent proposal ; 1 gagnée.
      ...Array.from({ length: 4 }, () => opp({ stagesVisited: ['lead'] })),
      ...Array.from({ length: 3 }, () =>
        opp({
          stageKey: 'qualified',
          stagesVisited: ['lead', 'qualified'],
          currency: 'CDF',
          amount: '250000.00',
        }),
      ),
      ...Array.from({ length: 2 }, () =>
        opp({
          stageKey: 'proposal',
          stagesVisited: ['lead', 'qualified', 'proposal'],
          amount: null,
        }),
      ),
      // Gagnée sans passage enregistré par `proposal` : compte comme avancée.
      wonOpp('2026-02-10', '2026-05-01', { stagesVisited: ['lead', 'qualified'] }),
      // Hors période : ignorée par l'entonnoir.
      opp({ createdDay: '2025-12-31' }),
    ];
    const r = run(items);
    expect(r.funnel.created).toBe(10);
    expect(r.funnel.stages[0]).toEqual({
      stageKey: 'lead',
      count: 10,
      amounts: [
        { currency: 'CDF', total: '750000.00', count: 3 },
        { currency: 'USD', total: '500.00', count: 5 },
      ],
    });
    expect(r.funnel.stages.map((s) => s.count)).toEqual([10, 6, 2]);
    expect(r.conversion.stages[0]).toEqual({
      fromStageKey: 'lead',
      toStageKey: 'qualified',
      rate: { status: 'available', ratePercent: '60', sample: 10, count: 6 },
    });
    expect(r.conversion.stages[1]!.rate).toMatchObject({
      status: 'unavailable',
      sample: 6,
      count: 3,
    });
    expect(r.conversion.stages[2]).toMatchObject({ toStageKey: 'won' });
    // Seuil abaissé : les taux deviennent calculables.
    const r2 = run(items, { minSample: 2 });
    expect(r2.conversion.stages[1]!.rate).toMatchObject({ ratePercent: '50' });
    expect(r2.conversion.stages[2]!.rate).toMatchObject({ ratePercent: '0', sample: 2 });
  });

  it('prévision par mois de clôture : en retard, mois croissants, sans date ; jamais de somme entre devises', () => {
    const probabilities: Record<string, ForecastProbability> = {
      lead: { status: 'available', numerator: 1, denominator: 4 },
      qualified: { status: 'unavailable' },
    };
    const items = [
      opp({ expectedCloseDate: '2026-06-14', amount: '1000.00' }),
      opp({ expectedCloseDate: '2026-08-01', amount: '400.00' }),
      opp({ expectedCloseDate: '2026-06-15', amount: '200.00' }),
      opp({ expectedCloseDate: '2026-06-30', amount: '300000.00', currency: 'CDF' }),
      opp({ expectedCloseDate: null, stageKey: 'qualified', amount: '50.00' }),
      // Clôturée : hors prévision.
      wonOpp('2026-02-01', '2026-03-01', { expectedCloseDate: '2026-07-01' }),
    ];
    const r = run(items, { probabilities });
    expect(r.forecastByMonth.probabilitySource).toBe('historical');
    expect(r.forecastByMonth.buckets.map((b) => [b.kind, b.month, b.count])).toEqual([
      ['overdue', null, 1],
      ['month', '2026-06', 2],
      ['month', '2026-08', 1],
      ['no_date', null, 1],
    ]);
    expect(r.forecastByMonth.buckets[1]!.currencies).toEqual([
      {
        currency: 'CDF',
        weighted: '75000.00',
        unweighted: '300000.00',
        count: 1,
        notWeightable: { total: '0.00', count: 0 },
      },
      {
        currency: 'USD',
        weighted: '50.00',
        unweighted: '200.00',
        count: 1,
        notWeightable: { total: '0.00', count: 0 },
      },
    ]);
    expect(r.forecastByMonth.buckets[3]!.currencies[0]!.notWeightable).toEqual({
      total: '50.00',
      count: 1,
    });
  });

  it('par responsable et motifs de perte ; le filtre ownerId restreint tous les blocs', () => {
    const items = [
      wonOpp('2026-02-01', '2026-02-10', { ownerId: 'u1', amount: '300.00' }),
      lostOpp('2026-02-01', '2026-02-10', { ownerId: 'u1', lostReasonKey: 'price' }),
      lostOpp('2026-02-01', '2026-02-10', { ownerId: 'u1', lostReasonKey: 'timing' }),
      lostOpp('2026-02-01', '2026-02-10', { ownerId: 'u1', lostReasonKey: 'price' }),
      lostOpp('2026-02-01', '2026-02-10', { ownerId: 'u2', lostReasonKey: null }),
      opp({ ownerId: 'u2', amount: '70.00' }),
      opp({ ownerId: null, amount: '5.00' }),
      // Clôturée hors période : ni gagnée ni perdue du rapport.
      wonOpp('2025-01-01', '2025-12-31', { ownerId: 'u1' }),
    ];
    const r = run(items);
    expect(r.byOwner.map((o) => o.ownerId)).toEqual(['u1', 'u2', null]);
    const u1 = r.byOwner[0]!;
    expect(u1.won).toEqual({ count: 1, amounts: [{ currency: 'USD', total: '300.00', count: 1 }] });
    expect(u1.lost.count).toBe(3);
    expect(u1.open.count).toBe(0);
    expect(u1.topLostReasons).toEqual([
      { lostReasonKey: 'price', count: 2 },
      { lostReasonKey: 'timing', count: 1 },
    ]);
    expect(r.lostReasons).toEqual({
      total: 4,
      reasons: [
        { lostReasonKey: 'price', count: 2 },
        { lostReasonKey: 'timing', count: 1 },
        { lostReasonKey: null, count: 1 },
      ],
    });

    const f = run(items, { ownerId: 'u2' });
    expect(f.ownerId).toBe('u2');
    expect(f.byOwner.map((o) => o.ownerId)).toEqual(['u2']);
    expect(f.funnel.created).toBe(2);
    expect(f.conversion.overall).toMatchObject({ sample: 1, count: 0 });
    expect(f.lostReasons).toEqual({ total: 1, reasons: [{ lostReasonKey: null, count: 1 }] });
    expect(f.forecastByMonth.buckets).toHaveLength(1);
    expect(f.forecastByMonth.buckets[0]!.currencies[0]!.unweighted).toBe('70.00');
  });

  it('déterministe : l’ordre d’entrée ne change pas le résultat', () => {
    const items = [
      wonOpp('2026-02-01', '2026-02-10', { ownerId: 'u2' }),
      lostOpp('2026-02-03', '2026-02-11', { ownerId: 'u1' }),
      opp({ expectedCloseDate: '2026-07-01', currency: 'CDF', amount: '10.00' }),
      opp({ expectedCloseDate: '2026-06-20' }),
    ];
    expect(run([...items].reverse())).toEqual(run(items));
  });

  it('refuse une période ou un jour invalides', () => {
    expect(() => run([], { period: { from: '2026-07-01', to: '2026-06-30' } })).toThrow(RangeError);
    expect(() => run([opp({ createdDay: '2026-13-01' })])).toThrow(RangeError);
    expect(() => run([], { minSample: 0 })).toThrow(RangeError);
  });
});
