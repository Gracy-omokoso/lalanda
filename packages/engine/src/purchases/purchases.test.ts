// Moteur des achats (ADR-0044 § 7). Attendus calculés à la main ; les
// propriétés utilisent un générateur pseudo-aléatoire à graine fixe : un échec
// est rejouable à l'identique.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BLOCKING_VARIANCE_CODES,
  ENGINE_VERSION,
  PURCHASES_VERSION,
  checkApprovalTiers,
  checkCostAllocations,
  checkInvoiceTotal,
  checkSupplierPayment,
  computeOrderTotals,
  dueDateOf,
  matchInvoice,
  orderReceptionStatus,
  orderRemainingToInvoice,
  payableSettlement,
  payablesAging,
  payablesSchedule,
  possibleDuplicateExpenses,
  purchasesSummary,
  requiredApprovals,
  splitAllocation,
  type MatchInvoiceInput,
  type MatchOrderInput,
  type MatchReceptionInput,
  type MatchTolerances,
  type PayableInput,
  type SummaryInvoiceInput,
} from '../index.js';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const cents = (v: string): bigint => {
  const neg = v.startsWith('-');
  const [i, d = ''] = (neg ? v.slice(1) : v).split('.');
  const c = BigInt(i ?? '0') * 100n + BigInt(d.padEnd(2, '0'));
  return neg ? -c : c;
};
const str = (c: bigint): string =>
  `${c < 0n ? '-' : ''}${(c < 0n ? -c : c) / 100n}.${((c < 0n ? -c : c) % 100n).toString().padStart(2, '0')}`;

describe('version', () => {
  it('le module a sa propre version, sans toucher ENGINE_VERSION', () => {
    expect(PURCHASES_VERSION).toBe('1.0.0');
    expect(ENGINE_VERSION).toBe('0.2.0');
  });
});

// ─── computeOrderTotals ──────────────────────────────────────────────────────

describe('computeOrderTotals', () => {
  it('quantité × prix, taxes déclarées additionnées, total TTC', () => {
    const r = computeOrderTotals(
      [
        { id: 'a', quantity: '10', unitPrice: '5.00' },
        { id: 'b', quantity: '1', unitPrice: '100.00', discountPercent: '10' },
      ],
      [{ label: 'TVA', amount: '23.20' }],
    );
    expect(r).toEqual({
      version: PURCHASES_VERSION,
      lines: [
        { id: 'a', amount: '50.00' },
        { id: 'b', amount: '90.00' },
      ],
      subtotal: '140.00',
      taxes: '23.20',
      total: '163.20',
    });
  });

  it('un seul arrondi par ligne, demi vers le haut', () => {
    // 3 × 0.335 n'existe pas (2 décimales) : 0.333 × 1.50 = 0.4995 → 0.50
    expect(computeOrderTotals([{ quantity: '0.333', unitPrice: '1.50' }], []).subtotal).toBe(
      '0.50',
    );
    // 0.001 × 4.99 = 0.00499 → 0.00
    expect(computeOrderTotals([{ quantity: '0.001', unitPrice: '4.99' }], []).subtotal).toBe(
      '0.00',
    );
    // 1 × 0.05 × (1 − 10 %) = 0.045 → 0.05 (un seul arrondi, pas 0.04)
    expect(
      computeOrderTotals([{ quantity: '1', unitPrice: '0.05', discountPercent: '10' }], [])
        .subtotal,
    ).toBe('0.05');
    // 3 × 3.33 × (1 − 33.33 %) = 6.660333 → 6.66
    expect(
      computeOrderTotals([{ quantity: '3', unitPrice: '3.33', discountPercent: '33.33' }], [])
        .subtotal,
    ).toBe('6.66');
    // Arrondi par ligne puis somme : 2 × 0.4995 → 0.50 + 0.50 = 1.00 (pas 1.00 vs 0.999)
    expect(
      computeOrderTotals(
        [
          { quantity: '0.333', unitPrice: '1.50' },
          { quantity: '0.333', unitPrice: '1.50' },
        ],
        [],
      ).subtotal,
    ).toBe('1.00');
  });

  it('remise de 100 % : ligne nulle ; prix nul admis ; aucune ligne : zéro', () => {
    expect(
      computeOrderTotals([{ quantity: '2', unitPrice: '9.99', discountPercent: '100' }], [])
        .subtotal,
    ).toBe('0.00');
    expect(computeOrderTotals([{ quantity: '2', unitPrice: '0' }], []).total).toBe('0.00');
    expect(computeOrderTotals([], []).total).toBe('0.00');
  });

  it('grands montants CDF exacts', () => {
    expect(
      computeOrderTotals(
        [{ quantity: '1250.5', unitPrice: '2850000.00' }],
        [{ label: 'TVA', amount: '570285000.00' }],
      ).total,
    ).toBe('4134210000.00');
  });

  it('entrées invalides : erreur', () => {
    expect(() => computeOrderTotals([{ quantity: '0', unitPrice: '1' }], [])).toThrow(RangeError);
    expect(() => computeOrderTotals([{ quantity: '1.0001', unitPrice: '1' }], [])).toThrow(
      RangeError,
    );
    expect(() => computeOrderTotals([{ quantity: '1', unitPrice: '1.001' }], [])).toThrow(
      RangeError,
    );
    expect(() => computeOrderTotals([{ quantity: '-1', unitPrice: '1' }], [])).toThrow(RangeError);
    expect(() =>
      computeOrderTotals([{ quantity: '1', unitPrice: '1', discountPercent: '100.01' }], []),
    ).toThrow(RangeError);
    expect(() => computeOrderTotals([], [{ label: 'x', amount: '1.5.0' }])).toThrow(RangeError);
  });

  it('propriété : total = Σ lignes + Σ taxes, ligne à ±½ centime de la valeur exacte', () => {
    const rand = rng(20261030);
    for (let n = 0; n < 300; n += 1) {
      const lines = Array.from({ length: 1 + Math.floor(rand() * 6) }, () => ({
        quantity: (1 + Math.floor(rand() * 99_999)) / 1000 + '',
        unitPrice: str(BigInt(Math.floor(rand() * 10_000_000))),
        discountPercent: str(BigInt(Math.floor(rand() * 10_001))),
      }));
      const taxes = [{ label: 'TVA', amount: str(BigInt(Math.floor(rand() * 1_000_000))) }];
      const r = computeOrderTotals(lines, taxes);
      const sumLines = r.lines.reduce((s, l) => s + cents(l.amount), 0n);
      expect(cents(r.subtotal)).toBe(sumLines);
      expect(cents(r.total)).toBe(sumLines + cents(taxes[0]!.amount));
      lines.forEach((l, i) => {
        const [qi, qd = ''] = l.quantity.split('.');
        const milli = BigInt(qi!) * 1000n + BigInt(qd.padEnd(3, '0'));
        const exact = milli * cents(l.unitPrice) * (10_000n - cents(l.discountPercent)); // ×10⁻⁷ centime
        const got = cents(r.lines[i]!.amount) * 10_000_000n;
        const diff = got - exact;
        expect(diff * 2n <= 10_000_000n && diff * 2n > -10_000_000n).toBe(true);
      });
    }
  });
});

// ─── Paliers ─────────────────────────────────────────────────────────────────

