// Secret TOTP d'un opérateur : chiffrement au repos (ADR-0053 — P8).
//
// AUCUN nouveau schéma cryptographique : `secrets-crypto.ts` (ADR-0013) tel quel, sous
// `SECRETS_MASTER_KEY`, rotation comprise dans `secrets:rewrap`. L'emplacement porte
// l'identifiant de l'opérateur : un chiffré recopié sur la fiche d'un autre opérateur ne
// se déchiffre pas (AAD liée à l'emplacement).

import {
  decryptSecret,
  encryptSecret,
  rewrapSecret,
  type EncryptedValue,
  type MasterKeyring,
  type SecretLocation,
} from '../integrations/secrets-crypto.js';

/** Emplacement cryptographique — UNE seule définition (écriture, lecture, rotation). */
export function twoFactorSecretLocation(userId: string): SecretLocation {
  return {
    documentId: userId,
    provider: 'platform:two_factor',
    secretName: `${userId}:totp`,
  };
}

export function sealTotpSecret(input: {
  userId: string;
  secretBase32: string;
  keyring: MasterKeyring;
}): EncryptedValue {
  const record = encryptSecret({
    location: twoFactorSecretLocation(input.userId),
    value: input.secretBase32,
    keyring: input.keyring,
    updatedBy: input.userId,
  });
  // Rien en clair, pas même les quatre derniers caractères d'un secret d'authentification.
  return { ...record, last4: null };
}

export function openTotpSecret(input: {
  userId: string;
  record: EncryptedValue;
  keyring: MasterKeyring;
}): string {
  return decryptSecret({
    location: twoFactorSecretLocation(input.userId),
    record: input.record,
    keyring: input.keyring,
  }).expose();
}

/** Rotation (ADR-0013 § 3) : `changed: false` si le chiffré est déjà à la clé courante. */
export function rewrapTotpSecret(input: {
  userId: string;
  record: EncryptedValue;
  keyring: MasterKeyring;
}): { changed: boolean; record: EncryptedValue } {
  const out = rewrapSecret({
    location: twoFactorSecretLocation(input.userId),
    record: input.record,
    keyring: input.keyring,
  });
  return out.changed ? { changed: true, record: { ...out.record, last4: null } } : out;
}
