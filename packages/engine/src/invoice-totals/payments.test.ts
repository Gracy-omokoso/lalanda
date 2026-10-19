// Paiements d'une facture (ADR-0023 § S25e.8, critères E1).
//
// Les attendus sont des littéraux ; les propriétés recoupent le moteur par une
// arithmétique de contrôle propre au test (centimes entiers obtenus en retirant
// le point), indépendante de `decimal.ts`.

import { describe, expect, it } from 'vitest';

import {
  PAYMENT_METHODS,
  checkPayments,
  reconcilePayments,
  type PaymentInput,
  type PaymentMethod,
} from '../index.js';

// ── Outils de contrôle ───────────────────────────────────────────────────────

/** « 1234.56 » → 123456n. Refuse toute autre forme. */
function cents(text: string): bigint {
  expect(text).toMatch(/^\d+\.\d{2}$/);
  return BigInt(text.replace('.', ''));
}
const money = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
const pay = (method: PaymentMethod, amount: string): PaymentInput => ({ method, amount });
const codes = (issues: readonly { code: string }[]) => issues.map((i) => i.code);

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function generator(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T;
  return { next, int, pick };
}

// ── checkPayments ────────────────────────────────────────────────────────────

describe('checkPayments', () => {
  it('somme exacte en chaînes : 0,10 + 0,20 = 0,30', () => {
    const check = checkPayments('0.30', [pay('ESPECES', '0.10'), pay('VIREMENT', '0.20')]);
    expect(check).toEqual({ ok: true, issues: [], paidTotal: '0.30', amountOnCredit: '0.00' });
  });

  it('montants sans décimales ou à une décimale acceptés, résultat canonique à 2 décimales', () => {
    const check = checkPayments('15.50', [pay('ESPECES', '10'), pay('CHEQUES', '5.5')]);
    expect(check.ok).toBe(true);
    expect(check.paidTotal).toBe('15.50');
  });

  it('amountOnCredit additionne toutes les parts CREDIT', () => {
    const check = checkPayments('100.00', [
      pay('CREDIT', '30.00'),
      pay('ESPECES', '40.00'),
      pay('CREDIT', '30.00'),
    ]);
    expect(check.ok).toBe(true);
    expect(check.amountOnCredit).toBe('60.00');
  });

  it('vente entièrement à crédit admise', () => {
    const check = checkPayments('4064.00', [pay('CREDIT', '4064.00')]);
    expect(check).toEqual({
      ok: true,
      issues: [],
      paidTotal: '4064.00',
      amountOnCredit: '4064.00',
    });
  });

  it('les sept modes e-DEF sont admis, le même mode peut revenir', () => {
    expect(PAYMENT_METHODS).toEqual([
      'ESPECES',
      'VIREMENT',
      'CARTEBANCAIRE',
      'MOBILEMONEY',
      'CHEQUES',
      'CREDIT',
      'AUTRE',
    ]);
    const payments = [...PAYMENT_METHODS, 'ESPECES' as const].map((m) => pay(m, '1.00'));
    expect(checkPayments('8.00', payments).ok).toBe(true);
  });

  it('aucun paiement → NO_PAYMENTS', () => {
    const check = checkPayments('10.00', []);
    expect(codes(check.issues)).toEqual(['NO_PAYMENTS']);
    expect(check.paidTotal).toBe('0.00');
  });

  it.each(['0', '0.00', '-1.00', '1.005', '1e3', '', ' 1.00', '1,00', '+1'])(
    'montant %j refusé (PAYMENT_AMOUNT_INVALID)',
    (amount) => {
      const check = checkPayments('1.00', [pay('ESPECES', amount)]);
      expect(check.ok).toBe(false);
      expect(codes(check.issues)).toEqual(['PAYMENT_AMOUNT_INVALID']);
      expect(check.issues[0]?.details?.paymentIndex).toBe('0');
    },
  );

  it('un montant qui n’est pas une chaîne est refusé', () => {
    const check = checkPayments('1.00', [{ method: 'ESPECES', amount: 1 as unknown as string }]);
    expect(codes(check.issues)).toEqual(['PAYMENT_AMOUNT_INVALID']);
  });

  it('mode inconnu signalé (details.field = method), la somme reste contrôlée', () => {
    const check = checkPayments('10.00', [
      { method: 'BITCOIN' as PaymentMethod, amount: '5.00' },
      pay('ESPECES', '4.00'),
    ]);
    expect(codes(check.issues)).toEqual(['PAYMENT_AMOUNT_INVALID', 'PAYMENTS_TOTAL_MISMATCH']);
    expect(check.issues[0]?.details).toMatchObject({ paymentIndex: '0', field: 'method' });
    expect(check.paidTotal).toBe('9.00');
  });

  it('écart d’un centime en plus ou en moins : PAYMENTS_TOTAL_MISMATCH avec le détail', () => {
    const under = checkPayments('100.00', [pay('ESPECES', '99.99')]);
    expect(under.issues).toEqual([
      expect.objectContaining({
        code: 'PAYMENTS_TOTAL_MISMATCH',
        lineIndex: null,
        details: { total: '100.00', paidTotal: '99.99', difference: '0.01', direction: 'under' },
      }),
    ]);
    const over = checkPayments('100.00', [pay('ESPECES', '60.00'), pay('CREDIT', '40.01')]);
    expect(over.issues[0]?.details).toMatchObject({ difference: '0.01', direction: 'over' });
    expect(over.amountOnCredit).toBe('40.01');
  });

  it('tous les problèmes d’un coup ; pas d’écart de somme tant qu’un montant est illisible', () => {
    const check = checkPayments('50.00', [
      pay('ESPECES', '0.00'),
      pay('VIREMENT', 'abc'),
      pay('CREDIT', '10.00'),
    ]);
    expect(codes(check.issues)).toEqual(['PAYMENT_AMOUNT_INVALID', 'PAYMENT_AMOUNT_INVALID']);
    expect(check.issues.map((i) => i.details?.paymentIndex)).toEqual(['0', '1']);
    expect(check.paidTotal).toBe('10.00');
    expect(check.amountOnCredit).toBe('10.00');
  });

  it('messages en français', () => {
    const check = checkPayments('100.00', [pay('ESPECES', '99.99')]);
    expect(check.issues[0]?.message).toMatch(/somme des paiements/);
  });

  it.each(['abc', '1.005', '-1.00', ''])('total %j illisible : erreur de programmation', (t) => {
    expect(() => checkPayments(t, [pay('ESPECES', '1.00')])).toThrow(RangeError);
  });

  it('propriété : la somme de paiements tirés au hasard est acceptée, au centime près', () => {
    const random = generator(20261019);
    for (let n = 0; n < 1000; n += 1) {
      const count = random.int(1, 7);
      const payments = Array.from({ length: count }, () =>
        pay(random.pick(PAYMENT_METHODS), money(BigInt(random.int(1, 99_999_999)))),
      );
      const sum = payments.reduce((s, p) => s + cents(p.amount), 0n);
      const credit = payments
        .filter((p) => p.method === 'CREDIT')
        .reduce((s, p) => s + cents(p.amount), 0n);
      const check = checkPayments(money(sum), payments);
      expect(check.ok).toBe(true);
      expect(cents(check.paidTotal)).toBe(sum);
      expect(cents(check.amountOnCredit)).toBe(credit);
      const off = checkPayments(money(sum + 1n), payments);
      expect(codes(off.issues)).toEqual(['PAYMENTS_TOTAL_MISMATCH']);
    }
  });
});

