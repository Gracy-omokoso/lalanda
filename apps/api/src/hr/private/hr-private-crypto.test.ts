// Données sensibles du personnel : chiffrement lié à l'organisation, au collaborateur
// et à la section ; masques ; rotation (ADR-0045 § 2.4). ADR-0045 — H2. Sans base.

import { randomBytes } from 'node:crypto';

import type { HrPrivateSections } from '@lalanda/shared/hr';
import { describe, expect, it } from 'vitest';

import { MasterKeyring } from '../../integrations/secrets-crypto.js';
import { EmployeePrivateSchema } from './employee-private.schema.js';
import {
  decryptHrPrivate,
  encryptHrPrivate,
  maskHrPrivate,
  rewrapHrPrivate,
} from './hr-private-crypto.js';
import { privateSummaryOf } from './hr-private.service.js';

const k1 = MasterKeyring.of([{ keyId: 'k1', key: randomBytes(32) }], 'k1');
const IBAN = 'CD0800011234567894521';
const PASSEPORT = 'OP1234567';
const bank: HrPrivateSections['bankDetails'] = {
  accounts: [
    {
      kind: 'bank',
      bankName: 'Rawbank',
      holderName: 'Aline Mbuyi',
      accountNumber: '0001-1234-5678-94521',
      iban: IBAN,
      swift: null,
    },
    {
      kind: 'mobile_money',
      operator: 'M-Pesa',
      holderName: 'Aline',
      phoneNumber: '+243 81 234 5678',
    },
  ],
};
const identity: HrPrivateSections['identity'] = {
  birthDate: '1990-05-01',
  nationality: 'congolaise',
  idDocuments: [{ kind: 'passport', number: PASSEPORT, issuedOn: null, expiresOn: '2030-01-01' }],
};
const at = { organizationId: 'org-a', employeeId: 'a'.repeat(24) };

describe('chiffrement des données sensibles', () => {
  it('aller-retour exact ; jamais le clair dans le chiffré ; last4 nul', () => {
    const record = encryptHrPrivate({
      ...at,
      field: 'bankDetails',
      value: bank,
      keyring: k1,
      updatedBy: 'u',
    });
    expect(JSON.stringify(record)).not.toContain(IBAN);
    expect(record.last4).toBeNull();
    expect(decryptHrPrivate({ ...at, field: 'bankDetails', record, keyring: k1 })).toEqual(bank);
  });

  it('un chiffré déplacé vers un autre collaborateur, une autre section ou une autre organisation ne se déchiffre pas', () => {
    const record = encryptHrPrivate({
      ...at,
      field: 'identity',
      value: identity,
      keyring: k1,
      updatedBy: 'u',
    });
    expect(() =>
      decryptHrPrivate({
        ...at,
        employeeId: 'b'.repeat(24),
        field: 'identity',
        record,
        keyring: k1,
      }),
    ).toThrow();
    expect(() =>
      decryptHrPrivate({ ...at, field: 'personalContact', record, keyring: k1 }),
    ).toThrow();
    expect(() =>
      decryptHrPrivate({ ...at, organizationId: 'org-b', field: 'identity', record, keyring: k1 }),
    ).toThrow();
  });

  it('rotation : re-chiffré sous la nouvelle clé, idempotente', () => {
    const record = encryptHrPrivate({
      ...at,
      field: 'identity',
      value: identity,
      keyring: k1,
      updatedBy: 'u',
    });
    const k2 = MasterKeyring.of(
      [
        { keyId: 'k2', key: randomBytes(32) },
        { keyId: 'k1', key: k1.keyFor('k1') },
      ],
      'k2',
    );
    const out = rewrapHrPrivate({ ...at, field: 'identity', record, keyring: k2 });
    expect(out.changed).toBe(true);
    expect(out.record.keyId).toBe('k2');
    expect(decryptHrPrivate({ ...at, field: 'identity', record: out.record, keyring: k2 })).toEqual(
      identity,
    );
    expect(
      rewrapHrPrivate({ ...at, field: 'identity', record: out.record, keyring: k2 }).changed,
    ).toBe(false);
  });
});

describe('formes masquées', () => {
  it('salaire : ni montant ni devise ; banque : quatre derniers caractères ; pièce : type et expiration', () => {
    const comp = maskHrPrivate(
      'org-a',
      'compensation',
      {
        history: [
          { effectiveFrom: '2025-01-01', amount: '400000.00', currency: 'CDF', period: 'month' },
          { effectiveFrom: '2026-01-01', amount: '450000.00', currency: 'CDF', period: 'month' },
        ],
      },
      k1,
    );
    expect(comp).toEqual({ since: '2026-01-01', entries: 2 });
    const masked = maskHrPrivate('org-a', 'bankDetails', bank, k1) as {
      accounts: { masked: string; fingerprint: string }[];
    };
    expect(masked.accounts.map((a) => a.masked)).toEqual(['Rawbank •••• 4521', 'M-Pesa •••• 78']);
    expect(JSON.stringify(masked)).not.toContain(IBAN);
    const id = maskHrPrivate('org-a', 'identity', identity, k1);
    expect(id).toEqual({
      hasBirthDate: true,
      hasNationality: true,
      idDocuments: [{ kind: 'passport', expiresOn: '2030-01-01' }],
    });
    expect(JSON.stringify(id)).not.toContain(PASSEPORT);
  });

  it('bandeau bancaire : sept jours après le changement, puis plus rien', () => {
    const changedAt = new Date('2026-10-01T10:00:00Z');
    const doc = {
      bankDetailsChangedAt: changedAt,
      bankDetailsChangedBy: 'u',
      revision: 2,
    } as never;
    expect(
      privateSummaryOf('e', doc, new Date('2026-10-05T00:00:00Z')).bankDetailsAlert,
    ).toMatchObject({
      changedBy: 'u',
      until: '2026-10-08T10:00:00.000Z',
    });
    expect(
      privateSummaryOf('e', doc, new Date('2026-10-09T00:00:00Z')).bankDetailsAlert,
    ).toBeNull();
    expect(privateSummaryOf('e', null).revision).toBe(0);
  });

  it('toJSON et toObject remplacent tout chiffré par [redacted]', () => {
    const transform = (
      EmployeePrivateSchema.get('toJSON') as { transform: (d: unknown, r: unknown) => unknown }
    ).transform;
    const record = encryptHrPrivate({
      ...at,
      field: 'identity',
      value: identity,
      keyring: k1,
      updatedBy: 'u',
    });
    const out = transform(null, {
      identity: { cipher: record, masked: {} },
      compensation: null,
    }) as Record<string, { cipher: unknown } | null>;
    expect(out['identity']!.cipher).toBe('[redacted]');
    expect(out['compensation']).toBeNull();
  });
});
