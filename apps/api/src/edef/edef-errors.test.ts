// Catégories et messages des erreurs e-MCF — ADR-0024 § 5.

import { describe, expect, it } from 'vitest';

import {
  EDEF_CATEGORY_RULES,
  EDEF_KNOWN_ERROR_CODES,
  EDEF_UNKNOWN_ERROR_MESSAGE,
  describeEdefError,
  edefFailureCategory,
  normalizeEdefErrorCode,
  type EdefErrorCategory,
} from './edef-errors.js';
import type { EdefFailure } from './edef.types.js';

/** Tableau du § 5 d'ADR-0024, recopié ici pour verrouiller la correspondance. */
const TABLEAU_ADR: Record<Exclude<EdefErrorCategory, 'unknown'>, string[]> = {
  data: [
    '3',
    '4',
    '5',
    '7',
    '8',
    '9',
    '11',
    '12',
    '13',
    '14',
    '15',
    '16',
    '17',
    '18',
    '19',
    '21',
    '22',
    '23',
    '24',
    '25',
    '26',
    '27',
    '31',
    '33',
    '41',
    '42',
  ],
  configuration: ['32'],
  capacity: ['1'],
  temporary: ['10', '60'],
  server: ['61', '99'],
  state: ['20'],
  totals_mismatch: ['50', '51'],
  duplicate_pending: ['63'],
};

const REESSAYABLE: Record<EdefErrorCategory, boolean> = {
  data: false,
  configuration: false,
  capacity: true,
  temporary: true,
  server: false,
  state: false,
  totals_mismatch: false,
  duplicate_pending: false,
  unknown: false,
};

describe('describeEdefError', () => {
  it('chaque code de l’annexe a la catégorie du § 5 et un message français', () => {
    const attendus = Object.values(TABLEAU_ADR).flat();
    expect([...EDEF_KNOWN_ERROR_CODES].sort()).toEqual([...attendus].sort());
    for (const [categorie, codes] of Object.entries(TABLEAU_ADR)) {
      for (const code of codes) {
        const d = describeEdefError(code);
        expect(d.category, `code ${code}`).toBe(categorie);
        expect(d.code).toBe(code);
        expect(d.message.length, `code ${code}`).toBeGreaterThan(25);
        expect(d.message).toMatch(/[.!]$/);
        expect(d.message).not.toBe(EDEF_UNKNOWN_ERROR_MESSAGE);
      }
    }
  });

  it('réessayable et alerte suivent la catégorie', () => {
    for (const code of EDEF_KNOWN_ERROR_CODES) {
      const d = describeEdefError(code);
      expect(d.retryable, `code ${code}`).toBe(REESSAYABLE[d.category]);
      expect(d.platformAlert).toBe(EDEF_CATEGORY_RULES[d.category].platformAlert);
    }
    expect(describeEdefError('9').platformAlert).toBe(true);
    expect(describeEdefError('32').platformAlert).toBe(true);
    expect(describeEdefError('50').platformAlert).toBe(true);
    expect(describeEdefError('1').platformAlert).toBe(false);
  });

  it('code inconnu → unknown, message générique, alerte, non réessayable', () => {
    for (const code of ['2', '62', '1000', 'FAKE-1', '']) {
      const d = describeEdefError(code);
      expect(d.category).toBe('unknown');
      expect(d.message).toBe(EDEF_UNKNOWN_ERROR_MESSAGE);
      expect(d.retryable).toBe(false);
      expect(d.platformAlert).toBe(true);
    }
  });

  it('normalise le code reçu (espaces, zéros de tête, nombre JSON)', () => {
    expect(normalizeEdefErrorCode(' 07 ')).toBe('7');
    expect(normalizeEdefErrorCode(63)).toBe('63');
    expect(normalizeEdefErrorCode('FAKE-1')).toBe('FAKE-1');
    expect(describeEdefError('063').category).toBe('duplicate_pending');
    expect(describeEdefError(1).category).toBe('capacity');
  });

  it('ne se laisse pas tromper par les propriétés héritées', () => {
    expect(describeEdefError('toString').category).toBe('unknown');
    expect(describeEdefError('__proto__').category).toBe('unknown');
  });
});

describe('edefFailureCategory', () => {
  const echec = (kind: EdefFailure['kind'], dgiErrorCode: string | null = null): EdefFailure => ({
    kind,
    httpStatus: null,
    dgiErrorCode,
    message: 'x',
  });

  it('traduit chaque défaillance du client', () => {
    expect(edefFailureCategory(echec('business', '63'))).toBe('duplicate_pending');
    expect(edefFailureCategory(echec('business', '50'))).toBe('totals_mismatch');
    expect(edefFailureCategory(echec('business', '404'))).toBe('unknown');
    expect(edefFailureCategory(echec('business', null))).toBe('unknown');
    expect(edefFailureCategory(echec('unauthorized'))).toBe('token_rejected');
    expect(edefFailureCategory(echec('timeout'))).toBe('network');
    expect(edefFailureCategory(echec('network'))).toBe('network');
    expect(edefFailureCategory(echec('server'))).toBe('server');
    expect(edefFailureCategory(echec('invalid_response'))).toBe('server');
    expect(edefFailureCategory(echec('production_disabled'))).toBe('precondition');
  });
});
