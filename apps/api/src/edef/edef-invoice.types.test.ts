// Schémas des routes de facturation e-MCF — ADR-0024 § 2 (jalon F0).

import { describe, expect, it } from 'vitest';

import {
  EdefCancelledSchema,
  EdefInvoiceDetailsSchema,
  EdefInvoiceRequestSchema,
  EdefInvoiceSubmittedSchema,
  EdefPendingRequestsSchema,
  EdefSecurityElementsSchema,
  type EdefInvoiceRequest,
} from './edef-invoice.types.js';

const SECURITY = {
  dateTime: '2026-10-19 10:00:00',
  qrCode: 'DEF|...',
  codeDEFDGI: 'ABCD-EFGH-IJKL',
  counters: '12/12 FV',
  nim: 'NIM-TEST-01',
};

describe('EdefInvoiceSubmittedSchema', () => {
  it('garde la réponse brute intacte (nombres JSON) à côté de l’uid', () => {
    const parsed = EdefInvoiceSubmittedSchema.parse({ uid: 'u-1', taa: 64.005, total: 464.01 });
    expect(parsed.uid).toBe('u-1');
    expect(parsed.raw).toEqual({ uid: 'u-1', taa: 64.005, total: 464.01 });
  });

  it('uid absent ou vide : non conforme', () => {
    expect(EdefInvoiceSubmittedSchema.safeParse({ total: 1 }).success).toBe(false);
    expect(EdefInvoiceSubmittedSchema.safeParse({ uid: '' }).success).toBe(false);
  });
});

describe('EdefSecurityElementsSchema', () => {
  it('rend les cinq éléments tels que reçus', () => {
    expect(EdefSecurityElementsSchema.parse(SECURITY)).toEqual({
      codeDefDgi: 'ABCD-EFGH-IJKL',
      nim: 'NIM-TEST-01',
      counters: '12/12 FV',
      dateTime: '2026-10-19 10:00:00',
      qrCode: 'DEF|...',
    });
  });

  it('un élément vide ou absent : non conforme, jamais une normalisation', () => {
    expect(EdefSecurityElementsSchema.safeParse({ ...SECURITY, codeDEFDGI: '' }).success).toBe(
      false,
    );
    expect(EdefSecurityElementsSchema.safeParse({ ...SECURITY, qrCode: null }).success).toBe(
      false,
    );
  });
});

describe('EdefInvoiceDetailsSchema', () => {
  it('security nul si secElements est absent ou incomplet', () => {
    expect(EdefInvoiceDetailsSchema.parse({ rn: 'TEST-2026-000001', nif: 'A1' }).security).toBe(
      null,
    );
    expect(
      EdefInvoiceDetailsSchema.parse({ rn: 'R', secElements: { ...SECURITY, nim: null } })
        .security,
    ).toBe(null);
  });

  it('security renseigné quand les cinq éléments sont présents', () => {
    const parsed = EdefInvoiceDetailsSchema.parse({
      rn: 'R',
      nif: 'N',
      totals: { total: 10 },
      secElements: SECURITY,
    });
    expect(parsed.totals).toEqual({ total: 10 });
    expect(parsed.security?.codeDefDgi).toBe('ABCD-EFGH-IJKL');
  });
});

describe('EdefPendingRequestsSchema et EdefCancelledSchema', () => {
  it('liste des demandes en attente, entrées sans uid écartées', () => {
    expect(
      EdefPendingRequestsSchema.parse({
        status: true,
        pendingRequestsCount: 2,
        pendingRequestsList: [
          { date: '2026-10-19T10:00:00', uid: 'u-1' },
          { date: '2026-10-19T10:00:01', uid: null },
        ],
      }),
    ).toEqual({ count: 2, list: [{ uid: 'u-1', date: '2026-10-19T10:00:00' }] });
    expect(EdefPendingRequestsSchema.parse({ pendingRequestsCount: 0 })).toEqual({
      count: 0,
      list: [],
    });
  });

  it('annulation : dateTime facultatif', () => {
    expect(EdefCancelledSchema.parse({})).toEqual({ dateTime: null });
  });
});

describe('EdefInvoiceRequestSchema', () => {
  const body: EdefInvoiceRequest = {
    nif: 'A1234567B',
    rn: 'TEST-2026-000001',
    mode: 'ttc',
    isf: 'TEST-01',
    type: 'FV',
    items: [
      { code: null, name: 'Article', type: 'BIE', price: 1160, quantity: 1, taxGroup: 'B' },
    ],
    client: { type: 'PP' },
    operator: { name: 'Caisse 1' },
    payment: [{ name: 'ESPECES', amount: 1160 }],
  };

  it('accepte un corps minimal', () => {
    expect(EdefInvoiceRequestSchema.safeParse(body).success).toBe(true);
  });

  it('refuse un champ inconnu, un null à omettre, un groupe hors A–P', () => {
    expect(EdefInvoiceRequestSchema.safeParse({ ...body, extra: 1 }).success).toBe(false);
    expect(EdefInvoiceRequestSchema.safeParse({ ...body, cmta: null }).success).toBe(false);
    expect(
      EdefInvoiceRequestSchema.safeParse({
        ...body,
        items: [{ ...body.items[0], taxGroup: 'Q' }],
      }).success,
    ).toBe(false);
    expect(
      EdefInvoiceRequestSchema.safeParse({ ...body, operator: { id: 'u1', name: 'X' } }).success,
    ).toBe(false);
  });
});
