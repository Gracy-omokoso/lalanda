// Moteur des contrats (ADR-0050 § 7, lot V1) — cas d'exemple et critères
// d'acceptation 4, 6 à 9 et 14 (partie calcul).

import { describe, expect, it } from 'vitest';

import {
  billingOccurrences,
  contractAlerts,
  contractTerms,
  CONTRACTS_VERSION,
  depositSummary,
  noticeCheck,
  occurrenceStatus,
  orderInvoicing,
  termsAt,
  type AlertContractInput,
  type AmendmentInput,
  type ContractInput,
  type LinkedInvoiceInput,
  type RecordedRenewal,
} from './index.js';
import * as engine from '../index.js';

interface Line {
  item: string;
  price: string;
}

const base: ContractInput<Line> = {
  startDate: '2027-01-15',
  status: 'signed',
  lines: [{ item: 'A', price: '100' }],
  billing: { kind: 'none' },
  initialTermMonths: 12,
  renewal: { mode: 'tacit', periodMonths: 12, maxRenewals: null },
  noticeDays: 30,
  clauses: null,
};

const terms = (
  c: Partial<ContractInput<Line>>,
  today: string,
  renewals: RecordedRenewal[] = [],
  termination: { noticeGivenOn: string; effectiveOn: string } | null = null,
) => contractTerms({ ...base, ...c }, [], renewals, termination, today);

describe('export public', () => {
  it('le module est exporté par le moteur, version à part', () => {
    expect(engine.CONTRACTS_VERSION).toBe('1.1.0');
    expect(engine.termsAt).toBe(termsAt);
    expect(engine.ENGINE_VERSION).toBe('0.2.0');
  });
});

describe('termsAt — conditions en vigueur (critère 6)', () => {
  const price = (p: string): Partial<ContractInput<Line>> => ({ lines: [{ item: 'A', price: p }] });
  const signedMarch: AmendmentInput<Line> = {
    index: 1,
    effectiveDate: '2027-03-01',
    status: 'signed',
    changes: price('120'),
  };

  it('ancien prix le 28 février, nouveau le 1er mars', () => {
    expect(termsAt(base, [signedMarch], '2027-02-28').terms.lines).toEqual([
      { item: 'A', price: '100' },
    ]);
    const march = termsAt(base, [signedMarch], '2027-03-01');
    expect(march.terms.lines).toEqual([{ item: 'A', price: '120' }]);
    expect(march.appliedAmendments).toEqual([1]);
    expect(march.version).toBe(CONTRACTS_VERSION);
  });

  it('un avenant non signé n’a aucun effet, mais il est signalé une fois sa date atteinte', () => {
    for (const status of ['draft', 'submitted', 'approved'] as const) {
      const r = termsAt(base, [{ ...signedMarch, status }], '2027-04-01');
      expect(r.terms.lines).toEqual(base.lines);
      expect(r.pendingAmendments).toEqual([1]);
    }
    expect(
      termsAt(base, [{ ...signedMarch, status: 'draft' }], '2027-02-01').pendingAmendments,
    ).toEqual([]);
    expect(
      termsAt(base, [{ ...signedMarch, status: 'cancelled' }], '2027-04-01').pendingAmendments,
    ).toEqual([]);
  });

  it('avenants dans le désordre : appliqués dans l’ordre des index, pas des dates', () => {
    const a1: AmendmentInput<Line> = { ...signedMarch, index: 1, effectiveDate: '2027-05-01' };
    const a2: AmendmentInput<Line> = {
      index: 2,
      effectiveDate: '2027-04-01',
      status: 'signed',
      changes: price('150'),
    };
    expect(termsAt(base, [a2, a1], '2027-04-15').terms.lines[0]?.price).toBe('150');
    // Au 1er mai, l'avenant 1 s'applique puis l'avenant 2 (index supérieur) le recouvre.
    const may = termsAt(base, [a2, a1], '2027-05-01');
    expect(may.terms.lines[0]?.price).toBe('150');
    expect(may.appliedAmendments).toEqual([1, 2]);
    expect(termsAt(base, [a1, a2], '2027-05-01')).toEqual(may);
  });

  it('ce qui n’est pas fourni est repris', () => {
    const r = termsAt(
      base,
      [{ index: 1, effectiveDate: '2027-02-01', status: 'signed', changes: { noticeDays: 60 } }],
      '2027-02-01',
    );
    expect(r.terms).toEqual({
      lines: base.lines,
      billing: base.billing,
      initialTermMonths: 12,
      renewal: base.renewal,
      noticeDays: 60,
      clauses: null,
    });
  });

  it('refuse un index en double et une date illisible', () => {
    expect(() => termsAt(base, [signedMarch, signedMarch], '2027-03-01')).toThrow(RangeError);
    expect(() => termsAt(base, [], '2027-02-30')).toThrow(RangeError);
    expect(() => termsAt(base, [{ ...signedMarch, index: 0 }], '2027-03-01')).toThrow(RangeError);
  });
});

