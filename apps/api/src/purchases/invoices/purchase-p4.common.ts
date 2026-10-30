// Briques communes aux réceptions et aux factures fournisseurs (ADR-0044 § 2.4,
// § 2.5). ADR-0044 — P4.
//
// Erreurs au format des contrôleurs de ventes : `{ code, message, details? }`, en
// français ; une ressource d'une autre organisation répond 404, jamais 403.

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { z } from 'zod';

import { kinshasaDayOf } from '../../sales/receipts/kinshasa-day.js';
import { conflict, invalidRequest } from '../../sales/sales.errors.js';

export { conflict };

export interface PurchaseActor {
  userId: string;
  role: string;
}

export function notFound(code: string, message: string): never {
  throw new NotFoundException({ code, message });
}

export function badRequest(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new BadRequestException({ code, message, ...(details ? { details } : {}) });
}

export function orderNotFound(): never {
  notFound('PURCHASE_ORDER_NOT_FOUND', 'Commande introuvable.');
}

export function orderLineNotFound(): never {
  notFound('PURCHASE_ORDER_LINE_NOT_FOUND', 'Ligne de commande introuvable sur cette commande.');
}

/** Jour civil de Kinshasa (ADR-0027) ; `now` injectable pour les tests. */
export function todayInKinshasa(now = new Date()): string {
  return kinshasaDayOf(now);
}

/** « Jamais future » (§ 2.4, § 2.5) : comparé au jour de Kinshasa du serveur. */
export function assertNotFuture(day: string, field: string, now = new Date()): void {
  if (day > todayInKinshasa(now)) {
    badRequest('PURCHASE_DATE_IN_FUTURE', 'Cette date ne peut pas être dans le futur.', { field });
  }
}

export function oid(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}

export function isOid(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-f]{24}$/i.test(id);
}

// ── Curseur « clé décroissante puis identifiant décroissant » ────────────────

export function encodeKeyCursor(key: string, id: string): string {
  return Buffer.from(JSON.stringify({ k: key, i: id }), 'utf8').toString('base64url');
}

export function decodeKeyCursor(raw: string): { key: string; id: Types.ObjectId } | null {
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const { k, i } = parsed as Record<string, unknown>;
    if (typeof k !== 'string' || !isOid(i)) return null;
    if (encodeKeyCursor(k, i) !== raw) return null;
    return { key: k, id: oid(i) };
  } catch {
    return null;
  }
}

/** Filtre « après le curseur » pour le tri `{ [field]: -1, _id: -1 }`. */
export function beforeKeyCursor(
  field: string,
  cursor: { key: string; id: Types.ObjectId },
): Record<string, unknown> {
  return {
    $or: [{ [field]: { $lt: cursor.key } }, { [field]: cursor.key, _id: { $lt: cursor.id } }],
  };
}

/** Corps validé par un schéma partagé ; 400 `INVALID_REQUEST` sinon. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) invalidRequest(parsed.error);
  return parsed.data;
}
