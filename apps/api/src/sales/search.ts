// Normalisation de recherche et curseur de pagination — ADR-0022 § S25c.5.
//
// Les listes de clients et d'articles sont triées par `sortName` puis `_id`
// (docs/16 : pagination par curseur). Le curseur est opaque pour l'appelant :
// base64url de `{ "s": sortName, "i": id }`. Un curseur illisible répond
// `400 INVALID_CURSOR`, jamais une première page silencieuse.

import { Types } from 'mongoose';

/**
 * Forme de comparaison : minuscules, sans accents, espaces réduits. Sert à la
 * fois au tri (`sortName`), à la clé de recherche (`searchKey`) et au terme
 * recherché (`q`) — un seul algorithme, sinon « eleve » ne trouverait plus
 * « Élevé ».
 */
export function normalizeForSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Clé de recherche : parties non vides, normalisées, séparées par une espace. */
export function searchKeyOf(parts: ReadonlyArray<string | null | undefined>): string {
  return parts
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    .map(normalizeForSearch)
    .join(' ');
}

/** Échappe les métacaractères d'une expression régulière : `.*` cherche « .* ». */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface ListCursor {
  sortName: string;
  id: Types.ObjectId;
}

export function encodeCursor(sortName: string, id: string): string {
  return Buffer.from(JSON.stringify({ s: sortName, i: id }), 'utf8').toString('base64url');
}

/** `null` si le curseur est illisible (base64url, JSON ou forme invalides). */
export function decodeCursor(raw: string): ListCursor | null {
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const { s, i } = parsed as Record<string, unknown>;
  if (typeof s !== 'string' || typeof i !== 'string' || !isObjectIdHex(i)) return null;
  if (Object.keys(parsed).length !== 2) return null;
  // Aller-retour exact : le décodeur base64url de Node tolère des caractères en
  // trop ; un curseur qui ne se réencode pas à l'identique a été altéré.
  if (encodeCursor(s, i) !== raw) return null;
  return { sortName: s, id: new Types.ObjectId(i) };
}

/** Identifiant Mongo sous sa forme canonique de 24 caractères hexadécimaux. */
export function isObjectIdHex(value: string): boolean {
  return /^[0-9a-f]{24}$/i.test(value);
}

/** Filtre « après le curseur » pour le tri `{ sortName: 1, _id: 1 }`. */
export function afterCursor(cursor: ListCursor): Record<string, unknown> {
  return {
    $or: [
      { sortName: { $gt: cursor.sortName } },
      { sortName: cursor.sortName, _id: { $gt: cursor.id } },
    ],
  };
}
