// Contrôles d'un avoir (ADR-0023 § S25e.5, critères E1).
//
// Attendus littéraux ; propriété : suites d'avoirs partiels tirés au hasard,
// recoupées par une comptabilité de contrôle propre au test (millièmes entiers).

import { describe, expect, it } from 'vitest';

import { checkCreditNote, remainingQuantities, type OriginLine } from '../index.js';

const ORIGIN: readonly OriginLine[] = [
  { index: 0, quantity: '2.375', unitPrice: '40.00' },
  { index: 1, quantity: '1', unitPrice: '25.00' },
  { index: 2, quantity: '10', unitPrice: '0.01' },
];

const base = {
  originLines: ORIGIN,
  alreadyCredited: [] as { lineIndex: number; quantity: string }[],
  lines: [] as { originLineIndex: number; quantity: string; unitPrice: string }[],
  originTotal: '135.30',
  previousCreditTotals: [] as string[],
  creditTotal: '0.00',
};
const codes = (issues: readonly { code: string }[]) => issues.map((i) => i.code);
const quantities = (list: readonly { quantity: string }[]) => list.map((e) => e.quantity);

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
  return { next, int };
}
/** Millièmes entiers → quantité canonique la plus courte. */
function quantityText(milli: number): string {
  const integer = Math.floor(milli / 1000);
  const fraction = String(milli % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return fraction === '' ? String(integer) : `${integer}.${fraction}`;
}

describe('checkCreditNote', () => {
  it('avoir total : tout crédité, reste 0 partout', () => {
    const check = checkCreditNote({
      ...base,
      lines: [
        { originLineIndex: 0, quantity: '2.375', unitPrice: '40.00' },
        { originLineIndex: 1, quantity: '1', unitPrice: '25.00' },
        { originLineIndex: 2, quantity: '10', unitPrice: '0.01' },
      ],
      creditTotal: '135.30',
    });
    expect(check).toEqual({
      ok: true,
      issues: [],
      creditedAfter: [
        { lineIndex: 0, quantity: '2.375' },
        { lineIndex: 1, quantity: '1' },
        { lineIndex: 2, quantity: '10' },
      ],
      remainingAfter: [
        { lineIndex: 0, quantity: '0' },
        { lineIndex: 1, quantity: '0' },
        { lineIndex: 2, quantity: '0' },
      ],
    });
  });

  it('cumul de trois avoirs : 1 + 0,375 déjà crédités, puis 1 → reste 0', () => {
    const check = checkCreditNote({
      ...base,
      alreadyCredited: [
        { lineIndex: 0, quantity: '1' },
        { lineIndex: 0, quantity: '0.375' },
      ],
      lines: [{ originLineIndex: 0, quantity: '1', unitPrice: '40.00' }],
      previousCreditTotals: ['46.40', '17.40'],
      creditTotal: '46.40',
    });
    expect(check.ok).toBe(true);
    expect(quantities(check.creditedAfter)).toEqual(['2.375', '0', '0']);
    expect(quantities(check.remainingAfter)).toEqual(['0', '1', '10']);
  });

  it('restant exact à 3 décimales ; deux lignes de l’avoir sur la même ligne d’origine s’additionnent', () => {
    const check = checkCreditNote({
      ...base,
      alreadyCredited: [{ lineIndex: 0, quantity: '0.125' }],
      lines: [
        { originLineIndex: 0, quantity: '0.1', unitPrice: '40.00' },
        { originLineIndex: 0, quantity: '0.15', unitPrice: '40' },
      ],
    });
    expect(check.ok).toBe(true);
    expect(quantities(check.creditedAfter)).toEqual(['0.375', '0', '0']);
    expect(quantities(check.remainingAfter)).toEqual(['2', '1', '10']);
  });

  it('dépassement d’un millième refusé, avec le restant', () => {
    const check = checkCreditNote({
      ...base,
      alreadyCredited: [{ lineIndex: 0, quantity: '2' }],
      lines: [{ originLineIndex: 0, quantity: '0.376', unitPrice: '40.00' }],
    });
    expect(check.issues).toEqual([
      expect.objectContaining({
        code: 'CREDIT_NOTE_QUANTITY_EXCEEDED',
        lineIndex: 0,
        details: {
          lineIndex: '0',
          remaining: '0.375',
          requested: '0.376',
          sold: '2.375',
          alreadyCredited: '2',
        },
      }),
    ]);
    expect(quantities(check.remainingAfter)).toEqual(['0', '1', '10']);
    expect(check.issues[0]?.message).toMatch(/il reste 0.375 à créditer/);
  });

  it('exactement le restant : accepté (borne incluse)', () => {
    const check = checkCreditNote({
      ...base,
      alreadyCredited: [{ lineIndex: 0, quantity: '2' }],
      lines: [{ originLineIndex: 0, quantity: '0.375', unitPrice: '40.00' }],
    });
    expect(check.ok).toBe(true);
  });

  it('dépassement réparti sur deux lignes de l’avoir : un seul problème, sur la première', () => {
    const check = checkCreditNote({
      ...base,
      lines: [
        { originLineIndex: 1, quantity: '0.6', unitPrice: '25.00' },
        { originLineIndex: 0, quantity: '1', unitPrice: '40.00' },
        { originLineIndex: 1, quantity: '0.5', unitPrice: '25.00' },
      ],
    });
    expect(check.issues.map((i) => [i.code, i.lineIndex, i.details?.lineIndex])).toEqual([
      ['CREDIT_NOTE_QUANTITY_EXCEEDED', 0, '1'],
    ]);
    expect(check.issues[0]?.details).toMatchObject({ remaining: '1', requested: '1.1' });
  });

  it('ligne inconnue refusée (et sans effet sur les quantités)', () => {
    const check = checkCreditNote({
      ...base,
      lines: [{ originLineIndex: 7, quantity: '1', unitPrice: '40.00' }],
    });
    expect(check.issues).toEqual([
      expect.objectContaining({
        code: 'CREDIT_NOTE_LINE_NOT_IN_ORIGIN',
        lineIndex: 0,
        details: { lineIndex: '7' },
      }),
    ]);
    expect(quantities(check.creditedAfter)).toEqual(['0', '0', '0']);
  });

  it('prix différent refusé, au centime ; même valeur écrite autrement acceptée', () => {
    const check = checkCreditNote({
      ...base,
      lines: [
        { originLineIndex: 1, quantity: '1', unitPrice: '24.99' },
        { originLineIndex: 0, quantity: '1', unitPrice: '40.01' },
        { originLineIndex: 2, quantity: '1', unitPrice: '0.01' },
      ],
    });
    expect(check.issues.map((i) => [i.code, i.lineIndex])).toEqual([
      ['CREDIT_NOTE_PRICE_MISMATCH', 0],
      ['CREDIT_NOTE_PRICE_MISMATCH', 1],
    ]);
    expect(check.issues[0]?.details).toEqual({
      lineIndex: '1',
      expected: '25.00',
      received: '24.99',
    });
    expect(
      checkCreditNote({
        ...base,
        lines: [{ originLineIndex: 1, quantity: '1', unitPrice: '25' }],
      }).ok,
    ).toBe(true);
  });

  it('dépassement d’un centime du montant d’origine signalé ; égalité acceptée', () => {
    const over = checkCreditNote({
      ...base,
      previousCreditTotals: ['100.00', '35.20'],
      creditTotal: '0.11',
    });
    expect(over.issues).toEqual([
      expect.objectContaining({
        code: 'CREDIT_NOTE_AMOUNT_EXCEEDS_ORIGIN',
        lineIndex: null,
        details: { originTotal: '135.30', creditedTotal: '135.31', excess: '0.01' },
      }),
    ]);
    const equal = checkCreditNote({
      ...base,
      previousCreditTotals: ['100.00', '35.20'],
      creditTotal: '0.10',
    });
    expect(equal.ok).toBe(true);
  });

  it('RRR rattaché (aucune ligne d’origine) : seul le montant cumulé est contrôlé', () => {
    const check = checkCreditNote({ ...base, lines: [], creditTotal: '135.30' });
    expect(check.ok).toBe(true);
    expect(quantities(check.remainingAfter)).toEqual(['2.375', '1', '10']);
  });

  it('tous les problèmes d’un coup', () => {
    const check = checkCreditNote({
      ...base,
      alreadyCredited: [{ lineIndex: 1, quantity: '1' }],
      lines: [
        { originLineIndex: 9, quantity: '1', unitPrice: '1.00' },
        { originLineIndex: 1, quantity: '0.001', unitPrice: '25.01' },
      ],
      previousCreditTotals: ['135.30'],
      creditTotal: '0.03',
    });
    expect(codes(check.issues)).toEqual([
      'CREDIT_NOTE_LINE_NOT_IN_ORIGIN',
      'CREDIT_NOTE_PRICE_MISMATCH',
      'CREDIT_NOTE_QUANTITY_EXCEEDED',
      'CREDIT_NOTE_AMOUNT_EXCEEDS_ORIGIN',
    ]);
  });

  it('déjà sur-crédité (données incohérentes) : restant ramené à 0, jamais négatif', () => {
    const check = checkCreditNote({
      ...base,
      alreadyCredited: [{ lineIndex: 1, quantity: '2' }],
    });
    expect(quantities(check.remainingAfter)).toEqual(['2.375', '0', '10']);
  });

  it('valeurs illisibles : erreur de programmation', () => {
    const bad = (patch: Partial<Parameters<typeof checkCreditNote>[0]>) => () =>
      checkCreditNote({ ...base, ...patch });
    expect(bad({ lines: [{ originLineIndex: 0, quantity: '0', unitPrice: '40.00' }] })).toThrow(
      RangeError,
    );
    expect(
      bad({ lines: [{ originLineIndex: 0, quantity: '0.0001', unitPrice: '40.00' }] }),
    ).toThrow(RangeError);
    expect(bad({ lines: [{ originLineIndex: 0, quantity: '1', unitPrice: '40.001' }] })).toThrow(
      RangeError,
    );
    expect(bad({ alreadyCredited: [{ lineIndex: 9, quantity: '1' }] })).toThrow(/ligne inconnue/);
    expect(bad({ originTotal: '-1' })).toThrow(RangeError);
    expect(bad({ previousCreditTotals: ['1,00'] })).toThrow(RangeError);
    expect(
      bad({
        originLines: [
          { index: 0, quantity: '1', unitPrice: '1.00' },
          { index: 0, quantity: '1', unitPrice: '1.00' },
        ],
      }),
    ).toThrow(/deux fois/);
  });
});

describe('remainingQuantities', () => {
  it('par ligne d’origine, dans l’ordre de l’origine, au format canonique', () => {
    expect(
      remainingQuantities(ORIGIN, [
        { lineIndex: 2, quantity: '9.999' },
        { lineIndex: 0, quantity: '0.375' },
        { lineIndex: 0, quantity: '1' },
      ]),
    ).toEqual([
      { lineIndex: 0, quantity: '1' },
      { lineIndex: 1, quantity: '1' },
      { lineIndex: 2, quantity: '0.001' },
    ]);
  });

  it('origine aux index non contigus ; sur-crédit ramené à 0', () => {
    const origin: OriginLine[] = [
      { index: 4, quantity: '3', unitPrice: '1.00' },
      { index: 1, quantity: '1.5', unitPrice: '2.00' },
    ];
    expect(remainingQuantities(origin, [{ lineIndex: 1, quantity: '2' }])).toEqual([
      { lineIndex: 4, quantity: '3' },
      { lineIndex: 1, quantity: '0' },
    ]);
  });

  it('propriété : avoirs partiels successifs jusqu’à épuisement, recoupés en millièmes', () => {
    const random = generator(20261019);
    for (let n = 0; n < 300; n += 1) {
      const sold = Array.from({ length: random.int(1, 5) }, () => random.int(1, 20_000));
      const origin: OriginLine[] = sold.map((milli, index) => ({
        index,
        quantity: quantityText(milli),
        unitPrice: '1.00',
      }));
      const credited = sold.map(() => 0);
      const history: { lineIndex: number; quantity: string }[] = [];
      for (let step = 0; step < 12; step += 1) {
        const lineIndex = random.int(0, sold.length - 1);
        const left = (sold[lineIndex] ?? 0) - (credited[lineIndex] ?? 0);
        // Une fois sur quatre, on tente de dépasser d'un à trois millièmes.
        const over = random.next() < 0.25;
        const milli = over ? left + random.int(1, 3) : left === 0 ? 0 : random.int(1, left);
        if (milli === 0) continue;
        const check = checkCreditNote({
          originLines: origin,
          alreadyCredited: history,
          lines: [{ originLineIndex: lineIndex, quantity: quantityText(milli), unitPrice: '1' }],
          originTotal: '1000000.00',
          previousCreditTotals: [],
          creditTotal: '0.01',
        });
        expect(check.ok).toBe(!over);
        if (over) {
          expect(check.issues[0]?.details?.remaining).toBe(quantityText(left));
          continue;
        }
        credited[lineIndex] = (credited[lineIndex] ?? 0) + milli;
        history.push({ lineIndex, quantity: quantityText(milli) });
        expect(quantities(check.creditedAfter)).toEqual(credited.map(quantityText));
        expect(quantities(remainingQuantities(origin, history))).toEqual(
          sold.map((s, i) => quantityText(s - (credited[i] ?? 0))),
        );
      }
    }
  });
});
