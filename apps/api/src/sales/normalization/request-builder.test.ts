// Correspondance contenu figé → requête e-MCF (« golden ») — ADR-0024 § 1.

import { computeInvoiceTotals, type InvoiceLineInput } from '@lalanda/engine';
import { describe, expect, it } from 'vitest';

import type { InvoiceLean, StoredLine } from '../invoices/invoice.types.js';
import { buildEdefInvoiceRequest, type EdefRequestRefs } from './request-builder.js';

const RATES = { A: '0', B: '16', L: '0' } as const;

const REFS: EdefRequestRefs = {
  clientTypes: [
    { type: 'PP', description: 'Personne physique (fictif)' },
    { type: 'PM', description: 'Personne morale (fictif)' },
  ],
  referenceTypes: [{ type: 'COR', description: 'Correction (fictif)' }],
};

function line(i: number, over: Partial<StoredLine> = {}): StoredLine {
  return {
    index: i,
    source: 'free',
    catalogItemId: null,
    originLineIndex: null,
    code: `C${i}`,
    edefCode: `C${i}`,
    name: `Article ${i}`,
    unit: null,
    itemType: 'BIE',
    taxGroup: 'B',
    outOfScope: false,
    specificTax: null,
    quantity: '2',
    originalPrice: null,
    discount: null,
    unitPrice: '100.00',
    priceModification: null,
    priceOverridden: false,
    ...over,
  };
}

function doc(over: Partial<InvoiceLean> = {}, lines: StoredLine[] = [line(0)]): InvoiceLean {
  const engineLines: InvoiceLineInput[] = lines.map((l) => ({
    unitPrice: l.unitPrice,
    quantity: l.quantity,
    taxGroup: l.taxGroup,
    itemType: l.itemType,
    specificTax: l.specificTax,
  }));
  const r = computeInvoiceTotals({ priceMode: 'ht', lines: engineLines, rates: RATES });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return {
    _id: '0123456789abcdef01234567',
    organizationId: 'org',
    status: 'pending_normalization',
    type: 'FV',
    priceMode: 'ht',
    isf: 'ISF-TEST',
    seller: { nif: 'A0000000X' },
    operator: { userId: 'u1', name: 'Opératrice' },
    customer: {
      customerId: 'c1',
      type: 'PM',
      name: 'Client SARL',
      nif: 'T01',
      exemptionReference: null,
      phone: '+243 800',
      email: 'a@b.cd',
      address: 'Gombe',
      printContactDetails: false,
    },
    lines,
    comments: { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null },
    creditNote: null,
    normalizedAmounts: {
      currency: 'CDF',
      lines: lines.map((l) => ({
        index: l.index,
        unitPrice: l.unitPrice,
        originalPrice: l.originalPrice,
        priceModification: l.priceModification,
        specificTax: l.specificTax,
      })),
      payments: [{ method: 'VIREMENT', amount: r.totals.total }],
      calculation: r.totals,
      counterValueUsd: null,
    },
    ...over,
  } as unknown as InvoiceLean;
}

