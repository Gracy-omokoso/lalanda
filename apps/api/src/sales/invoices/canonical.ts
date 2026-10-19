// Formes canoniques et empreintes des documents de vente — ADR-0023 § S25e.1,
// § S25e.12.
//
// `contentSha256` prouve l'immuabilité d'un document gelé : il est calculé au gel
// sur les SEULS champs figés (§ S25e.2) et doit se recalculer à l'identique à
// tout moment ensuite. Les champs de suivi (statut, `normalization`, `credited`,
// `duplicateCount`, numéro attribué plus tard par S25f) en sont exclus.
//
// `journalHash` chaîne le journal électronique : `sha256(prevHash + forme
// canonique de l'entrée)`. Toute altération ou suppression d'une entrée rompt
// la chaîne (`chainValid: false`).

import { createHash } from 'node:crypto';

import { canonicalJson } from '../../edef/edef-reference-snapshots.service.js';

export { canonicalJson };

/** Les champs figés au gel, dans l'ordre du § S25e.2 (l'ordre n'importe pas : clés triées). */
export const FROZEN_CONTENT_FIELDS = [
  'type',
  'currency',
  'priceMode',
  'customer',
  'pointOfSaleId',
  'lines',
  'payments',
  'comments',
  'creditNote',
  'showUsdCounterValue',
  'documentAmounts',
  'conversion',
  'normalizedAmounts',
  'calculationVersion',
  'roundingPolicyId',
  'taxRates',
  'emissionMode',
  'environment',
  'isf',
  'seller',
  'operator',
  'frozenFromRevision',
] as const;

/** Valeur JSON pure : les dates deviennent des chaînes ISO, `undefined` disparaît. */
function plain(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === 'object') {
    // `ObjectId` et autres objets porteurs d'un `toHexString` : leur forme texte.
    const hex = (value as { toHexString?: () => string }).toHexString;
    if (typeof hex === 'function') return hex.call(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = plain(v);
    }
    return out;
  }
  return value;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Empreinte du contenu figé d'un document (absent ≡ `null`). */
export function contentSha256Of(doc: Readonly<Record<string, unknown>>): string {
  const content: Record<string, unknown> = {};
  for (const field of FROZEN_CONTENT_FIELDS) content[field] = plain(doc[field] ?? null);
  return sha256Hex(canonicalJson(content));
}

/** Hachage d'une entrée du journal, chaînée à la précédente. */
export function journalHash(prevHash: string, entry: Readonly<Record<string, unknown>>): string {
  return sha256Hex(`${prevHash}\n${canonicalJson(plain(entry))}`);
}

/** Valeur de `prevHash` de la première entrée d'une organisation. */
export const JOURNAL_GENESIS_HASH = '0'.repeat(64);
