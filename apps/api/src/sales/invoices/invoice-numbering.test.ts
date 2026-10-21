// Format des numéros — ADR-0027. Fonctions pures, sans base.

import { describe, expect, it } from 'vitest';

import { INVOICE_TYPES } from './invoice.contract.js';
import {
  fiscalPeriodOf,
  fiscalPrefixOf,
  fiscalYearOf,
  formatInvoiceNumber,
  formatProformaRef,
  parseInvoiceNumber,
  periodInYear,
} from './invoice-numbering.js';

const OCT_2026 = { year: 2026, month: 10 };

describe('format IN / AV / TEST- / PF', () => {
  it('facture, avoir, essai, pro forma', () => {
    expect(formatInvoiceNumber('real', 'IN', OCT_2026, 42)).toBe('IN2610-000042');
    expect(formatInvoiceNumber('real', 'AV', OCT_2026, 43)).toBe('AV2610-000043');
    expect(formatInvoiceNumber('test', 'IN', OCT_2026, 1)).toBe('TEST-IN2610-000001');
    expect(formatInvoiceNumber('test', 'AV', OCT_2026, 2)).toBe('TEST-AV2610-000002');
    expect(formatProformaRef(OCT_2026, 3)).toBe('PF2610-000003');
    expect(formatInvoiceNumber('real', 'IN', { year: 2027, month: 1 }, 1)).toBe('IN2701-000001');
  });

  it('au-delà de 999 999, le rang s’allonge ; rang, mois et année invalides refusés', () => {
    expect(formatInvoiceNumber('real', 'IN', OCT_2026, 1_234_567)).toBe('IN2610-1234567');
    expect(() => formatInvoiceNumber('real', 'IN', OCT_2026, 0)).toThrow();
    expect(() => formatInvoiceNumber('real', 'IN', OCT_2026, 1.5)).toThrow();
    expect(() => formatInvoiceNumber('real', 'IN', { year: 2026, month: 13 }, 1)).toThrow();
    expect(() => formatProformaRef({ year: 2100, month: 1 }, 1)).toThrow();
  });

  it('préfixe selon le type : AV pour FA et EA, IN pour les autres', () => {
    const prefixes = Object.fromEntries(INVOICE_TYPES.map((t) => [t, fiscalPrefixOf(t)]));
    expect(prefixes).toEqual({ FV: 'IN', FT: 'IN', FA: 'AV', EV: 'IN', ET: 'IN', EA: 'AV' });
  });

  it('un numéro ne dépasse jamais 64 caractères (`rn` DGI, ADR-0024)', () => {
    expect(
      formatInvoiceNumber('test', 'AV', OCT_2026, Number.MAX_SAFE_INTEGER).length,
    ).toBeLessThan(64);
  });
});

describe('lecture des deux formes', () => {
  it('forme actuelle', () => {
    expect(parseInvoiceNumber('IN2610-000042')).toEqual({
      series: 'real',
      year: 2026,
      month: 10,
      prefix: 'IN',
      seq: 42,
      legacy: false,
    });
    expect(parseInvoiceNumber('AV2611-000043')).toMatchObject({
      series: 'real',
      prefix: 'AV',
      month: 11,
      seq: 43,
    });
    expect(parseInvoiceNumber('TEST-AV2610-000002')).toMatchObject({
      series: 'test',
      prefix: 'AV',
      year: 2026,
      seq: 2,
    });
    expect(parseInvoiceNumber('PF2610-000003')).toMatchObject({
      series: 'proforma',
      prefix: 'PF',
      year: 2026,
      seq: 3,
    });
  });

  it('ancienne forme (documents figés avant ADR-0027)', () => {
    expect(parseInvoiceNumber('2026-000001')).toEqual({
      series: 'real',
      year: 2026,
      month: null,
      prefix: null,
      seq: 1,
      legacy: true,
    });
    expect(parseInvoiceNumber('TEST-2026-000001')).toMatchObject({ series: 'test', seq: 1 });
    expect(parseInvoiceNumber('PF-2026-000002')).toMatchObject({
      series: 'proforma',
      prefix: 'PF',
      seq: 2,
      legacy: true,
    });
  });

  it('aller-retour exact', () => {
    for (const n of ['IN2610-000042', 'AV2612-000099', 'TEST-IN2701-000001']) {
      const p = parseInvoiceNumber(n)!;
      expect(
        formatInvoiceNumber(
          p.series as 'real' | 'test',
          p.prefix as 'IN' | 'AV',
          { year: p.year, month: p.month! },
          p.seq,
        ),
      ).toBe(n);
    }
    const pf = parseInvoiceNumber('PF2610-000003')!;
    expect(formatProformaRef({ year: pf.year, month: pf.month! }, pf.seq)).toBe('PF2610-000003');
  });

  it('formes inconnues → null', () => {
    for (const n of [
      '',
      'IN2613-000001', // mois 13
      'IN2600-000001', // mois 0
      'IN2610-00001', // rang sur 5 chiffres
      'in2610-000001', // minuscules
      'TEST-PF2610-000001', // pas de pro forma d'essai
      'PF-IN2610-000001',
      'XX2610-000001',
      'IN202610-000001',
      'CAL-20261020-1-ttc', // étalonnage, hors série
      ' IN2610-000001',
    ]) {
      expect(parseInvoiceNumber(n), n).toBeNull();
    }
  });
});

describe('période à Kinshasa (UTC+1, sans heure d’été)', () => {
  it('changement de mois : 31 oct. 23 h 30 à Kinshasa (22 h 30 UTC) reste en octobre', () => {
    expect(fiscalPeriodOf(new Date('2026-10-31T22:30:00Z'))).toEqual(OCT_2026);
    // 23 h 30 UTC le 31 oct. = 0 h 30 le 1ᵉʳ nov. à Kinshasa.
    expect(fiscalPeriodOf(new Date('2026-10-31T23:30:00Z'))).toEqual({ year: 2026, month: 11 });
  });

  it('changement d’année : 31 déc. 23 h 30 à Kinshasa ≠ 31 déc. 23 h 30 UTC', () => {
    expect(fiscalPeriodOf(new Date('2026-12-31T23:30:00+01:00'))).toEqual({
      year: 2026,
      month: 12,
    });
    // 31 déc. 23 h 30 UTC = 1ᵉʳ janv. 0 h 30 à Kinshasa : nouvelle année de gestion.
    expect(fiscalPeriodOf(new Date('2026-12-31T23:30:00Z'))).toEqual({ year: 2027, month: 1 });
    expect(fiscalYearOf(new Date('2026-12-31T22:59:59.999Z'))).toBe(2026);
    expect(fiscalYearOf(new Date('2026-12-31T23:00:00Z'))).toBe(2027);
  });

  it('l’année imprimée est toujours celle du compteur', () => {
    const janvier = new Date('2027-01-01T00:00:30+01:00');
    expect(periodInYear(2027, janvier)).toEqual({ year: 2027, month: 1 });
    // Instant de l'année suivante sur le compteur 2026 → décembre 2026, jamais « 2701 ».
    expect(periodInYear(2026, janvier)).toEqual({ year: 2026, month: 12 });
    expect(periodInYear(2027, new Date('2026-12-31T23:59:00+01:00'))).toEqual({
      year: 2027,
      month: 1,
    });
  });
});