// ── reconcilePayments ────────────────────────────────────────────────────────

describe('reconcilePayments', () => {
  it('trois paiements convertis dont la somme dépasse d’un centime : le plus gros porte −0,01', () => {
    const result = reconcilePayments('98026.32', [
      pay('ESPECES', '22623.20'),
      pay('VIREMENT', '45246.40'),
      pay('CREDIT', '30156.73'),
    ]);
    expect(result).toEqual({
      ok: true,
      payments: [
        pay('ESPECES', '22623.20'),
        pay('VIREMENT', '45246.39'),
        pay('CREDIT', '30156.73'),
      ],
    });
  });

  it('somme inférieure d’un centime : le plus gros porte +0,01', () => {
    const result = reconcilePayments('100.01', [pay('ESPECES', '40.00'), pay('CHEQUES', '60.00')]);
    expect(result).toEqual({
      ok: true,
      payments: [pay('ESPECES', '40.00'), pay('CHEQUES', '60.01')],
    });
  });

  it('à égalité, le premier des plus gros porte l’écart', () => {
    const result = reconcilePayments('250.01', [
      pay('ESPECES', '100.00'),
      pay('VIREMENT', '100.00'),
      pay('CHEQUES', '50.00'),
    ]);
    expect(result.ok && result.payments.map((p) => p.amount)).toEqual([
      '100.01',
      '100.00',
      '50.00',
    ]);
  });

  it('sans écart : montants inchangés, mis au format canonique', () => {
    const result = reconcilePayments('15.50', [pay('ESPECES', '10'), pay('CREDIT', '5.5')]);
    expect(result).toEqual({
      ok: true,
      payments: [pay('ESPECES', '10.00'), pay('CREDIT', '5.50')],
    });
  });

  it('un paiement qui deviendrait nul ou négatif → PAYMENT_AMOUNT_INVALID', () => {
    const nul = reconcilePayments('0.01', [pay('ESPECES', '0.01'), pay('ESPECES', '0.01')]);
    expect(nul.ok === false && codes(nul.issues)).toEqual(['PAYMENT_AMOUNT_INVALID']);
    const negative = reconcilePayments('1.00', [pay('ESPECES', '2.00'), pay('CREDIT', '1.50')]);
    expect(negative.ok === false && negative.issues[0]?.details?.paymentIndex).toBe('0');
  });

  it('aucun paiement → NO_PAYMENTS ; montant illisible → PAYMENT_AMOUNT_INVALID', () => {
    const none = reconcilePayments('1.00', []);
    expect(none.ok === false && codes(none.issues)).toEqual(['NO_PAYMENTS']);
    const bad = reconcilePayments('1.00', [pay('ESPECES', '0.00'), pay('ESPECES', '1.001')]);
    expect(bad.ok === false && codes(bad.issues)).toEqual([
      'PAYMENT_AMOUNT_INVALID',
      'PAYMENT_AMOUNT_INVALID',
    ]);
  });

  it('ne modifie pas le tableau reçu', () => {
    const payments = Object.freeze([pay('ESPECES', '1.00'), pay('CREDIT', '2.00')]);
    reconcilePayments('3.01', payments);
    expect(payments).toEqual([pay('ESPECES', '1.00'), pay('CREDIT', '2.00')]);
  });

  it('propriété : somme exacte, un seul paiement touché (le plus gros), modes et ordre gardés', () => {
    const random = generator(7);
    for (let n = 0; n < 1000; n += 1) {
      const count = random.int(1, 5);
      const payments = Array.from({ length: count }, () =>
        pay(random.pick(PAYMENT_METHODS), money(BigInt(random.int(1_000, 50_000_000)))),
      );
      const sum = payments.reduce((s, p) => s + cents(p.amount), 0n);
      const target = sum + BigInt(random.int(-count, count)); // écart d'arrondi : quelques centimes
      const result = reconcilePayments(money(target), payments);
      if (!result.ok) throw new Error('réconciliation refusée');
      expect(result.payments.reduce((s, p) => s + cents(p.amount), 0n)).toBe(target);
      expect(result.payments.map((p) => p.method)).toEqual(payments.map((p) => p.method));
      const amounts = payments.map((p) => cents(p.amount));
      const largest = amounts.indexOf(amounts.reduce((a, b) => (b > a ? b : a)));
      result.payments.forEach((p, i) => {
        if (i !== largest) expect(p.amount).toBe(payments[i]?.amount);
      });
      const check = checkPayments(money(target), result.payments);
      expect(check.ok).toBe(true);
    }
  });
});