describe('contractTerms — terme, préavis, reconduction (critères 7 et 8)', () => {
  it('15 janv. 2027, 12 mois, préavis 30 j : fin 14 janv. 2028, date limite 15 déc. 2027', () => {
    const r = terms({}, '2027-06-01');
    expect(r.currentTerm).toEqual({
      index: 0,
      from: '2027-01-15',
      to: '2028-01-14',
      origin: 'initial',
    });
    expect(r.noticeDeadline).toBe('2027-12-15');
    expect(r.status).toBe('in_force');
    expect(r.billableUntil).toBe('2028-01-14');
    expect(r.proposedNextTerm).toEqual({
      index: 1,
      from: '2028-01-15',
      to: '2029-01-14',
      origin: 'tacit_recorded',
    });
  });

  it('statuts dérivés : à venir, en vigueur, fin proche, échu', () => {
    expect(terms({}, '2027-01-14').status).toBe('upcoming');
    expect(terms({}, '2027-01-15').status).toBe('in_force');
    expect(terms({}, '2027-11-15').status).toBe('expiring'); // 60 j avant le 14 janv.
    expect(terms({}, '2027-11-14').status).toBe('in_force');
    // Terme échu, reconduction tacite à constater : jamais « en vigueur » ni prolongé.
    const due = terms({}, '2028-02-01');
    expect(due.status).toBe('expiring');
    expect(due.termElapsed).toBe(true);
    expect(due.billableUntil).toBe('2028-01-14');
    // Sans reconduction : échu.
    expect(
      terms({ renewal: { mode: 'none', periodMonths: null, maxRenewals: null } }, '2028-02-01')
        .status,
    ).toBe('ended');
    expect(
      terms({ renewal: { mode: 'explicit', periodMonths: 12, maxRenewals: null } }, '2028-02-01'),
    ).toMatchObject({
      status: 'ended',
      proposedNextTerm: null,
    });
    for (const status of ['draft', 'submitted', 'approved', 'terminated', 'cancelled'] as const) {
      expect(terms({ status }, '2027-06-01').status).toBe(status);
    }
  });

  it('une reconduction constatée ouvre le terme suivant ; maxRenewals la borne', () => {
    const renewal: RecordedRenewal = {
      termIndex: 1,
      from: '2028-01-15',
      to: '2029-01-14',
      mode: 'tacit_recorded',
    };
    const r = terms({}, '2028-02-01', [renewal]);
    expect(r.currentTerm.index).toBe(1);
    expect(r.billableUntil).toBe('2029-01-14');
    expect(r.noticeDeadline).toBe('2028-12-15');
    expect(r.status).toBe('in_force');
    expect(r.proposedNextTerm?.from).toBe('2029-01-15');

    const capped = terms(
      { renewal: { mode: 'tacit', periodMonths: 12, maxRenewals: 1 } },
      '2029-02-01',
      [renewal],
    );
    expect(capped.proposedNextTerm).toBeNull();
    expect(capped.status).toBe('ended');
    expect(capped.issues).toEqual([]);
    const zero = terms(
      { renewal: { mode: 'tacit', periodMonths: 12, maxRenewals: 0 } },
      '2027-06-01',
    );
    expect(zero.proposedNextTerm).toBeNull();
    expect(
      terms({ renewal: { mode: 'tacit', periodMonths: 12, maxRenewals: 0 } }, '2028-06-01', [
        renewal,
      ]).issues,
    ).toEqual([{ code: 'RENEWALS_ABOVE_MAXIMUM', termIndex: 1 }]);
  });

  it('une reconduction non contiguë est ignorée et signalée', () => {
    const r = terms({}, '2028-02-01', [
      { termIndex: 1, from: '2028-01-16', to: '2029-01-14', mode: 'tacit_recorded' },
    ]);
    expect(r.terms).toHaveLength(1);
    expect(r.issues).toEqual([{ code: 'RENEWAL_INCOHERENT', termIndex: 1 }]);
    expect(r.billableUntil).toBe('2028-01-14');
    const skipped = terms({}, '2028-02-01', [
      { termIndex: 2, from: '2028-01-15', to: '2029-01-14', mode: 'tacit_recorded' },
    ]);
    expect(skipped.issues[0]?.code).toBe('RENEWAL_INCOHERENT');
  });

  it('reconduction tacite sans durée saisie : rien n’est proposé, c’est signalé', () => {
    const r = terms(
      { renewal: { mode: 'tacit', periodMonths: null, maxRenewals: null } },
      '2027-06-01',
    );
    expect(r.proposedNextTerm).toBeNull();
    expect(r.issues).toEqual([{ code: 'RENEWAL_PERIOD_MISSING', termIndex: 1 }]);
  });

  it('durée indéterminée : ni fin, ni date limite, ni borne', () => {
    const r = terms({ initialTermMonths: null }, '2040-01-01');
    expect(r.currentTerm.to).toBeNull();
    expect(r.noticeDeadline).toBeNull();
    expect(r.billableUntil).toBeNull();
    expect(r.status).toBe('in_force');
    expect(r.proposedNextTerm).toBeNull();
  });

  it('résiliation : borne facturable à la date d’effet, aucune proposition (critère 14)', () => {
    const r = terms({}, '2027-12-10', [], {
      noticeGivenOn: '2027-12-01',
      effectiveOn: '2027-12-31',
    });
    expect(r.billableUntil).toBe('2027-12-31');
    expect(r.proposedNextTerm).toBeNull();
    const late = terms({}, '2027-12-10', [], {
      noticeGivenOn: '2027-12-01',
      effectiveOn: '2028-06-30',
    });
    expect(late.billableUntil).toBe('2028-01-14');
    const open = terms({ initialTermMonths: null }, '2030-01-01', [], {
      noticeGivenOn: '2030-01-01',
      effectiveOn: '2030-03-31',
    });
    expect(open.billableUntil).toBe('2030-03-31');
  });

  it('fins de mois : un terme d’un mois commencé un 31 garde son quantième', () => {
    const c = {
      startDate: '2027-01-31',
      initialTermMonths: 1,
      renewal: { mode: 'tacit' as const, periodMonths: 1, maxRenewals: null },
    };
    const r0 = terms(c, '2027-02-01');
    expect(r0.currentTerm.to).toBe('2027-02-27'); // veille du 28 février
    expect(r0.proposedNextTerm).toMatchObject({ from: '2027-02-28', to: '2027-03-30' });
    const r1 = terms(c, '2027-03-01', [
      { termIndex: 1, from: '2027-02-28', to: '2027-03-30', mode: 'tacit_recorded' },
    ]);
    expect(r1.proposedNextTerm).toMatchObject({ from: '2027-03-31', to: '2027-04-29' });
    // Année bissextile : 29 février 2028.
    expect(
      terms({ startDate: '2028-01-31', initialTermMonths: 1 }, '2028-02-01').currentTerm.to,
    ).toBe('2028-02-28');
    expect(
      terms({ startDate: '2028-02-29', initialTermMonths: 12 }, '2028-03-01').currentTerm.to,
    ).toBe('2029-02-27');
  });

  it('les clauses en vigueur viennent des avenants signés', () => {
    const r = contractTerms(
      base,
      [{ index: 1, effectiveDate: '2027-06-01', status: 'signed', changes: { noticeDays: 90 } }],
      [],
      null,
      '2027-07-01',
    );
    expect(r.noticeDeadline).toBe('2027-10-16');
  });

  it('valide les clauses saisies', () => {
    expect(() => terms({ initialTermMonths: 0 }, '2027-06-01')).toThrow(RangeError);
    expect(() => terms({ initialTermMonths: 121 }, '2027-06-01')).toThrow(RangeError);
    expect(() => terms({ noticeDays: 366 }, '2027-06-01')).toThrow(RangeError);
    expect(() =>
      terms({ renewal: { mode: 'tacit', periodMonths: 61, maxRenewals: null } }, '2027-06-01'),
    ).toThrow(RangeError);
    expect(() => terms({}, '2027-13-01')).toThrow(RangeError);
  });
});

