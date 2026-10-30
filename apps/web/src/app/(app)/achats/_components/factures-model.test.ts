import { describe, expect, it } from 'vitest';

import type {
  SupplierInvoiceVarianceView,
  SupplierInvoiceView,
} from '@/lib/api-purchases-payables';

import {
  RAISON_ECART_BLOQUANT,
  RAISON_FORCER_APPROBATEUR,
  RAISON_LITIGE,
  actionsFacture,
  doublonDe,
  ecartTotalDuRefus,
  ecartsAffiches,
  ecartsDuRefus,
  etatFacture,
  formulaireAvoir,
  formulaireDepuisCommande,
  formulaireFactureLibre,
  lireFiltreFactures,
  phraseRapprochement,
  preparerFacture,
  requeteFactures,
  verifierPiece,
} from './factures-model';

function facture(over: Partial<SupplierInvoiceView> = {}): SupplierInvoiceView {
  return {
    id: 'f1',
    internalNumber: 'FF2610-000001',
    supplierId: 's1',
    supplierName: 'Socimex',
    supplierReference: 'FA 001',
    kind: 'invoice',
    status: 'draft',
    matchingMode: 'three_way',
    matchingStatus: 'matched',
    currency: 'USD',
    invoiceDate: '2026-10-28',
    dueDate: '2026-11-27',
    total: '50.00',
    remaining: '50.00',
    settlementStatus: 'unpaid',
    disputed: false,
    forced: false,
    hasAttachment: false,
    orderIds: ['o1'],
    updatedAt: '2026-10-28T10:00:00.000Z',
    creditedInvoiceId: null,
    receivedOn: '2026-10-28',
    lines: [
      {
        orderLineId: 'l1',
        label: 'Ramettes',
        quantity: '10',
        unitPrice: '5.00',
        discountPercent: null,
        amount: '50.00',
      },
    ],
    subtotal: '50.00',
    taxes: [],
    deductibleVat: null,
    costAllocations: [{ category: 'achats', workProjectId: null, amount: '50.00' }],
    attachment: null,
    matching: { version: '1.0.0', mode: 'three_way', status: 'matched', variances: [], lines: [] },
    settlement: {
      status: 'unpaid',
      paid: '0.00',
      credited: '0.00',
      remaining: '50.00',
      overpaid: '0.00',
    },
    forcedValidation: null,
    dispute: null,
    validatedAt: null,
    validatedBy: null,
    cancellation: null,
    revision: 1,
    createdBy: 'u1',
    createdAt: '2026-10-28T10:00:00.000Z',
    ...over,
  };
}

const ecart = (over: Partial<SupplierInvoiceVarianceView> = {}): SupplierInvoiceVarianceView => ({
  code: 'QUANTITY_ABOVE_RECEIVED',
  blocking: true,
  orderId: 'o1',
  orderLineId: 'l1',
  invoiceLineIndex: 0,
  unit: 'quantity',
  expected: '6',
  actual: '10',
  difference: '4',
  ...over,
});

const MANAGE = ['purchase.read', 'purchase.manage'] as const;
const APPROVE = ['purchase.read', 'purchase.approve'] as const;
const TOUT = ['purchase.read', 'purchase.manage', 'purchase.approve', 'payables.pay'] as const;
const ids = (l: { id: string }[]) => l.map((x) => x.id);

describe('état d’une facture', () => {
  it('annulée, litige, écart, brouillon, puis règlement dérivé par l’API', () => {
    expect(etatFacture(facture({ status: 'cancelled', disputed: true })).libelle).toBe('Annulée');
    expect(etatFacture(facture({ disputed: true })).libelle).toBe('En litige');
    expect(etatFacture(facture({ matchingStatus: 'variance' }))).toEqual({
      libelle: 'En écart',
      ton: 'warning',
    });
    expect(etatFacture(facture()).libelle).toBe('Brouillon');
    expect(etatFacture(facture({ status: 'validated' })).libelle).toBe('Bonne à payer');
    expect(etatFacture(facture({ status: 'validated', forced: true })).libelle).toMatch(/forcée/);
    expect(
      etatFacture(facture({ status: 'validated', settlementStatus: 'partially_paid' })).libelle,
    ).toBe('Payée en partie');
    expect(etatFacture(facture({ status: 'validated', settlementStatus: 'paid' })).ton).toBe(
      'success',
    );
    expect(etatFacture(facture({ status: 'validated', kind: 'credit_note' })).libelle).toBe(
      'Avoir validé',
    );
  });
});

