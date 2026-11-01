// Clés de source (ADR-0049 § 2.6 et § 6) : déterministes, une par événement de
// pièce. L'unicité `organizationId + sourceKey` (lot K5) rend tout rejeu inerte.
//
// Forme : `<nature>:<identifiant>:<événement>[:<jambe>]` (stock : `<nature>:<identifiant>`).

import { SOURCE_KINDS, type SourceKind } from '../types.js';

export const salesInvoiceKey = (id: string, event: 'issue' | 'paid_at_issue'): string =>
  `sales_invoice:${id}:${event}`;
export const receiptKey = (id: string, revision: number): string =>
  `sales_receipt:${id}:r${revision}`;
export const expenseKey = (id: string, revision: number): string =>
  `treasury_expense:${id}:r${revision}`;
export const supplierInvoiceKey = (id: string): string => `supplier_invoice:${id}:validate`;
export const supplierPaymentKey = (id: string): string => `supplier_payment:${id}:record`;
export const treasuryMovementKey = (id: string, event: 'out' | 'in' | 'record'): string =>
  `treasury_movement:${id}:${event}`;
/** Forme d'ADR-0049 § 6.7, sans événement : un mouvement de stock n'est jamais annulé (il est contre-passé par un autre mouvement). */
export const stockMovementKey = (id: string): string => `stock_movement:${id}`;

export interface ParsedSourceKey {
  kind: SourceKind;
  id: string;
  /** Événement et jambe éventuelle (`issue`, `r2`, `out`, `cancel:out`, `r1:superseded`…) ; vide pour un mouvement de stock. */
  event: string;
}

/** Lecture d'une clé produite par ce module ; `null` si elle n'en vient pas. */
export function parseSourceKey(key: string): ParsedSourceKey | null {
  const [kind, id, ...rest] = key.split(':');
  if (kind === undefined || id === undefined || id === '') return null;
  if (!(SOURCE_KINDS as readonly string[]).includes(kind)) return null;
  return { kind: kind as SourceKind, id, event: rest.join(':') };
}

/**
 * Clé de la contre-passation de `originalKey`.
 * - `cancel` (pièce annulée) : `<nature>:<id>:cancel` quand la pièce n'avait
 *   qu'une écriture active (forme d'ADR-0049 § 6.2 et § 6.4), sinon
 *   `<nature>:<id>:cancel:<événement>` (les deux jambes d'un virement) ;
 * - `superseded` (révision remplacée) : `<originalKey>:superseded`.
 */
export function reversalKey(
  originalKey: string,
  cause: 'cancel' | 'superseded',
  activeEntriesOfSource: number,
): string {
  if (cause === 'superseded') return `${originalKey}:superseded`;
  const parsed = parseSourceKey(originalKey);
  if (parsed === null) return `${originalKey}:cancel`;
  return activeEntriesOfSource <= 1 || parsed.event === ''
    ? `${parsed.kind}:${parsed.id}:cancel`
    : `${parsed.kind}:${parsed.id}:cancel:${parsed.event}`;
}
