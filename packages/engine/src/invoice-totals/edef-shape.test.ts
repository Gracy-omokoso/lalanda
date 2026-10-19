// Forme e-DEF des totaux et comparaison avec la réponse DGI (ADR-0022 § S25d.3, critères D3).

import { describe, expect, it } from 'vitest';

import {
  EDEF_TOTALS_FIELDS,
  compareWithEdefResponse,
  computeInvoiceTotals,
  decimalFromJsonNumber,
  decimalToJsonNumber,
  isValidDecimal,
  toEdefTotals,
  type InvoiceTotals,
  type TaxRateTable,
} from '../index.js';

const RATES: TaxRateTable = { A: '0', B: '16' };

/** Facture modèle de la documentation DGI : A 5 × 720, B 1 × 464, TTC. */
function modelInvoice(): InvoiceTotals {
  const result = computeInvoiceTotals({
    priceMode: 'ttc',
    lines: [
      { unitPrice: '720.00', quantity: '5', taxGroup: 'A', itemType: 'BIE', specificTax: null },
      { unitPrice: '464.00', quantity: '1', taxGroup: 'B', itemType: 'BIE', specificTax: null },
    ],
    rates: RATES,
  });
  if (!result.ok) throw new Error('facture modèle refusée');
  return result.totals;
}

/** Réponse DGI attendue, écrite en nombres JSON comme la DGI les renvoie. */
function dgiResponse(): Record<string, unknown> {
  return {
    ta: 0,
    tb: 16,
    taa: 3600,
    haa: 3600,
    vaa: 0,
    tab: 464,
    hab: 400,
    vab: 64,
    ts: 0,
    total: 4064,
    vtotal: 64,
    // Champs étrangers à la comparaison : ignorés.
    uid: 'factice',
    curTotal: 1.36,
  };
}

describe('toEdefTotals', () => {
  it('produit 16 × 4 clés + ts, total, vtotal, dans l’ordre de la réponse', () => {
    const edef = toEdefTotals(modelInvoice(), RATES);
    expect(Object.keys(edef)).toHaveLength(67);
    expect(Object.keys(edef)).toEqual([...EDEF_TOTALS_FIELDS]);
    expect(Object.keys(edef).slice(0, 3)).toEqual(['ta', 'tb', 'tc']);
    expect(Object.keys(edef).slice(16, 18)).toEqual(['taa', 'tab']);
    expect(Object.keys(edef).slice(-3)).toEqual(['ts', 'total', 'vtotal']);
  });

  it('ta = taux A, taa = total A ; groupe inutilisé à "0.00", taux absent à null', () => {
    const edef = toEdefTotals(modelInvoice(), RATES);
    expect(edef.ta).toBe('0');
    expect(edef.tb).toBe('16');
    expect(edef.tc).toBeNull();
    expect(edef.tp).toBeNull();
    expect(edef.taa).toBe('3600.00');
    expect(edef.haa).toBe('3600.00');
    expect(edef.vaa).toBe('0.00');
    expect(edef.tab).toBe('464.00');
    expect(edef.hab).toBe('400.00');
    expect(edef.vab).toBe('64.00');
    expect(edef.tac).toBe('0.00');
    expect(edef.vap).toBe('0.00');
    expect(edef.ts).toBe('0.00');
    expect(edef.total).toBe('4064.00');
    expect(edef.vtotal).toBe('64.00');
  });

  it('ne produit aucun champ des lettres Q à Z', () => {
    const edef = toEdefTotals(modelInvoice(), RATES) as Record<string, unknown>;
    for (const field of ['tq', 'taq', 'haq', 'vaq', 'tz', 'taz']) {
      expect(field in edef, field).toBe(false);
    }
  });

  it('lève une erreur sur un tableau de taux invalide', () => {
    expect(() => toEdefTotals(modelInvoice(), { B: '16%' })).toThrow(RangeError);
  });
});