describe('noticeCheck — comparaison à la clause saisie (critère 14)', () => {
  it('notifiée le 1er déc. 2027, effet au 14 janv. 2028, préavis 60 j : en deçà, jamais refusée', () => {
    expect(noticeCheck('2027-12-01', '2028-01-14', 60)).toEqual({
      version: CONTRACTS_VERSION,
      noticeGivenOn: '2027-12-01',
      effectiveOn: '2028-01-14',
      noticeDays: 60,
      daysGiven: 44,
      latestNoticeDate: '2027-11-15',
      result: 'below_clause',
    });
  });

  it('pile au préavis : conforme à la clause ; effet avant la notification : en deçà', () => {
    expect(noticeCheck('2027-11-15', '2028-01-14', 60).result).toBe('meets_clause');
    expect(noticeCheck('2027-11-16', '2028-01-14', 60).result).toBe('below_clause');
    expect(noticeCheck('2028-02-01', '2028-01-14', 0)).toMatchObject({
      daysGiven: -18,
      result: 'below_clause',
    });
    expect(noticeCheck('2028-01-14', '2028-01-14', 0).result).toBe('meets_clause');
  });

  it('valide ses entrées', () => {
    expect(() => noticeCheck('2027-12-01', '2028-01-14', -1)).toThrow(RangeError);
    expect(() => noticeCheck('x', '2028-01-14', 1)).toThrow(RangeError);
  });
});

