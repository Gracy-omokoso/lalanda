// Contenu chiffré des évaluations (ADR-0051 § 2.6, § 4). ADR-0051 — H15.
//
// AUCUN nouveau schéma cryptographique : `secrets-crypto.ts` (ADR-0013) est réutilisé
// tel quel, motif exact des données sensibles du personnel (ADR-0045 § 2.4,
// `hr-private-crypto.ts`). L'emplacement `org:hr_reviews` porte, dans `documentId` et
// `secretName`, l'organisation, l'évaluation et la section : la dérivation HKDF et l'AAD
// lient donc le chiffré à `organizationId + reviewId + section`. Un chiffré recopié vers
// une autre évaluation, une autre section ou une autre organisation ne se déchiffre pas.
//
// Une seule définition de l'emplacement, partagée par l'écriture, la lecture (`reveal`)
// et la rotation (`secrets:rewrap`, `integrations/rewrap.ts`).

import { HR_REVIEWS_KEY_SLOT, type ReviewSection } from '@lalanda/shared/hr';

import {
  decryptSecret,
  encryptSecret,
  rewrapSecret,
  type EncryptedValue,
  type MasterKeyring,
  type SecretLocation,
} from '../../integrations/secrets-crypto.js';

/** Contenu d'une section, en clair (jamais stocké ni journalisé tel quel). */
export interface ReviewSectionContent {
  /** Réponses par section de trame (ou `comment`), texte libre. */
  answers: Record<string, string>;
  /** Notes CHOISIES par l'évaluateur, par section `scale` (évaluation du manager seule). */
  ratings?: Record<string, number>;
  /** Appréciation générale CHOISIE, jamais calculée ; absente si non choisie. */
  overall?: number | null;
}

export interface HrReviewSectionIdentity {
  organizationId: string;
  reviewId: string;
  section: ReviewSection;
}

/** Emplacement cryptographique d'une section — UNE seule définition. */
export function hrReviewLocation(id: HrReviewSectionIdentity): SecretLocation {
  return {
    documentId: `${id.organizationId}:${id.reviewId}`,
    provider: HR_REVIEWS_KEY_SLOT,
    secretName: `${id.organizationId}:${id.reviewId}:${id.section}`,
  };
}

export function encryptReviewSection(
  id: HrReviewSectionIdentity,
  value: ReviewSectionContent,
  keyring: MasterKeyring,
  updatedBy: string,
): EncryptedValue {
  const record = encryptSecret({
    location: hrReviewLocation(id),
    value: JSON.stringify(value),
    keyring,
    updatedBy,
  });
  // `last4` d'un JSON n'aurait aucun sens (et trahirait la fin d'une appréciation).
  return { ...record, last4: null };
}

export function decryptReviewSection(
  id: HrReviewSectionIdentity,
  record: EncryptedValue,
  keyring: MasterKeyring,
): ReviewSectionContent {
  const plain = decryptSecret({ location: hrReviewLocation(id), record, keyring });
  return JSON.parse(plain.expose()) as ReviewSectionContent;
}

/** Rotation (ADR-0013 § 3) : `changed: false` si le chiffré est déjà à la clé courante. */
export function rewrapReviewSection(
  id: HrReviewSectionIdentity,
  record: EncryptedValue,
  keyring: MasterKeyring,
): { changed: boolean; record: EncryptedValue } {
  const out = rewrapSecret({ location: hrReviewLocation(id), record, keyring });
  return out.changed ? { changed: true, record: { ...out.record, last4: null } } : out;
}
