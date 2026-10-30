// Données sensibles du collaborateur : chiffrement, masque, empreinte (ADR-0045 § 2.4).
// ADR-0045 — H2.
//
// AUCUN nouveau schéma cryptographique. `secrets-crypto.ts` (ADR-0013) est réutilisé
// tel quel, exactement comme les coordonnées des fournisseurs (ADR-0044 § 2.1.1) :
// l'emplacement `org:hr_employee_private` porte, dans `documentId` et `secretName`,
// l'organisation, le collaborateur et la section ; la dérivation HKDF et l'AAD lient
// donc le chiffré à `organizationId + employeeId + section`. Un chiffré recopié vers
// un autre collaborateur, une autre section ou une autre organisation ne se
// déchiffre pas. Le masque et l'empreinte d'un compte bancaire sont ceux des
// fournisseurs (`maskPaymentDetails`, `paymentFingerprint`).

import type {
  HrBankAccount,
  HrBankAccountMasked,
  HrPrivateField,
  HrPrivateSections,
} from '@lalanda/shared/hr';

import {
  maskPaymentDetails,
  paymentFingerprint,
  type PaymentDetails,
} from '../../purchases/suppliers/supplier-payment-crypto.js';
import {
  decryptSecret,
  encryptSecret,
  rewrapSecret,
  type EncryptedValue,
  type MasterKeyring,
  type SecretLocation,
} from '../../integrations/secrets-crypto.js';

/** Emplacement cryptographique d'une section — UNE seule définition (écriture, lecture, rotation). */
export function hrPrivateLocation(
  organizationId: string,
  employeeId: string,
  field: HrPrivateField,
): SecretLocation {
  return {
    documentId: `${organizationId}:${employeeId}`,
    provider: 'org:hr_employee_private',
    secretName: `${organizationId}:${employeeId}:${field}`,
  };
}

export function encryptHrPrivate<F extends HrPrivateField>(input: {
  organizationId: string;
  employeeId: string;
  field: F;
  value: HrPrivateSections[F];
  keyring: MasterKeyring;
  updatedBy: string;
}): EncryptedValue {
  const record = encryptSecret({
    location: hrPrivateLocation(input.organizationId, input.employeeId, input.field),
    value: JSON.stringify(input.value),
    keyring: input.keyring,
    updatedBy: input.updatedBy,
  });
  // `last4` d'un JSON n'aurait aucun sens (et pourrait trahir la fin d'un numéro).
  return { ...record, last4: null };
}

export function decryptHrPrivate<F extends HrPrivateField>(input: {
  organizationId: string;
  employeeId: string;
  field: F;
  record: EncryptedValue;
  keyring: MasterKeyring;
}): HrPrivateSections[F] {
  const plain = decryptSecret({
    location: hrPrivateLocation(input.organizationId, input.employeeId, input.field),
    record: input.record,
    keyring: input.keyring,
  });
  return JSON.parse(plain.expose()) as HrPrivateSections[F];
}

/** Rotation (ADR-0013 § 3) : `changed: false` si le chiffré est déjà à la clé courante. */
export function rewrapHrPrivate(input: {
  organizationId: string;
  employeeId: string;
  field: HrPrivateField;
  record: EncryptedValue;
  keyring: MasterKeyring;
}): { changed: boolean; record: EncryptedValue } {
  const out = rewrapSecret({
    location: hrPrivateLocation(input.organizationId, input.employeeId, input.field),
    record: input.record,
    keyring: input.keyring,
  });
  return out.changed ? { changed: true, record: { ...out.record, last4: null } } : out;
}

function paymentOf(account: HrBankAccount): PaymentDetails {
  if (account.kind === 'bank') {
    return {
      kind: 'bank',
      details: {
        bankName: account.bankName,
        accountHolder: account.holderName,
        accountNumber: account.accountNumber,
        iban: account.iban ?? null,
        swift: account.swift ?? null,
      },
    };
  }
  return {
    kind: 'mobile_money',
    details: {
      operator: account.operator,
      phoneNumber: account.phoneNumber,
      holderName: account.holderName,
    },
  };
}

/** `Rawbank •••• 4521`, `M-Pesa •••• 78` et l'empreinte HMAC propre à l'organisation. */
export function maskBankAccount(
  organizationId: string,
  account: HrBankAccount,
  keyring: MasterKeyring,
): HrBankAccountMasked {
  const payment = paymentOf(account);
  return {
    kind: account.kind,
    masked: maskPaymentDetails(payment),
    fingerprint: paymentFingerprint(organizationId, payment, keyring),
  };
}

/**
 * Forme masquée d'une section (sans l'horodatage) : jamais un montant, une devise,
 * un numéro de compte complet ni un numéro de pièce.
 */
export function maskHrPrivate<F extends HrPrivateField>(
  organizationId: string,
  field: F,
  value: HrPrivateSections[F],
  keyring: MasterKeyring,
): Record<string, unknown> {
  switch (field) {
    case 'compensation': {
      const v = value as HrPrivateSections['compensation'];
      const dates = v.history.map((h) => h.effectiveFrom).sort();
      return { since: dates[dates.length - 1]!, entries: v.history.length };
    }
    case 'bankDetails': {
      const v = value as HrPrivateSections['bankDetails'];
      return { accounts: v.accounts.map((a) => maskBankAccount(organizationId, a, keyring)) };
    }
    case 'identity': {
      const v = value as HrPrivateSections['identity'];
      return {
        hasBirthDate: Boolean(v.birthDate),
        hasNationality: Boolean(v.nationality),
        idDocuments: v.idDocuments.map((d) => ({ kind: d.kind, expiresOn: d.expiresOn ?? null })),
      };
    }
    case 'personalContact': {
      const v = value as HrPrivateSections['personalContact'];
      return {
        hasAddress: Boolean(v.address),
        hasPersonalPhone: Boolean(v.personalPhone),
        hasPersonalEmail: Boolean(v.personalEmail),
        emergencyContacts: v.emergencyContacts.length,
      };
    }
    default:
      return { present: true };
  }
}
