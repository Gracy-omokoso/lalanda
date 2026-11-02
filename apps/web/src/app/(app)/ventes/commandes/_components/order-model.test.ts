import { describe, expect, it } from 'vitest';

import type { OrderInvoicingView } from '@/lib/api-sales-contracts';

import { formulaireVide, ligneVide } from '../../factures/_components/invoice-model';

import {
  metaVide,
  preparerCommande,
  preparerFacturation,
  quantitesProposees,
  tonCommande,
} from './order-model';

const invoicing: OrderInvoicingView = {
  version: '1.0.0',
  status: 'partially_invoiced',
  closeSuggested: false,
  lines: [
    {
      lineRef: 'L1',
      ordered: '10',
      invoiced: '6',
      credited: '0',
      inDraft: '0',
      remainingToInvoice: '4',
      remainingToPrepare: '4',
      overInvoiced: '0',
    },
    {
      lineRef: 'L2',
      ordered: '1',
      invoiced: '1',
      credited: '0',
      inDraft: '0',
      remainingToInvoice: '0',
      remainingToPrepare: '0',
      overInvoiced: '0',
    },
  ],
  issues: [],
};

describe('reste à facturer (critère 4)', () => {
  it('propose ce qui reste à préparer, lignes soldées exclues', () => {
    expect(quantitesProposees(invoicing)).toEqual({ L1: '4' });
    expect(quantitesProposees(null)).toEqual({});
  });
  it('corps : quantités en chaînes ; un dépassement est signalé, pas corrigé', () => {
    const r = preparerFacturation({
      expectedRevision: 2,
      type: 'FV',
      quantites: { L1: '5', L2: '' },
      invoicing,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.corps).toEqual({
      expectedRevision: 2,
      type: 'FV',
      lines: [{ lineRef: 'L1', quantity: '5' }],
    });
    expect(r.avertissements).toHaveLength(1);
  });
  it('refuse une préparation vide ou mal formée', () => {
    const vide = preparerFacturation({ expectedRevision: 2, type: 'FV', quantites: {}, invoicing });
    expect(!vide.ok && vide.champs['lines']).toBeTruthy();
    const mal = preparerFacturation({
      expectedRevision: 2,
      type: 'EV',
      quantites: { L1: '0' },
      invoicing,
    });
    expect(!mal.ok && mal.champs['L1']).toBeTruthy();
  });
});

describe('saisie d’une commande (§ 2.2)', () => {
  it('client enregistré obligatoire ; dates au format AAAA-MM-JJ', () => {
    const r = preparerCommande(
      { ...formulaireVide(), priceMode: 'ttc', client: { mode: 'comptoir', nom: 'X' } },
      { ...metaVide('2027-01-15'), orderedOn: '15/01/2027' },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.champs['customer']).toBeDefined();
    expect(r.champs['orderedOn']).toBeDefined();
  });
  it('rend le corps avec les lignes au format du brouillon de facture', () => {
    const ligne = {
      ...ligneVide('free'),
      name: 'Formation',
      itemType: 'SER' as const,
      taxGroup: 'B' as const,
      quantite: '10',
      prix: '100',
    };
    const r = preparerCommande(
      {
        ...formulaireVide(),
        priceMode: 'ht',
        currency: 'USD',
        client: { mode: 'fiche', customerId: 'c1', nom: 'Client', printContactDetails: false },
        lignes: [ligne],
      },
      { ...metaVide('2027-01-15'), customerReference: ' BC-42 ' },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.corps).toMatchObject({
      orderedOn: '2027-01-15',
      customerReference: 'BC-42',
      requestedDeliveryDate: null,
      notes: null,
      currency: 'USD',
      priceMode: 'ht',
      customer: { customerId: 'c1', printContactDetails: false },
    });
    expect(r.corps.lines).toHaveLength(1);
    expect(r.corps.lines[0]).toMatchObject({ source: 'free', quantity: '10', unitPrice: '100' });
  });
  it('ton : une commande confirmée facturée en partie attire l’œil', () => {
    expect(tonCommande('confirmed', 'partially_invoiced')).toBe('attention');
    expect(tonCommande('draft', null)).toBe('neutre');
  });
});
