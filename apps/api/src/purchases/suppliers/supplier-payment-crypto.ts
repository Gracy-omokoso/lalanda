// Coordonnées de paiement des fournisseurs : chiffrement, masque, empreinte
// (ADR-0044 § 2.1.1). ADR-0044 — P2.
//
// AUCUN nouveau schéma cryptographique : `secrets-crypto.ts` (ADR-0013) est
// réutilisé tel quel. On lui passe un emplacement dont le `provider` est
// `org:supplier_payment_method` et dont le `documentId` et le `secretName` portent
// l'organisation, la fiche et le moyen : la dérivation HKDF et l'AAD lient donc le
// chiffré à `organizationId + supplierId + methodId` (§ 2.1.1). Un chiffré recopié
// vers une autre fiche, une autre organisation ou un autre moyen ne se déchiffre
// pas. Le préfixe `org:` évite toute collision avec un fournisseur plateforme.
//
// Empreinte (`fingerprint`) : HMAC-SHA256 tronqué, clé dérivée (HKDF) de la clé
// maîtresse COURANTE, message préfixé par l'organisation. Un numéro de téléphone a
// peu d'entropie : sans clé secrète, l'empreinte se retrouverait par force brute.
// Préfixée par l'organisation, elle ne permet aucune corrélation entre clients.
// La rotation (`secrets:rewrap`) la recalcule avec le chiffré.

import { createHmac, hkdfSync } from 'node:crypto';

import type { SupplierPaymentMethodKind } from '@lalanda/shared/purchases';

import {
  decryptSecret,
  encryptSecret,
  rewrapSecret,
  type EncryptedValue,
  type MasterKeyring,
  type SecretLocation,
} from '../../integrations/secrets-crypto.js';

export interface BankDetails {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  iban: string | null;
  swift: string | null;
}

export interface MobileMoneyDetails {
  operator: string;
  phoneNumber: string;
  holderName: string;
}

export type PaymentDetails =
  { kind: 'bank'; details: BankDetails } | { kind: 'mobile_money'; details: MobileMoneyDetails };

/** Emplacement cryptographique d'un moyen de paiement — UNE seule définition. */
export function supplierPaymentLocation(
  organizationId: string,
  supplierId: string,
  methodId: string,
): SecretLocation {
  return {
    documentId: `${organizationId}:${supplierId}`,
    provider: 'org:supplier_payment_method',
    secretName: `${organizationId}:${supplierId}:${methodId}`,
  };
}

/** Clair sérialisé : seuls les champs connus, dans un ordre fixe. */
function serialize(p: PaymentDetails): string {
  if (p.kind === 'bank') {
    const d = p.details;
    return JSON.stringify({
      bankName: d.bankName,
      accountHolder: d.accountHolder,
      accountNumber: d.accountNumber,
      iban: d.iban ?? null,
      swift: d.swift ?? null,
    });
  }
  const d = p.details;
  return JSON.stringify({
    operator: d.operator,
    phoneNumber: d.phoneNumber,
    holderName: d.holderName,
  });
}

export function encryptPaymentDetails(input: {
  organizationId: string;
  supplierId: string;
  methodId: string;
  payment: PaymentDetails;
  keyring: MasterKeyring;
  updatedBy: string;
}): EncryptedValue {
  const record = encryptSecret({
    location: supplierPaymentLocation(input.organizationId, input.supplierId, input.methodId),
    value: serialize(input.payment),
    keyring: input.keyring,
    updatedBy: input.updatedBy,
  });
  // `last4` n'a pas de sens sur un JSON (ce seraient des guillemets et une
  // accolade) : le masque lisible est porté par `masked`.
  return { ...record, last4: null };
}

export function decryptPaymentDetails(input: {
  organizationId: string;
  supplierId: string;
  methodId: string;
  kind: SupplierPaymentMethodKind;
  record: EncryptedValue;
  keyring: MasterKeyring;
}): PaymentDetails {
  const plain = decryptSecret({
    location: supplierPaymentLocation(input.organizationId, input.supplierId, input.methodId),
    record: input.record,
    keyring: input.keyring,
  });
  const parsed = JSON.parse(plain.expose()) as Record<string, string | null>;
  if (input.kind === 'bank') {
    return {
      kind: 'bank',
      details: {
        bankName: String(parsed['bankName']),
        accountHolder: String(parsed['accountHolder']),
        accountNumber: String(parsed['accountNumber']),
        iban: parsed['iban'] ?? null,
        swift: parsed['swift'] ?? null,
      },
    };
  }
  return {
    kind: 'mobile_money',
    details: {
      operator: String(parsed['operator']),
      phoneNumber: String(parsed['phoneNumber']),
      holderName: String(parsed['holderName']),
    },
  };
}

/** Rotation d'un chiffré (ADR-0013 § 3) : `changed: false` s'il est déjà à la clé courante. */
export function rewrapPaymentDetails(input: {
  organizationId: string;
  supplierId: string;
  methodId: string;
  record: EncryptedValue;
  keyring: MasterKeyring;
}): { changed: boolean; record: EncryptedValue } {
  return rewrapSecret({
    location: supplierPaymentLocation(input.organizationId, input.supplierId, input.methodId),
    record: input.record,
    keyring: input.keyring,
  });
}

/** Lettres et chiffres seulement, en majuscules (`CD08 0101-…` → `CD080101…`). */
function alnum(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Identifiant canonique d'un compte : IBAN s'il existe, sinon le numéro ; chiffres du téléphone. */
export function canonicalAccount(p: PaymentDetails): string {
  if (p.kind === 'bank') return alnum(p.details.iban ?? p.details.accountNumber);
  return p.details.phoneNumber.replace(/\D/g, '');
}

const FINGERPRINT_INFO = Buffer.from('lalanda:supplier-payment-fingerprint', 'utf8');
const FINGERPRINT_HEX = 16;

export function paymentFingerprint(
  organizationId: string,
  p: PaymentDetails,
  keyring: MasterKeyring,
): string {
  const key = Buffer.from(
    hkdfSync(
      'sha256',
      keyring.keyFor(keyring.currentKeyId),
      Buffer.alloc(0),
      FINGERPRINT_INFO,
      32,
    ) as ArrayBuffer,
  );
  return createHmac('sha256', key)
    .update(`${organizationId}|${p.kind}|${canonicalAccount(p)}`, 'utf8')
    .digest('hex')
    .slice(0, FINGERPRINT_HEX);
}

/**
 * Forme masquée servie partout : `Rawbank •••• 4521`, `M-Pesa •••• 78`. Banque :
 * quatre derniers caractères, deux seulement sous huit caractères ; mobile money :
 * deux derniers chiffres (ADR-0044 § 2.1.1).
 */
export function maskPaymentDetails(p: PaymentDetails): string {
  if (p.kind === 'bank') {
    const id = alnum(p.details.accountNumber);
    const tail = id.length >= 8 ? id.slice(-4) : id.slice(-2);
    return `${p.details.bankName} •••• ${tail}`;
  }
  const digits = p.details.phoneNumber.replace(/\D/g, '');
  return `${p.details.operator} •••• ${digits.slice(-2)}`;
}
