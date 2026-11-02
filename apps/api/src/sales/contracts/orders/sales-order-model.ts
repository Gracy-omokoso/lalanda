// Règles pures des commandes clients — ADR-0050 § 2.2. ADR-0050 — V2.
// Aucune base, aucune horloge implicite, aucun montant : les quantités seules sont
// COMPARÉES (jamais additionnées ici — le reste à facturer vient du moteur).

import type { OrderInvoicingResult } from '@lalanda/engine';
import type { SalesOrderStatus } from '@lalanda/shared/sales-contracts';

export const SALES_ORDER_STATUS_LABELS: Record<SalesOrderStatus, string> = {
  draft: 'Brouillon',
  confirmed: 'Confirmée',
  closed: 'Close',
  cancelled: 'Annulée',
};

export const SALES_ORDER_INVOICING_LABELS: Record<OrderInvoicingResult['status'], string> = {
  not_invoiced: 'Non facturée',
  partially_invoiced: 'Partiellement facturée',
  invoiced: 'Facturée',
};

export interface SalesOrderActions {
  edit: boolean;
  delete: boolean;
  confirm: boolean;
  close: boolean;
  /** « Clore » est PROPOSÉ quand tout est facturé (jamais appliqué seul). */
  closeSuggested: boolean;
  cancel: boolean;
  prepareInvoice: boolean;
  addFile: boolean;
}

/** Actions selon le statut stocké et le reste à facturer (l'API et l'écran partagent la table). */
export function salesOrderActionsOf(
  status: SalesOrderStatus,
  invoicing: OrderInvoicingResult | null,
  hasIssuedInvoice: boolean,
): SalesOrderActions {
  const somethingToPrepare =
    invoicing?.lines.some((l) => compareQuantities(l.remainingToPrepare, '0') > 0) ?? false;
  return {
    edit: status === 'draft',
    delete: status === 'draft',
    confirm: status === 'draft',
    close: status === 'confirmed',
    closeSuggested: status === 'confirmed' && invoicing?.closeSuggested === true,
    cancel: status === 'draft' || (status === 'confirmed' && !hasIssuedInvoice),
    prepareInvoice: status === 'confirmed' && somethingToPrepare,
    addFile: status === 'draft' || status === 'confirmed',
  };
}

const QUANTITY = /^(\d+)(?:\.(\d{1,3}))?$/;

function milli(value: string): bigint {
  const m = QUANTITY.exec(value);
  if (m === null) throw new RangeError(`Quantité illisible : ${JSON.stringify(value)}`);
  return BigInt(m[1]!) * 1000n + BigInt((m[2] ?? '').padEnd(3, '0'));
}

/** Signe de `a − b` pour deux quantités décimales (≤ 3 décimales) : −1, 0 ou 1. */
export function compareQuantities(a: string, b: string): -1 | 0 | 1 {
  const x = milli(a);
  const y = milli(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Ligne C d'une facture préparée depuis une commande (§ 4.3), tronquée à `max`. */
export function orderInvoiceComment(
  order: { number: string; customerReference: string | null },
  max: number,
): { text: string; truncated: boolean } {
  const full = `Commande ${order.number}${
    order.customerReference ? ` — réf. client ${order.customerReference}` : ''
  }`;
  return full.length > max
    ? { text: full.slice(0, max), truncated: true }
    : { text: full, truncated: false };
}