describe('compareWithEdefResponse', () => {
  it('réponse identique → identical: true', () => {
    expect(compareWithEdefResponse(modelInvoice(), RATES, dgiResponse())).toEqual({
      identical: true,
      differences: [],
    });
  });

  it('un centime d’écart sur vab → une différence nommée vab', () => {
    const response = { ...dgiResponse(), vab: 64.01 };
    expect(compareWithEdefResponse(modelInvoice(), RATES, response)).toEqual({
      identical: false,
      differences: [{ field: 'vab', ours: '64.00', dgi: '64.01' }],
    });
  });

  it('champs absents = 0 : absents et nuls de notre côté, aucune différence', () => {
    // La réponse minimale ne cite que les groupes utilisés.
    const minimal = {
      ta: 0,
      tb: 16,
      taa: 3600,
      haa: 3600,
      tab: 464,
      hab: 400,
      vab: 64,
      total: 4064,
      vtotal: 64,
    };
    expect(compareWithEdefResponse(modelInvoice(), RATES, minimal).identical).toBe(true);
  });

  it('un champ absent alors que nous avons un montant → différence avec dgi: null', () => {
    const { vtotal: _omitted, ...response } = dgiResponse();
    expect(compareWithEdefResponse(modelInvoice(), RATES, response).differences).toEqual([
      { field: 'vtotal', ours: '64.00', dgi: null },
    ]);
  });

  it('68.97 reçu comme nombre JSON est accepté, 68.965 est une différence', () => {
    const result = computeInvoiceTotals({
      priceMode: 'ttc',
      lines: [
        { unitPrice: '500.00', quantity: '1', taxGroup: 'B', itemType: 'BIE', specificTax: null },
      ],
      rates: { B: '16' },
    });
    if (!result.ok) throw new Error('refus inattendu');
    const base = { tb: 16, tab: 500, hab: 431.03, total: 500, vtotal: 68.97 };
    expect(
      compareWithEdefResponse(result.totals, { B: '16' }, { ...base, vab: 68.97 }).identical,
    ).toBe(true);
    expect(
      compareWithEdefResponse(result.totals, { B: '16' }, { ...base, vab: 68.965 }).differences,
    ).toEqual([{ field: 'vab', ours: '68.97', dgi: '68.965' }]);
  });

  it('valeurs illisibles : négatif, infini, exponentielle, booléen, objet → différences', () => {
    const totals = modelInvoice();
    for (const bad of [
      -64,
      Number.POSITIVE_INFINITY,
      Number.NaN,
      6.4e1 * 1e20,
      true,
      {},
      '64,00',
    ]) {
      const response = { ...dgiResponse(), vab: bad };
      const { differences } = compareWithEdefResponse(totals, RATES, response);
      expect(
        differences.map((d) => d.field),
        String(bad),
      ).toEqual(['vab']);
    }
  });

  it('un décimal canonique reçu en chaîne est lu sans arrondi', () => {
    const response = { ...dgiResponse(), vab: '64.00', total: '4064' };
    expect(compareWithEdefResponse(modelInvoice(), RATES, response).identical).toBe(true);
  });

  it('un taux DGI différent du nôtre est une différence ; un taux inconnu de nous est ignoré', () => {
    const response = { ...dgiResponse(), tb: 18, tc: 5 };
    expect(compareWithEdefResponse(modelInvoice(), RATES, response).differences).toEqual([
      { field: 'tb', ours: '16', dgi: '18' },
    ]);
  });

  it('signale toutes les différences, dans l’ordre des champs', () => {
    const response = { ...dgiResponse(), total: 4065, taa: 3599.99, vab: 65 };
    expect(
      compareWithEdefResponse(modelInvoice(), RATES, response).differences.map((d) => d.field),
    ).toEqual(['taa', 'vab', 'total']);
  });
});

describe('frontière des nombres JSON', () => {
  it('decimalFromJsonNumber : représentation la plus courte, 2 décimales au plus', () => {
    expect(decimalFromJsonNumber(68.97)).toBe('68.97');
    expect(decimalFromJsonNumber(4064)).toBe('4064');
    expect(decimalFromJsonNumber(0)).toBe('0');
    expect(decimalFromJsonNumber(-0)).toBe('0');
    expect(decimalFromJsonNumber(0.1 + 0.2)).toBeNull(); // 0.30000000000000004
    expect(decimalFromJsonNumber(68.965)).toBeNull();
    expect(decimalFromJsonNumber(-1)).toBeNull();
    expect(decimalFromJsonNumber(1e21)).toBeNull();
    expect(decimalFromJsonNumber(1e-7)).toBeNull();
    expect(decimalFromJsonNumber(Number.NaN)).toBeNull();
    expect(decimalFromJsonNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('decimalToJsonNumber : exact jusqu’à 15 chiffres significatifs, refuse au-delà', () => {
    expect(decimalToJsonNumber('464.00')).toBe(464);
    expect(decimalToJsonNumber('68.97')).toBe(68.97);
    expect(decimalToJsonNumber('9999999999999.99')).toBe(9999999999999.99);
    expect(decimalToJsonNumber('0.00')).toBe(0);
    expect(() => decimalToJsonNumber('99999999999999.99')).toThrow(RangeError);
    expect(() => decimalToJsonNumber('1e3')).toThrow(RangeError);
  });

  it('aller-retour exact pour tout montant à 2 décimales sous 10¹³', () => {
    for (const text of [
      '0.01',
      '0.10',
      '1.05',
      '68.97',
      '4064.00',
      '1234567890123.45',
      '9999999999999.99',
    ]) {
      const back = decimalFromJsonNumber(decimalToJsonNumber(text));
      expect(back, text).not.toBeNull();
      // « 0.10 » revient « 0.1 » : même valeur, forme la plus courte.
      expect(Number(back), text).toBe(Number(text));
    }
  });

  it('isValidDecimal', () => {
    expect(isValidDecimal('464.00', 2)).toBe(true);
    expect(isValidDecimal('464', 0)).toBe(true);
    expect(isValidDecimal('1.234', 2)).toBe(false);
    expect(isValidDecimal('1.234', 3)).toBe(true);
    expect(isValidDecimal('1e3', 2)).toBe(false);
    expect(isValidDecimal('-1', 2)).toBe(false);
    expect(isValidDecimal('', 2)).toBe(false);
    expect(isValidDecimal(12 as unknown as string, 2)).toBe(false);
  });
});