describe('billingOccurrences (critères 9 et 14)', () => {
  const monthly = {
    kind: 'recurring' as const,
    frequency: 'monthly' as const,
    anchorDate: '2027-01-31',
    timing: 'in_advance' as const,
    autoPrepare: true,
  };

  it('mensuel ancré le 31 janv. : 31 janv., 28 févr., 31 mars', () => {
    const r = billingOccurrences(
      monthly,
      { startDate: '2027-01-31', endDate: null },
      '2027-01-01',
      '2027-03-31',
    );
    expect(r.occurrences.map((o) => o.date)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    expect(r.occurrences.map((o) => o.rank)).toEqual([0, 1, 2]);
    expect(r.occurrences.map((o) => o.key)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    const leap = billingOccurrences(
      { ...monthly, anchorDate: '2028-01-31' },
      { startDate: '2028-01-31', endDate: null },
      '2028-02-01',
      '2028-02-29',
    );
    expect(leap.occurrences.map((o) => o.date)).toEqual(['2028-02-29']);
  });

  it('libellé de période : à échoir ou échue, sans montant', () => {
    const adv = billingOccurrences(
      monthly,
      { startDate: '2027-01-31', endDate: null },
      '2027-02-01',
      '2027-02-28',
    );
    expect(adv.occurrences[0]).toMatchObject({
      periodStart: '2027-02-28',
      periodEnd: '2027-03-30',
    });
    const arr = billingOccurrences(
      { ...monthly, timing: 'in_arrears' },
      { startDate: '2027-01-31', endDate: null },
      '2027-01-01',
      '2027-02-28',
    );
    expect(arr.occurrences.map((o) => [o.periodStart, o.periodEnd])).toEqual([
      ['2027-01-01', '2027-01-31'],
      ['2027-02-01', '2027-02-28'],
    ]);
    expect(arr.occurrences[0]?.periodExceedsBounds).toBe(true); // commence avant le contrat
    expect(arr.occurrences[1]?.periodExceedsBounds).toBe(false);
  });

  it('rien au-delà du terme ni de la date d’effet d’une résiliation', () => {
    const t = terms(
      { startDate: '2027-01-15', billing: { ...monthly, anchorDate: '2027-01-15' } },
      '2027-12-10',
      [],
      { noticeGivenOn: '2027-12-01', effectiveOn: '2028-01-14' },
    );
    const r = billingOccurrences(
      { ...monthly, anchorDate: '2027-01-15' },
      { startDate: '2027-01-15', endDate: t.billableUntil },
      '2027-01-01',
      '2030-12-31',
    );
    expect(r.occurrences).toHaveLength(12);
    expect(r.occurrences.at(-1)?.date).toBe('2027-12-15');
    expect(r.occurrences.at(-1)?.periodExceedsBounds).toBe(false); // 15 déc. → 14 janv. inclus
    const cut = billingOccurrences(
      { ...monthly, anchorDate: '2027-01-15' },
      { startDate: '2027-01-15', endDate: '2027-12-31' },
      '2027-01-01',
      '2030-12-31',
    );
    expect(cut.occurrences.at(-1)).toMatchObject({ date: '2027-12-15', periodExceedsBounds: true });
    const last = billingOccurrences(
      { ...monthly, anchorDate: '2027-01-14' },
      { startDate: '2027-01-14', endDate: '2028-01-14' },
      '2028-01-01',
      '2028-12-31',
    );
    expect(last.occurrences.map((o) => o.date)).toEqual(['2028-01-14']);
  });

  it('hebdomadaire, trimestriel, annuel', () => {
    const b = { startDate: '2027-01-01', endDate: '2027-12-31' };
    const w = billingOccurrences(
      { ...monthly, frequency: 'weekly', anchorDate: '2027-01-01' },
      b,
      '2027-01-01',
      '2027-01-31',
    );
    expect(w.occurrences.map((o) => o.date)).toEqual([
      '2027-01-01',
      '2027-01-08',
      '2027-01-15',
      '2027-01-22',
      '2027-01-29',
    ]);
    expect(w.occurrences[1]).toMatchObject({
      rank: 1,
      periodStart: '2027-01-08',
      periodEnd: '2027-01-14',
    });
    const q = billingOccurrences(
      { ...monthly, frequency: 'quarterly', anchorDate: '2026-11-30' },
      b,
      '2027-01-01',
      '2027-12-31',
    );
    expect(q.occurrences.map((o) => o.date)).toEqual([
      '2027-02-28',
      '2027-05-30',
      '2027-08-30',
      '2027-11-30',
    ]);
    expect(q.occurrences[0]?.rank).toBe(1);
    const y = billingOccurrences(
      { ...monthly, frequency: 'yearly', anchorDate: '2024-02-29' },
      { startDate: '2024-02-29', endDate: null },
      '2024-01-01',
      '2028-12-31',
    );
    expect(y.occurrences.map((o) => o.date)).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ]);
  });

  it('échéancier à dates fixes : trié, hors bornes écarté et signalé', () => {
    const r = billingOccurrences(
      {
        kind: 'schedule',
        items: [
          { itemRef: 'b', dueDate: '2027-06-01' },
          { itemRef: 'a', dueDate: '2027-06-01' },
          { itemRef: 'early', dueDate: '2026-12-01' },
          { itemRef: 'late', dueDate: '2029-01-01' },
          { itemRef: 'outside', dueDate: '2031-01-01' },
        ],
      },
      { startDate: '2027-01-15', endDate: '2028-01-14' },
      '2026-01-01',
      '2030-12-31',
    );
    expect(r.occurrences.map((o) => o.key)).toEqual(['item:a', 'item:b']);
    expect(r.excluded).toEqual([
      { itemRef: 'early', date: '2026-12-01', reason: 'BEFORE_START' },
      { itemRef: 'late', date: '2029-01-01', reason: 'AFTER_END' },
    ]);
    expect(() =>
      billingOccurrences(
        {
          kind: 'schedule',
          items: [
            { itemRef: 'a', dueDate: '2027-01-01' },
            { itemRef: 'a', dueDate: '2027-02-01' },
          ],
        },
        { startDate: '2027-01-01', endDate: null },
        '2027-01-01',
        '2027-12-31',
      ),
    ).toThrow(RangeError);
  });

  it('sans échéancier, ou fenêtre vide : aucune échéance', () => {
    expect(
      billingOccurrences(
        { kind: 'none' },
        { startDate: '2027-01-01', endDate: null },
        '2027-01-01',
        '2027-12-31',
      ).occurrences,
    ).toEqual([]);
    expect(
      billingOccurrences(
        monthly,
        { startDate: '2027-01-01', endDate: null },
        '2027-12-31',
        '2027-01-01',
      ).occurrences,
    ).toEqual([]);
  });
});

