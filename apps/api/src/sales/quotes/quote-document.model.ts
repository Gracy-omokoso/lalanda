// Contenu imprimé d'un DEVIS — ADR-0035 § 1.
//
// Fonction PURE : devis (tel que lu en base) → `InvoiceDocumentModel`, la forme
// que consomment le moteur de rendu et les modèles de l'organisation (ADR-0028).
// Le devis réutilise donc la présentation choisie par l'organisation et la
// vérification des mentions à chaque rendu, mais AUCUNE mention DGI de facture :
// ni éléments de sécurité, ni QR code, ni numéro de facture, ni bandeau de test,
// ni paiement. Intitulé imposé : « DEVIS — non valable comme facture ».
//
// Aucun calcul : montants figés par le moteur, seulement mis en forme.

import type { LineTotals } from '@lalanda/engine';

import { amountInWords } from '../documents/amount-in-words.js';
import {
  DocumentNotPrintableError,
  INVOICE_PDF_LAYOUT_VERSION,
  formatAmount,
  formatKinshasa,
  type DocumentLine,
  type DocumentParty,
  type InvoiceDocumentModel,
} from '../documents/invoice-document.model.js';
import type { StoredLine, StoredSeller } from '../invoices/invoice.types.js';
import { CUSTOMER_TYPE_LABELS } from '../sales.dto.js';
import type { QuoteLean, QuoteStatus } from './quote.schema.js';

export const QUOTE_TITLE = 'DEVIS — non valable comme facture';

export interface QuoteDocumentContext {
  /** Vendeur : fiche fiscale courante de l'organisation, ou `null`. */
  seller: StoredSeller | null;
  organizationName: string;
  status: QuoteStatus;
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

function sellerParty(ctx: QuoteDocumentContext): DocumentParty {
  const s = ctx.seller;
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

function customerParty(q: QuoteLean): DocumentParty {
  const c = q.customer;
  const lines: string[] = [`[${c.type}] ${CUSTOMER_TYPE_LABELS[c.type]}`];
  if (nonEmpty(c.nif)) lines.push(`NIF : ${c.nif}`);
  if (c.printContactDetails) {
    if (nonEmpty(c.address)) lines.push(c.address);
    const contacts = [c.phone, c.email].filter(nonEmpty);
    if (contacts.length > 0) lines.push(contacts.join(' · '));
  }
  return { title: nonEmpty(c.name) ? c.name : 'Client', lines };
}

function modificationOf(l: StoredLine): string | null {
  const parts: string[] = [];
  if (nonEmpty(l.originalPrice)) parts.push(`Prix d’origine ${formatAmount(l.originalPrice)}`);
  if (nonEmpty(l.priceModification)) parts.push(l.priceModification);
  else if (l.discount) {
    parts.push(
      l.discount.kind === 'percent'
        ? `Remise ${formatAmount(l.discount.value)} %`
        : `Remise ${formatAmount(l.discount.value)}`,
    );
  }
  return parts.length > 0 ? parts.join(' — ') : null;
}

const STATUS_MENTIONS: Partial<Record<QuoteStatus, string>> = {
  accepted: 'Devis accepté',
  refused: 'Devis refusé',
  expired: 'Devis expiré',
};

function fileSafe(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '-');
}

export function buildQuoteDocument(q: QuoteLean, ctx: QuoteDocumentContext): InvoiceDocumentModel {
  const calc = q.documentAmounts.calculation;
  if (!calc.ok || !calc.totals) {
    throw new DocumentNotPrintableError(
      'Le calcul de ce devis présente des erreurs : corrigez-le avant de l’imprimer.',
      calc.issues.map((i) => ({ code: i.code, message: i.message })),
    );
  }
  const totals = calc.totals;
  const byIndex = new Map<number, LineTotals>(totals.lines.map((t) => [t.index, t]));
  const lines: DocumentLine[] = q.lines.map((l) => {
    const t = byIndex.get(l.index);
    if (!t) throw new DocumentNotPrintableError(`Ligne ${l.index} absente du calcul.`);
    return {
      code: l.edefCode ?? l.code,
      name: l.name,
      itemType: `[${l.itemType}]`,
      group: l.outOfScope ? `[${l.taxGroup}] hors champ` : `[${l.taxGroup}]`,
      quantity: `${formatAmount(l.quantity)}${nonEmpty(l.unit) ? ` ${l.unit}` : ''}`,
      unitPrice: formatAmount(l.unitPrice),
      modification: modificationOf(l),
      specificTax:
        l.specificTax && t.specificTaxAmount !== '0.00'
          ? `T.S. ${formatAmount(t.specificTaxAmount)}`
          : null,
      amount: formatAmount(t.amount),
    };
  });

  const established = new Date(q.sentAt ?? q.updatedAt);
  const reference = `${q.number} — version ${q.version}`;
  const stateMentions = [`Valable jusqu’au ${formatDay(q.validUntil)}`];
  const status = STATUS_MENTIONS[ctx.status];
  if (status) stateMentions.push(status);
  const layoutName = ctx.layout
    ? `modèle ${ctx.layout.label} ${ctx.layout.version}`
    : `gabarit ${INVOICE_PDF_LAYOUT_VERSION}`;
  const footer = [
    ctx.softwareVersion !== null
      ? `Établi avec Lalanda v${ctx.softwareVersion} — ${layoutName}`
      : `Établi avec Lalanda — ${layoutName}`,
    `Devis ${reference}`,
    'Non valable comme facture',
  ].join(' · ');

  return {
    layoutVersion: ctx.layout?.version ?? INVOICE_PDF_LAYOUT_VERSION,
    softwareVersion: ctx.softwareVersion,
    // Jamais « invoice » : un devis n'est pas une facture.
    kind: 'proforma',
    title: QUOTE_TITLE,
    natureMentions: [],
    stateMentions,
    duplicate: null,
    test: null,
    sample: null,
    reference: { label: 'Devis n°', value: reference },
    date: { label: 'Établi le', value: formatKinshasa(established) },
    seller: sellerParty(ctx),
    customer: customerParty(q),
    creditReference: [],
    currency: q.currency,
    amountsNote: `Montants en ${q.currency === 'CDF' ? 'francs congolais (CDF)' : 'dollars américains (USD)'}`,
    priceModeLabel: q.priceMode === 'ttc' ? 'Prix unitaires TTC' : 'Prix unitaires HT',
    lines,
    groups: totals.groups.map((g) => ({
      group: `[${g.group}]`,
      rate: `${formatAmount(g.ratePercent)} %`,
      ht: formatAmount(g.ht),
      vat: formatAmount(g.vat),
      total: formatAmount(g.total),
    })),
    specificTaxTotal: totals.specificTax !== '0.00' ? formatAmount(totals.specificTax) : null,
    vatTotal: formatAmount(totals.vatTotal),
    total: formatAmount(totals.total),
    totalInWords: `Arrêté le présent devis à la somme de : ${capitalize(amountInWords(totals.total, q.currency))}.`,
    payments: [],
    counterValue: null,
    security: null,
    operator: null,
    comments: [q.title, q.notes].filter(nonEmpty),
    footer,
    fixedDate: established,
    fileName: `${fileSafe(q.number)}-v${q.version}.pdf`,
  };
}
