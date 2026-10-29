// Contrats des comptes CRM (ADR-0040 — C0) : `.strict()`, codes stables.

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  CRM_ACCOUNT_KINDS,
  CRM_SECTION_STATUSES,
  ConvertCrmAccountBody,
  CreateCrmAccountBody,
  ListCrmAccountsQuery,
  MergeCrmAccountBody,
  UpdateCrmAccountBody,
} from './index.js';

const ID = '64B7F0C2A1B2C3D4E5F60718';

function codes(schema: z.ZodType, input: unknown): string[] {
  const r = schema.safeParse(input);
  if (r.success) return [];
  return r.error.issues.map((i) => {
    const c = (i as { params?: { code?: unknown } }).params?.code;
    return typeof c === 'string' ? c : i.code;
  });
}

describe('comptes CRM — corps de requête', () => {
  it('crée un prospect : nom requis, coordonnées facultatives, vide → null', () => {
    const r = CreateCrmAccountBody.parse({
      name: '  ACME Sarl ',
      ownerId: ID,
      industry: '',
      phone: '+243 81 000 0000',
    });
    expect(r).toMatchObject({ name: 'ACME Sarl', ownerId: ID.toLowerCase(), industry: null });
    expect(codes(CreateCrmAccountBody, { name: '  ' })).toContain('FIELD_REQUIRED');
    expect(codes(CreateCrmAccountBody, { name: 'x'.repeat(201) })).toContain('TEXT_TOO_LONG');
  });

  it('refuse un champ inconnu, dont l’identité fiscale (`.strict()`)', () => {
    expect(codes(CreateCrmAccountBody, { name: 'A', nif: 'A0000000X' })).toContain(
      'unrecognized_keys',
    );
    expect(codes(CreateCrmAccountBody, { name: 'A', customerId: ID })).toContain(
      'unrecognized_keys',
    );
  });

  it('valide téléphone, e-mail et identifiant', () => {
    expect(codes(CreateCrmAccountBody, { name: 'A', phone: 'abc' })).toContain('PHONE_INVALID');
    expect(codes(CreateCrmAccountBody, { name: 'A', email: 'pas-un-email' })).toContain(
      'EMAIL_INVALID',
    );
    expect(codes(CreateCrmAccountBody, { name: 'A', ownerId: '123' })).toContain('CRM_ID_INVALID');
  });

  it('une mise à jour exige la révision attendue', () => {
    expect(UpdateCrmAccountBody.safeParse({ industry: 'BTP' }).success).toBe(false);
    expect(UpdateCrmAccountBody.parse({ expectedRevision: 2, industry: 'BTP' })).toMatchObject({
      industry: 'BTP',
    });
  });

  it('fusion et conversion : deux modes, corps strict', () => {
    expect(MergeCrmAccountBody.parse({ targetAccountId: ID, expectedRevision: 1 })).toEqual({
      targetAccountId: ID.toLowerCase(),
      expectedRevision: 1,
    });
    expect(
      ConvertCrmAccountBody.parse({ mode: 'link', customerId: ID, expectedRevision: 3 }),
    ).toMatchObject({ mode: 'link' });
    expect(
      ConvertCrmAccountBody.parse({
        mode: 'create',
        customer: { type: 'PM', name: 'ACME', nif: 'A0000000X' },
        expectedRevision: 3,
      }),
    ).toMatchObject({ mode: 'create' });
    expect(ConvertCrmAccountBody.safeParse({ mode: 'merge', expectedRevision: 1 }).success).toBe(
      false,
    );
    expect(
      ConvertCrmAccountBody.safeParse({
        mode: 'link',
        customerId: ID,
        expectedRevision: 1,
        extra: true,
      }).success,
    ).toBe(false);
  });
});

describe('comptes CRM — liste', () => {
  it('filtres : nature, « les miens », actif ; borne de page', () => {
    expect(
      ListCrmAccountsQuery.parse({ kind: 'prospect', ownerId: 'me', active: 'false' }),
    ).toEqual({ kind: 'prospect', ownerId: 'me', active: false, limit: 50 });
    expect(ListCrmAccountsQuery.safeParse({ limit: '101' }).success).toBe(false);
    expect(ListCrmAccountsQuery.safeParse({ kind: 'lead' }).success).toBe(false);
  });

  it('unions fermées', () => {
    expect(CRM_ACCOUNT_KINDS).toEqual(['prospect', 'customer']);
    expect(CRM_SECTION_STATUSES).toEqual(['known', 'hidden', 'empty']);
  });
});