describe('occurrenceStatus — préparée, à préparer, à venir, bloquée', () => {
  const occ = [
    { key: '2027-01-31', date: '2027-01-31' },
    { key: '2027-02-28', date: '2027-02-28' },
    { key: '2027-03-31', date: '2027-03-31' },
    { key: '2027-04-30', date: '2027-04-30' },
  ];

  it('combine liens, blocages et délai', () => {
    const r = occurrenceStatus(
      occ,
      [
        { key: '2027-01-31', invoiceId: 'inv1' },
        { key: '2027-02-28', invoiceId: 'gone', orphan: true },
        { key: '2026-12-31', invoiceId: 'old' },
      ],
      [{ reason: 'RENEWAL_NOT_RECORDED', fromDate: '2027-03-15' }],
      { today: '2027-03-31', leadDays: 0 },
    );
    expect(r.entries.map((e) => [e.key, e.state, e.invoiceId, e.reasons])).toEqual([
      ['2027-01-31', 'prepared', 'inv1', []],
      ['2027-02-28', 'to_prepare', null, []], // brouillon supprimé : redevient à préparer
      ['2027-03-31', 'blocked', null, ['RENEWAL_NOT_RECORDED']],
      ['2027-04-30', 'upcoming', null, []],
    ]);
    expect(r.unknownLinks).toEqual(['2026-12-31']);
    expect(r.duplicateLinks).toEqual([]);
  });

  it('délai de préparation, blocage par clé, doublons', () => {
    const r = occurrenceStatus(
      occ,
      [
        { key: '2027-01-31', invoiceId: 'b' },
        { key: '2027-01-31', invoiceId: 'a' },
      ],
      [
        { reason: 'CUSTOMER_ARCHIVED', key: '2027-02-28' },
        { reason: 'COMPUTATION_ERROR', key: '2027-02-28' },
        { reason: 'COMPUTATION_ERROR' },
      ],
      { today: '2027-03-25', leadDays: 6 },
    );
    expect(r.entries[0]).toMatchObject({ state: 'prepared', invoiceId: 'a' });
    expect(r.entries[1]?.reasons).toEqual(['COMPUTATION_ERROR', 'CUSTOMER_ARCHIVED']);
    expect(r.entries[2]).toMatchObject({ state: 'blocked', reasons: ['COMPUTATION_ERROR'] });
    expect(r.entries[3]?.state).toBe('upcoming');
    expect(r.duplicateLinks).toEqual(['2027-01-31']);
    expect(() => occurrenceStatus([...occ, occ[0]!], [], [], { today: '2027-01-01' })).toThrow(
      RangeError,
    );
    expect(() => occurrenceStatus(occ, [], [], { today: '2027-01-01', leadDays: 31 })).toThrow(
      RangeError,
    );
  });
});