describe('buildEdefInvoiceRequest', () => {
  it('facture de vente minimale : forme exacte, montants CDF en nombres JSON', () => {
    const { body } = buildEdefInvoiceRequest(doc(), 'TEST-2026-000001', REFS);
    expect(body).toEqual({
      nif: 'A0000000X',
      rn: 'TEST-2026-000001',
      mode: 'ht',
      isf: 'ISF-TEST',
      type: 'FV',
      items: [
        { code: 'C0', name: 'Article 0', type: 'BIE', price: 100, quantity: 2, taxGroup: 'B' },
      ],
      client: { type: 'PM', typeDesc: 'Personne morale (fictif)', name: 'Client SARL', nif: 'T01' },
      operator: { name: 'Opératrice' },
      payment: [{ name: 'VIREMENT', amount: 232 }],
    });
  });

  it('coordonnées du client seulement si printContactDetails', () => {
    const d = doc();
    const avec = buildEdefInvoiceRequest(
      doc({ customer: { ...d.customer, printContactDetails: true } }),
      'R',
      REFS,
    ).body;
    expect(avec.client).toMatchObject({ contact: '+243 800; a@b.cd', address: 'Gombe' });
  });

  it('client de comptoir PP sans nom ni NIF : champs omis', () => {
    const d = doc();
    const body = buildEdefInvoiceRequest(
      doc({ customer: { ...d.customer, type: 'PP', name: null, nif: null } }),
      'R',
      REFS,
    ).body;
    expect(body.client).toEqual({ type: 'PP', typeDesc: 'Personne physique (fictif)' });
  });

  it('remise, taxe spécifique, commentaires, contre-valeur USD', () => {
    const lines = [
      line(0, { originalPrice: '120.00', priceModification: 'Remise 20', unitPrice: '100.00' }),
      line(1, {
        specificTax: { kind: 'per_unit', amount: '5.00' },
        edefCode: null,
      }),
    ];
    const base = doc({}, lines);
    const body = buildEdefInvoiceRequest(
      {
        ...base,
        comments: { ...base.comments, A: 'Merci', C: 'Livraison' },
        normalizedAmounts: {
          ...base.normalizedAmounts!,
          counterValueUsd: { amount: '0.20', rate: '2262.32', date: '2026-10-19T00:00:00+01:00' },
        },
      },
      'R',
      REFS,
    ).body;
    expect(body.items[0]).toMatchObject({ originalPrice: 120, priceModification: 'Remise 20' });
    expect(body.items[1]).toMatchObject({ code: null, taxSpecificValue: expect.any(String) });
    expect(typeof body.items[1]!.taxSpecificAmount).toBe('number');
    expect(body.items[0]).not.toHaveProperty('taxSpecificValue');
    expect(body).toMatchObject({
      cmta: 'Merci',
      cmtc: 'Livraison',
      curCode: 'USD',
      curRate: 2262.32,
      curDate: '2026-10-19T00:00:00+01:00',
    });
    expect(body).not.toHaveProperty('cmtb');
    // Aucun montant USD hors `curRate` : pas de curTotal envoyé.
    expect(body).not.toHaveProperty('curTotal');
  });

  it('avoir : référence DGI de l’origine, nature et libellé', () => {
    const body = buildEdefInvoiceRequest(
      doc({
        type: 'FA',
        creditNote: {
          nature: 'COR',
          originInvoiceId: 'x',
          originNumber: 'TEST-2026-000001',
          reference: 'DEF-ORIGINE',
        },
      }),
      'R',
      REFS,
    ).body;
    expect(body).toMatchObject({
      type: 'FA',
      reference: 'DEF-ORIGINE',
      referenceType: 'COR',
      referenceDesc: 'Correction (fictif)',
    });
  });

  it('même corps et même empreinte à chaque construction', () => {
    const a = buildEdefInvoiceRequest(doc(), 'R', REFS);
    const b = buildEdefInvoiceRequest(doc(), 'R', REFS);
    expect(a.json).toBe(b.json);
    expect(a.sha256).toBe(b.sha256);
  });

  it('prérequis manquants : ISF, listes, référence d’avoir', () => {
    expect(() => buildEdefInvoiceRequest(doc({ isf: null }), 'R', REFS)).toThrow(
      expect.objectContaining({ code: 'ISF_NOT_CONFIGURED' }),
    );
    expect(() => buildEdefInvoiceRequest(doc(), 'R', null)).toThrow(
      expect.objectContaining({ code: 'REFERENCE_LISTS_UNAVAILABLE' }),
    );
    expect(() =>
      buildEdefInvoiceRequest(
        doc({
          type: 'FA',
          creditNote: { nature: 'COR', originInvoiceId: 'x', originNumber: null, reference: null },
        }),
        'R',
        REFS,
      ),
    ).toThrow(expect.objectContaining({ code: 'CREDIT_NOTE_REFERENCE_MISSING' }));
  });
});
