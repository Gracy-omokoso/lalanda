// Adaptateurs GROW (ADR-0032 § 2, § 6) : recopie des champs, choix du projet de
// référence, retrait des noms de clients.

import { computeInvestorIndicators } from '@lalanda/engine';
import { describe, expect, it } from 'vitest';

import {
  pickReferenceProject,
  toGrowActuals,
  toGrowSalesDocument,
  withoutCustomerNames,
  type InvoiceForGrow,
} from './grow-sources.js';

const invoice = (p: Partial<InvoiceForGrow> = {}): InvoiceForGrow => ({
  _id: 'inv1',
  type: 'FV',
  status: 'normalized',
  series: 'real',
  issuedAt: new Date('2026-09-10T09:00:00.000Z'),
  currency: 'USD',
  customer: { customerId: 'c1', name: 'Alpha SARL' },
  lines: [{ catalogItemId: 'abo' }, { catalogItemId: null }],
  documentAmounts: { calculation: { totals: { groups: [{ group: 'B', ht: '100.00' }] } } },
  normalizedAmounts: {
    currency: 'CDF',
    calculation: { groups: [{ group: 'B', ht: '280000.00' }] },
  },
  ...p,
});

describe('toGrowSalesDocument', () => {
  it('recopie devise, montants normalisés CDF, client et articles des lignes', () => {
    expect(toGrowSalesDocument(invoice())).toEqual({
      id: 'inv1',
      type: 'FV',
      status: 'normalized',
      series: 'real',
      issuedAt: '2026-09-10T09:00:00.000Z',
      customerKey: 'c1',
      customerName: 'Alpha SARL',
      amounts: [
        { currency: 'USD', groups: [{ group: 'B', ht: '100.00' }] },
        { currency: 'CDF', groups: [{ group: 'B', ht: '280000.00' }] },
      ],
      lineCatalogItemIds: ['abo', null],
    });
  });

  it('document sans montants calculés : écarté (jamais un zéro)', () => {
    expect(toGrowSalesDocument(invoice({ documentAmounts: null }))).toBeNull();
  });
});

describe('pickReferenceProject', () => {
  const p1 = { _id: 'a', name: 'A', deviseAffichage: 'USD' };
  const p2 = { _id: 'b', name: 'B', deviseAffichage: 'CDF' };

  it('choix de l’utilisateur, sinon seul projet, sinon raison', () => {
    expect(pickReferenceProject([p1, p2], 'b')).toEqual({ project: p2, selection: 'declared' });
    expect(pickReferenceProject([p1], null)).toEqual({ project: p1, selection: 'only_project' });
    expect(pickReferenceProject([p1, p2], null)).toEqual({
      project: null,
      reason: 'PROJET_DE_REFERENCE_A_CHOISIR',
    });
    expect(pickReferenceProject([], null)).toEqual({ project: null, reason: 'AUCUN_PROJET' });
    // Projet choisi puis supprimé : le choix ne vaut plus.
    expect(pickReferenceProject([p1, p2], 'zzz')).toMatchObject({ project: null });
  });

  it('le réalisé ne garde que les valeurs numériques', () => {
    const actuals = toGrowActuals(pickReferenceProject([p1], null), [
      {
        year: 1,
        month: 2,
        status: 'closed',
        closedAt: new Date('2026-03-01T00:00:00Z'),
        values: { ca: 10, note: 'x', vide: null },
      },
    ]);
    expect(actuals).toMatchObject({
      kind: 'project',
      currency: 'USD',
      periods: [{ year: 1, month: 2, closedAt: '2026-03-01T00:00:00.000Z', values: { ca: 10 } }],
    });
  });
});

describe('withoutCustomerNames', () => {
  it('retire noms et identifiants des premiers clients, garde les parts', () => {
    const doc = (month: string, key: string, ht: string) =>
      toGrowSalesDocument(
        invoice({
          _id: `${month}-${key}`,
          status: 'issued',
          issuedAt: new Date(`${month}-15T12:00:00Z`),
          customer: { customerId: key, name: `Nom ${key}` },
          normalizedAmounts: null,
          documentAmounts: { calculation: { totals: { groups: [{ group: 'B', ht }] } } },
        }),
      )!;
    const r = computeInvestorIndicators({
      asOf: '2026-10-21',
      actuals: { kind: 'none', reason: 'AUCUN_PROJET' },
      sales: [
        doc('2026-07', 'a', '300.00'),
        doc('2026-08', 'b', '100.00'),
        doc('2026-09', 'a', '100.00'),
      ],
      declaredCash: null,
      recurringCatalogItemIds: [],
    });
    const stripped = withoutCustomerNames(r).indicateurs.concentration_clients;
    expect(stripped).toMatchObject({ disponible: true, valeur: 0.8 });
    if (stripped.disponible) {
      expect(stripped.premiersClients).toEqual([
        { rang: 1, cle: 'client-1', nom: null, montant: 400, part: 0.8 },
        { rang: 2, cle: 'client-2', nom: null, montant: 100, part: 0.2 },
      ]);
    }
    expect(JSON.stringify(withoutCustomerNames(r))).not.toMatch(/Nom a|Nom b/);
  });
});
