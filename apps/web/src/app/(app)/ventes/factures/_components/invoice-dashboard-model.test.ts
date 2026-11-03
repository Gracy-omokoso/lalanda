// Mise en forme du tableau de bord des factures (ADR-0056) : aucun calcul, des
// libellés, des couleurs et des écritures lisibles à partir de la réponse serveur.

import type { InvoiceStats } from '@lalanda/shared/sales-invoices';
import { describe, expect, it } from 'vitest';

import type { SettlementView } from '@/lib/api';

import {
  cartesChiffres,
  compact,
  compteursFiltres,
  dateCourte,
  joursEntre,
  moisCourt,
  moisLong,
  montantEntier,
  noteDevise,
  noteExclusions,
  statutLigne,
  tranchesStatut,
  typeAffiche,
} from './invoice-dashboard-model';

const NB = ' ';

const stats = (over: Partial<InvoiceStats> = {}): InvoiceStats => ({
  currency: 'CDF',
  currencySource: 'default_cdf',
  asOf: '2026-11-03',
  from: '2025-12',
  to: '2026-11',
  months: [
    {
      month: '2026-10',
      billed: '1000.00',
      collected: '400.00',
      outstanding: '600.00',
      overdue: '0.00',
    },
    {
      month: '2026-11',
      billed: '-300.00',
      collected: '250.00',
      outstanding: '50.00',
      overdue: '50.00',
    },
  ],
  totals: {
    billed: '700.00',
    collected: '650.00',
    collectedRatePercent: 93,
    invoiceCount: 1,
    creditNoteCount: 1,
  },
  outstanding: { amount: '50.00', count: 1 },
  overdue: { amount: '50.00', count: 1 },
  categories: [
    { category: 'paid', count: 0 },
    { category: 'to_collect', count: 0 },
    { category: 'overdue', count: 1 },
    { category: 'draft', count: 2 },
    { category: 'pending_normalization', count: 0 },
    { category: 'normalization_failed', count: 0 },
    { category: 'credit_note', count: 1 },
    { category: 'other_final', count: 0 },
  ],
  statusCounts: {
    all: 4,
    draft: 2,
    issued: 2,
    pending_normalization: 0,
    normalized: 0,
    normalization_failed: 0,
    final: 2,
  },
  topCustomers: [],
  excluded: { deposits: 0, testSeries: 0, notConvertible: [] },
  truncated: false,
  version: '1.0.0',
  ...over,
});

const reglement = (over: Partial<SettlementView>): SettlementView =>
  ({
    invoiceId: 'f',
    number: 'IN2611-000001',
    type: 'FV',
    currency: 'CDF',
    customerName: null,
    issuedOn: '2026-10-01',
    total: '100.00',
    dueDate: null,
    status: 'unpaid',
    reason: null,
    settlement: null,
    asOf: '2026-11-03',
    ...over,
  }) as SettlementView;

describe('écritures', () => {
  it('mois courts et longs, valeur illisible rendue telle quelle', () => {
    expect(moisCourt('2026-10')).toBe('oct.');
    expect(moisLong('2025-12')).toBe('décembre 2025');
    expect(moisCourt('2026-13')).toBe('2026-13');
  });

  it('montant entier : arrondi d’affichage sur la chaîne, groupes insécables, signe', () => {
    expect(montantEntier('4812300.40', 'CDF')).toBe(`4${NB}812${NB}300${NB}CDF`);
    expect(montantEntier('99.50', 'USD')).toBe(`100${NB}USD`);
    expect(montantEntier('-300.00', 'CDF')).toBe(`−300${NB}CDF`);
    expect(montantEntier('0.00', 'CDF')).toBe(`0${NB}CDF`);
    expect(montantEntier('n/a', 'CDF')).toBe(`n/a${NB}CDF`);
  });

  it('compact : M, k, Md, négatif', () => {
    expect(compact(12_900_000)).toBe(`12,9${NB}M`);
    expect(compact(15_000_000)).toBe(`15${NB}M`);
    expect(compact(348_000)).toBe(`348${NB}k`);
    expect(compact(2_300_000_000)).toBe(`2,3${NB}Md`);
    expect(compact(-300)).toBe('−300');
    expect(compact(0)).toBe('0');
  });

  it('date courte au jour de Kinshasa', () => {
    expect(dateCourte('2026-11-02T23:30:00.000Z')).toBe('03/11/2026');
    expect(dateCourte(null)).toBe('—');
  });

  it('jours entre deux dates civiles', () => {
    expect(joursEntre('2026-10-29', '2026-11-03')).toBe(5);
    expect(joursEntre('x', '2026-11-03')).toBeNull();
  });
});

