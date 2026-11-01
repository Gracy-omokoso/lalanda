// Rapprochement avec le réalisé (ADR-0049 § 7, docs/08) : affiché, jamais corrigé.

import { describe, expect, it } from 'vitest';

import type { ReportingEntry, ReportingLine } from '../ledger/index.js';
import { reconcileWithActuals, type ReconcileWithActualsInput } from './index.js';

const L = (
  account: string,
  side: 'D' | 'C',
  amount: string,
  o: Partial<ReportingLine> = {},
): ReportingLine => ({
  accountNumber: account,
  auxiliaryAccountNumber: null,
  label: 'l',
  debit: side === 'D' ? amount : null,
  credit: side === 'C' ? amount : null,
  currency: 'CDF',
  amount,
  ...o,
});
const gen = { ruleSetVersion: 1, chartPack: { slug: 'p', version: 1 }, engineVersion: '1.0.0' };
const E = (
  id: string,
  date: string,
  lines: ReportingLine[],
  o: Partial<ReportingEntry> = {},
): ReportingEntry => ({
  id,
  journalCode: 'VE',
  fiscalYear: 2026,
  number: 1,
  date,
  status: 'posted',
  source: { kind: 'sales_invoice', id, number: null, date, partyName: null },
  sourceKey: id,
  lines,
  generation: gen,
  manual: null,
  ...o,
});
const REV = 'sale.invoice.revenue.SER.B';

const entries: ReportingEntry[] = [
  E('f1', '2026-03-03', [
    L('411', 'D', '1000.00'),
    L('706', 'C', '1000.00', { operationKey: REV }),
  ]),
  E('av', '2026-03-10', [
    L('706', 'D', '100.00', { operationKey: 'sale.credit_note.revenue.SER.B' }),
    L('411', 'C', '100.00'),
  ]),
  E('j', '2026-03-11', [
    L('411', 'D', '50.00'),
    L('ATT', 'C', '50.00', { operationKey: 'sale.invoice.revenue.BIE.Z' }),
  ]),
  E('usd', '2026-03-12', [
    L('411', 'D', '2800.00', { currency: 'USD', amount: '1.00' }),
    L('706', 'C', '2800.00', { currency: 'USD', amount: '1.00', operationKey: REV }),
  ]),
  E('od', '2026-03-20', [L('706', 'D', '30.00'), L('ATT', 'C', '30.00')], {
    generation: null,
    manual: { authorId: 'u', validatorId: 'v', reason: 'reclassement' },
  }),
  // contre-passation au premier jour ouvert d'une pièce de février (§ 4)
  E('rev', '2026-03-01', [L('706', 'D', '20.00', { operationKey: REV }), L('411', 'C', '20.00')], {
    source: { kind: 'sales_invoice', id: 'feb', number: null, date: '2026-02-27', partyName: null },
  }),
  // pièce de mars écrite en avril
  E('apr', '2026-04-01', [L('411', 'D', '5.00'), L('706', 'C', '5.00', { operationKey: REV })], {
    source: { kind: 'sales_invoice', id: 'm', number: null, date: '2026-03-31', partyName: null },
  }),
  E(
    'x1',
    '2026-03-05',
    [L('6011', 'D', '200.00', { operationKey: 'expense.loyer' }), L('5211', 'C', '200.00')],
    { journalCode: 'T01' },
  ),
  E(
    'x2',
    '2026-03-06',
    [L('6012', 'D', '70.00', { operationKey: 'expense.loyer.sub' }), L('5211', 'C', '70.00')],
    { journalCode: 'T01' },
  ),
  E('x3', '2026-03-07', [
    L('6013', 'D', '9.00', { operationKey: 'expense.loyers' }),
    L('5211', 'C', '9.00'),
  ]),
  E(
    'wait',
    '2026-03-08',
    [L('706', 'C', '999.00', { operationKey: REV }), L('411', 'D', '999.00')],
    { status: 'awaiting_rate' },
  ),
];