describe('orderInvoicing — reste à facturer (critère 4)', () => {
  const lines = [
    { lineRef: 'L1', catalogItemId: 'item-1', unitPrice: '25.50', quantity: '10' },
    { lineRef: 'L2', catalogItemId: null, unitPrice: '100', quantity: '1.5' },
  ];
  const inv = (
    id: string,
    state: 'draft' | 'issued',
    quantity: string,
    over: Partial<{ catalogItemId: string | null; unitPrice: string }> = {},
  ): LinkedInvoiceInput => ({
    invoiceId: id,
    state,
    lines: [{ index: 0, catalogItemId: 'item-1', unitPrice: '25.5', quantity, ...over }],
    lineMap: [{ invoiceLineIndex: 0, lineRef: 'L1', quantity }],
  });

  it('10 commandées, 6 préparées puis émises, 4 restantes, puis tout facturé', () => {
    const draft = orderInvoicing(lines, [inv('f1', 'draft', '6')]);
    expect(draft.status).toBe('not_invoiced');
    expect(draft.lines[0]).toMatchObject({
      invoiced: '0',
      inDraft: '6',
      remainingToInvoice: '10',
      remainingToPrepare: '4',
    });

    const issued = orderInvoicing(lines, [inv('f1', 'issued', '6')]);
    expect(issued.status).toBe('partially_invoiced');
    expect(issued.lines[0]).toMatchObject({
      invoiced: '6',
      remainingToInvoice: '4',
      remainingToPrepare: '4',
    });

    const all = orderInvoicing(lines, [
      inv('f1', 'issued', '6'),
      inv('f2', 'issued', '4'),
      {
        invoiceId: 'f3',
        state: 'issued',
        lines: [{ index: 2, catalogItemId: null, unitPrice: '100.00', quantity: '1.5' }],
        lineMap: [{ invoiceLineIndex: 2, lineRef: 'L2', quantity: '1.5' }],
      },
    ]);
    expect(all.status).toBe('invoiced');
    expect(all.closeSuggested).toBe(true);
    expect(all.issues).toEqual([]);
  });

  it('ADR-0054 : un avoir gelé réduit le facturé et rouvre le reste à facturer', () => {
    const credited = (q: string, c: string): LinkedInvoiceInput => {
      const base = inv('f1', 'issued', q);
      return { ...base, lines: [{ ...base.lines[0]!, credited: c }] };
    };
    const partial = orderInvoicing(lines, [credited('10', '3')]);
    expect(partial.status).toBe('partially_invoiced');
    expect(partial.lines[0]).toMatchObject({
      invoiced: '7',
      credited: '3',
      remainingToInvoice: '3',
      remainingToPrepare: '3',
    });

    // Avoir total : plus rien de facturé sur la ligne.
    const total = orderInvoicing(lines, [credited('10', '10')]);
    expect(total.status).toBe('not_invoiced');
    expect(total.lines[0]).toMatchObject({
      invoiced: '0',
      credited: '10',
      remainingToInvoice: '10',
    });

    // Crédit supérieur à la ligne (donnée incohérente) : borné à la quantité de la ligne.
    expect(orderInvoicing(lines, [credited('4', '9')]).lines[0]).toMatchObject({
      invoiced: '0',
      credited: '4',
    });

    // Un brouillon ne porte pas d'avoir gelé : rien n'est déduit.
    const draftBase = inv('f2', 'draft', '5');
    const draft = orderInvoicing(lines, [
      { ...draftBase, lines: [{ ...draftBase.lines[0]!, credited: '5' }] },
    ]);
    expect(draft.lines[0]).toMatchObject({ inDraft: '5', credited: '0' });

    // Sans avoir : facturé inchangé, crédité nul.
    expect(orderInvoicing(lines, [credited('6', '0')]).lines[0]).toMatchObject({
      invoiced: '6',
      credited: '0',
    });
    expect(() => orderInvoicing(lines, [credited('6', '-1')])).toThrow(RangeError);
  });

  it('article ou prix changé dans le brouillon : UNMATCHED_LINE, reste inchangé', () => {
    for (const over of [
      { catalogItemId: 'item-2' },
      { unitPrice: '30' },
      { catalogItemId: null },
    ]) {
      const r = orderInvoicing(lines, [inv('f1', 'issued', '6', over)]);
      expect(r.lines[0]?.remainingToInvoice).toBe('10');
      expect(r.issues).toEqual([
        { code: 'UNMATCHED_LINE', invoiceId: 'f1', lineRef: 'L1', invoiceLineIndex: 0 },
      ]);
    }
  });

  it('la quantité comptée est celle de la facture ; jamais de reste négatif', () => {
    const r = orderInvoicing(lines, [
      {
        ...inv('f1', 'issued', '12'),
        lineMap: [{ invoiceLineIndex: 0, lineRef: 'L1', quantity: '6' }],
      },
    ]);
    expect(r.lines[0]).toMatchObject({
      invoiced: '12',
      remainingToInvoice: '0',
      remainingToPrepare: '0',
      overInvoiced: '2',
    });
    expect(r.issues).toContainEqual({
      code: 'OVER_INVOICED',
      invoiceId: null,
      lineRef: 'L1',
      invoiceLineIndex: null,
    });
  });

  it('liens incohérents signalés, jamais devinés', () => {
    const r = orderInvoicing(lines, [
      {
        invoiceId: 'f1',
        state: 'issued',
        lines: [{ index: 0, catalogItemId: 'item-1', unitPrice: '25.50', quantity: '1' }],
        lineMap: [
          { invoiceLineIndex: 0, lineRef: 'L1', quantity: '1' },
          { invoiceLineIndex: 0, lineRef: 'L1', quantity: '1' },
          { invoiceLineIndex: 5, lineRef: 'L1', quantity: '1' },
          { invoiceLineIndex: 1, lineRef: 'ZZ', quantity: '1' },
        ],
      },
    ]);
    expect(r.issues.map((i) => i.code)).toEqual([
      'DUPLICATE_MAPPING',
      'MISSING_INVOICE_LINE',
      'UNKNOWN_LINE_REF',
    ]);
    expect(r.lines[0]?.invoiced).toBe('1');
  });

  it('valide ses entrées', () => {
    expect(() => orderInvoicing([{ ...lines[0]!, quantity: '0' }], [])).toThrow(RangeError);
    expect(() => orderInvoicing([lines[0]!, lines[0]!], [])).toThrow(RangeError);
    expect(() => orderInvoicing(lines, [inv('f', 'issued', '1'), inv('f', 'issued', '1')])).toThrow(
      RangeError,
    );
    expect(() => orderInvoicing([{ ...lines[0]!, unitPrice: '1.001' }], [])).toThrow(RangeError);
    expect(orderInvoicing([], []).status).toBe('not_invoiced');
  });
});