describe('requiredApprovals et checkApprovalTiers', () => {
  const tiers = {
    USD: [
      { from: '0', approvals: 0 },
      { from: '500', approvals: 1 },
      { from: '5000', approvals: 2 },
    ],
    CDF: [
      { from: '0', approvals: 1 },
      { from: '1000000', approvals: 2 },
    ],
  };

  it('critère 3 : bornes exactes des paliers USD', () => {
    expect(requiredApprovals(tiers, 'USD', '499.99').approvals).toBe(0);
    expect(requiredApprovals(tiers, 'USD', '500.00')).toEqual({
      version: PURCHASES_VERSION,
      currency: 'USD',
      approvals: 1,
      tierIndex: 1,
      from: '500.00',
    });
    expect(requiredApprovals(tiers, 'USD', '4999.99').approvals).toBe(1);
    expect(requiredApprovals(tiers, 'USD', '5000.00').approvals).toBe(2);
    expect(requiredApprovals(tiers, 'USD', '0.00').approvals).toBe(0);
  });

  it('une demande CDF suit ses propres paliers, jamais ceux de l’USD', () => {
    expect(requiredApprovals(tiers, 'CDF', '499.99').approvals).toBe(1);
    expect(requiredApprovals(tiers, 'CDF', '5000.00').approvals).toBe(1);
    expect(requiredApprovals(tiers, 'CDF', '1000000.00').approvals).toBe(2);
  });

  it('défaut de l’ADR : une approbation pour toute commande', () => {
    expect(requiredApprovals({ USD: [{ from: '0', approvals: 1 }] }, 'USD', '0.01').approvals).toBe(
      1,
    );
  });

  it('devise sans paliers, paliers invalides, devise inconnue : erreur', () => {
    expect(() => requiredApprovals({ USD: tiers.USD }, 'CDF', '1')).toThrow(RangeError);
    expect(() => requiredApprovals({ USD: [{ from: '1', approvals: 1 }] }, 'USD', '1')).toThrow(
      RangeError,
    );
    expect(() => requiredApprovals(tiers, 'EUR' as 'USD', '1')).toThrow(RangeError);
  });

  it('checkApprovalTiers rend tous les problèmes', () => {
    expect(checkApprovalTiers(tiers.USD)).toEqual({ ok: true, issues: [] });
    expect(checkApprovalTiers([]).issues.map((i) => i.code)).toEqual(['APPROVAL_TIERS_EMPTY']);
    const r = checkApprovalTiers([
      { from: '10', approvals: 3 },
      { from: '10', approvals: 1 },
      { from: 'x', approvals: 1.5 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => [i.code, i.tierIndex])).toEqual([
      ['APPROVAL_TIER_FIRST_NOT_ZERO', 0],
      ['APPROVAL_TIER_APPROVALS_INVALID', 0],
      ['APPROVAL_TIERS_NOT_INCREASING', 1],
      ['APPROVAL_TIER_FROM_INVALID', 2],
      ['APPROVAL_TIER_APPROVALS_INVALID', 2],
    ]);
  });
});

// ─── Réceptions ──────────────────────────────────────────────────────────────

describe('orderReceptionStatus', () => {
  const order = (status: 'approved' | 'sent' | 'partially_received' | 'closed', sent = true) => ({
    status,
    sent,
    lines: [
      { id: 'L1', quantity: '10', receivable: true },
      { id: 'L2', quantity: '2.5', receivable: true },
      { id: 'S1', quantity: '1', receivable: false },
    ],
  });

  it('rien reçu : envoyée ou approuvée selon la transmission', () => {
    expect(orderReceptionStatus(order('sent'), []).status).toBe('sent');
    expect(orderReceptionStatus(order('approved', false), []).status).toBe('approved');
  });

  it('réception partielle, puis totale ; reste et excédent par ligne', () => {
    const r1 = orderReceptionStatus(order('sent'), [
      { status: 'recorded', lines: [{ orderLineId: 'L1', quantity: '6' }] },
    ]);
    expect(r1.status).toBe('partially_received');
    expect(r1.anyReceived).toBe(true);
    expect(r1.lines[0]).toEqual({
      orderLineId: 'L1',
      receivable: true,
      ordered: '10',
      received: '6',
      remaining: '4',
      overReceived: '0',
    });
    const r2 = orderReceptionStatus(order('partially_received'), [
      { status: 'recorded', lines: [{ orderLineId: 'L1', quantity: '6' }] },
      {
        status: 'recorded',
        lines: [
          { orderLineId: 'L1', quantity: '5' },
          { orderLineId: 'L2', quantity: '2.5' },
        ],
      },
    ]);
    expect(r2.status).toBe('received');
    expect(r2.fullyReceived).toBe(true);
    expect(r2.lines[0]).toMatchObject({ received: '11', remaining: '0', overReceived: '1' });
  });

  it('une réception annulée ne compte pas ; la commande revient à « envoyée »', () => {
    const r = orderReceptionStatus(order('received'), [
      { status: 'cancelled', lines: [{ orderLineId: 'L1', quantity: '10' }] },
    ]);
    expect(r.status).toBe('sent');
    expect(r.lines[0]!.received).toBe('0');
  });

  it('une ligne de service « faite » ne change pas le statut de réception', () => {
    const r = orderReceptionStatus(order('sent'), [
      { status: 'recorded', lines: [{ orderLineId: 'S1', quantity: '1' }] },
    ]);
    expect(r.status).toBe('sent');
    expect(r.lines[2]).toMatchObject({ received: '1', remaining: '0' });
  });

  it('commande de services seuls : jamais « reçue » ; statut hors cycle inchangé', () => {
    const services = {
      status: 'sent' as const,
      sent: true,
      lines: [{ id: 'S', quantity: '1', receivable: false }],
    };
    expect(orderReceptionStatus(services, []).fullyReceived).toBe(false);
    expect(
      orderReceptionStatus(order('closed'), [
        { status: 'recorded', lines: [{ orderLineId: 'L1', quantity: '3' }] },
      ]).status,
    ).toBe('closed');
  });

  it('ligne inconnue, quantité invalide, ligne en double : erreur', () => {
    expect(() =>
      orderReceptionStatus(order('sent'), [
        { status: 'recorded', lines: [{ orderLineId: 'X', quantity: '1' }] },
      ]),
    ).toThrow(RangeError);
    expect(() =>
      orderReceptionStatus(order('sent'), [
        { status: 'recorded', lines: [{ orderLineId: 'L1', quantity: '0' }] },
      ]),
    ).toThrow(RangeError);
    expect(() =>
      orderReceptionStatus(
        {
          status: 'sent',
          sent: true,
          lines: [
            { id: 'A', quantity: '1', receivable: true },
            { id: 'A', quantity: '1', receivable: true },
          ],
        },
        [],
      ),
    ).toThrow(RangeError);
  });
});

// ─── Rapprochement ───────────────────────────────────────────────────────────

const strict: MatchTolerances = { pricePercent: '0', amountAbsolute: {} };

const goodsOrder: MatchOrderInput = {
  id: 'O1',
  currency: 'USD',
  approvedTotal: '50.00',
  declaredTaxes: [],
  lines: [{ id: 'L1', quantity: '10', unitPrice: '5.00', receivable: true }],
};
const serviceOrder: MatchOrderInput = {
  id: 'O2',
  currency: 'USD',
  approvedTotal: '100.00',
  declaredTaxes: [],
  lines: [{ id: 'S1', quantity: '1', unitPrice: '100.00', receivable: false }],
};
const reception6: MatchReceptionInput = {
  orderId: 'O1',
  status: 'recorded',
  lines: [{ orderLineId: 'L1', quantity: '6' }],
};
const inv = (over: Partial<MatchInvoiceInput>): MatchInvoiceInput => ({
  id: 'F1',
  kind: 'invoice',
  status: 'draft',
  currency: 'USD',
  orderIds: ['O1'],
  lines: [{ orderLineId: 'L1', quantity: '10', unitPrice: '5.00' }],
  taxes: [],
  total: '50.00',
  ...over,
});
const codes = (r: { variances: { code: string }[] }) => r.variances.map((v) => v.code);

describe('matchInvoice', () => {
  it('sans commande, ou avoir : non applicable', () => {
    const none = matchInvoice({
      orders: [],
      receptions: [],
      invoices: [],
      invoice: inv({ orderIds: [], lines: [] }),
      tolerances: strict,
    });
    expect(none).toEqual({
      version: PURCHASES_VERSION,
      mode: 'none',
      status: 'not_applicable',
      variances: [],
      lines: [],
    });
    expect(
      matchInvoice({
        orders: [goodsOrder],
        receptions: [],
        invoices: [],
        invoice: inv({ kind: 'credit_note' }),
        tolerances: strict,
      }).status,
    ).toBe('not_applicable');
  });

  it('critère 7 : trois voies, 10 commandés, 6 reçus, 10 facturés → QUANTITY_ABOVE_RECEIVED', () => {
    const r = matchInvoice({
      orders: [goodsOrder],
      receptions: [reception6],
      invoices: [],
      invoice: inv({}),
      tolerances: strict,
    });
    expect(r.mode).toBe('three_way');
    expect(r.status).toBe('variance');
    expect(r.variances).toEqual([
      {
        code: 'QUANTITY_ABOVE_RECEIVED',
        blocking: true,
        orderId: 'O1',
        orderLineId: 'L1',
        invoiceLineIndex: null,
        unit: 'quantity',
        expected: '6',
        actual: '10',
        difference: '4',
      },
    ]);
    expect(r.lines).toEqual([
      {
        orderId: 'O1',
        orderLineId: 'L1',
        mode: 'three_way',
        ordered: '10',
        received: '6',
        invoicedBefore: '0',
        invoicedNow: '10',
        invoicedCumulative: '10',
      },
    ]);
  });

  it('critère 7 : facture de 6 → rapprochée (quantité inférieure en information)', () => {
    const r = matchInvoice({
      orders: [goodsOrder],
      receptions: [reception6],
      invoices: [],
      invoice: inv({
        lines: [{ orderLineId: 'L1', quantity: '6', unitPrice: '5.00' }],
        total: '30.00',
      }),
      tolerances: strict,
    });
    expect(r.status).toBe('matched');
    expect(codes(r)).toEqual(['QUANTITY_BELOW_ORDER']);
    expect(r.variances[0]!.blocking).toBe(false);
  });

  it('réceptions annulées ignorées', () => {
    const r = matchInvoice({
      orders: [goodsOrder],
      receptions: [
        { ...reception6, lines: [{ orderLineId: 'L1', quantity: '10' }], status: 'cancelled' },
        reception6,
      ],
      invoices: [],
      invoice: inv({
        lines: [{ orderLineId: 'L1', quantity: '7', unitPrice: '5.00' }],
        total: '35.00',
      }),
      tolerances: strict,
    });
    expect(codes(r)).toContain('QUANTITY_ABOVE_RECEIVED');
  });

  it('critère 8 : deux voies, service à 100 facturé 110, tolérance 0 % puis 10 %', () => {
    const invoice = inv({
      orderIds: ['O2'],
      lines: [{ orderLineId: 'S1', quantity: '1', unitPrice: '110.00' }],
      total: '100.00',
    });
    const r0 = matchInvoice({
      orders: [serviceOrder],
      receptions: [],
      invoices: [],
      invoice,
      tolerances: strict,
    });
    expect(r0.mode).toBe('two_way');
    expect(r0.status).toBe('variance');
    expect(r0.variances).toEqual([
      {
        code: 'PRICE_ABOVE_ORDER',
        blocking: true,
        orderId: 'O2',
        orderLineId: 'S1',
        invoiceLineIndex: 0,
        unit: 'unit_price',
        expected: '100.00',
        actual: '110.00',
        difference: '10.00',
      },
    ]);
    const r10 = matchInvoice({
      orders: [serviceOrder],
      receptions: [],
      invoices: [],
      invoice,
      tolerances: { pricePercent: '10', amountAbsolute: {} },
    });
    expect(r10.status).toBe('matched');
    expect(r10.variances).toEqual([]);
    // 110.01 dépasse 10 %
    const r10b = matchInvoice({
      orders: [serviceOrder],
      receptions: [],
      invoices: [],
      invoice: { ...invoice, lines: [{ orderLineId: 'S1', quantity: '1', unitPrice: '110.01' }] },
      tolerances: { pricePercent: '10', amountAbsolute: {} },
    });
    expect(codes(r10b)).toEqual(['PRICE_ABOVE_ORDER']);
  });

  it('prix net de remise : remise commandée prise en compte, prix inférieur en information', () => {
    const order: MatchOrderInput = {
      ...serviceOrder,
      lines: [
        { id: 'S1', quantity: '1', unitPrice: '100.00', discountPercent: '10', receivable: false },
      ],
    };
    const same = matchInvoice({
      orders: [order],
      receptions: [],
      invoices: [],
      invoice: inv({
        orderIds: ['O2'],
        lines: [{ orderLineId: 'S1', quantity: '1', unitPrice: '90.00' }],
        total: '90.00',
      }),
      tolerances: strict,
    });
    expect(same.variances).toEqual([]);
    const lower = matchInvoice({
      orders: [order],
      receptions: [],
      invoices: [],
      invoice: inv({
        orderIds: ['O2'],
        lines: [{ orderLineId: 'S1', quantity: '1', unitPrice: '100.00', discountPercent: '12.5' }],
        total: '87.50',
      }),
      tolerances: strict,
    });
    expect(lower.status).toBe('matched');
    expect(lower.variances[0]).toMatchObject({
      code: 'PRICE_BELOW_ORDER',
      blocking: false,
      expected: '90.00',
      actual: '87.50',
      difference: '-2.50',
    });
  });

  it('cumul multi-factures : seules les factures validées (hors avoirs et hors elle-même) comptent', () => {
    const others: MatchInvoiceInput[] = [
      inv({
        id: 'V1',
        status: 'validated',
        lines: [{ orderLineId: 'L1', quantity: '4', unitPrice: '5.00' }],
        total: '20.00',
      }),
      inv({
        id: 'D1',
        status: 'draft',
        lines: [{ orderLineId: 'L1', quantity: '9', unitPrice: '5.00' }],
        total: '45.00',
      }),
      inv({ id: 'C1', status: 'cancelled', total: '50.00' }),
      inv({ id: 'A1', kind: 'credit_note', status: 'validated', total: '50.00' }),
      inv({ id: 'F1', status: 'validated', total: '50.00' }),
    ];
    const r = matchInvoice({
      orders: [goodsOrder],
      receptions: [{ ...reception6, lines: [{ orderLineId: 'L1', quantity: '10' }] }],
      invoices: others,
      invoice: inv({
        lines: [{ orderLineId: 'L1', quantity: '6', unitPrice: '5.00' }],
        total: '30.00',
      }),
      tolerances: strict,
    });
    expect(r.status).toBe('matched');
    expect(r.lines[0]).toMatchObject({
      invoicedBefore: '4',
      invoicedNow: '6',
      invoicedCumulative: '10',
    });
    const over = matchInvoice({
      orders: [goodsOrder],
      receptions: [{ ...reception6, lines: [{ orderLineId: 'L1', quantity: '10' }] }],
      invoices: others,
      invoice: inv({
        lines: [{ orderLineId: 'L1', quantity: '7', unitPrice: '5.00' }],
        total: '35.00',
      }),
      tolerances: strict,
    });
    expect(codes(over)).toEqual([
      'QUANTITY_ABOVE_ORDER',
      'QUANTITY_ABOVE_RECEIVED',
      'TOTAL_ABOVE_ORDER',
    ]);
    expect(over.variances.find((v) => v.code === 'TOTAL_ABOVE_ORDER')).toMatchObject({
      expected: '50.00',
      actual: '55.00',
      difference: '5.00',
    });
  });

  it('tolérance absolue sur le total, par devise', () => {
    const args = {
      orders: [serviceOrder],
      receptions: [],
      invoices: [],
      invoice: inv({
        orderIds: ['O2'],
        lines: [{ orderLineId: 'S1', quantity: '1', unitPrice: '100.00' }],
        taxes: [{ label: 'TVA', amount: '16.00' }],
        total: '116.00',
      }),
    };
    expect(codes(matchInvoice({ ...args, tolerances: strict }))).toEqual([
      'TOTAL_ABOVE_ORDER',
      'TAXES_DIFFER_FROM_ORDER',
    ]);
    expect(
      codes(
        matchInvoice({
          ...args,
          tolerances: { pricePercent: '0', amountAbsolute: { USD: '16.00', CDF: '0' } },
        }),
      ),
    ).toEqual(['TAXES_DIFFER_FROM_ORDER']);
    // la tolérance CDF ne s'applique pas à une facture USD
    expect(
      codes(
        matchInvoice({
          ...args,
          tolerances: { pricePercent: '0', amountAbsolute: { CDF: '1000.00' } },
        }),
      ),
    ).toContain('TOTAL_ABOVE_ORDER');
  });

  it('ligne hors commande, réception excédentaire, mode le plus exigeant, plusieurs commandes', () => {
    const r = matchInvoice({
      orders: [goodsOrder, serviceOrder],
      receptions: [{ ...reception6, lines: [{ orderLineId: 'L1', quantity: '12' }] }],
      invoices: [],
      invoice: inv({
        orderIds: ['O1', 'O2'],
        lines: [
          { orderLineId: 'S1', quantity: '1', unitPrice: '100.00' },
          { orderLineId: null, quantity: '2', unitPrice: '3.00' },
          { orderLineId: 'L1', quantity: '4', unitPrice: '5.00' },
          { orderLineId: 'L1', quantity: '6', unitPrice: '5.00' },
        ],
        total: '156.00',
      }),
      tolerances: strict,
    });
    expect(r.mode).toBe('three_way');
    expect(r.status).toBe('variance');
    expect(codes(r)).toEqual(['LINE_NOT_ON_ORDER', 'RECEIVED_OVER_ORDERED', 'TOTAL_ABOVE_ORDER']);
    expect(r.variances[0]).toMatchObject({ invoiceLineIndex: 1, actual: '2' });
    expect(r.lines.map((l) => [l.orderLineId, l.mode, l.invoicedNow])).toEqual([
      ['S1', 'two_way', '1'],
      ['L1', 'three_way', '10'],
    ]);
  });

  it('total cumulé sur l’union des commandes partagées', () => {
    // V1 vise O1 et O2 (150 approuvés) ; la facture vise O1 seul.
    const r = matchInvoice({
      orders: [goodsOrder, serviceOrder],
      receptions: [{ ...reception6, lines: [{ orderLineId: 'L1', quantity: '10' }] }],
      invoices: [
        inv({
          id: 'V1',
          status: 'validated',
          orderIds: ['O1', 'O2'],
          lines: [{ orderLineId: 'S1', quantity: '1', unitPrice: '100.00' }],
          total: '100.00',
        }),
      ],
      invoice: inv({ total: '50.00' }),
      tolerances: strict,
    });
    expect(r.status).toBe('matched');
    expect(() =>
      matchInvoice({
        orders: [goodsOrder],
        receptions: [],
        invoices: [inv({ id: 'V1', status: 'validated', orderIds: ['O1', 'O9'] })],
        invoice: inv({}),
        tolerances: strict,
      }),
    ).toThrow(RangeError);
  });

  it('préconditions : commande absente, devise différente, ligne étrangère, sans ligne, tolérance > 10 %', () => {
    const base = { orders: [goodsOrder], receptions: [], invoices: [], tolerances: strict };
    expect(() => matchInvoice({ ...base, invoice: inv({ orderIds: ['O9'] }) })).toThrow(RangeError);
    expect(() => matchInvoice({ ...base, invoice: inv({ currency: 'CDF' }) })).toThrow(RangeError);
    expect(() =>
      matchInvoice({
        ...base,
        invoice: inv({ lines: [{ orderLineId: 'S1', quantity: '1', unitPrice: '1' }] }),
      }),
    ).toThrow(RangeError);
    expect(() => matchInvoice({ ...base, invoice: inv({ lines: [] }) })).toThrow(RangeError);
    expect(() =>
      matchInvoice({
        ...base,
        invoice: inv({}),
        tolerances: { pricePercent: '10.01', amountAbsolute: {} },
      }),
    ).toThrow(RangeError);
  });

  it('les codes bloquants sont exactement ceux du § 5.2', () => {
    expect([...BLOCKING_VARIANCE_CODES].sort()).toEqual([
      'LINE_NOT_ON_ORDER',
      'PRICE_ABOVE_ORDER',
      'QUANTITY_ABOVE_ORDER',
      'QUANTITY_ABOVE_RECEIVED',
      'TOTAL_ABOVE_ORDER',
    ]);
  });

  it('propriété : statut « variance » ⇔ au moins un écart bloquant ; différence = constaté − attendu', () => {
    const rand = rng(44);
    for (let n = 0; n < 200; n += 1) {
      const ordered = 1 + Math.floor(rand() * 20);
      const price = 1 + Math.floor(rand() * 10_000);
      const order: MatchOrderInput = {
        id: 'O',
        currency: 'CDF',
        approvedTotal: str(BigInt(ordered * price)),
        declaredTaxes: [],
        lines: [
          {
            id: 'L',
            quantity: String(ordered),
            unitPrice: str(BigInt(price)),
            receivable: rand() < 0.5,
          },
        ],
      };
      const qty = 1 + Math.floor(rand() * 25);
      const invPrice = Math.max(0, price + Math.floor(rand() * 200) - 100);
      const r = matchInvoice({
        orders: [order],
        receptions: [
          {
            orderId: 'O',
            status: 'recorded',
            lines: [{ orderLineId: 'L', quantity: String(1 + Math.floor(rand() * 25)) }],
          },
        ],
        invoices: [],
        invoice: {
          id: 'F',
          kind: 'invoice',
          status: 'draft',
          currency: 'CDF',
          orderIds: ['O'],
          lines: [{ orderLineId: 'L', quantity: String(qty), unitPrice: str(BigInt(invPrice)) }],
          taxes: [],
          total: str(BigInt(qty * invPrice)),
        },
        tolerances: { pricePercent: String(Math.floor(rand() * 11)), amountAbsolute: {} },
      });
      expect(r.status === 'variance').toBe(r.variances.some((v) => v.blocking));
      for (const v of r.variances) {
        expect(v.blocking).toBe(BLOCKING_VARIANCE_CODES.includes(v.code));
        expect(Number(v.actual) - Number(v.expected)).toBeCloseTo(Number(v.difference), 6);
      }
      // déterminisme
      expect(
        matchInvoice({
          orders: [order],
          receptions: [],
          invoices: [],
          invoice: {
            id: 'F',
            kind: 'invoice',
            status: 'draft',
            currency: 'CDF',
            orderIds: ['O'],
            lines: [{ orderLineId: 'L', quantity: String(qty), unitPrice: str(BigInt(invPrice)) }],
            taxes: [],
            total: '1.00',
          },
          tolerances: strict,
        }),
      ).toEqual(
        matchInvoice({
          orders: [order],
          receptions: [],
          invoices: [],
          invoice: {
            id: 'F',
            kind: 'invoice',
            status: 'draft',
            currency: 'CDF',
            orderIds: ['O'],
            lines: [{ orderLineId: 'L', quantity: String(qty), unitPrice: str(BigInt(invPrice)) }],
            taxes: [],
            total: '1.00',
          },
          tolerances: strict,
        }),
      );
    }
  });
});

describe('checkInvoiceTotal et checkCostAllocations', () => {
  it('total au centime', () => {
    expect(checkInvoiceTotal('100.00', [{ label: 'TVA', amount: '16.00' }], '116.00')).toEqual({
      version: PURCHASES_VERSION,
      ok: true,
      code: null,
      expected: '116.00',
      actual: '116.00',
      difference: '0.00',
    });
    expect(
      checkInvoiceTotal('100.00', [{ label: 'TVA', amount: '16.00' }], '115.99'),
    ).toMatchObject({
      ok: false,
      code: 'SUPPLIER_INVOICE_TOTAL_MISMATCH',
      difference: '-0.01',
    });
    expect(checkInvoiceTotal('100', [], '100.01').difference).toBe('0.01');
  });

  it('imputations = total ; aucune imputation : écart', () => {
    expect(
      checkCostAllocations('1000.00', [
        { category: 'achats', workProjectId: 'P', amount: '600.00' },
        { category: 'services_exterieurs', amount: '400.00' },
      ]).ok,
    ).toBe(true);
    expect(
      checkCostAllocations('1000.00', [{ category: 'achats', amount: '999.99' }]),
    ).toMatchObject({
      ok: false,
      code: 'SUPPLIER_INVOICE_ALLOCATION_MISMATCH',
      allocated: '999.99',
      difference: '-0.01',
    });
    expect(checkCostAllocations('0.00', []).ok).toBe(false);
  });
});

// ─── Échéances ───────────────────────────────────────────────────────────────

describe('dueDateOf', () => {
  it('critère 13 : fin de mois + 30 sur une facture du 15 janvier (année non bissextile) → 2 mars', () => {
    expect(dueDateOf({ kind: 'end_of_month', days: 30 }, '2027-01-15')).toEqual({
      version: PURCHASES_VERSION,
      dueDate: '2027-03-02',
    });
  });

  it('année bissextile, fin de mois + 0, net, immédiat, changement d’année', () => {
    expect(dueDateOf({ kind: 'end_of_month', days: 30 }, '2028-01-15').dueDate).toBe('2028-03-01');
    expect(dueDateOf({ kind: 'end_of_month', days: 0 }, '2028-02-03').dueDate).toBe('2028-02-29');
    expect(dueDateOf({ kind: 'end_of_month', days: 0 }, '2100-02-03').dueDate).toBe('2100-02-28');
    expect(dueDateOf({ kind: 'net', days: 30 }, '2026-12-15').dueDate).toBe('2027-01-14');
    expect(dueDateOf({ kind: 'net', days: 1 }, '2026-12-31').dueDate).toBe('2027-01-01');
    expect(dueDateOf({ kind: 'immediate' }, '2026-10-30').dueDate).toBe('2026-10-30');
    expect(dueDateOf({ kind: 'end_of_month', days: 180 }, '2026-10-30').dueDate).toBe('2027-04-29');
  });

  it('bornes des délais et date invalide : erreur', () => {
    expect(() => dueDateOf({ kind: 'net', days: 0 }, '2026-01-01')).toThrow(RangeError);
    expect(() => dueDateOf({ kind: 'net', days: 181 }, '2026-01-01')).toThrow(RangeError);
    expect(() => dueDateOf({ kind: 'net', days: 1.5 }, '2026-01-01')).toThrow(RangeError);
    expect(() => dueDateOf({ kind: 'end_of_month', days: -1 }, '2026-01-01')).toThrow(RangeError);
    expect(() => dueDateOf({ kind: 'immediate' }, '2026-02-30')).toThrow(RangeError);
    expect(() => dueDateOf({ kind: 'weekly' } as never, '2026-02-01')).toThrow(RangeError);
  });
});

describe('payableSettlement', () => {
  it('non payée, partiellement, payée ; avoirs ; excédent à part', () => {
    expect(payableSettlement({ total: '1000.00' }, [], [])).toEqual({
      version: PURCHASES_VERSION,
      status: 'unpaid',
      total: '1000.00',
      paid: '0.00',
      credited: '0.00',
      remaining: '1000.00',
      overpaid: '0.00',
    });
    expect(payableSettlement({ total: '1000.00' }, ['500.00'], [])).toMatchObject({
      status: 'partially_paid',
      remaining: '500.00',
    });
    expect(payableSettlement({ total: '1000.00' }, ['300.00'], ['200.00'])).toMatchObject({
      status: 'partially_paid',
      credited: '200.00',
      remaining: '500.00',
    });
    expect(payableSettlement({ total: '1000.00' }, ['900.00'], ['100.00']).status).toBe('paid');
    expect(payableSettlement({ total: '1000.00' }, ['1000.00'], ['50.00'])).toMatchObject({
      status: 'paid',
      remaining: '0.00',
      overpaid: '50.00',
    });
    expect(payableSettlement({ total: '0.00' }, [], []).status).toBe('paid');
  });
});

const payable = (
  currency: 'CDF' | 'USD',
  dueDate: string,
  remaining: string,
  disputed = false,
): PayableInput => ({
  currency,
  dueDate,
  remaining,
  disputed,
});

describe('payablesAging', () => {
  it('tranches exactes, par devise, litiges à part, soldées ignorées', () => {
    const r = payablesAging(
      [
        payable('USD', '2026-10-30', '10.00'), // échéance aujourd'hui : non échue
        payable('USD', '2026-10-29', '20.00'), // 1 jour
        payable('USD', '2026-09-30', '30.00'), // 30 jours
        payable('USD', '2026-09-29', '40.00'), // 31 jours
        payable('USD', '2026-08-31', '50.00'), // 60 jours
        payable('USD', '2026-08-30', '60.00'), // 61 jours
        payable('USD', '2026-08-01', '70.00'), // 90 jours
        payable('USD', '2026-07-31', '80.00'), // 91 jours
        payable('USD', '2026-01-01', '5.00', true),
        payable('USD', '2026-01-01', '0.00'),
        payable('CDF', '2026-12-01', '250000.00'),
      ],
      '2026-10-30',
    );
    expect(r.asOf).toBe('2026-10-30');
    expect(r.byCurrency.map((c) => c.currency)).toEqual(['CDF', 'USD']);
    expect(r.byCurrency[0]).toMatchObject({
      notDue: { amount: '250000.00', count: 1 },
      open: { amount: '250000.00', count: 1 },
      disputed: { amount: '0.00', count: 0 },
    });
    expect(r.byCurrency[1]).toEqual({
      currency: 'USD',
      notDue: { amount: '10.00', count: 1 },
      days1To30: { amount: '50.00', count: 2 },
      days31To60: { amount: '90.00', count: 2 },
      days61To90: { amount: '130.00', count: 2 },
      over90: { amount: '80.00', count: 1 },
      open: { amount: '360.00', count: 8 },
      disputed: { amount: '5.00', count: 1 },
    });
  });

  it('critère 13 : au changement de jour, la facture change de tranche', () => {
    const items = [payable('USD', '2026-09-30', '1.00')];
    expect(payablesAging(items, '2026-10-30').byCurrency[0]!.days1To30.count).toBe(1);
    expect(payablesAging(items, '2026-10-31').byCurrency[0]!.days31To60.count).toBe(1);
    expect(payablesAging(items, '2026-09-30').byCurrency[0]!.notDue.count).toBe(1);
  });

  it('aucune facture : aucune devise ; date invalide : erreur', () => {
    expect(payablesAging([], '2026-10-30').byCurrency).toEqual([]);
    expect(() => payablesAging([], '30/10/2026')).toThrow(RangeError);
    expect(() => payablesAging([payable('EUR' as 'USD', '2026-10-30', '1')], '2026-10-30')).toThrow(
      RangeError,
    );
  });

  it('propriété : Σ tranches = ouvert ; ouvert + litiges = Σ restes, par devise', () => {
    const rand = rng(7);
    const items: PayableInput[] = Array.from({ length: 400 }, () =>
      payable(
        rand() < 0.5 ? 'CDF' : 'USD',
        `2026-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`,
        str(BigInt(Math.floor(rand() * 1_000_000))),
        rand() < 0.1,
      ),
    );
    const r = payablesAging(items, '2026-07-15');
    for (const c of r.byCurrency) {
      const buckets = [c.notDue, c.days1To30, c.days31To60, c.days61To90, c.over90];
      expect(buckets.reduce((s, b) => s + cents(b.amount), 0n)).toBe(cents(c.open.amount));
      expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(c.open.count);
      const all = items
        .filter((i) => i.currency === c.currency)
        .reduce((s, i) => s + cents(i.remaining), 0n);
      expect(cents(c.open.amount) + cents(c.disputed.amount)).toBe(all);
    }
  });
});

describe('payablesSchedule', () => {
  it('en retard, bientôt, quatre semaines glissantes puis mois, par devise', () => {
    const r = payablesSchedule(
      [
        payable('USD', '2026-10-29', '300.00'), // en retard
        payable('USD', '2026-10-30', '1.00'), // bientôt (aujourd'hui)
        payable('USD', '2026-11-06', '2.00'), // bientôt (J+7, borne incluse)
        payable('USD', '2026-11-07', '3.00'), // semaine 1
        payable('USD', '2026-11-13', '4.00'), // semaine 1 (dernier jour)
        payable('USD', '2026-11-14', '5.00'), // semaine 2
        payable('USD', '2026-12-04', '6.00'), // semaine 4 (dernier jour)
        payable('USD', '2026-12-05', '7.00'), // mois 2026-12
        payable('USD', '2027-02-10', '8.00'), // mois 2027-02
        payable('USD', '2026-12-31', '9.00'), // mois 2026-12
        payable('USD', '2026-11-01', '50.00', true),
      ],
      '2026-10-30',
      7,
    );
    expect(r.dueSoonUntil).toBe('2026-11-06');
    const usd = r.byCurrency[0]!;
    expect(usd.overdue).toEqual({ amount: '300.00', count: 1 });
    expect(usd.dueSoon).toEqual({ amount: '3.00', count: 2 });
    expect(usd.weeks).toEqual([
      { from: '2026-11-07', to: '2026-11-13', amount: '7.00', count: 2 },
      { from: '2026-11-14', to: '2026-11-20', amount: '5.00', count: 1 },
      { from: '2026-11-21', to: '2026-11-27', amount: '0.00', count: 0 },
      { from: '2026-11-28', to: '2026-12-04', amount: '6.00', count: 1 },
    ]);
    expect(usd.months).toEqual([
      { month: '2026-12', amount: '16.00', count: 2 },
      { month: '2027-02', amount: '8.00', count: 1 },
    ]);
    expect(usd.open).toEqual({ amount: '345.00', count: 10 });
    expect(usd.disputed).toEqual({ amount: '50.00', count: 1 });
  });

  it('jamais de somme CDF + USD ; fenêtre hors bornes : erreur', () => {
    const r = payablesSchedule(
      [payable('USD', '2026-10-31', '300.00'), payable('CDF', '2026-10-31', '200.00')],
      '2026-10-30',
      1,
    );
    expect(r.byCurrency.map((c) => [c.currency, c.dueSoon.amount])).toEqual([
      ['CDF', '200.00'],
      ['USD', '300.00'],
    ]);
    expect(() => payablesSchedule([], '2026-10-30', 0)).toThrow(RangeError);
    expect(() => payablesSchedule([], '2026-10-30', 31)).toThrow(RangeError);
  });

  it('propriété : chaque reste ouvert tombe dans une seule case', () => {
    const rand = rng(99);
    for (let n = 0; n < 50; n += 1) {
      const items = Array.from({ length: 40 }, () =>
        payable(
          'USD',
          `2026-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`,
          str(BigInt(1 + Math.floor(rand() * 100_000))),
        ),
      );
      const r = payablesSchedule(items, '2026-06-15', 1 + Math.floor(rand() * 30));
      const c = r.byCurrency[0]!;
      const cases = [c.overdue, c.dueSoon, ...c.weeks, ...c.months];
      expect(cases.reduce((s, b) => s + cents(b.amount), 0n)).toBe(cents(c.open.amount));
      expect(cases.reduce((s, b) => s + b.count, 0)).toBe(items.length);
    }
  });
});

// ─── Paiements ───────────────────────────────────────────────────────────────

describe('splitAllocation', () => {
  it('critère 10 : 500 payés sur 600 + 400 → 300 et 200', () => {
    expect(splitAllocation('500.00', [{ amount: '600.00' }, { amount: '400.00' }])).toEqual({
      version: PURCHASES_VERSION,
      shares: ['300.00', '200.00'],
    });
  });

  it('plus fort reste, égalités par ordre d’entrée', () => {
    expect(
      splitAllocation('0.01', [{ amount: '1' }, { amount: '1' }, { amount: '1' }]).shares,
    ).toEqual(['0.01', '0.00', '0.00']);
    expect(
      splitAllocation('100.00', [{ amount: '1' }, { amount: '1' }, { amount: '1' }]).shares,
    ).toEqual(['33.34', '33.33', '33.33']);
    // restes : 10×1/3 = 3.33.. ; 10×2/3 = 6.66.. → le second (reste 2/3) prend le centime
    expect(splitAllocation('0.10', [{ amount: '1' }, { amount: '2' }]).shares).toEqual([
      '0.03',
      '0.07',
    ]);
    expect(splitAllocation('0.00', [{ amount: '5' }]).shares).toEqual(['0.00']);
    expect(splitAllocation('7.00', [{ amount: '0' }, { amount: '3' }]).shares).toEqual([
      '0.00',
      '7.00',
    ]);
  });

  it('sans poids positif : erreur', () => {
    expect(() => splitAllocation('1.00', [])).toThrow(RangeError);
    expect(() => splitAllocation('1.00', [{ amount: '0' }])).toThrow(RangeError);
  });

  it('propriétés (graine fixe) : somme exacte, parts ≥ 0, écart < 1 centime, montant = poids ⇒ identité', () => {
    const rand = rng(20261031);
    for (let n = 0; n < 500; n += 1) {
      const weights = Array.from({ length: 1 + Math.floor(rand() * 20) }, () => ({
        amount: str(BigInt(Math.floor(rand() * 100_000_000))),
      }));
      const W = weights.reduce((s, w) => s + cents(w.amount), 0n);
      if (W === 0n) continue;
      const amount = BigInt(Math.floor(rand() * 1_000_000_000));
      const { shares } = splitAllocation(str(amount), weights);
      expect(shares).toHaveLength(weights.length);
      expect(shares.reduce((s, v) => s + cents(v), 0n)).toBe(amount);
      shares.forEach((v, i) => {
        const share = cents(v);
        expect(share >= 0n).toBe(true);
        const exactTimesW = amount * cents(weights[i]!.amount);
        // |part × W − montant × poids| < W
        const d = share * W - exactTimesW;
        expect(d < W && d > -W).toBe(true);
      });
      expect(splitAllocation(str(W), weights).shares).toEqual(
        weights.map((w) => str(cents(w.amount))),
      );
    }
  });
});

describe('checkSupplierPayment', () => {
  const remainingByInvoice = { F1: '500.00', F2: '200.00' };

  it('paiement valide', () => {
    expect(
      checkSupplierPayment({
        amount: '700.00',
        allocations: [
          { invoiceId: 'F1', amount: '500.00' },
          { invoiceId: 'F2', amount: '200.00' },
        ],
        remainingByInvoice,
      }),
    ).toEqual({ version: PURCHASES_VERSION, ok: true, issues: [] });
  });

  it('tous les problèmes rendus d’un coup', () => {
    const r = checkSupplierPayment({
      amount: '800.00',
      allocations: [
        { invoiceId: 'F1', amount: '500.01' },
        { invoiceId: 'F1', amount: '0' },
      ],
      remainingByInvoice,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => [i.code, i.allocationIndex])).toEqual([
      ['SUPPLIER_PAYMENT_EXCEEDS_REMAINING', 0],
      ['SUPPLIER_PAYMENT_ALLOCATION_INVALID', 1],
      ['SUPPLIER_PAYMENT_ALLOCATION_DUPLICATE', 1],
    ]);
    const mismatch = checkSupplierPayment({
      amount: '600.00',
      allocations: [{ invoiceId: 'F1', amount: '500.00' }],
      remainingByInvoice,
    });
    expect(mismatch.issues).toEqual([
      expect.objectContaining({
        code: 'SUPPLIER_PAYMENT_ALLOCATION_MISMATCH',
        details: { allocated: '500.00', amount: '600.00' },
      }),
    ]);
    expect(
      checkSupplierPayment({ amount: '0', allocations: [], remainingByInvoice }).issues.map(
        (i) => i.code,
      ),
    ).toEqual(['SUPPLIER_PAYMENT_AMOUNT_INVALID', 'SUPPLIER_PAYMENT_NO_ALLOCATION']);
  });

  it('facture non résolue par l’appelant : erreur', () => {
    expect(() =>
      checkSupplierPayment({
        amount: '1',
        allocations: [{ invoiceId: 'X', amount: '1' }],
        remainingByInvoice,
      }),
    ).toThrow(RangeError);
  });
});

describe('possibleDuplicateExpenses', () => {
  it('même fournisseur, devise et montant, à trois jours ou moins', () => {
    const r = possibleDuplicateExpenses(
      [
        { id: 'P1', supplierId: 'S', currency: 'USD', amount: '200.00', paidOn: '2026-10-10' },
        { id: 'P2', supplierId: 'T', currency: 'USD', amount: '50.00', paidOn: '2026-10-10' },
      ],
      [
        { id: 'E1', supplierId: 'S', currency: 'USD', amount: '200.00', spentOn: '2026-10-13' }, // 3 j
        { id: 'E0', supplierId: 'S', currency: 'USD', amount: '200.00', spentOn: '2026-10-07' }, // 3 j avant
        { id: 'E2', supplierId: 'S', currency: 'USD', amount: '200.00', spentOn: '2026-10-14' }, // 4 j
        { id: 'E3', supplierId: 'S', currency: 'CDF', amount: '200.00', spentOn: '2026-10-10' },
        { id: 'E4', supplierId: 'S', currency: 'USD', amount: '200.01', spentOn: '2026-10-10' },
        { id: 'E5', supplierId: null, currency: 'USD', amount: '200.00', spentOn: '2026-10-10' },
        { id: 'E6', supplierId: 'T', currency: 'USD', amount: '200.00', spentOn: '2026-10-10' },
      ],
    );
    expect(r.windowDays).toBe(3);
    expect(r.duplicates).toEqual([
      {
        code: 'POSSIBLE_DUPLICATE_EXPENSE',
        paymentId: 'P1',
        expenseId: 'E0',
        supplierId: 'S',
        currency: 'USD',
        amount: '200.00',
        daysApart: 3,
      },
      {
        code: 'POSSIBLE_DUPLICATE_EXPENSE',
        paymentId: 'P1',
        expenseId: 'E1',
        supplierId: 'S',
        currency: 'USD',
        amount: '200.00',
        daysApart: 3,
      },
    ]);
  });

  it('montants comparés exactement (« 200 » = « 200.00 ») ; aucun : vide', () => {
    expect(
      possibleDuplicateExpenses(
        [{ id: 'P', supplierId: 'S', currency: 'CDF', amount: '200', paidOn: '2026-12-31' }],
        [{ id: 'E', supplierId: 'S', currency: 'CDF', amount: '200.00', spentOn: '2027-01-01' }],
      ).duplicates,
    ).toHaveLength(1);
    expect(possibleDuplicateExpenses([], []).duplicates).toEqual([]);
  });
});

// ─── Reste à facturer et résumé ──────────────────────────────────────────────

describe('orderRemainingToInvoice', () => {
  it('reste par ligne au prix net, factures validées seulement', () => {
    const r = orderRemainingToInvoice(
      {
        currency: 'USD',
        lines: [
          {
            id: 'L1',
            quantity: '10',
            unitPrice: '5.00',
            receivable: true,
            category: 'achats',
            workProjectId: 'P',
          },
          { id: 'L2', quantity: '3', unitPrice: '3.33', discountPercent: '10', receivable: false },
        ],
      },
      [
        {
          id: 'V',
          kind: 'invoice',
          status: 'validated',
          lines: [
            { orderLineId: 'L1', quantity: '6' },
            { orderLineId: null, quantity: '1' },
          ],
        },
        {
          id: 'D',
          kind: 'invoice',
          status: 'draft',
          lines: [{ orderLineId: 'L1', quantity: '4' }],
        },
        {
          id: 'A',
          kind: 'credit_note',
          status: 'validated',
          lines: [{ orderLineId: 'L1', quantity: '4' }],
        },
        {
          id: 'W',
          kind: 'invoice',
          status: 'validated',
          lines: [{ orderLineId: 'L2', quantity: '5' }],
        },
      ],
    );
    expect(r).toEqual({
      version: PURCHASES_VERSION,
      currency: 'USD',
      lines: [
        {
          orderLineId: 'L1',
          category: 'achats',
          workProjectId: 'P',
          ordered: '10',
          invoiced: '6',
          remainingQuantity: '4',
          remainingAmount: '20.00',
        },
        {
          orderLineId: 'L2',
          category: null,
          workProjectId: null,
          ordered: '3',
          invoiced: '5',
          remainingQuantity: '0',
          remainingAmount: '0.00',
        },
      ],
      remainingAmount: '20.00',
    });
  });
});

describe('purchasesSummary', () => {
  const invoice = (over: Partial<SummaryInvoiceInput>): SummaryInvoiceInput => ({
    id: 'F1',
    kind: 'invoice',
    status: 'validated',
    supplierId: 'S1',
    currency: 'USD',
    total: '1000.00',
    lines: [],
    costAllocations: [
      { category: 'achats', workProjectId: 'P', amount: '600.00' },
      { category: 'services_exterieurs', amount: '400.00' },
    ],
    settlement: { paid: '500.00', credited: '0.00', remaining: '500.00' },
    ...over,
  });

  it('engagé, facturé, payé et reste par devise, fournisseur et catégorie, sans conversion', () => {
    const r = purchasesSummary({
      orders: [
        {
          id: 'O1',
          supplierId: 'S1',
          currency: 'USD',
          lines: [
            { id: 'L1', quantity: '10', unitPrice: '5.00', receivable: true, category: 'achats' },
          ],
        },
        {
          id: 'O2',
          supplierId: 'S2',
          currency: 'CDF',
          lines: [
            {
              id: 'M1',
              quantity: '2',
              unitPrice: '125000.00',
              receivable: false,
              category: 'transport',
            },
          ],
        },
      ],
      invoices: [
        invoice({ lines: [{ orderLineId: 'L1', quantity: '6' }] }),
        invoice({ id: 'D', status: 'draft' }),
        invoice({ id: 'C', status: 'cancelled' }),
        invoice({ id: 'A', kind: 'credit_note' }),
      ],
    });
    expect(r.version).toBe(PURCHASES_VERSION);
    expect(r.byCurrency).toEqual([
      {
        currency: 'CDF',
        committed: '250000.00',
        invoiced: '0.00',
        credited: '0.00',
        paid: '0.00',
        remaining: '0.00',
      },
      {
        currency: 'USD',
        committed: '20.00',
        invoiced: '1000.00',
        credited: '0.00',
        paid: '500.00',
        remaining: '500.00',
      },
    ]);
    expect(r.bySupplier).toEqual([
      {
        supplierId: 'S2',
        currency: 'CDF',
        committed: '250000.00',
        invoiced: '0.00',
        credited: '0.00',
        paid: '0.00',
        remaining: '0.00',
      },
      {
        supplierId: 'S1',
        currency: 'USD',
        committed: '20.00',
        invoiced: '1000.00',
        credited: '0.00',
        paid: '500.00',
        remaining: '500.00',
      },
    ]);
    expect(r.byCategory).toEqual([
      {
        category: 'transport',
        currency: 'CDF',
        committed: '250000.00',
        invoiced: '0.00',
        credited: '0.00',
        paid: '0.00',
        remaining: '0.00',
      },
      {
        category: 'achats',
        currency: 'USD',
        committed: '20.00',
        invoiced: '600.00',
        credited: '0.00',
        paid: '300.00',
        remaining: '300.00',
      },
      {
        category: 'services_exterieurs',
        currency: 'USD',
        committed: '0.00',
        invoiced: '400.00',
        credited: '0.00',
        paid: '200.00',
        remaining: '200.00',
      },
    ]);
  });

  it('imputations incohérentes ou catégorie manquante : erreur', () => {
    expect(() =>
      purchasesSummary({
        orders: [],
        invoices: [invoice({ costAllocations: [{ category: 'achats', amount: '999.99' }] })],
      }),
    ).toThrow(RangeError);
    expect(() =>
      purchasesSummary({
        orders: [
          {
            id: 'O',
            supplierId: 'S',
            currency: 'USD',
            lines: [{ id: 'L', quantity: '1', unitPrice: '1', receivable: true }],
          },
        ],
        invoices: [],
      }),
    ).toThrow(RangeError);
  });

  it('propriété : Σ par catégorie = Σ par fournisseur = par devise', () => {
    const rand = rng(5);
    const cats = ['achats', 'transport', 'loyer'];
    const invoices: SummaryInvoiceInput[] = Array.from({ length: 60 }, (_, i) => {
      const parts = Array.from({ length: 1 + Math.floor(rand() * 3) }, () =>
        BigInt(1 + Math.floor(rand() * 100_000)),
      );
      const total = parts.reduce((s, p) => s + p, 0n);
      const paid = BigInt(Math.floor(rand() * Number(total)));
      return invoice({
        id: `F${i}`,
        supplierId: `S${Math.floor(rand() * 4)}`,
        currency: rand() < 0.5 ? 'CDF' : 'USD',
        total: str(total),
        costAllocations: parts.map((p, k) => ({ category: cats[k % 3]!, amount: str(p) })),
        settlement: { paid: str(paid), credited: '0.00', remaining: str(total - paid) },
      });
    });
    const r = purchasesSummary({ orders: [], invoices });
    for (const c of r.byCurrency) {
      for (const field of ['invoiced', 'paid', 'remaining'] as const) {
        const bySup = r.bySupplier
          .filter((s) => s.currency === c.currency)
          .reduce((s, x) => s + cents(x[field]), 0n);
        const byCat = r.byCategory
          .filter((s) => s.currency === c.currency)
          .reduce((s, x) => s + cents(x[field]), 0n);
        expect(bySup).toBe(cents(c[field]));
        expect(byCat).toBe(cents(c[field]));
      }
    }
  });
});

// ─── Garde-fous de source ────────────────────────────────────────────────────

describe('sources du module', () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => ({ f, text: readFileSync(join(dir, f), 'utf8') }));

  it('aucune horloge, aucun flottant pour un montant, aucune TVA déductible (critère 18)', () => {
    for (const { f, text } of sources) {
      expect(text, f).not.toMatch(/new Date\(|Date\.now|parseFloat|\bNumber\(/);
      expect(text, f).not.toMatch(/deductibleVat/);
    }
  });
});
