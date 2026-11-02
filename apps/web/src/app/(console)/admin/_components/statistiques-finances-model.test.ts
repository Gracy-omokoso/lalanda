import { describe, expect, it } from 'vitest';

import { findForbiddenPlatformFinanceWords } from '@lalanda/shared/platform';

import {
  erreurPeriode,
  formaterMontant,
  formaterMontants,
  LIBELLES_FINANCES,
  libelleMois,
  libelleMoyen,
  nombreDeDepots,
} from './finances-model';
import { CONSOLE_MODULES } from './console-model';
import {
  afficherCase,
  libelleEtat,
  libelleModule,
  libellePays,
  lignesTriees,
} from './statistiques-model';

describe('statistiques — affichage du seuil (ADR-0053 § 6.7)', () => {
  it('écrit « < 5 » pour une case masquée, jamais une valeur', () => {
    expect(afficherCase({ value: null, masked: true })).toBe('< 5');
    expect(afficherCase({ value: 3, masked: true })).toBe('< 5');
    expect(afficherCase(undefined)).toBe('< 5');
    expect(afficherCase({ value: 1234, masked: false })).toMatch(/^1\s?234$/);
  });

  it('range les cases masquées en dernier', () => {
    const lignes = lignesTriees([
      { key: 'a', cell: { value: null, masked: true } },
      { key: 'b', cell: { value: 6, masked: false } },
      { key: 'c', cell: { value: 9, masked: false } },
    ]);
    expect(lignes.map((l) => l.key)).toEqual(['c', 'b', 'a']);
  });

  it('nomme états, modules et pays, sans perdre une clé inconnue', () => {
    expect(libelleEtat('none')).toContain('gratuit');
    expect(libelleEtat('inconnu')).toBe('inconnu');
    expect(libelleModule('crm')).toBe('CRM');
    expect(libellePays('CD')).toContain('CD');
    expect(libellePays('ZZ')).toContain('ZZ');
  });
});

describe('finances — montants par devise (ADR-0053 § 6.8)', () => {
  it('formate en entiers, sans conversion', () => {
    expect(formaterMontant(5801, 'USD')).toBe('58,01 USD');
    expect(formaterMontant(5, 'CDF')).toBe('0,05 CDF');
    expect(formaterMontant(123456789, 'USD').replace(/\s/g, ' ')).toBe('1 234 567,89 USD');
    expect(
      formaterMontants([
        { currency: 'CDF', totalCents: 500000, count: 1 },
        { currency: 'USD', totalCents: 1900, count: 1 },
        { currency: 'EUR', totalCents: 0, count: 0 },
      ]).replace(/\s/g, ' '),
    ).toBe('5 000,00 CDF · 19,00 USD');
    expect(formaterMontants([])).toBe('—');
    expect(nombreDeDepots([{ currency: 'USD', totalCents: 1, count: 3 }])).toBe(3);
  });

  it('valide la période', () => {
    expect(erreurPeriode('2026-01', '2026-10')).toBeNull();
    expect(erreurPeriode('2026-11', '2026-10')).not.toBeNull();
    expect(erreurPeriode('2026-13', '2026-10')).not.toBeNull();
    expect(libelleMois('2026-10')).toBe('oct. 2026');
    expect(libelleMoyen('mobile_money')).toBe('Mobile money');
  });

  it('n’emploie aucun mot réservé aux pièces fiscales (critère 21)', () => {
    for (const texte of Object.values(LIBELLES_FINANCES)) {
      expect(findForbiddenPlatformFinanceWords(texte), texte).toEqual([]);
    }
    const finances = CONSOLE_MODULES.find((m) => m.id === 'finances')!;
    expect(findForbiddenPlatformFinanceWords(`${finances.label} ${finances.description}`)).toEqual(
      [],
    );
  });
});