describe('depositSummary — acomptes par devise, rien d’imputé (critère 12)', () => {
  const deposits = [
    {
      invoiceId: 'ft1',
      currency: 'USD' as const,
      state: 'issued' as const,
      total: '116.00',
      paid: '50',
      requestedAmount: '100',
    },
    {
      invoiceId: 'ft2',
      currency: 'CDF' as const,
      state: 'issued' as const,
      total: '290000',
      paid: '0',
      requestedAmount: null,
    },
    {
      invoiceId: 'ft3',
      currency: 'USD' as const,
      state: 'draft' as const,
      total: '20',
      paid: '0',
      requestedAmount: '20',
    },
  ];

  it('sommes par devise, sans conversion ; écart au montant demandé signalé', () => {
    const r = depositSummary(deposits, [], []);
    expect(r.byCurrency).toEqual([
      { currency: 'CDF', requested: '0.00', invoiced: '290000.00', inDraft: '0.00', paid: '0.00' },
      { currency: 'USD', requested: '120.00', invoiced: '116.00', inDraft: '20.00', paid: '50.00' },
    ]);
    expect(r.deposits[0]?.gapToRequested).toBe('16.00');
    expect(r.deposits[1]?.gapToRequested).toBeNull();
    expect(r.issues).toEqual([]);
  });

  it('DEPOSIT_NOT_RESOLVED jusqu’au geste « traité »', () => {
    const r = depositSummary(deposits, [{ invoiceId: 'fv1', state: 'draft' }], []);
    expect(r.unresolved).toEqual(['ft1', 'ft2']);
    expect(r.issues).toEqual([{ code: 'DEPOSIT_NOT_RESOLVED', invoiceIds: ['ft1', 'ft2'] }]);
    const done = depositSummary(deposits, [{ invoiceId: 'fv1', state: 'issued' }], ['ft1', 'ft2']);
    expect(done.issues).toEqual([]);
    expect(done.deposits.every((d) => d.state === 'draft' || d.resolved)).toBe(true);
  });

  it('valide ses entrées', () => {
    expect(() => depositSummary([{ ...deposits[0]!, currency: 'EUR' as 'USD' }], [], [])).toThrow(
      RangeError,
    );
    expect(() => depositSummary([deposits[0]!, deposits[0]!], [], [])).toThrow(RangeError);
    expect(() => depositSummary([{ ...deposits[0]!, total: '-1' }], [], [])).toThrow(RangeError);
  });
});

