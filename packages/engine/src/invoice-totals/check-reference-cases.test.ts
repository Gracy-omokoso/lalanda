// Cas de référence des contrôles de facture (ADR-0023 § S25e.9, critères E1).
//
// Chaque cas est rejoué par le moteur ET recoupé par une seconde méthode
// indépendante de `decimal.ts` : produits d'entiers obtenus en retirant le
// point, arrondis au centime à la main ; sommes en centimes ; quantités en
// millièmes.

import { describe, expect, it } from 'vitest';

import {
  INVOICE_CHECK_REFERENCE_CASES,
  checkCreditNote,
  checkPayments,
  convertDocumentToCdf,
  reconcilePayments,
  type InvoiceCheckIssueCode,
  type InvoiceCheckReferenceCase,
} from '../index.js';

// ── Seconde méthode ──────────────────────────────────────────────────────────

/** « 12.345 » → { units: 12345n, digits: 3 } ; null si ce n'est pas un décimal canonique. */
function units(text: string): { units: bigint; digits: number } | null {
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const [integer = '', fraction = ''] = text.split('.');
  return { units: BigInt(integer + fraction), digits: fraction.length };
}
/** Montant en centimes (au plus 2 décimales), ou null. */
function toCents(text: string): bigint | null {
  const value = units(text);
  if (value === null || value.digits > 2) return null;
  return value.units * 10n ** BigInt(2 - value.digits);
}
/** Quantité en millièmes (au plus 3 décimales). */
function toMilli(text: string): bigint {
  const value = units(text);
  if (value === null || value.digits > 3) throw new Error(`quantité ${text}`);
  return value.units * 10n ** BigInt(3 - value.digits);
}
/** a × b arrondi au centime le plus proche, demi vers le haut. */
function productInCents(a: string, b: string): bigint {
  const x = units(a);
  const y = units(b);
  if (x === null || y === null) throw new Error(`${a} × ${b}`);
  const digits = x.digits + y.digits;
  const value = x.units * y.units;
  if (digits <= 2) return value * 10n ** BigInt(2 - digits);
  const divisor = 10n ** BigInt(digits - 2);
  return value / divisor + (2n * (value % divisor) >= divisor ? 1n : 0n);
}
const money = (c: bigint) => `${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`;
const milliText = (m: bigint) => {
  const fraction = (m % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return fraction === '' ? `${m / 1000n}` : `${m / 1000n}.${fraction}`;
};
const codes = (issues: readonly { code: string }[]) => issues.map((i) => i.code);

type Case<K extends InvoiceCheckReferenceCase['kind']> = Extract<
  InvoiceCheckReferenceCase,
  { kind: K }
>;
const ofKind = <K extends InvoiceCheckReferenceCase['kind']>(kind: K) =>
  INVOICE_CHECK_REFERENCE_CASES.filter((c): c is Case<K> => c.kind === kind);

// ── Inventaire ───────────────────────────────────────────────────────────────

describe('inventaire des cas', () => {
  it('identifiants uniques, notes renseignées', () => {
    const ids = INVOICE_CHECK_REFERENCE_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of INVOICE_CHECK_REFERENCE_CASES) expect(c.note.length).toBeGreaterThan(10);
  });

  it('chacun des neuf codes de problème est illustré par au moins un cas', () => {
    const all: InvoiceCheckIssueCode[] = [
      'NO_PAYMENTS',
      'PAYMENT_AMOUNT_INVALID',
      'PAYMENTS_TOTAL_MISMATCH',
      'CREDIT_NOTE_LINE_NOT_IN_ORIGIN',
      'CREDIT_NOTE_QUANTITY_EXCEEDED',
      'CREDIT_NOTE_PRICE_MISMATCH',
      'CREDIT_NOTE_AMOUNT_EXCEEDS_ORIGIN',
      'EXCHANGE_RATE_INVALID',
      'CONVERTED_AMOUNT_ZERO',
    ];
    const covered = new Set(
      INVOICE_CHECK_REFERENCE_CASES.flatMap((c) => ('codes' in c.expected ? c.expected.codes : [])),
    );
    expect([...covered].sort()).toEqual([...all].sort());
  });

  it('les critères d’ADR-0023 (E1) figurent parmi les cas', () => {
    const ids = new Set(INVOICE_CHECK_REFERENCE_CASES.map((c) => c.id));
    for (const id of [
      'paiements-somme-exacte',
      'reconciliation-trois-paiements',
      'conversion-prix-simple',
      'conversion-demi-centime',
      'conversion-remise-montant',
      'conversion-identite-cdf',
      'conversion-prix-nul',
      'avoir-cumul-trois',
      'avoir-depassement-millieme',
      'avoir-prix-different',
      'avoir-montant-depasse-centime',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });
});

// ── Paiements ────────────────────────────────────────────────────────────────

describe('paiements', () => {
  for (const c of ofKind('payments')) {
    it(c.id, () => {
      const check = checkPayments(c.total, c.payments);
      expect(check.ok).toBe(c.expected.ok);
      expect(codes(check.issues)).toEqual(c.expected.codes);
      expect(check.paidTotal).toBe(c.expected.paidTotal);
      expect(check.amountOnCredit).toBe(c.expected.amountOnCredit);

      // Seconde méthode : somme des montants lisibles et strictement positifs.
      const readable = c.payments
        .map((p) => ({ method: p.method, cents: toCents(p.amount) }))
        .filter((p): p is { method: typeof p.method; cents: bigint } => (p.cents ?? 0n) > 0n);
      const paid = readable.reduce((s, p) => s + p.cents, 0n);
      const credit = readable
        .filter((p) => p.method === 'CREDIT')
        .reduce((s, p) => s + p.cents, 0n);
      expect(money(paid)).toBe(c.expected.paidTotal);
      expect(money(credit)).toBe(c.expected.amountOnCredit);
      const allReadable = readable.length === c.payments.length && c.payments.length > 0;
      expect(c.expected.ok).toBe(allReadable && paid === toCents(c.total));
    });
  }
});

describe('réconciliation', () => {
  for (const c of ofKind('reconcile')) {
    it(c.id, () => {
      const result = reconcilePayments(c.total, c.payments);
      if (!c.expected.ok) {
        expect(result.ok === false && codes(result.issues)).toEqual(c.expected.codes);
        return;
      }
      if (!result.ok) throw new Error('réconciliation refusée');
      expect(result.payments.map((p) => p.amount)).toEqual(c.expected.amounts);
      // Seconde méthode : somme exacte ; seul le premier des plus gros a bougé.
      const amounts = c.expected.amounts.map((a) => toCents(a) ?? -1n);
      expect(amounts.reduce((s, a) => s + a, 0n)).toBe(toCents(c.total));
      const input = c.payments.map((p) => toCents(p.amount) ?? -1n);
      const largest = input.indexOf(input.reduce((a, b) => (b > a ? b : a)));
      input.forEach((a, i) => {
        if (i !== largest) expect(amounts[i]).toBe(a);
      });
    });
  }
});

// ── Conversion ───────────────────────────────────────────────────────────────

describe('conversion USD → CDF', () => {
  for (const c of ofKind('conversion')) {
    it(c.id, () => {
      const result = convertDocumentToCdf(c.input);
      if (!c.expected.ok) {
        expect(result.ok === false && codes(result.issues)).toEqual(c.expected.codes);
        return;
      }
      if (!result.ok) throw new Error(`refus inattendu : ${codes(result.issues).join(', ')}`);
      expect(result.lines.map(({ index: _index, ...line }) => line)).toEqual(c.expected.lines);
      expect(result.payments.map((p) => p.amount)).toEqual(c.expected.payments);

      // Seconde méthode : prix sans remise, prix d'origine, taxe par unité et paiements.
      const rate = c.input.from === 'CDF' ? '1' : c.input.rate;
      c.input.lines.forEach((line, i) => {
        const expected = c.expected.ok ? c.expected.lines[i] : undefined;
        if (expected === undefined) throw new Error('ligne attendue manquante');
        if (line.discount === null) {
          expect(toCents(expected.unitPrice)).toBe(productInCents(line.unitPrice, rate));
        }
        if (line.originalPrice !== null) {
          expect(toCents(expected.originalPrice ?? '')).toBe(
            productInCents(line.originalPrice, rate),
          );
        }
        if (line.specificTax?.kind === 'per_unit') {
          expect(expected.specificTax?.kind).toBe('per_unit');
          if (expected.specificTax?.kind === 'per_unit') {
            expect(toCents(expected.specificTax.amount)).toBe(
              productInCents(line.specificTax.amount, rate),
            );
          }
        }
      });
      c.input.payments.forEach((p, i) => {
        expect(toCents(c.expected.ok ? (c.expected.payments[i] ?? '') : '')).toBe(
          productInCents(p.amount, rate),
        );
      });
    });
  }

  it('remise en montant : prix recalculé recoupé à la main (fraction exacte)', () => {
    const c = ofKind('conversion').find((k) => k.id === 'conversion-remise-montant');
    if (c === undefined || !c.expected.ok) throw new Error('cas manquant');
    const line = c.input.lines[0];
    if (line?.discount?.kind !== 'total_amount' || line.originalPrice === null) {
      throw new Error('forme du cas');
    }
    const original = productInCents(line.originalPrice, c.input.rate);
    const discount = productInCents(line.discount.value, c.input.rate);
    const quantity = toMilli(line.quantity);
    // prix = (origine × qté − remise) / qté, en centimes : numérateur en 10⁻⁵.
    const numerator = original * quantity - discount * 1000n;
    const price = numerator / quantity + (2n * (numerator % quantity) >= quantity ? 1n : 0n);
    expect(money(price)).toBe(c.expected.lines[0]?.unitPrice);
    const effective = ((original - price) * quantity + 500n) / 1000n;
    expect(money(effective)).toBe('22623.21');
  });
});

// ── Avoirs ───────────────────────────────────────────────────────────────────

describe('avoirs', () => {
  for (const c of ofKind('credit_note')) {
    it(c.id, () => {
      const check = checkCreditNote(c.input);
      expect(check.ok).toBe(c.expected.ok);
      expect(codes(check.issues)).toEqual(c.expected.codes);
      expect(check.creditedAfter.map((e) => e.quantity)).toEqual(c.expected.creditedAfter);
      expect(check.remainingAfter.map((e) => e.quantity)).toEqual(c.expected.remainingAfter);

      // Seconde méthode : comptabilité en millièmes et en centimes.
      const known = new Set(c.input.originLines.map((l) => l.index));
      const credited = c.input.originLines.map((origin) => {
        const before = c.input.alreadyCredited
          .filter((e) => e.lineIndex === origin.index)
          .reduce((s, e) => s + toMilli(e.quantity), 0n);
        const now = c.input.lines
          .filter((l) => l.originLineIndex === origin.index)
          .reduce((s, l) => s + toMilli(l.quantity), 0n);
        return {
          sold: toMilli(origin.quantity),
          after: before + now,
          price: toCents(origin.unitPrice),
        };
      });
      expect(credited.map((e) => milliText(e.after))).toEqual(c.expected.creditedAfter);
      expect(credited.map((e) => milliText(e.sold > e.after ? e.sold - e.after : 0n))).toEqual(
        c.expected.remainingAfter,
      );
      const expectedCodes: InvoiceCheckIssueCode[] = [];
      for (const line of c.input.lines) {
        if (!known.has(line.originLineIndex)) expectedCodes.push('CREDIT_NOTE_LINE_NOT_IN_ORIGIN');
        else {
          const origin = c.input.originLines.find((o) => o.index === line.originLineIndex);
          if (toCents(line.unitPrice) !== toCents(origin?.unitPrice ?? '')) {
            expectedCodes.push('CREDIT_NOTE_PRICE_MISMATCH');
          }
        }
      }
      if (credited.some((e) => e.after > e.sold))
        expectedCodes.push('CREDIT_NOTE_QUANTITY_EXCEEDED');
      const cumulated =
        c.input.previousCreditTotals.reduce((s, t) => s + (toCents(t) ?? 0n), 0n) +
        (toCents(c.input.creditTotal) ?? 0n);
      if (cumulated > (toCents(c.input.originTotal) ?? 0n)) {
        expectedCodes.push('CREDIT_NOTE_AMOUNT_EXCEEDS_ORIGIN');
      }
      expect(expectedCodes).toEqual(c.expected.codes);
    });
  }
});
