// Jeton de vérification d'une carte de service — ADR-0069 O1.
//
// 18 octets tirés au hasard (144 bits), 24 caractères base64url : ni le matricule,
// ni l'identifiant de la fiche, aucune structure. Stocké EN CLAIR (il est imprimé
// sur la carte : référence non devinable, pas un secret) pour réimprimer la carte
// sans la réémettre. Émettre à nouveau remplace le jeton : l'ancienne carte devient
// « non valide ».

import { randomBytes } from 'node:crypto';

import { CARD_TOKEN_PATTERN } from '@lalanda/shared/hr';

export const CARD_TOKEN_BYTES = 18;

export function newCardToken(): string {
  return randomBytes(CARD_TOKEN_BYTES).toString('base64url');
}

export function isCardToken(value: unknown): value is string {
  return typeof value === 'string' && CARD_TOKEN_PATTERN.test(value);
}

/** Base de l'URL de vérification (`CARD_VERIFY_BASE_URL`, défaut `https://lalanda.co`). */
export function cardVerifyBaseUrl(): string {
  const raw = (process.env['CARD_VERIFY_BASE_URL'] ?? '').trim();
  const base = /^https?:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(raw.replace(/\/+$/, ''))
    ? raw.replace(/\/+$/, '')
    : 'https://lalanda.co';
  return base;
}

/** URL encodée dans le QR. */
export function cardVerifyUrl(token: string): string {
  return `${cardVerifyBaseUrl()}/v/${token}`;
}

/** Mention imprimée sous le QR : « lalanda.co/v ». */
export function cardVerifyLabel(): string {
  return `${cardVerifyBaseUrl().replace(/^https?:\/\//, '')}/v`;
}
