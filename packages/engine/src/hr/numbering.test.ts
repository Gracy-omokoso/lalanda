// Matricules, numéros de poste et fériés proposés (ADR-0068). Attendus écrits à la main.

import { describe, expect, it } from 'vitest';

import {
  RDC_PUBLIC_HOLIDAYS,
  defaultEmployeeNumberPrefix,
  formatSequenceNumber,
  highestSequenceRank,
  normalizeEmployeeNumberPrefix,
  numberKeyOf,
  rdcHolidaysFor,
  sequenceRankOf,
} from '../index.js';

describe('préfixe par défaut', () => {
  it('initiales des mots significatifs', () => {
    expect(defaultEmployeeNumberPrefix('Go freelance')).toBe('GF-');
    expect(defaultEmployeeNumberPrefix('Go Freelance SARLU')).toBe('GF-');
    expect(defaultEmployeeNumberPrefix('Société des Mines du Katanga')).toBe('SMK-');
    expect(defaultEmployeeNumberPrefix('Éts Bâtiments et Routes Équateur')).toBe('BRE-');
  });
  it('un seul mot : trois lettres ; rien : repli', () => {
    expect(defaultEmployeeNumberPrefix('Lalanda')).toBe('LAL-');
    expect(defaultEmployeeNumberPrefix('  ')).toBe('MAT-');
    expect(defaultEmployeeNumberPrefix('2026')).toBe('MAT-');
  });
  it('préfixe saisi normalisé ou refusé', () => {
    expect(normalizeEmployeeNumberPrefix('gf-')).toBe('GF-');
    expect(normalizeEmployeeNumberPrefix(' g f ')).toBe('GF');
    expect(normalizeEmployeeNumberPrefix('-GF')).toBeNull();
    expect(normalizeEmployeeNumberPrefix('GF#')).toBeNull();
    expect(normalizeEmployeeNumberPrefix('ABCDEFGHIJK')).toBeNull();
  });
});

describe('numéros et rangs', () => {
  it('mise en forme', () => {
    expect(formatSequenceNumber('GF-', 4, 1)).toBe('GF-0001');
    expect(formatSequenceNumber('POS-', 3, 12)).toBe('POS-012');
    expect(formatSequenceNumber('POS-', 3, 1234)).toBe('POS-1234');
    expect(() => formatSequenceNumber('GF-', 4, 0)).toThrow(RangeError);
  });
  it('rang d’un numéro compatible, comparé par clé', () => {
    expect(sequenceRankOf('GF-', 'GF-0050')).toBe(50);
    expect(sequenceRankOf('GF-', 'gf 12')).toBe(12);
    expect(sequenceRankOf('GF-', 'GF0007')).toBe(7);
    expect(sequenceRankOf('GF-', 'GF-0000')).toBeNull();
    expect(sequenceRankOf('GF-', 'GF-12A')).toBeNull();
    expect(sequenceRankOf('GF-', 'AB-0001')).toBeNull();
    expect(sequenceRankOf('GF-', '0001')).toBeNull();
  });
  it('plus grand rang compatible', () => {
    expect(highestSequenceRank('GF-', ['GF-0003', null, 'X-99', 'GF0010', 'GF-ABC'])).toBe(10);
    expect(highestSequenceRank('GF-', [])).toBe(0);
  });
  it('clé identique à celle de `employeeNumberKey`', () => {
    expect(numberKeyOf('ab-01')).toBe('AB01');
    expect(numberKeyOf('AB 01')).toBe('AB01');
  });
});

describe('jours fériés de la RDC proposés', () => {
  it('dix dates par année, dans l’ordre, sans doublon', () => {
    const list = rdcHolidaysFor(2027);
    expect(list).toHaveLength(10);
    expect(list.map((h) => h.date)).toEqual([
      '2027-01-01',
      '2027-01-04',
      '2027-01-16',
      '2027-01-17',
      '2027-04-06',
      '2027-05-01',
      '2027-05-17',
      '2027-06-30',
      '2027-08-01',
      '2027-12-25',
    ]);
    expect(new Set(RDC_PUBLIC_HOLIDAYS.map((h) => h.monthDay)).size).toBe(10);
  });
  it('année hors bornes refusée', () => {
    expect(() => rdcHolidaysFor(2022)).toThrow(RangeError);
    expect(() => rdcHolidaysFor(2026.5)).toThrow(RangeError);
  });
});
