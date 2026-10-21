// Définitions des cas d'homologation (ADR-0026) : cohérence interne, sans base
// ni réseau. Le jeu complet contre le faux serveur e-MCF est
// `__tests__/invoices.homologation.e2e.test.ts`.

import { isItemTypeAllowed } from '@lalanda/engine';
import { describe, expect, it } from 'vitest';

import {
  HOMOLOGATION_CASES,
  HOMOLOGATION_CHAINS,
  HOMOLOGATION_CUSTOMERS,
  homologationCase,
  homologationDraftBody,
  homologationPaymentMethods,
  homologationPayments,
} from './homologation-cases.js';

describe('cas d’homologation DGI (v1.2)', () => {
  it('29 cas, numérotés 1 à 29 dans l’ordre', () => {
    expect(HOMOLOGATION_CASES.map((c) => c.number)).toEqual(
      Array.from({ length: 29 }, (_, i) => i + 1),
    );
  });

  it('enchaînements 1→10, 3→11, 6→12, 15→16 : l’origine précède l’avoir et en a le type', () => {
    expect(HOMOLOGATION_CHAINS).toEqual([
      [1, 10],
      [3, 11],
      [6, 12],
      [15, 16],
    ]);
    for (const [origin, credit] of HOMOLOGATION_CHAINS) {
      const o = homologationCase(origin);
      const c = homologationCase(credit);
      expect(origin).toBeLessThan(credit);
      expect(c.credit).toMatchObject({ originCase: origin });
      expect(c.customer).toBe(o.customer);
      expect(c.type).toBe(o.type === 'EV' ? 'EA' : 'FA');
      // Lignes reprises : même groupe, quantité ≤ vendue.
      if (c.credit && c.credit.nature !== 'RRR') {
        c.credit.lines.forEach((l, i) => {
          const sold = o.lines[l.originLineIndex]!;
          expect(c.expected.groups[i]).toBe(sold.taxGroup);
          expect(Number(l.quantity)).toBeLessThanOrEqual(Number(sold.quantity));
        });
      }
    }
  });

  it('natures d’avoir : RAN (10, 16), RAM (11), COR (12), RRR sans origine (13)', () => {
    expect(
      HOMOLOGATION_CASES.filter((c) => c.credit).map((c) => [c.number, c.credit!.nature]),
    ).toEqual([
      [10, 'RAN'],
      [11, 'RAM'],
      [12, 'COR'],
      [13, 'RRR'],
      [16, 'RAN'],
    ]);
  });

  it('chaque ligne respecte le type d’article admis par son groupe (TAX ⇔ L, N)', () => {
    for (const c of HOMOLOGATION_CASES) {
      for (const l of c.lines) {
        expect(isItemTypeAllowed(l.taxGroup, l.itemType), `cas ${c.number} ${l.name}`).toBe(true);
      }
      if (c.lines.length > 0) {
        expect(c.lines.map((l) => l.taxGroup)).toEqual(c.expected.groups);
        expect(c.lines.map((l) => l.itemType)).toEqual(c.expected.itemTypes);
      }
    }
  });

  it('les seize groupes A à P sont couverts', () => {
    const groups = new Set(HOMOLOGATION_CASES.flatMap((c) => c.expected.groups));
    expect([...groups].sort().join('')).toBe('ABCDEFGHIJKLMNOP');
  });

  it('types de client PP, PM, PC, PL, AO ; données fictives marquées TEST', () => {
    expect(new Set(HOMOLOGATION_CASES.map((c) => c.customer))).toEqual(
      new Set(['PP', 'PM', 'PC', 'PL', 'AO']),
    );
    for (const c of HOMOLOGATION_CUSTOMERS) {
      expect(c.name).toContain('TEST');
      expect(c.nif.startsWith('TEST')).toBe(true);
    }
    for (const c of HOMOLOGATION_CASES) for (const l of c.lines) expect(l.name).toContain('TEST');
  });

  it('six moyens de paiement couverts, plusieurs par facture, un seul solde par cas', () => {
    expect(homologationPaymentMethods()).toEqual(
      expect.arrayContaining([
        'ESPECES',
        'VIREMENT',
        'CARTEBANCAIRE',
        'MOBILEMONEY',
        'CHEQUES',
        'CREDIT',
      ]),
    );
    expect(HOMOLOGATION_CASES.some((c) => c.payments.length > 1)).toBe(true);
    for (const c of HOMOLOGATION_CASES) {
      expect(c.payments.filter((p) => p.amount === 'remainder')).toHaveLength(1);
    }
  });

  it('paiements : montants fixes conservés, solde exact (moteur)', () => {
    expect(homologationPayments(homologationCase(1), '1028600.00')).toEqual([
      { method: 'ESPECES', amount: '100000.00' },
      { method: 'VIREMENT', amount: '928600.00' },
    ]);
    expect(homologationPayments(homologationCase(2), '15000.00')).toEqual([
      { method: 'CARTEBANCAIRE', amount: '15000.00' },
    ]);
    expect(() => homologationPayments(homologationCase(1), '50000.00')).toThrow(/Cas 1/);
  });

  it('corps de brouillon : client de comptoir pour PP, lignes d’origine pour un avoir rattaché, RRR sans origine', () => {
    const ctx = {
      customerIds: { PM: 'pm', PC: 'pc', PL: 'pl', AO: 'ao' },
      originInvoiceId: (n: number) => `origine-${n}`,
      pointOfSaleId: null,
    };
    expect(homologationDraftBody(homologationCase(5), 'ttc', ctx).customer).toEqual({
      customerId: null,
      walkIn: { name: 'TEST HOMOLOGATION Particulier' },
    });
    const avoir = homologationDraftBody(homologationCase(12), 'ht', ctx);
    expect(avoir).toMatchObject({
      type: 'FA',
      priceMode: 'ht',
      currency: 'CDF',
      customer: { customerId: 'pc' },
      creditNote: { nature: 'COR', originInvoiceId: 'origine-6' },
      lines: [{ source: 'origin', originLineIndex: 0, quantity: '1' }],
    });
    const rrr = homologationDraftBody(homologationCase(13), 'ttc', ctx);
    expect(rrr.creditNote).toEqual({ nature: 'RRR', originInvoiceId: null });
    expect(rrr.lines.every((l) => l.source === 'free')).toBe(true);
    expect(homologationDraftBody(homologationCase(26), 'ttc', ctx).showUsdCounterValue).toBe(true);
    expect(() =>
      homologationDraftBody(homologationCase(1), 'ttc', { ...ctx, customerIds: {} }),
    ).toThrow(/PM/);
  });
});
