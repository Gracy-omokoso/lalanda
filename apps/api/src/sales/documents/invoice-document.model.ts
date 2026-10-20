// Contenu imprimé d'un document de vente — ADR-0025 § 1 à § 6.
//
// Fonction PURE : document figé (tel que lu en base) → ce qui s'imprime. Toute
// règle d'impression est ici, testée sans navigateur : intitulé (par
// `documentKind` et lui seul), mentions DGI par type, montants qui font foi,
// total en lettres, contre-valeur, éléments de sécurité, filigrane de test,
// duplicata. La mise en page (`invoice-document-html.ts`) ne décide de rien.
//
// Aucun calcul : les montants sont ceux figés par le moteur, seulement mis en
// forme (séparateur de milliers, virgule décimale) par manipulation de chaînes.

import type { DocumentCurrency, InvoiceTotals, LineTotals } from '@lalanda/engine';

import { CUSTOMER_TYPE_LABELS } from '../sales.dto.js';
import type { CreditNoteNature, DocumentKind, InvoiceType } from '../invoices/invoice.contract.js';
import type { InvoiceLean, StoredLine, StoredSeller } from '../invoices/invoice.types.js';
import { PAYMENT_METHOD_LABELS, documentKindOf } from '../invoices/invoice-view.js';
import { amountInWords } from './amount-in-words.js';

/** Version du gabarit, imprimée en pied de page (ADR-0025 § O2). */
export const INVOICE_PDF_LAYOUT_VERSION = '1.0.0';

export const PROFORMA_TITLE = 'PRO FORMA — non valable comme facture';
export const TEST_BANNER = 'Environnement de test DGI — sans valeur fiscale';
export const TEST_MARK = 'TEST';
export const DUPLICATE_MARK = 'DUPLICATA';

/** Natures d'avoir, libellés imprimés (documentation DGI, reformulée). */
export const CREDIT_NATURE_LABELS: Record<CreditNoteNature, string> = {
  COR: 'Correction',
  RAN: 'Annulation',
  RAM: 'Avoir suite reprise',
  RRR: 'Remise, ristourne, rabais (RRR)',
};

/** Libellés de type d'un PRO FORMA : jamais le mot « facture » (ADR-0025 § 1). */
const PROFORMA_TYPE_LABELS: Record<InvoiceType, string> = {
  FV: 'Vente',
  FT: 'Acompte',
  FA: 'Avoir',
  EV: 'Vente à l’exportation',
  ET: 'Acompte à l’exportation',
  EA: 'Avoir à l’exportation',
};

const isCredit = (t: InvoiceType) => t === 'FA' || t === 'EA';
const isExport = (t: InvoiceType) => t === 'EV' || t === 'ET' || t === 'EA';
const isDeposit = (t: InvoiceType) => t === 'FT' || t === 'ET';

export interface DocumentParty {
  title: string;
  lines: string[];
}

export interface DocumentLine {
  code: string | null;
  name: string;
  itemType: string;
  group: string;
  quantity: string;
  unitPrice: string;
  /** « Prix d’origine 50,00 — remise 10 % », etc. ; `null` sans modification. */
  modification: string | null;
  specificTax: string | null;
  amount: string;
}

export interface DocumentGroupTotal {
  group: string;
  rate: string;
  ht: string;
  vat: string;
  total: string;
}

export interface DocumentSecurity {
  codeDefDgi: string;
  nim: string;
  counters: string;
  dgiDateTime: string;
  isf: string;
  /** Chaîne encodée TELLE QUELLE dans le QR code. */
  qrContent: string;
}

export interface InvoiceDocumentModel {
  layoutVersion: string;
  kind: DocumentKind;
  /** Intitulé — choisi par `documentKind` (ADR-0024 § 4.3). */
  title: string;
  /** Mentions de nature DGI : « D'ACOMPTE », « EXPORTATION », « FACTURE D'AVOIR — … ». */
  natureMentions: string[];
  /** Mentions d'état d'un pro forma (« Normalisation DGI en cours »). */
  stateMentions: string[];
  duplicate: { number: number; label: string } | null;
  test: { banner: string; mark: string } | null;
  reference: { label: string; value: string };
  date: { label: string; value: string };
  seller: DocumentParty;
  customer: DocumentParty;
  creditReference: string[];
  currency: DocumentCurrency;
  amountsNote: string;
  priceModeLabel: string;
  lines: DocumentLine[];
  groups: DocumentGroupTotal[];
  specificTaxTotal: string | null;
  vatTotal: string;
  total: string;
  totalInWords: string;
  payments: { label: string; amount: string }[];
  counterValue: string | null;
  security: DocumentSecurity | null;
  operator: string | null;
  comments: string[];
  footer: string;
  /** Date des métadonnées du PDF (rendu déterministe). */
  fixedDate: Date;
  fileName: string;
}

