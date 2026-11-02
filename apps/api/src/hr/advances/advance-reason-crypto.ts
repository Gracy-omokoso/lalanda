// Motif d'une avance SUR SALAIRE : chiffrement (ADR-0051 § 4). ADR-0051 — H10.
//
// AUCUN nouveau schéma cryptographique : `secrets-crypto.ts` (ADR-0013) tel quel, motif
// exact des données sensibles du collaborateur (ADR-0045 § 2.4). L'emplacement
// `org:hr_advances` porte l'organisation, l'avance et la section `advanceReason` : un
// chiffré recopié vers une autre avance ou une autre organisation ne se déchiffre pas.

import {
  decryptSecret,
  encryptSecret,
  rewrapSecret,
  type EncryptedValue,
  type MasterKeyring,
  type SecretLocation,
} from '../../integrations/secrets-crypto.js';

/** Emplacement cryptographique — UNE seule définition (écriture, lecture, rotation). */
export function advanceReasonLocation(organizationId: string, advanceId: string): SecretLocation {
  return {
    documentId: `${organizationId}:${advanceId}`,
    provider: 'org:hr_advances',
    secretName: `${organizationId}:${advanceId}:advanceReason`,
  };
}

export function sealAdvanceReason(input: {
  organizationId: string;
  advanceId: string;
  reason: string;
  keyring: MasterKeyring;
  updatedBy: string;
}): EncryptedValue {
  const record = encryptSecret({
    location: advanceReasonLocation(input.organizationId, input.advanceId),
    value: input.reason,
    keyring: input.keyring,
    updatedBy: input.updatedBy,
  });
  // Les quatre derniers caractères d'un motif ne sont pas un masque : rien en clair.
  return { ...record, last4: null };
}

export function openAdvanceReason(input: {
  organizationId: string;
  advanceId: string;
  record: EncryptedValue;
  keyring: MasterKeyring;
}): string {
  return decryptSecret({
    location: advanceReasonLocation(input.organizationId, input.advanceId),
    record: input.record,
    keyring: input.keyring,
  }).expose();
}

/** Rotation (ADR-0013 § 3) : `changed: false` si le chiffré est déjà à la clé courante. */
export function rewrapAdvanceReason(input: {
  organizationId: string;
  advanceId: string;
  record: EncryptedValue;
  keyring: MasterKeyring;
}): { changed: boolean; record: EncryptedValue } {
  const out = rewrapSecret({
    location: advanceReasonLocation(input.organizationId, input.advanceId),
    record: input.record,
    keyring: input.keyring,
  });
  return out.changed ? { changed: true, record: { ...out.record, last4: null } } : out;
}