describe('cartes, anneau et compteurs', () => {
  it('quatre cartes dans l’ordre, retard en alerte, séries du serveur', () => {
    const c = cartesChiffres(stats());
    expect(c.map((x) => x.id)).toEqual(['facture', 'encaisse', 'reste', 'retard']);
    expect(c[0]!.valeur).toBe(`700${NB}CDF`);
    expect(c[0]!.note).toBe('1 facture · 1 avoir déduit');
    expect(c[0]!.serie).toEqual([1000, -300]);
    expect(c[1]!.note).toBe(`93${NB}% du facturé`);
    expect(c[3]!.ton).toBe('alerte');
    expect(c[3]!.serie).toEqual([0, 50]);
  });

  it('rien de facturé, aucun retard', () => {
    const c = cartesChiffres(
      stats({
        totals: {
          billed: '0.00',
          collected: '0.00',
          collectedRatePercent: null,
          invoiceCount: 0,
          creditNoteCount: 0,
        },
        overdue: { amount: '0.00', count: 0 },
      }),
    );
    expect(c[1]!.note).toBe('Rien de facturé sur la période');
    expect(c[3]!.ton).toBe('normal');
    expect(c[3]!.note).toBe('Aucune échéance dépassée');
  });

  it('anneau : une part par catégorie, libellé écrit', () => {
    const t = tranchesStatut(stats());
    expect(t).toHaveLength(8);
    expect(t.find((x) => x.id === 'overdue')).toMatchObject({
      label: 'En retard',
      value: 1,
      color: 4,
    });
  });

  it('compteurs des onglets = compteurs du serveur', () => {
    expect(compteursFiltres(stats())).toEqual({
      all: 4,
      draft: 2,
      pending_normalization: 0,
      normalization_failed: 0,
      final: 2,
    });
  });

  it('notes de devise et d’exclusions', () => {
    expect(noteDevise(stats())).toContain('en CDF');
    expect(noteDevise(stats({ currencySource: 'accounting_book' }))).toContain('monnaie de tenue');
    expect(noteExclusions(stats())).toBeNull();
    expect(
      noteExclusions(
        stats({
          excluded: {
            deposits: 1,
            testSeries: 0,
            notConvertible: [{ currency: 'USD', count: 2, total: '185.60' }],
          },
        }),
      ),
    ).toBe(
      `2 documents en USD sans taux figé (186${NB}USD) non convertis ; 1 acompte hors facturé.`,
    );
  });
});

describe('statut d’une ligne', () => {
  it('états du document avant le règlement', () => {
    expect(statutLigne({ status: 'draft', type: 'FV' }, undefined)).toEqual({
      ton: 'draft',
      label: 'Brouillon',
    });
    expect(statutLigne({ status: 'pending_normalization', type: 'FV' }, undefined).ton).toBe(
      'wait',
    );
    expect(statutLigne({ status: 'normalization_failed', type: 'FV' }, undefined).ton).toBe('late');
    expect(statutLigne({ status: 'issued', type: 'FA' }, undefined).label).toBe('Avoir émis');
  });

  it('règlement : payée, à encaisser, en partie, en retard de N jours', () => {
    const doc = { status: 'issued' as const, type: 'FV' as const };
    expect(statutLigne(doc, reglement({ status: 'paid' }))).toEqual({ ton: 'ok', label: 'Payée' });
    expect(statutLigne(doc, reglement({ status: 'unpaid' })).label).toBe('À encaisser');
    expect(statutLigne(doc, reglement({ status: 'partially_paid' })).label).toBe('Payée en partie');
    expect(statutLigne(doc, reglement({ status: 'overdue', dueDate: '2026-10-29' }))).toEqual({
      ton: 'late',
      label: `En retard${NB}·${NB}5${NB}j`,
    });
    expect(statutLigne(doc, undefined).label).toBe('Émise');
    expect(statutLigne({ status: 'normalized', type: 'FV' }, undefined).label).toBe('Normalisée');
  });

  it('type affiché : pro forma tant que non définitif', () => {
    expect(typeAffiche({ status: 'draft', type: 'FV' })).toBe('Pro forma');
    expect(typeAffiche({ status: 'issued', type: 'FV' })).toBe('Facture');
    expect(typeAffiche({ status: 'normalized', type: 'EA' })).toBe('Avoir export');
  });
});
