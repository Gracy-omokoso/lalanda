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
});