describe('contractAlerts — « Mes tâches » (critère 7)', () => {
  const contract: AlertContractInput = {
    id: 'c1',
    ownerUserId: 'owner',
    status: 'signed',
    submittedOn: '2026-12-01',
    submittedBy: 'rep',
    startDate: '2027-01-15',
    initialTermMonths: 12,
    renewal: { mode: 'tacit', periodMonths: 12, maxRenewals: null },
    noticeDays: 30,
    renewals: [],
    termination: null,
    amendments: [],
    draftOccurrenceDates: [],
    blockedOccurrences: [],
  };
  const settings = { noticeAlertDays: 30, termEndAlertDays: 60 };
  const kinds = (today: string, c: Partial<AlertContractInput> = {}) =>
    contractAlerts([{ ...contract, ...c }], settings, today).alerts.map((a) => a.kind);

  it('préavis visible du 15 nov. au 15 déc. 2027 pour le responsable', () => {
    expect(kinds('2027-11-14')).not.toContain('notice_deadline');
    const r = contractAlerts([contract], settings, '2027-11-15').alerts.find(
      (a) => a.kind === 'notice_deadline',
    );
    expect(r).toMatchObject({
      id: 'sct:notice_deadline:c1:0',
      audience: 'owner',
      ownerUserId: 'owner',
      dueDate: '2027-12-15',
      visibleFrom: '2027-11-15',
    });
    expect(kinds('2027-12-15')).toContain('notice_deadline');
    expect(kinds('2027-12-16')).not.toContain('notice_deadline');
  });

  it('reconduction tacite à constater, jusqu’au constat', () => {
    expect(kinds('2027-11-14')).not.toContain('renewal_to_record');
    expect(kinds('2027-11-15')).toContain('renewal_to_record');
    expect(kinds('2028-03-01')).toContain('renewal_to_record');
    const recorded = kinds('2028-03-01', {
      renewals: [{ termIndex: 1, from: '2028-01-15', to: '2029-01-14', mode: 'tacit_recorded' }],
    });
    expect(recorded).not.toContain('renewal_to_record');
  });

  it('fin de terme pour une reconduction expresse ou absente', () => {
    const none = { renewal: { mode: 'none' as const, periodMonths: null, maxRenewals: null } };
    expect(kinds('2027-11-14', none)).not.toContain('term_end');
    expect(kinds('2027-11-15', none)).toContain('term_end');
    expect(kinds('2028-01-14', none)).toContain('term_end');
    expect(kinds('2028-01-15', none)).not.toContain('term_end');
    expect(kinds('2027-11-15', none)).not.toContain('renewal_to_record');
  });

  it('résilié ou à durée indéterminée : aucune alerte de date', () => {
    expect(
      kinds('2027-12-01', {
        termination: { noticeGivenOn: '2027-11-01', effectiveOn: '2027-12-31' },
      }),
    ).toEqual([]);
    expect(kinds('2027-12-01', { initialTermMonths: null })).toEqual([]);
  });

  it('contrat et avenant à approuver ; copie signée manquante après 15 jours', () => {
    const r = contractAlerts(
      [
        {
          ...contract,
          status: 'submitted',
          amendments: [
            {
              id: 'a1',
              index: 1,
              status: 'submitted',
              submittedOn: '2027-02-01',
              submittedBy: 'cpt',
              approvedOn: null,
              hasSignedCopy: false,
            },
            {
              id: 'a2',
              index: 2,
              status: 'approved',
              submittedOn: '2027-02-01',
              submittedBy: 'cpt',
              approvedOn: '2027-02-10',
              hasSignedCopy: false,
            },
          ],
        },
      ],
      settings,
      '2027-02-25',
    ).alerts;
    expect(r.map((a) => [a.kind, a.audience, a.excludeUserId])).toEqual([
      ['amendment_to_approve', 'approvers', 'cpt'],
      ['contract_to_approve', 'approvers', 'rep'],
      ['signed_copy_missing', 'owner', null],
    ]);
    const early = contractAlerts(
      [
        {
          ...contract,
          amendments: [
            {
              id: 'a2',
              index: 2,
              status: 'approved',
              submittedOn: null,
              submittedBy: null,
              approvedOn: '2027-02-10',
              hasSignedCopy: false,
            },
          ],
        },
      ],
      settings,
      '2027-02-24',
    );
    expect(early.alerts.map((a) => a.kind)).not.toContain('signed_copy_missing');
  });

  it('brouillons à émettre : un élément agrégé ; échéances bloquées : une par échéance', () => {
    const r = contractAlerts(
      [
        { ...contract, draftOccurrenceDates: ['2027-03-15', '2027-02-15'] },
        {
          ...contract,
          id: 'c2',
          draftOccurrenceDates: ['2027-02-20'],
          blockedOccurrences: [
            { key: '2027-02-15', date: '2027-02-15', reasons: ['TERMINATED', 'AMENDMENT_PENDING'] },
          ],
        },
      ],
      settings,
      '2027-03-20',
    ).alerts;
    expect(r.find((a) => a.kind === 'subscription_drafts_to_issue')).toMatchObject({
      id: 'sct:subscription_drafts_to_issue',
      audience: 'invoicers',
      count: 3,
      dueDate: '2027-02-15',
      contractId: null,
    });
    expect(r.find((a) => a.kind === 'occurrence_blocked')).toMatchObject({
      contractId: 'c2',
      reasons: ['AMENDMENT_PENDING', 'TERMINATED'],
    });
    expect(r.every((a) => a.id.startsWith('sct:'))).toBe(true);
  });

  it('valide les réglages', () => {
    expect(() =>
      contractAlerts([], { noticeAlertDays: 366, termEndAlertDays: 0 }, '2027-01-01'),
    ).toThrow(RangeError);
    expect(contractAlerts([], settings, '2027-01-01').alerts).toEqual([]);
  });
});
