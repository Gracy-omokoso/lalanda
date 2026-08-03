import { describe, expect, it } from 'vitest';

import { DuplicateIdError } from './errors.js';
import { TemplateSchema, collectIds } from './schema.js';

const minimal = {
  slug: 'demo',
  version: '1.0.0',
  drivers: [{ id: 'a', type: 'number', defaut: 1 }],
  feuilles: [
    {
      id: 'sheet1',
      lignes: [{ id: 'ligne1', formule: 'a * 2' }],
    },
  ],
};

describe('TemplateSchema', () => {
  it('accepte un template minimal valide', () => {
    const parsed = TemplateSchema.parse(minimal);
    expect(parsed.slug).toBe('demo');
    expect(parsed.drivers).toHaveLength(1);
  });

  it('rejette un slug invalide', () => {
    expect(() => TemplateSchema.parse({ ...minimal, slug: 'Invalid_UPPER' })).toThrow(/slug/);
  });

  it('rejette une version non-semver', () => {
    expect(() => TemplateSchema.parse({ ...minimal, version: '1.0' })).toThrow(/version/);
  });

  it('rejette un template sans drivers', () => {
    expect(() => TemplateSchema.parse({ ...minimal, drivers: [] })).toThrow(/au moins un driver/);
  });

  it('rejette un id de driver invalide', () => {
    expect(() =>
      TemplateSchema.parse({
        ...minimal,
        drivers: [{ id: 'Invalid-ID', type: 'number', defaut: 1 }],
      }),
    ).toThrow(/identifiant invalide/);
  });

  it('rejette une feuille sans lignes', () => {
    expect(() =>
      TemplateSchema.parse({
        ...minimal,
        feuilles: [{ id: 'sheet1', lignes: [] }],
      }),
    ).toThrow(/au moins une ligne/);
  });

  it('rejette une clé inconnue à la racine (strict)', () => {
    expect(() => TemplateSchema.parse({ ...minimal, extra_key: true })).toThrow();
  });
});

describe('collectIds', () => {
  it('collecte tous les ids sans doublon', () => {
    const parsed = TemplateSchema.parse(minimal);
    const ids = collectIds(parsed);
    expect(ids.drivers.has('a')).toBe(true);
    expect(ids.lignes.has('ligne1')).toBe(true);
    expect(ids.feuilles.has('sheet1')).toBe(true);
  });

  it('rejette un id de driver dupliqué', () => {
    const parsed = TemplateSchema.parse({
      ...minimal,
      drivers: [
        { id: 'a', type: 'number', defaut: 1 },
        { id: 'a', type: 'number', defaut: 2 },
      ],
    });
    expect(() => collectIds(parsed)).toThrow(DuplicateIdError);
  });

  it('rejette un id de ligne qui reprend un id de driver', () => {
    const parsed = TemplateSchema.parse({
      ...minimal,
      feuilles: [
        {
          id: 'sheet1',
          lignes: [{ id: 'a', formule: 'a * 2' }], // "a" = déjà un driver
        },
      ],
    });
    expect(() => collectIds(parsed)).toThrow(DuplicateIdError);
  });
});
