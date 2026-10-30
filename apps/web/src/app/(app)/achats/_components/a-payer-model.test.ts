import { describe, expect, it } from 'vitest';

import type { EcheancierView, SupplierInvoiceListItem } from '@/lib/api-purchases-payables';

import { formatMontant } from '../../ventes/_components/sales-model';

import {
  basculerImputation,
  depensesRattachables,
  facturesPayables,
  formulairePaiement,
  groupesEcheancier,
  lignesPlusTard,
  parDevise,
  phraseDoublon,
  preparerPaiement,
  preparerRattachement,
  totauxGroupe,
  type DepenseCandidate,
} from './a-payer-model';

const item = (
  id: string,
  over: Partial<SupplierInvoiceListItem> = {},
): SupplierInvoiceListItem => ({
  id,
  internalNumber: `FF2610-00000${id}`,
  supplierId: 's1',
  supplierName: 'Socimex',
  supplierReference: `FA ${id}`,
  kind: 'invoice',
  status: 'validated',
  matchingMode: 'none',
  matchingStatus: 'not_applicable',
  currency: 'USD',
  invoiceDate: '2026-10-01',
  dueDate: '2026-10-20',
  total: '100.00',
  remaining: '100.00',
  settlementStatus: 'unpaid',
  disputed: false,
  forced: false,
  hasAttachment: true,
  orderIds: [],
  updatedAt: '2026-10-01T10:00:00.000Z',
  ...over,
});

const echeancier: EcheancierView = {
  asOf: '2026-10-30',
  dueSoonDays: 7,
  byCurrency: [
    {
      currency: 'CDF',
      overdue: { amount: '0.00', count: 0 },
      dueSoon: { amount: '50000.00', count: 1 },
      disputed: { amount: '0.00', count: 0 },
    },
    {
      currency: 'USD',
      overdue: { amount: '300.00', count: 2 },
      dueSoon: { amount: '0.00', count: 0 },
      weeks: [
        { from: '2026-11-07', to: '2026-11-13', amount: '200.00', count: 1 },
        { from: '2026-11-14', to: '2026-11-20', amount: '0.00', count: 0 },
      ],
      months: [{ month: '2027-01', amount: '75.00', count: 1 }],
      disputed: { amount: '40.00', count: 1 },
    },
  ],
};

describe('échéancier', () => {
  it('range d’après les listes de l’API ; plus tard = le reste ; litiges et payées à part', () => {
    const retard = [item('1'), item('2', { currency: 'CDF' }), item('7', { disputed: true })];
    const bientot = [item('3')];
    const validees = [
      ...retard,
      ...bientot,
      item('4'),
      item('5', { settlementStatus: 'paid' }),
      item('6', { kind: 'credit_note' }),
      item('8', { disputed: true }),
    ];
    const g = groupesEcheancier(retard, bientot, validees, 7);
    const parId = Object.fromEntries(
      g.map((x) => [x.id, x.parDevise.map((d) => [d.currency, d.factures.map((f) => f.id)])]),
    );
    expect(parId).toEqual({
      'en-retard': [
        ['CDF', ['2']],
        ['USD', ['1']],
      ],
      bientot: [['USD', ['3']]],
      'plus-tard': [['USD', ['4']]],
      litiges: [['USD', ['7', '8']]],
    });
    expect(g[1]!.titre).toBe('À payer sous 7 jours');
    expect(groupesEcheancier([], [], [], null)[1]!.titre).toBe('À payer bientôt');
  });

  it('par devise : CDF puis USD, jamais mélangées', () => {
    expect(parDevise([item('1'), item('2', { currency: 'CDF' })]).map((d) => d.currency)).toEqual([
      'CDF',
      'USD',
    ]);
    expect(parDevise([])).toEqual([]);
  });

  it('totaux du moteur, une devise par ligne ; null si l’échéancier manque', () => {
    expect(totauxGroupe(echeancier, 'en-retard')).toEqual(['300,00 USD · 2 factures']);
    expect(totauxGroupe(echeancier, 'bientot')).toEqual([
      `${formatMontant('50000.00', 'CDF')} · 1 facture`,
    ]);
    expect(totauxGroupe(echeancier, 'litiges')).toEqual(['40,00 USD · 1 facture']);
    expect(totauxGroupe(null, 'bientot')).toBeNull();
    expect(lignesPlusTard(echeancier)).toEqual([
      'Du 7 nov. 2026 au 13 nov. 2026 : 200,00 USD · 1 facture',
      'En janvier 2027 : 75,00 USD · 1 facture',
    ]);
    expect(totauxGroupe(echeancier, 'plus-tard')).toHaveLength(2);
  });
});