describe('liste', () => {
  it('filtres → requêtes de l’API', () => {
    expect(requeteFactures('ecart')).toEqual({ limit: 50, status: 'draft', matching: 'variance' });
    expect(requeteFactures('en-retard', 'c')).toEqual({ limit: 50, cursor: 'c', due: 'overdue' });
    expect(requeteFactures('litiges')).toEqual({ limit: 50, disputed: 'true' });
    expect(requeteFactures('toutes')).toEqual({ limit: 50 });
    expect(lireFiltreFactures('ecart')).toBe('ecart');
    expect(lireFiltreFactures('n-importe')).toBe('toutes');
    expect(lireFiltreFactures(null)).toBe('toutes');
  });
});

describe('rapprochement affiché', () => {
  it('bloquants d’abord, en français, valeurs de l’API mises en forme', () => {
    const e = ecartsAffiches(
      [
        ecart({
          code: 'TAXES_DIFFER_FROM_ORDER',
          blocking: false,
          unit: 'amount',
          invoiceLineIndex: null,
          orderLineId: null,
          expected: '0.00',
          actual: '8.00',
          difference: '8.00',
        }),
        ecart(),
        ecart({
          code: 'PRICE_ABOVE_ORDER',
          unit: 'unit_price',
          expected: '100.00',
          actual: '110.00',
          difference: '10.00',
        }),
        ecart({
          code: 'PRICE_BELOW_ORDER',
          blocking: false,
          unit: 'unit_price',
          expected: '5.00',
          actual: '4.50',
          difference: '-0.50',
        }),
      ],
      facture().lines,
      'USD',
    );
    expect(e.map((x) => x.bloquant)).toEqual([true, true, false, false]);
    expect(e[0]).toMatchObject({
      titre: 'Quantité facturée plus grande que la quantité reçue',
      ligne: 'Ramettes',
      attendu: '6',
      constate: '10',
      difference: '+4',
    });
    expect(e[1]!.difference).toBe('+10,00 USD');
    expect(e[2]!.ligne).toBe('Ensemble de la facture');
    expect(e[2]!.titre).toMatch(/pas un contrôle fiscal/);
    expect(e[3]!.difference).toBe('−0,50 USD');
  });

  it('code inconnu : libellé générique ; ligne de commande hors facture', () => {
    const [x] = ecartsAffiches(
      [ecart({ code: 'AUTRE', invoiceLineIndex: null, orderLineId: 'zz' })],
      [],
      'CDF',
    );
    expect(x!.titre).toBe('Écart signalé par le rapprochement');
    expect(x!.ligne).toBe('Ligne de la commande');
  });

  it('phrase de synthèse', () => {
    expect(phraseRapprochement({ status: 'not_applicable', variances: [] })).toMatch(
      /sans commande/,
    );
    expect(phraseRapprochement({ status: 'variance', variances: [ecart(), ecart()] })).toMatch(
      /^2 écarts bloquants/,
    );
    expect(
      phraseRapprochement({ status: 'matched', variances: [ecart({ blocking: false })] }),
    ).toMatch(/1 information/);
    expect(phraseRapprochement({ status: 'matched', variances: [] })).toBe(
      'Conforme à la commande.',
    );
  });
});

describe('refus de l’API', () => {
  it('doublon : identifiant de la facture existante', () => {
    const err = {
      status: 409,
      detail: { code: 'SUPPLIER_INVOICE_DUPLICATE', details: { invoiceId: 'f0' } },
    };
    expect(doublonDe(err)).toBe('f0');
    expect(doublonDe({ status: 409, detail: { code: 'AUTRE' } })).toBeNull();
    expect(doublonDe(new Error('x'))).toBeNull();
  });

  it('validation refusée : écarts bloquants portés par le refus', () => {
    const err = {
      status: 409,
      detail: { code: 'SUPPLIER_INVOICE_VARIANCE', details: { variances: [ecart()] } },
    };
    expect(ecartsDuRefus(err)).toHaveLength(1);
    expect(ecartsDuRefus({ detail: { code: 'STALE_REVISION' } })).toBeNull();
  });

  it('total refusé : différence rendue par l’API', () => {
    const err = {
      detail: {
        code: 'SUPPLIER_INVOICE_TOTAL_MISMATCH',
        details: { expected: '58.00', actual: '60.00', difference: '2.00' },
      },
    };
    expect(ecartTotalDuRefus(err)).toEqual({
      attendu: '58.00',
      saisi: '60.00',
      difference: '2.00',
    });
    expect(ecartTotalDuRefus({})).toBeNull();
  });
});