export class DocumentNotPrintableError extends Error {
  constructor(
    message: string,
    readonly issues: readonly { code: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'DocumentNotPrintableError';
  }
}

export interface InvoiceDocumentContext {
  /** Numéro du duplicata imprimé, `null` pour l'original. */
  duplicateNumber: number | null;
  /** Vendeur d'un brouillon (fiche fiscale courante) ; ignoré si `doc.seller` existe. */
  draftSeller: StoredSeller | null;
  /** Nom de l'organisation, faute de fiche fiscale. */
  organizationName: string;
  /** Brouillon d'une organisation en facture normalisée dans l'environnement de test. */
  draftInTestEnvironment: boolean;
}

// ── Mise en forme (chaînes seulement) ─────────────────────────────────────────

const NBSP = ' ';

/** `"1234567.50"` → `"1 234 567,50"`. */
export function formatAmount(value: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!m) return value;
  const int = m[2]!.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${m[1]}${int}${m[3] !== undefined ? `,${m[3]}` : ''}`;
}

const kinshasa = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Kinshasa',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** Date et heure de Kinshasa : « 20/10/2026 14:05:12 ». */
export function formatKinshasa(d: Date): string {
  return kinshasa.format(d).replace(',', '');
}

/** `"2026-10-19T00:00:00+01:00"` → `"19/10/2026"` (date telle qu'écrite, sans fuseau). */
function formatIsoDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function capitalize(s: string): string {
  return s === '' ? s : `${s[0]!.toUpperCase()}${s.slice(1)}`;
}

function nonEmpty(v: string | null | undefined): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

// ── Construction ─────────────────────────────────────────────────────────────

function titleOf(doc: InvoiceLean, kind: DocumentKind): string {
  if (kind === 'proforma') return PROFORMA_TITLE;
  const credit = isCredit(doc.type);
  if (doc.status === 'normalized') {
    return credit ? 'Facture d’avoir normalisée' : 'Facture normalisée';
  }
  return credit ? 'Facture d’avoir' : 'Facture';
}

function natureMentionsOf(doc: InvoiceLean, kind: DocumentKind): string[] {
  const out: string[] = [];
  if (kind === 'proforma') out.push(PROFORMA_TYPE_LABELS[doc.type]);
  if (isExport(doc.type)) out.push('EXPORTATION');
  if (isDeposit(doc.type)) out.push('D’ACOMPTE');
  if (isCredit(doc.type)) {
    const nature = doc.creditNote ? CREDIT_NATURE_LABELS[doc.creditNote.nature] : null;
    const head = kind === 'proforma' ? 'AVOIR' : 'FACTURE D’AVOIR';
    out.push(nature ? `${head} — ${nature}` : head);
  }
  return out;
}

function stateMentionsOf(doc: InvoiceLean, kind: DocumentKind): string[] {
  if (kind !== 'proforma') return [];
  if (doc.status === 'pending_normalization') return ['Normalisation DGI en cours'];
  if (doc.status === 'normalization_failed') {
    return ['Normalisation DGI refusée ou interrompue'];
  }
  if (doc.status === 'normalized') return ['Éléments de sécurité DGI incomplets'];
  return [];
}

function sellerParty(doc: InvoiceLean, ctx: InvoiceDocumentContext): DocumentParty {
  const s = doc.seller ?? ctx.draftSeller;
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

function customerParty(doc: InvoiceLean): DocumentParty {
  const c = doc.customer;
  const lines: string[] = [`[${c.type}] ${CUSTOMER_TYPE_LABELS[c.type]}`];
  if (nonEmpty(c.nif)) lines.push(`NIF : ${c.nif}`);
  if (c.type === 'AO' && nonEmpty(c.exemptionReference)) {
    lines.push(`Référence d’exonération : ${c.exemptionReference}`);
  }
  if (c.printContactDetails) {
    if (nonEmpty(c.address)) lines.push(c.address);
    const contacts = [c.phone, c.email].filter(nonEmpty);
    if (contacts.length > 0) lines.push(contacts.join(' · '));
  }
  return { title: nonEmpty(c.name) ? c.name : 'Client comptant', lines };
}

function creditReferenceOf(doc: InvoiceLean): string[] {
  const cn = doc.creditNote;
  if (!cn || !isCredit(doc.type)) return [];
  const out: string[] = [];
  if (nonEmpty(cn.originNumber)) out.push(`Facture d’origine : n° ${cn.originNumber}`);
  if (cn.nature === 'RRR' && !nonEmpty(cn.originNumber)) out.push('Référence : RRR');
  else if (nonEmpty(cn.reference)) out.push(`Code DEF/DGI d’origine : ${cn.reference}`);
  return out;
}

function groupLabel(l: StoredLine): string {
  return l.outOfScope ? `[${l.taxGroup}] hors champ` : `[${l.taxGroup}]`;
}

function modificationOf(
  originalPrice: string | null,
  priceModification: string | null,
  line: StoredLine,
  amountsAreDocument: boolean,
): string | null {
  const parts: string[] = [];
  if (nonEmpty(originalPrice)) parts.push(`Prix d’origine ${formatAmount(originalPrice)}`);
  if (nonEmpty(priceModification)) parts.push(priceModification);
  else if (amountsAreDocument && line.discount) {
    parts.push(
      line.discount.kind === 'percent'
        ? `Remise ${formatAmount(line.discount.value)} %`
        : `Remise ${formatAmount(line.discount.value)}`,
    );
  }
  return parts.length > 0 ? parts.join(' — ') : null;
}

interface AmountsSource {
  currency: DocumentCurrency;
  totals: InvoiceTotals;
  unitPriceOf: (l: StoredLine) => {
    unitPrice: string;
    originalPrice: string | null;
    priceModification: string | null;
  };
  payments: { method: keyof typeof PAYMENT_METHOD_LABELS; amount: string }[];
  note: string;
  isDocument: boolean;
}

/** Montants qui s'impriment : CDF figés pour une facture normalisée, devise d'origine sinon. */
function amountsSourceOf(doc: InvoiceLean, kind: DocumentKind): AmountsSource {
  const n = doc.normalizedAmounts;
  if (kind === 'invoice' && doc.status === 'normalized' && n) {
    return {
      currency: 'CDF',
      totals: n.calculation,
      unitPriceOf: (l) => {
        const nl = n.lines.find((x) => x.index === l.index);
        if (!nl) throw new DocumentNotPrintableError(`Ligne ${l.index} absente des montants CDF.`);
        return {
          unitPrice: nl.unitPrice,
          originalPrice: nl.originalPrice,
          priceModification: nl.priceModification,
        };
      },
      payments: n.payments,
      note: 'Montants en francs congolais (CDF) — font foi',
      isDocument: false,
    };
  }
  const calc = doc.documentAmounts.calculation;
  if (!calc.ok || !calc.totals) {
    throw new DocumentNotPrintableError(
      'Le calcul de ce brouillon présente des erreurs : corrigez-le avant de l’imprimer.',
      calc.issues.map((i) => ({ code: i.code, message: i.message })),
    );
  }
  return {
    currency: doc.currency,
    totals: calc.totals,
    unitPriceOf: (l) => ({
      unitPrice: l.unitPrice,
      originalPrice: l.originalPrice,
      priceModification: l.priceModification,
    }),
    payments: doc.payments,
    note: `Montants en ${doc.currency === 'CDF' ? 'francs congolais (CDF)' : 'dollars américains (USD)'}`,
    isDocument: true,
  };
}

function isTestDocument(doc: InvoiceLean, ctx: InvoiceDocumentContext): boolean {
  return (
    doc.environment === 'test' ||
    doc.series === 'test' ||
    (doc.status === 'draft' && ctx.draftInTestEnvironment)
  );
}

function fileSafe(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '-');
}

export function buildInvoiceDocument(
  doc: InvoiceLean,
  ctx: InvoiceDocumentContext,
): InvoiceDocumentModel {
  const kind = documentKindOf(doc);
  if (ctx.duplicateNumber !== null && kind !== 'invoice') {
    throw new DocumentNotPrintableError('Un pro forma n’a pas de duplicata.');
  }
  const amounts = amountsSourceOf(doc, kind);
  const totals = amounts.totals;
  const lineTotals = new Map<number, LineTotals>(totals.lines.map((t) => [t.index, t]));

  const lines: DocumentLine[] = doc.lines.map((l) => {
    const p = amounts.unitPriceOf(l);
    const t = lineTotals.get(l.index);
    if (!t) throw new DocumentNotPrintableError(`Ligne ${l.index} absente du calcul figé.`);
    return {
      code: l.code,
      name: l.name,
      itemType: `[${l.itemType}]`,
      group: groupLabel(l),
      quantity: `${formatAmount(l.quantity)}${nonEmpty(l.unit) ? ` ${l.unit}` : ''}`,
      unitPrice: formatAmount(p.unitPrice),
      modification: modificationOf(p.originalPrice, p.priceModification, l, amounts.isDocument),
      specificTax:
        l.specificTax && t.specificTaxAmount !== '0.00'
          ? `T.S. ${formatAmount(t.specificTaxAmount)}`
          : null,
      amount: formatAmount(t.amount),
    };
  });

  const final = kind === 'invoice';
  const number = final ? (doc.number ?? null) : null;
  if (final && !number) throw new DocumentNotPrintableError('Facture finale sans numéro.');
  const issuedAt = final && doc.issuedAt ? new Date(doc.issuedAt) : null;
  const establishedAt = issuedAt ?? new Date(doc.frozenAt ?? doc.updatedAt);

  const n = doc.normalization;
  const security: DocumentSecurity | null =
    final && doc.status === 'normalized' && n && nonEmpty(n.codeDefDgi) && nonEmpty(n.qrCode)
      ? {
          codeDefDgi: n.codeDefDgi,
          nim: n.nim ?? '',
          counters: n.counters ?? '',
          dgiDateTime: n.dgiDateTime ?? '',
          isf: doc.isf ?? '',
          qrContent: n.qrCode,
        }
      : null;

  const cv =
    final && doc.status === 'normalized' ? (doc.normalizedAmounts?.counterValueUsd ?? null) : null;
  const counterValue = cv
    ? `Contre-valeur : ${formatAmount(cv.amount)} USD — taux appliqué : 1 USD = ${formatAmount(cv.rate)} CDF (taux du ${formatIsoDay(cv.date)})`
    : null;

  const words = capitalize(amountInWords(totals.total, amounts.currency));
  const subject = !final
    ? 'Arrêté le présent pro forma'
    : isCredit(doc.type)
      ? 'Arrêtée la présente facture d’avoir'
      : 'Arrêtée la présente facture';

  const duplicate =
    ctx.duplicateNumber !== null
      ? { number: ctx.duplicateNumber, label: `${DUPLICATE_MARK} n° ${ctx.duplicateNumber}` }
      : null;
  const test = isTestDocument(doc, ctx) ? { banner: TEST_BANNER, mark: TEST_MARK } : null;

  const comments = (['A', 'C'] as const)
    .map((k) => doc.comments[k])
    .filter(nonEmpty)
    .map((v) => v);

  const footerParts = [
    `Établi avec Lalanda — gabarit ${INVOICE_PDF_LAYOUT_VERSION}`,
    final ? `N° ${number}` : `Réf. ${doc.proformaRef}`,
  ];
  if (duplicate) footerParts.push(duplicate.label);
  if (test) footerParts.push(test.banner);

  const baseName = final ? number! : doc.proformaRef;
  return {
    layoutVersion: INVOICE_PDF_LAYOUT_VERSION,
    kind,
    title: titleOf(doc, kind),
    natureMentions: natureMentionsOf(doc, kind),
    stateMentions: stateMentionsOf(doc, kind),
    duplicate,
    test,
    reference: final
      ? { label: isCredit(doc.type) ? 'Avoir n°' : 'Facture n°', value: number! }
      : { label: 'Référence pro forma', value: doc.proformaRef },
    date: {
      label: final ? 'Date et heure d’émission' : 'Établi le',
      value: formatKinshasa(establishedAt),
    },
    seller: sellerParty(doc, ctx),
    customer: customerParty(doc),
    creditReference: creditReferenceOf(doc),
    currency: amounts.currency,
    amountsNote: amounts.note,
    priceModeLabel: doc.priceMode === 'ttc' ? 'Prix unitaires TTC' : 'Prix unitaires HT',
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
    totalInWords: `${subject} à la somme de : ${words}.`,
    payments: amounts.payments.map((p) => ({
      label: PAYMENT_METHOD_LABELS[p.method],
      amount: formatAmount(p.amount),
    })),
    counterValue,
    security,
    operator: doc.operator?.name ?? null,
    comments,
    footer: footerParts.join(' · '),
    fixedDate: establishedAt,
    fileName: `${fileSafe(baseName)}${duplicate ? `-duplicata-${duplicate.number}` : ''}.pdf`,
  };
}