describe('paiement', () => {
  const factures = facturesPayables(
    [
      item('1', { remaining: '60.00', settlementStatus: 'partially_paid' }),
      item('2'),
      item('3', { currency: 'CDF' }),
      item('4', { supplierId: 's2' }),
      item('5', { disputed: true }),
      item('6', { status: 'draft' }),
    ],
    's1',
    'USD',
  );

  it('factures payables : même fournisseur, même devise, validées, ni payées ni en litige', () => {
    expect(factures.map((f) => f.id)).toEqual(['1', '2']);
  });

  it('une facture choisie : son reste est recopié, montant payé compris', () => {
    const f = formulairePaiement(factures, new Set(['1']), '2026-10-30');
    expect(f).toMatchObject({
      supplierId: 's1',
      currency: 'USD',
      amount: '60,00',
      paidOn: '2026-10-30',
    });
    expect(f.imputations.map((x) => [x.invoiceId, x.choisie, x.montant])).toEqual([
      ['1', true, '60,00'],
      ['2', false, ''],
    ]);
  });

  it('plusieurs factures : montant payé saisi, ventilation envoyée telle quelle', () => {
    let f = formulairePaiement(factures, new Set(['1']), '2026-10-30');
    f = basculerImputation(f, '2');
    expect(f.imputations[1]).toMatchObject({ choisie: true, montant: '100,00' });
    f.amount = '160';
    f.accountId = 'a1';
    f.reference = ' TX-9 ';
    expect(preparerPaiement(f, '2026-10-30')).toEqual({
      ok: true,
      corps: {
        supplierId: 's1',
        currency: 'USD',
        paidOn: '2026-10-30',
        amount: '160',
        accountId: 'a1',
        method: 'bank_transfer',
        reference: 'TX-9',
        allocations: [
          { invoiceId: '1', amount: '60.00' },
          { invoiceId: '2', amount: '100.00' },
        ],
      },
    });
    f = basculerImputation(f, '2');
    expect(f.imputations[1]).toMatchObject({ choisie: false, montant: '' });
  });

  it('une seule facture au montant vide reçoit le montant payé (copie)', () => {
    const f = formulairePaiement(factures, new Set(['2']), '2026-10-30');
    f.imputations[1]!.montant = '';
    f.amount = '40';
    const p = preparerPaiement(f, '2026-10-30');
    expect(p.ok && p.corps.allocations).toEqual([{ invoiceId: '2', amount: '40' }]);
  });

  it('refus : rien coché, date future, montant invalide', () => {
    const f = formulairePaiement(factures, new Set(), '2026-10-30');
    f.paidOn = '2026-11-01';
    f.amount = '0';
    const p = preparerPaiement(f, '2026-10-30');
    expect(p.ok).toBe(false);
    if (!p.ok) expect(Object.keys(p.champs).sort()).toEqual(['amount', 'imputations', 'paidOn']);
  });
});

describe('rattacher une dépense déjà saisie', () => {
  const dep = (id: string, over: Partial<DepenseCandidate> = {}): DepenseCandidate => ({
    id,
    spentOn: '2026-10-29',
    label: 'Ramettes',
    amount: '200.00',
    currency: 'USD',
    revision: 3,
    supplierName: 'Socimex',
    origin: null,
    status: 'recorded',
    ...over,
  });

  it('seules les dépenses directes, enregistrées, dans la devise', () => {
    const l = depensesRattachables(
      [
        dep('a'),
        dep('b', { origin: { kind: 'supplier_payment' } }),
        dep('c', { status: 'cancelled' }),
        dep('d', { currency: 'CDF' }),
        dep('e', { origin: undefined }),
      ],
      'USD',
    );
    expect(l.map((d) => d.id)).toEqual(['a', 'e']);
  });

  it('une facture sans montant reçoit le montant de la dépense ; révision transmise', () => {
    const f = formulairePaiement(
      [item('1', { remaining: '200.00' })],
      new Set(['1']),
      '2026-10-30',
    );
    f.imputations[0]!.montant = '';
    expect(preparerRattachement(dep('a'), f.imputations)).toEqual({
      ok: true,
      corps: {
        expenseId: 'a',
        allocations: [{ invoiceId: '1', amount: '200.00' }],
        expectedRevision: 3,
      },
    });
    expect(preparerRattachement(null, f.imputations)).toMatchObject({
      ok: false,
      champs: { expenseId: expect.any(String) },
    });
  });
});

describe('doublons probables', () => {
  it('phrase claire, sans rien annuler', () => {
    const p = phraseDoublon({
      code: 'POSSIBLE_DUPLICATE_EXPENSE',
      paymentId: 'p1',
      expenseId: 'e1',
      supplierId: 's1',
      currency: 'USD',
      amount: '200.00',
      daysApart: 2,
      supplierName: 'Socimex',
      paymentNumber: 'PF2610-000003',
      expenseLabel: 'Ramettes',
    });
    expect(p).toBe(
      '200,00 USD chez Socimex : le paiement PF2610-000003 et la dépense « Ramettes », à 2 jours d’écart. Vérifiez qu’il ne s’agit pas de la même sortie d’argent ; rien n’est annulé automatiquement.',
    );
    expect(
      phraseDoublon({
        code: 'POSSIBLE_DUPLICATE_EXPENSE',
        paymentId: 'p1',
        expenseId: 'e1',
        supplierId: 's1',
        currency: 'CDF',
        amount: '10.00',
        daysApart: 0,
      }),
    ).toMatch(
      /ce fournisseur : un paiement fournisseur et une dépense saisie à la main, le même jour/,
    );
  });
});
