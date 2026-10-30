// Coordonnées de paiement des fournisseurs : chiffrement lié à la fiche, masque,
// empreinte (ADR-0044 § 2.1.1). ADR-0044 — P2. Sans base ni application.

import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import { MasterKeyring } from '../../integrations/secrets-crypto.js';
import {
  canonicalAccount,
  decryptPaymentDetails,
  encryptPaymentDetails,
  maskPaymentDetails,
  paymentFingerprint,
  rewrapPaymentDetails,
  type PaymentDetails,
} from './supplier-payment-crypto.js';
import { SupplierSchema } from './supplier.schema.js';

const k1 = MasterKeyring.of([{ keyId: 'k1', key: randomBytes(32) }], 'k1');
const bank: PaymentDetails = {
  kind: 'bank',
  details: {
    bankName: 'Rawbank',
    accountHolder: 'Socimex SARL',
    accountNumber: '0001-1234-5678-94521',
    iban: 'CD0800011234567894521',
    swift: 'RAWBCDKI',
  },
};
const momo: PaymentDetails = {
  kind: 'mobile_money',
  details: { operator: 'M-Pesa', phoneNumber: '+243 81 234 5678', holderName: 'Jean' },
};
const at = { organizationId: 'org-a', supplierId: 'a'.repeat(24), methodId: 'b'.repeat(24) };

describe('chiffrement des coordonnées', () => {
  it('aller-retour exact, jamais le clair dans le chiffré', () => {
    const record = encryptPaymentDetails({ ...at, payment: bank, keyring: k1, updatedBy: 'u1' });
    expect(record.alg).toBe('aes-256-gcm');
    expect(record.last4).toBeNull();
    expect(JSON.stringify(record)).not.toContain('94521');
    expect(decryptPaymentDetails({ ...at, kind: 'bank', record, keyring: k1 })).toEqual(bank);
  });

  it('deux chiffrements de la même valeur diffèrent (iv neuf)', () => {
    const a = encryptPaymentDetails({ ...at, payment: momo, keyring: k1, updatedBy: 'u1' });
    const b = encryptPaymentDetails({ ...at, payment: momo, keyring: k1, updatedBy: 'u1' });
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('un chiffré déplacé vers une autre fiche, organisation ou moyen ne se déchiffre pas', () => {
    const record = encryptPaymentDetails({ ...at, payment: bank, keyring: k1, updatedBy: 'u1' });
    for (const moved of [
      { ...at, supplierId: 'c'.repeat(24) },
      { ...at, organizationId: 'org-b' },
      { ...at, methodId: 'd'.repeat(24) },
    ]) {
      expect(() => decryptPaymentDetails({ ...moved, kind: 'bank', record, keyring: k1 })).toThrow(
        /Déchiffrement refusé/,
      );
    }
  });

  it('rotation : re-chiffré sous la clé courante, idempotente', () => {
    const record = encryptPaymentDetails({ ...at, payment: bank, keyring: k1, updatedBy: 'u1' });
    const k2 = MasterKeyring.of(
      [
        { keyId: 'k2', key: randomBytes(32) },
        { keyId: 'k1', key: k1.keyFor('k1') },
      ],
      'k2',
    );
    const once = rewrapPaymentDetails({ ...at, record, keyring: k2 });
    expect(once.changed).toBe(true);
    expect(once.record.keyId).toBe('k2');
    expect(
      decryptPaymentDetails({ ...at, kind: 'bank', record: once.record, keyring: k2 }),
    ).toEqual(bank);
    expect(rewrapPaymentDetails({ ...at, record: once.record, keyring: k2 }).changed).toBe(false);
  });
});

describe('masque et empreinte', () => {
  it('masques de l’ADR', () => {
    expect(maskPaymentDetails(bank)).toBe('Rawbank •••• 4521');
    expect(maskPaymentDetails(momo)).toBe('M-Pesa •••• 78');
    expect(
      maskPaymentDetails({ kind: 'bank', details: { ...bank.details, accountNumber: '12345' } }),
    ).toBe('Rawbank •••• 45');
  });

  it('empreinte : stable à la mise en forme, propre à l’organisation et à la clé', () => {
    const variant: PaymentDetails = {
      kind: 'mobile_money',
      details: { ...momo.details, phoneNumber: '+243812345678', holderName: 'Autre' },
    };
    expect(canonicalAccount(variant)).toBe(canonicalAccount(momo));
    const f = paymentFingerprint('org-a', momo, k1);
    expect(f).toMatch(/^[0-9a-f]{16}$/);
    expect(paymentFingerprint('org-a', variant, k1)).toBe(f);
    expect(paymentFingerprint('org-b', momo, k1)).not.toBe(f);
    const autreCle = MasterKeyring.of([{ keyId: 'k1', key: randomBytes(32) }], 'k1');
    expect(paymentFingerprint('org-a', momo, autreCle)).not.toBe(f);
  });

  it('la sérialisation d’une fiche n’emporte jamais le chiffré', () => {
    const record = encryptPaymentDetails({ ...at, payment: bank, keyring: k1, updatedBy: 'u1' });
    const transform = (
      SupplierSchema.get('toJSON') as { transform: (d: unknown, r: unknown) => unknown }
    ).transform;
    const out = transform(null, {
      name: 'X',
      paymentMethods: [{ id: 'm', masked: 'Rawbank •••• 4521', cipher: record }],
    });
    const text = JSON.stringify(out) + inspect(out);
    expect(text).not.toContain(record.ciphertext);
    expect(text).toContain('[redacted]');
  });
});
