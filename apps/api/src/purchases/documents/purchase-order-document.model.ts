// Contenu imprimé d'un BON DE COMMANDE — ADR-0044 § 3.3. ADR-0044 — P3.
//
// Fonction PURE : commande (telle que lue en base) + fournisseur → la forme que
// consomment le moteur de rendu et les modèles de l'organisation (ADR-0025,
// ADR-0028), comme le devis (`quote-document.model.ts`). Présentation propre :
// numéro `BC`, date d'approbation, fournisseur (nom, NIF s'il existe, adresse),
// lignes, sous-total HT, taxes TELLES QUE DÉCLARÉES par le fournisseur, total,
// adresse et date de livraison, conditions de paiement, et la mention fixe
// « Bon de commande — ce document n'est pas une facture ».
//
// JAMAIS : ni QR code, ni élément de sécurité DGI, ni numéro de facture, ni
// coordonnées bancaires du fournisseur (elles ne sont même pas lues ici). Aucun
// calcul : montants rendus par le moteur, seulement mis en forme.

import { amountInWords } from '../../sales/documents/amount-in-words.js';
import {
  DocumentNotPrintableError,
  INVOICE_PDF_LAYOUT_VERSION,
  formatAmount,
  formatKinshasa,
  type DocumentLine,
  type DocumentParty,
  type InvoiceDocumentModel,
} from '../../sales/documents/invoice-document.model.js';
import type { StoredSeller } from '../../sales/invoices/invoice.types.js';
import type { PurchaseOrderLean } from '../orders/purchase-order.schema.js';

export const PURCHASE_ORDER_TITLE = 'BON DE COMMANDE';
/** Mention fixe (§ 3.3, critère d'acceptation 6). */
export const PURCHASE_ORDER_NOTICE = 'Bon de commande — ce document n’est pas une facture';

/** Ce que le bon de commande lit de la fiche fournisseur : jamais ses coordonnées de paiement. */
export interface PurchaseOrderSupplierInfo {
  name: string;
  nif: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  paymentTerms: { kind: 'immediate' } | { kind: 'net' | 'end_of_month'; days: number };
}

export interface PurchaseOrderDocumentContext {
  /** Acheteur : fiche fiscale courante de l'organisation, ou `null`. */
  buyer: StoredSeller | null;
  organizationName: string;
  supplier: PurchaseOrderSupplierInfo;
  softwareVersion: string | null;
  layout: { label: string; version: string } | null;
}

const nonEmpty = (v: string | null | undefined): v is string =>
  typeof v === 'string' && v.trim() !== '';

/** `"2026-11-20"` → `"20/11/2026"`. */
function formatDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : day;
}

function capitalize(s: string): string {
  return s === '' ? s : `${s[0]!.toUpperCase()}${s.slice(1)}`;
}

function fileSafe(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '-');
}

export function paymentTermsLabel(t: PurchaseOrderSupplierInfo['paymentTerms']): string {
  if (t.kind === 'immediate') return 'Paiement à réception de la facture';
  if (t.kind === 'net') return `Paiement à ${t.days} jours date de facture`;
  return t.days === 0 ? 'Paiement fin de mois' : `Paiement fin de mois + ${t.days} jours`;
}

function buyerParty(ctx: PurchaseOrderDocumentContext): DocumentParty {
  const s = ctx.buyer;
  if (!s) return { title: ctx.organizationName, lines: [] };
  const lines: string[] = [];
  if (nonEmpty(s.tradeName) && s.tradeName !== s.legalName) lines.push(s.tradeName);
  lines.push(`NIF : ${s.nif}`);
  if (nonEmpty(s.rccm)) lines.push(`RCCM : ${s.rccm}`);
  if (nonEmpty(s.address)) lines.push(s.address);
  const contacts = [s.phone, s.email].filter(nonEmpty);
  if (contacts.length > 0) lines.push(contacts.join(' · '));
  return { title: s.legalName, lines };
}

function supplierParty(s: PurchaseOrderSupplierInfo): DocumentParty {
  const lines: string[] = ['Fournisseur'];
  if (nonEmpty(s.nif)) lines.push(`NIF : ${s.nif}`);
  if (nonEmpty(s.address)) lines.push(s.address);
  const contacts = [s.phone, s.email].filter(nonEmpty);
  if (contacts.length > 0) lines.push(contacts.join(' · '));
  return { title: s.name, lines };
}

