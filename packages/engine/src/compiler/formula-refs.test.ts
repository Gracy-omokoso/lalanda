import { describe, expect, it } from 'vitest';

import { extractReferencedIds } from './formula-refs.js';

describe('extractReferencedIds', () => {
  it("extrait les ids d'une formule arithmétique simple", () => {
    const ids = extractReferencedIds('prix_unitaire * quantite_mois');
    expect([...ids].sort()).toEqual(['prix_unitaire', 'quantite_mois']);
  });

  it('dédoublonne les occurrences multiples', () => {
    const ids = extractReferencedIds('a * a + a');
    expect([...ids]).toEqual(['a']);
  });

  it('ignore les littéraux numériques', () => {
    const ids = extractReferencedIds('a * 2 + 0.5');
    expect([...ids]).toEqual(['a']);
  });

  it('ignore les mots-clés réservés', () => {
    const ids = extractReferencedIds('a * (true ? 1 : 0)');
    expect([...ids]).toEqual(['a']);
  });

  it('retourne un ensemble vide sur une formule purement numérique', () => {
    const ids = extractReferencedIds('2 + 3 * (4 - 1)');
    expect(ids.size).toBe(0);
  });

  it('ignore les fonctions Excel natives (MAX, MIN, IF, ABS, ROUND, SUM, IFERROR)', () => {
    expect([...extractReferencedIds('MAX(0, profit)')]).toEqual(['profit']);
    expect([...extractReferencedIds('IF(excedent > 0, excedent, 0)')]).toEqual(['excedent']);
    expect([...extractReferencedIds('MIN(a, b)').values()].sort()).toEqual(['a', 'b']);
    expect([...extractReferencedIds('ROUND(x * y, 2)').values()].sort()).toEqual(['x', 'y']);
    expect([...extractReferencedIds('IFERROR(a / b, 0)').values()].sort()).toEqual(['a', 'b']);
    expect([...extractReferencedIds('SUM(x, y, z)').values()].sort()).toEqual(['x', 'y', 'z']);
    expect([...extractReferencedIds('ABS(delta)')]).toEqual(['delta']);
    expect([...extractReferencedIds('AND(a > 0, b > 0)').values()].sort()).toEqual(['a', 'b']);
  });

  it('ne confond pas un id préfixé/suffixé par un nom de fonction (ex: if_actif, max_prix)', () => {
    // `\b` isole les mots — `if` ne matche pas à l'intérieur de `if_actif`.
    expect([...extractReferencedIds('if_actif * max_prix')].sort()).toEqual([
      'if_actif',
      'max_prix',
    ]);
  });
});