const input: ReconcileWithActualsInput = {
  month: '2026-03',
  projectCurrency: 'CDF',
  entries,
  suspenseAccountNumbers: ['ATT'],
  revenue: { value: '1000.00', source: 'run.sales' },
  expenses: [
    { category: 'loyer', actual: { value: '270.00', source: 'run.expenses' } },
    { category: 'transport', actual: { value: null, source: null } },
  ],
};

describe('reconcileWithActuals', () => {
  it('écarts typés, aucun inexpliqué sur le jeu de référence', () => {
    const r = reconcileWithActuals({ ...input, outsideCutover: { revenue: '45.00' } });
    expect(r.displayOnly).toBe(true);
    const rev = r.metrics[0];
    // comptabilité = 1000 − 100 − 30 (OD) − 20 (contre-passation) = 850
    expect(rev).toMatchObject({
      metric: 'revenue',
      comparable: true,
      actual: '1000.00',
      accounting: '850.00',
      difference: '150.00',
      alert: false,
    });
    expect(rev?.causes).toEqual([
      { cause: 'OUTSIDE_CUTOVER', amount: '45.00' },
      { cause: 'SUSPENSE', amount: '50.00' },
      { cause: 'PERIOD_MAPPING', amount: '25.00' },
      { cause: 'MANUAL_ENTRY', amount: '30.00' },
    ]);
    expect(rev?.otherCurrencies).toEqual([{ currency: 'USD', amount: '1.00' }]);
    expect(r.alertCount).toBe(0);
  });

  it('écart non expliqué : alerte, jamais correction', () => {
    const r = reconcileWithActuals({
      ...input,
      revenue: { value: '1100.00', source: 'run.sales' },
    });
    const rev = r.metrics[0];
    expect(rev?.alert).toBe(true);
    expect(rev?.causes.find((c) => c.cause === 'UNEXPLAINED')?.amount).toBe('145.00');
    expect(r.alertCount).toBe(1);
  });

  it('réalisé saisi à la main : tout l’écart lui revient', () => {
    const r = reconcileWithActuals({ ...input, revenue: { value: '900.00', source: 'manual' } });
    expect(r.metrics[0]?.causes).toEqual([{ cause: 'ACTUALS_MANUAL_VALUE', amount: '50.00' }]);
    expect(r.metrics[0]?.alert).toBe(false);
  });

  it('dépenses par catégorie : clé exacte ou sous-clé, jamais un préfixe voisin', () => {
    const r = reconcileWithActuals(input);
    const loyer = r.metrics.find((m) => m.metric === 'expense.loyer');
    expect(loyer).toMatchObject({
      accounting: '270.00',
      difference: '0.00',
      causes: [],
      alert: false,
    });
  });

  it('réalisé absent : non comparable, jamais un zéro fabriqué', () => {
    const r = reconcileWithActuals(input);
    expect(r.metrics.find((m) => m.metric === 'expense.transport')).toMatchObject({
      comparable: false,
      reason: 'NOT_REPORTED',
      actual: null,
      difference: null,
      causes: [],
    });
    const rev = reconcileWithActuals({ ...input, revenue: { value: null, source: null } })
      .metrics[0];
    expect(rev).toMatchObject({
      comparable: false,
      reason: 'CURRENCY_NOT_CONVERTIBLE',
      difference: null,
    });
  });

  it('ne modifie aucune entrée et reste déterministe', () => {
    const frozen = JSON.parse(JSON.stringify(input)) as ReconcileWithActualsInput;
    const deepFreeze = (o: unknown): void => {
      if (o && typeof o === 'object') {
        Object.freeze(o);
        for (const v of Object.values(o)) deepFreeze(v);
      }
    };
    deepFreeze(frozen);
    const a = reconcileWithActuals(frozen);
    const b = reconcileWithActuals(frozen);
    expect(a).toEqual(b);
    expect(frozen).toEqual(input);
  });

  it('revenu non demandé ; mois illisible refusé', () => {
    expect(reconcileWithActuals({ ...input, revenue: null }).metrics.map((m) => m.metric)).toEqual([
      'expense.loyer',
      'expense.transport',
    ]);
    expect(() => reconcileWithActuals({ ...input, month: '2026-13' })).toThrow(RangeError);
  });
});