export function buildPurchaseOrderDocument(
  o: PurchaseOrderLean,
  ctx: PurchaseOrderDocumentContext,
): InvoiceDocumentModel {
  if (o.phase !== 'order' || !nonEmpty(o.orderNumber)) {
    throw new DocumentNotPrintableError(
      'Une demande non approuvée n’a pas de bon de commande : faites-la approuver d’abord.',
    );
  }
  const lines: DocumentLine[] = o.lines.map((l) => ({
    code: l.itemRef ?? null,
    name: l.label,
    itemType: l.kind === 'goods' ? '[Bien]' : '[Service]',
    group: '',
    quantity: `${formatAmount(l.quantity)}${nonEmpty(l.unit) ? ` ${l.unit}` : ''}`,
    unitPrice: formatAmount(l.unitPrice),
    modification: nonEmpty(l.discountPercent)
      ? `Remise ${formatAmount(l.discountPercent)} %`
      : null,
    specificTax: null,
    amount: formatAmount(l.amount),
  }));

  const approvedAt = new Date(o.approvedAt ?? o.updatedAt);
  const reference = o.orderNumber;
  const stateMentions = [PURCHASE_ORDER_NOTICE];
  if (o.status === 'cancelled') stateMentions.push('Commande annulée');
  const delivery =
    o.deliveryAddress ?? (ctx.buyer && nonEmpty(ctx.buyer.address) ? ctx.buyer.address : null);
  const comments: string[] = [o.title];
  if (nonEmpty(o.requestNumber)) comments.push(`Demande d’achat ${o.requestNumber}`);
  if (nonEmpty(delivery)) comments.push(`Adresse de livraison : ${delivery}`);
  if (nonEmpty(o.expectedOn)) comments.push(`Livraison souhaitée le ${formatDay(o.expectedOn)}`);
  comments.push(`Conditions de paiement : ${paymentTermsLabel(ctx.supplier.paymentTerms)}`);
  const taxes = o.declaredTaxes ?? [];
  if (taxes.length > 0) {
    comments.push(
      `Taxes telles qu’indiquées par le fournisseur : ${taxes
        .map((t) => `${t.label} ${formatAmount(t.amount)}`)
        .join(' ; ')}`,
    );
  }
  const layoutName = ctx.layout
    ? `modèle ${ctx.layout.label} ${ctx.layout.version}`
    : `gabarit ${INVOICE_PDF_LAYOUT_VERSION}`;
  const footer = [
    ctx.softwareVersion !== null
      ? `Établi avec Lalanda v${ctx.softwareVersion} — ${layoutName}`
      : `Établi avec Lalanda — ${layoutName}`,
    `Bon de commande ${reference}`,
    'Non valable comme facture',
  ].join(' · ');

  return {
    layoutVersion: ctx.layout?.version ?? INVOICE_PDF_LAYOUT_VERSION,
    softwareVersion: ctx.softwareVersion,
    // Jamais « invoice » : un bon de commande n'est pas une facture.
    kind: 'proforma',
    title: PURCHASE_ORDER_TITLE,
    natureMentions: [],
    stateMentions,
    duplicate: null,
    test: null,
    sample: null,
    reference: { label: 'Bon de commande n°', value: reference },
    date: { label: 'Approuvé le', value: formatKinshasa(approvedAt) },
    // L'émetteur du bon est l'organisation (acheteuse), le destinataire le fournisseur.
    seller: buyerParty(ctx),
    customer: supplierParty(ctx.supplier),
    creditReference: [],
    currency: o.currency,
    amountsNote: `Montants en ${o.currency === 'CDF' ? 'francs congolais (CDF)' : 'dollars américains (USD)'}`,
    priceModeLabel: 'Prix unitaires HT',
    lines,
    groups: [],
    specificTaxTotal: null,
    htTotal: formatAmount(o.totals.subtotal),
    vatTotal: formatAmount(o.totals.taxes),
    total: formatAmount(o.totals.total),
    totalInWords: `Arrêté le présent bon de commande à la somme de : ${capitalize(
      amountInWords(o.totals.total, o.currency),
    )}.`,
    payments: [],
    counterValue: null,
    security: null,
    operator: null,
    comments,
    footer,
    fixedDate: approvedAt,
    fileName: `${fileSafe(reference)}.pdf`,
  };
}
