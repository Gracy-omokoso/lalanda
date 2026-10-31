// Briques communes du module des stocks (ADR-0046 § 1, § 5). ADR-0046 — S3.
//
// Erreurs au format des contrôleurs d'achats (`{ code, message, details? }`) ; une
// ressource d'une autre organisation répond 404, jamais 403 ; un refus de droit décidé
// dans un service (coût, ajustement) reprend la forme du guard (`forbidden()`).
// Les VALEURS ne sont servies qu'avec `canSeeStockValues` (droits EFFECTIFS).

import type { StockItemInput, StockMovementInput } from '@lalanda/engine';
import { canonicalStockDecimal } from '@lalanda/shared/stock';
import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { ClientSession, Connection } from 'mongoose';
import type { z } from 'zod';

import { forbidden } from '../authz/authz.service.js';
import type { CurrentOrgPermissionsValue } from '../authz/current-org-permissions.decorator.js';
import { can, canSeeStockValues, type Action } from '../authz/permissions.js';
import { badRequest, notFound } from '../purchases/invoices/purchase-p4.common.js';
import { kinshasaDayOf } from '../sales/receipts/kinshasa-day.js';
import { conflict, invalidRequest } from '../sales/sales.errors.js';
import type { StockItemLean, StockMovementLean } from './stock.schemas.js';

export { badRequest, conflict, notFound };

/** Acteur d'une requête des stocks : identité, rôle (audit) et droits EFFECTIFS (décision). */
export interface StockActor {
  userId: string;
  role: string;
  perms: CurrentOrgPermissionsValue | undefined;
}

export function actorOf(
  user: { id: string },
  role: string | undefined,
  perms: CurrentOrgPermissionsValue | undefined,
): StockActor {
  return { userId: user.id, role: role ?? 'unknown', perms };
}

/** Droit effectif de l'acteur (ajouts et retraits compris). */
export function holds(actor: StockActor, action: Action): boolean {
  return actor.perms ? can(actor.perms.role, action, actor.perms.context) : false;
}

/** L'acteur voit les valeurs (§ 5) : `purchase.read` ou `treasury.read` effectif. */
export function seesValues(actor: StockActor): boolean {
  return actor.perms ? canSeeStockValues(actor.perms.role, actor.perms.context) : false;
}

/** Refus décidé dans le service, à la forme du guard (`403 FORBIDDEN`, action nommée). */
export function requireAction(actor: StockActor, action: Action): void {
  if (holds(actor, action)) return;
  const customized = actor.perms?.context.revokes?.includes(action) === true;
  throw new ForbiddenException(forbidden(action, actor.perms?.role ?? actor.role, customized));
}

/** Corps validé par un schéma partagé ; 400 `INVALID_REQUEST` sinon. */
export function parseWith<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) invalidRequest(parsed.error);
  return parsed.data;
}

export function oid(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}

export function isOid(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-f]{24}$/i.test(id);
}

/** Jour civil de Kinshasa (ADR-0027). */
export function stockToday(now = new Date()): string {
  return kinshasaDayOf(now);
}

/** « Jamais future » (§ 2.3, § 2.4) : comparé au jour de Kinshasa du serveur. */
export function assertNotFuture(day: string, field: string, now = new Date()): void {
  if (day > stockToday(now)) {
    badRequest('STOCK_DATE_IN_FUTURE', 'Cette date ne peut pas être dans le futur.', { field });
  }
}

export function itemNotFound(): never {
  notFound('STOCK_ITEM_NOT_FOUND', 'Article introuvable.');
}

export function locationNotFound(): never {
  notFound('STOCK_LOCATION_NOT_FOUND', 'Emplacement introuvable.');
}

/** Quantité canonique à trois décimales (`"4.000"`, `"-2.500"`) ; forme seulement. */
export function qty3(raw: string): string {
  const out = canonicalStockDecimal(raw, 3, true);
  if (out === null) throw new Error(`Quantité illisible : ${raw}`);
  return out;
}

/** Opposé d'une quantité canonique (changement de signe, aucun calcul). */
export function negate(quantity: string): string {
  return quantity.startsWith('-') ? quantity.slice(1) : qty3(`-${quantity}`);
}

/** Vrai si la quantité canonique est strictement positive. */
export const isEntry = (quantity: string): boolean =>
  !quantity.startsWith('-') && !/^[0.]+$/.test(quantity);

// ── Passage au moteur ───────────────────────────────────────────────────────

export function engineItem(d: StockItemLean): StockItemInput {
  return {
    id: String(d._id),
    unit: d.unit,
    unitConversions: d.unitConversions,
    costCurrency: d.costCurrency,
    tracked: d.tracked,
    active: d.active,
    kind: d.kind,
    reorder: d.reorder,
    preferredSupplierId: d.preferredSupplierId,
    discreteUnit: d.discreteUnit,
  };
}

export function engineMovement(d: StockMovementLean): StockMovementInput {
  return {
    id: String(d._id),
    itemId: d.itemId,
    locationId: d.locationId,
    kind: d.kind,
    quantity: d.quantity,
    occurredOn: d.occurredOn,
    unitCost: d.unitCost,
    costStatus: d.costStatus,
    workProjectId: d.workProjectId,
    reversalOf: d.reversalOf,
    recordedAt: new Date(d.createdAt).toISOString(),
  };
}

// ── Curseurs ────────────────────────────────────────────────────────────────

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

/** Filtre « après le curseur » pour un tri `{ [field]: dir, _id: dir }`. */
export function afterKeyCursor(
  field: string,
  cursor: { key: string; id: Types.ObjectId },
  dir: 1 | -1,
): Record<string, unknown> {
  const op = dir === 1 ? '$gt' : '$lt';
  return {
    $or: [{ [field]: { [op]: cursor.key } }, { [field]: cursor.key, _id: { [op]: cursor.id } }],
  };
}

export function invalidCursor(): never {
  badRequest('INVALID_CURSOR', 'Curseur de pagination invalide.');
}

// ── Transactions ────────────────────────────────────────────────────────────

/**
 * Transaction MongoDB : `withTransaction` rejoue le rappel sur une erreur transitoire
 * (`WriteConflict` quand deux écritures touchent le même niveau de stock), ce qui
 * sérialise les mouvements d'un même article à un même emplacement.
 */
export async function inTransaction<T>(
  connection: Connection,
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await connection.startSession();
  try {
    let out!: T;
    await session.withTransaction(async () => {
      out = await fn(session);
    });
    return out;
  } finally {
    await session.endSession();
  }
}

/** Normalisation de recherche : minuscules, sans accents ni espaces multiples. */
export function normalizeKey(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const iso = (d: Date | string | null | undefined): string | null =>
  d === null || d === undefined ? null : new Date(d).toISOString();

export { conflict as stockConflict };
