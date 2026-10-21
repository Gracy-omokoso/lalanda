// Curseur de liste triée par date décroissante puis identifiant décroissant :
// base64url de `{ "t": date ISO, "i": id }`. Opaque pour l'appelant ; un curseur
// illisible ou altéré vaut `null` (l'appelant répond 400 INVALID_CURSOR).

import { Types } from 'mongoose';

import { isObjectIdHex } from '../sales/search.js';

export function encodeTimeCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: at.toISOString(), i: id }), 'utf8').toString('base64url');
}

export function decodeTimeCursor(raw: string): { at: Date; id: Types.ObjectId } | null {
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const { t, i } = parsed as Record<string, unknown>;
    if (typeof t !== 'string' || typeof i !== 'string' || !isObjectIdHex(i)) return null;
    const at = new Date(t);
    if (Number.isNaN(at.getTime()) || encodeTimeCursor(at, i) !== raw) return null;
    return { at, id: new Types.ObjectId(i) };
  } catch {
    return null;
  }
}

/** Filtre « après le curseur » pour le tri `{ [field]: -1, _id: -1 }`. */
export function beforeTimeCursor(
  field: string,
  cursor: { at: Date; id: Types.ObjectId },
): Record<string, unknown> {
  return {
    $or: [{ [field]: { $lt: cursor.at } }, { [field]: cursor.at, _id: { $lt: cursor.id } }],
  };
}