describe('gestes', () => {
  it('brouillon conforme : valider ; litige et annuler', () => {
    expect(ids(actionsFacture(facture(), [...MANAGE]))).toEqual(['valider', 'litige', 'annuler']);
    expect(actionsFacture(facture(), [...MANAGE])[0]!.actif).toBe(true);
  });

  it('en écart : valider désactivé avec raison, forcer réservé aux approbateurs', () => {
    const f = facture({ matchingStatus: 'variance' });
    const g = actionsFacture(f, [...MANAGE]);
    expect(g.find((x) => x.id === 'valider')).toMatchObject({
      actif: false,
      raison: RAISON_ECART_BLOQUANT,
    });
    expect(g.find((x) => x.id === 'forcer')).toMatchObject({
      actif: false,
      raison: RAISON_FORCER_APPROBATEUR,
    });
    expect(actionsFacture(f, [...APPROVE]).map((x) => [x.id, x.actif])).toEqual([['forcer', true]]);
  });

  it('en litige : lever le litige ; forcer et payer bloqués', () => {
    const g = actionsFacture(facture({ disputed: true, matchingStatus: 'variance' }), [...TOUT]);
    expect(ids(g)).toEqual(['valider', 'forcer', 'lever-litige', 'annuler']);
    expect(g.find((x) => x.id === 'forcer')!.raison).toBe(RAISON_LITIGE);
    const v = actionsFacture(facture({ status: 'validated', disputed: true }), [...TOUT]);
    expect(v.find((x) => x.id === 'payer')).toMatchObject({ actif: false, raison: RAISON_LITIGE });
  });

  it('validée : payer (payables.pay), avoir ; payée : plus de paiement ; annulée : rien', () => {
    const v = facture({ status: 'validated' });
    expect(ids(actionsFacture(v, [...TOUT]))).toEqual(['litige', 'payer', 'avoir', 'annuler']);
    expect(ids(actionsFacture(v, ['purchase.read', 'payables.pay']))).toEqual(['payer']);
    expect(ids(actionsFacture({ ...v, settlementStatus: 'paid' }, [...TOUT]))).not.toContain(
      'payer',
    );
    expect(actionsFacture(facture({ status: 'cancelled' }), [...TOUT])).toEqual([]);
    expect(actionsFacture(v, ['purchase.read'])).toEqual([]);
  });

  it('un avoir validé ne se paie pas et n’a pas de litige', () => {
    expect(
      ids(actionsFacture(facture({ status: 'validated', kind: 'credit_note' }), [...TOUT])),
    ).toEqual(['annuler']);
  });
});

