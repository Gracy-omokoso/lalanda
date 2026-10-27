import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { issuesOf } from '../sales/sales.errors.js';
import { fixedMessage, typeMessages, zod3Code } from './zod-compat.js';

describe('compatibilité zod 3 des problèmes de validation (passage à zod 4)', () => {
  const Schema = z
    .object({
      name: z.string().min(1),
      revision: z
        .number({ error: typeMessages({ required: 'Révision obligatoire.', invalid: 'Entier.' }) })
        .int(),
      kind: z.enum(['a', 'b'], { error: fixedMessage('Nature : a ou b.') }),
      free: z.unknown().optional(),
    })
    .strict();

  it('distingue le champ absent (FIELD_REQUIRED) du mauvais type (INVALID_TYPE)', () => {
    const absent = Schema.safeParse({});
    expect(absent.success).toBe(false);
    expect(issuesOf(absent.error!)).toEqual([
      { path: 'name', code: 'FIELD_REQUIRED', message: expect.any(String) },
      { path: 'revision', code: 'FIELD_REQUIRED', message: 'Révision obligatoire.' },
      { path: 'kind', code: 'FIELD_REQUIRED', message: 'Nature : a ou b.' },
    ]);

    const mauvais = Schema.safeParse({ name: 3, revision: 'x', kind: 'c', extra: 1 });
    expect(issuesOf(mauvais.error!)).toEqual([
      { path: 'name', code: 'INVALID_TYPE', message: expect.any(String) },
      { path: 'revision', code: 'INVALID_TYPE', message: 'Entier.' },
      { path: 'kind', code: 'INVALID_VALUE', message: 'Nature : a ou b.' },
      { path: '', code: 'UNKNOWN_FIELD', message: expect.any(String) },
    ]);
  });

  it('accepte une clé z.unknown().optional() absente, comme z.unknown() en zod 3', () => {
    expect(Schema.safeParse({ name: 'n', revision: 1, kind: 'a' }).success).toBe(true);
  });

  it('expose les codes bruts sous leur nom zod 3', () => {
    const r = z
      .object({
        a: z.email(),
        b: z.enum(['x', 'y']),
        c: z.literal('z'),
        d: z.string().min(2),
        e: z.enum(['u', 'v']),
      })
      .safeParse({ a: 'non', b: 'q', c: 'w', d: 'd' });
    expect(r.error!.issues.map(zod3Code)).toEqual([
      'invalid_string',
      'invalid_enum_value',
      'invalid_literal',
      'too_small',
      'invalid_type',
    ]);
  });
});
