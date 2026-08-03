import { describe, expect, it } from 'vitest';

import { CycleError } from '../dsl/errors.js';
import { assertAcyclic } from './graph.js';

describe('assertAcyclic', () => {
  it('accepte un graphe vide', () => {
    expect(() => assertAcyclic(new Map())).not.toThrow();
  });

  it('accepte un DAG', () => {
    // a → b → c ; a → c
    const edges = new Map<string, Set<string>>([
      ['a', new Set(['b', 'c'])],
      ['b', new Set(['c'])],
      ['c', new Set()],
    ]);
    expect(() => assertAcyclic(edges)).not.toThrow();
  });

  it('détecte un cycle direct a → a', () => {
    const edges = new Map<string, Set<string>>([['a', new Set(['a'])]]);
    expect(() => assertAcyclic(edges)).toThrow(CycleError);
  });

  it('détecte un cycle indirect a → b → a et affiche le chemin', () => {
    const edges = new Map<string, Set<string>>([
      ['a', new Set(['b'])],
      ['b', new Set(['a'])],
    ]);
    try {
      assertAcyclic(edges);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CycleError);
      const cycleError = e as CycleError;
      expect(cycleError.details['path']).toEqual(['a', 'b', 'a']);
    }
  });

  it('détecte un cycle profond a → b → c → a', () => {
    const edges = new Map<string, Set<string>>([
      ['a', new Set(['b'])],
      ['b', new Set(['c'])],
      ['c', new Set(['a'])],
    ]);
    try {
      assertAcyclic(edges);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CycleError);
      expect((e as CycleError).details['path']).toEqual(['a', 'b', 'c', 'a']);
    }
  });

  it('ignore les références vers des nœuds hors du graphe', () => {
    // ref vers "driver_externe" ignorée (drivers = feuilles, non présents dans edges).
    const edges = new Map<string, Set<string>>([['a', new Set(['driver_externe'])]]);
    expect(() => assertAcyclic(edges)).not.toThrow();
  });
});