describe('formulaire de saisie', () => {
  it('libre : sous-total saisi, une imputation sans montant prend le total', () => {
    const f = formulaireFactureLibre('2026-10-30', 'USD', 's1');
    f.supplierReference = ' FA-77 ';
    f.subtotal = '100';
    f.taxes = [{ label: 'TVA', amount: '16,00' }];
    f.total = '116,00';
    f.imputations = [{ category: 'achats', workProjectId: '', amount: '' }];
    const p = preparerFacture(f, '2026-10-30');
    expect(p).toEqual({
      ok: true,
      corps: {
        supplierId: 's1',
        supplierReference: 'FA-77',
        kind: 'invoice',
        invoiceDate: '2026-10-30',
        receivedOn: '2026-10-30',
        currency: 'USD',
        subtotal: '100',
        taxes: [{ label: 'TVA', amount: '16.00' }],
        total: '116.00',
        deductibleVat: null,
        costAllocations: [{ category: 'achats', workProjectId: null, amount: '116.00' }],
      },
    });
  });

  it('imputation vide : omise (défaut de l’API) ; échéance facultative', () => {
    const f = formulaireFactureLibre('2026-10-30', 'CDF', 's1');
    f.supplierReference = 'X';
    f.subtotal = '10';
    f.total = '10';
    f.dueDate = '2026-11-30';
    const p = preparerFacture(f, '2026-10-30');
    expect(p.ok && p.corps.costAllocations).toBeUndefined();
    expect(p.ok && p.corps.dueDate).toBe('2026-11-30');
  });

  it('refus locaux : référence, fournisseur, dates, total nul, plusieurs imputations sans montant', () => {
    const f = formulaireFactureLibre('2026-10-30');
    f.invoiceDate = '2026-11-02';
    f.dueDate = '2026-10-01';
    f.subtotal = 'abc';
    f.total = '0';
    f.imputations = [
      { category: 'achats', workProjectId: '', amount: '' },
      { category: '', workProjectId: '', amount: '5' },
    ];
    const p = preparerFacture(f, '2026-10-30');
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(Object.keys(p.champs).sort()).toEqual(
        [
          'dueDate',
          'imputation-0-amount',
          'imputation-1-category',
          'invoiceDate',
          'subtotal',
          'supplierId',
          'supplierReference',
          'total',
        ].sort(),
      );
    }
  });

  it('depuis une commande : lignes au reste à facturer, montants en saisie française', () => {
    const f = formulaireDepuisCommande(
      {
        supplierId: 's1',
        currency: 'USD',
        orderIds: ['o1'],
        lines: [
          {
            orderLineId: 'l1',
            label: 'Ramettes',
            quantity: '4',
            unitPrice: '5.00',
            discountPercent: '2.5',
          },
        ],
        subtotal: '19.50',
        costAllocations: [{ category: null, workProjectId: 'p1', amount: '19.50' }],
        remainingToInvoice: '19.50',
      },
      '2026-10-30',
    );
    expect(f.lignes).toEqual([
      {
        orderLineId: 'l1',
        label: 'Ramettes',
        quantity: '4',
        unitPrice: '5,00',
        discountPercent: '2,5',
      },
    ]);
    expect(f.imputations).toEqual([{ category: '', workProjectId: 'p1', amount: '' }]);
    f.supplierReference = 'FA 9';
    f.total = '19,50';
    f.imputations[0]!.category = 'achats';
    const p = preparerFacture(f, '2026-10-30');
    expect(p.ok && p.corps.lines).toEqual([
      {
        orderLineId: 'l1',
        label: 'Ramettes',
        quantity: '4',
        unitPrice: '5.00',
        discountPercent: '2.5',
      },
    ]);
    expect(p.ok && p.corps.subtotal).toBeUndefined();
    expect(p.ok && p.corps.orderIds).toEqual(['o1']);
    expect(p.ok && p.corps.costAllocations).toEqual([
      { category: 'achats', workProjectId: 'p1', amount: '19.50' },
    ]);
  });

  it('commande sans ligne restante : refusé localement', () => {
    const f = formulaireFactureLibre('2026-10-30', 'USD', 's1');
    f.orderIds = ['o1'];
    f.supplierReference = 'A';
    f.total = '1';
    const p = preparerFacture(f, '2026-10-30');
    expect(!p.ok && p.champs['lignes']).toBeTruthy();
  });

  it('avoir : vise la facture, même fournisseur et devise', () => {
    const f = formulaireAvoir(facture({ id: 'f9', currency: 'CDF' }), '2026-10-30');
    expect(f).toMatchObject({
      kind: 'credit_note',
      creditedInvoiceId: 'f9',
      supplierId: 's1',
      currency: 'CDF',
    });
    f.supplierReference = 'AV-1';
    f.subtotal = '5';
    f.total = '5';
    const p = preparerFacture(f, '2026-10-30');
    expect(p.ok && p.corps.kind).toBe('credit_note');
    expect(p.ok && p.corps.creditedInvoiceId).toBe('f9');
  });
});

describe('pièce jointe', () => {
  it('PDF ≤ 10 Mio, images ≤ 2 Mio, autres refusés', () => {
    expect(verifierPiece({ type: 'application/pdf', size: 9_000_000 })).toBeNull();
    expect(verifierPiece({ type: 'application/pdf', size: 11 * 1024 * 1024 })).toMatch(/10 Mio/);
    expect(verifierPiece({ type: 'image/jpeg', size: 3 * 1024 * 1024 })).toMatch(/2 Mio/);
    expect(verifierPiece({ type: 'text/html', size: 10 })).toMatch(/PDF/);
  });
});
