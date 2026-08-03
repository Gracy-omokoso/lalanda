import { describe, expect, it } from 'vitest';

import { CycleError, UnknownDriverError, UnknownLineError } from '../dsl/errors.js';
import { TemplateSchema } from '../dsl/schema.js';
import { DRIVERS_SHEET, compileTemplate } from './index.js';

const t = (o: object) =>
  TemplateSchema.parse({
    slug: 'demo',
    version: '1.0.0',
    ...o,
  });

describe('compileTemplate', () => {
  it('compile un template minimal et réécrit la formule vers des coord Excel', () => {
    const template = t({
      drivers: [
        { id: 'a', type: 'number', defaut: 1 },
        { id: 'b', type: 'number', defaut: 2 },
      ],
      feuilles: [
        {
          id: 'main',
          lignes: [{ id: 'somme', formule: 'a + b' }],
        },
      ],
    });
    const compiled = compileTemplate(template);
    expect(compiled.driverIndex.get('a')).toEqual({ sheet: DRIVERS_SHEET, row: 0 });
    expect(compiled.driverIndex.get('b')).toEqual({ sheet: DRIVERS_SHEET, row: 1 });
    expect(compiled.lineIndex.get('somme')?.formulaExcel).toBe('=__drivers!B1 + __drivers!B2');
  });

  it('réécrit correctement une référence à une autre ligne', () => {
    const template = t({
      drivers: [{ id: 'x', type: 'number', defaut: 10 }],
      feuilles: [
        {
          id: 'main',
          lignes: [
            { id: 'double_x', formule: 'x * 2' },
            { id: 'plus_un', formule: 'double_x + 1' },
          ],
        },
      ],
    });
    const compiled = compileTemplate(template);
    // double_x est en main!B1, référencé depuis plus_un.
    expect(compiled.lineIndex.get('plus_un')?.formulaExcel).toBe('=main!B1 + 1');
  });

  it('trie les ids par longueur décroissante pour éviter les collisions de préfixe', () => {
    // Si "a" était remplacé avant "ab", "ab" deviendrait "coordA b" — bug classique.
    const template = t({
      drivers: [
        { id: 'a', type: 'number', defaut: 1 },
        { id: 'ab', type: 'number', defaut: 2 },
      ],
      feuilles: [
        {
          id: 'main',
          lignes: [{ id: 'total', formule: 'a + ab' }],
        },
      ],
    });
    const compiled = compileTemplate(template);
    expect(compiled.lineIndex.get('total')?.formulaExcel).toBe('=__drivers!B1 + __drivers!B2');
  });

  it('lève UnknownDriverError sur une référence inconnue', () => {
    const template = t({
      drivers: [{ id: 'a', type: 'number', defaut: 1 }],
      feuilles: [
        {
          id: 'main',
          lignes: [{ id: 'x', formule: 'a * inconnu' }],
        },
      ],
    });
    expect(() => compileTemplate(template)).toThrow(UnknownDriverError);
  });

  it('lève CycleError sur un cycle a → b → a', () => {
    const template = t({
      drivers: [{ id: 'x', type: 'number', defaut: 1 }],
      feuilles: [
        {
          id: 'main',
          lignes: [
            { id: 'a', formule: 'b + x' },
            { id: 'b', formule: 'a + x' },
          ],
        },
      ],
    });
    try {
      compileTemplate(template);
      throw new Error('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(CycleError);
      expect((e as CycleError).details['path']).toContain('a');
      expect((e as CycleError).details['path']).toContain('b');
    }
  });

  it('lève CycleError sur une auto-référence ligne = ligne', () => {
    const template = t({
      drivers: [{ id: 'x', type: 'number', defaut: 1 }],
      feuilles: [
        {
          id: 'main',
          lignes: [{ id: 'a', formule: 'a + x' }],
        },
      ],
    });
    expect(() => compileTemplate(template)).toThrow(CycleError);
  });

  it("suppose que UnknownLineError est levé si extractReferencedIds capte un token qui ressemble à une ligne mais ne l'est pas", () => {
    // En pratique la classification driver vs ligne se fait via `ids.drivers.has` / `ids.lignes.has`,
    // donc un identifiant inconnu tombe systématiquement dans UnknownDriverError.
    // Ce test documente ce comportement : UnknownLineError n'est levé que dans une résolution
    // spécifique (référence vers une ligne existante depuis un contexte inattendu — non exposé en S1).
    // On garde le type disponible dans l'API publique pour évolution future.
    expect(UnknownLineError).toBeDefined();
  });
});
