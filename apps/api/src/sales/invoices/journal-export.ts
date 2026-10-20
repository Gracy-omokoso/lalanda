// Export du journal électronique pour les vérificateurs — ADR-0026 § 6.3
// (exigence 1.20, écart B3 du dossier d'homologation).
//
// Fonctions PURES : document figé → facture exportée ; export → CSV. Aucun
// calcul : les montants sont ceux figés par le moteur (CDF de
// `normalizedAmounts` pour une facture normalisée, qui font foi ; devise du
// document sinon), recopiés tels quels. Le journal chaîné n'est ni modifié ni
// recopié ailleurs : l'export LIT les documents figés et les entrées existantes.

import type { InvoiceTotals } from '@lalanda/engine';

import { contentSha256Of } from './canonical.js';
import type {
  ExportedDgiExchange,
  ExportedInvoice,
  ExportedInvoiceLine,
  JournalEvent,
  SalesJournalExport,
} from './invoice.contract.js';
import type { InvoiceLean } from './invoice.types.js';
import { INVOICE_TYPE_LABELS } from './invoice-view.js';

/** Chaîne décrivant le calcul du `hash`, recopiée dans l'export. */
export const JOURNAL_HASH_ALGORITHM =
  'hash = sha256_hex(prevHash + "\\n" + JSON canonique (clés triées, sans espace) de ' +
  '{organizationId, seq, at (ISO 8601), event, invoiceId, proformaRef, number, series, type, ' +
  'creditNature, originNumber, documentTotals, normalizedTotals, conversion, contentSha256, ' +
  'codeDefDgi, nim, counters, actor}) ; première entrée : prevHash = genesisHash';

/** Jour civil `AAAA-MM-JJ` → instant de début de ce jour à Kinshasa (UTC+1, sans heure d'été). */
export function kinshasaDayStart(day: string): Date {
  return new Date(`${day}T00:00:00+01:00`);
}

const DAY_MS = 86_400_000;

/** Bornes `[from, to[` d'une période de jours de Kinshasa, bornes incluses. */
export function periodBounds(from: string, to: string): { start: Date; end: Date; days: number } {
  const start = kinshasaDayStart(from);
  const end = new Date(kinshasaDayStart(to).getTime() + DAY_MS);
  return { start, end, days: (end.getTime() - start.getTime()) / DAY_MS };
}

type JournalRef = { seq: number; event: JournalEvent; at: Date; hash: string };

/** Facture émise ou normalisée → forme exportée. `null` si le document n'est pas exportable. */
export function exportedInvoiceOf(
  doc: InvoiceLean,
  journal: readonly JournalRef[],
): ExportedInvoice | null {
  if ((doc.status !== 'issued' && doc.status !== 'normalized') || !doc.number || !doc.issuedAt) {
    return null;
  }
  const n = doc.normalizedAmounts;
  const normalized = doc.status === 'normalized' && n !== null && n !== undefined;
  const totals: InvoiceTotals | null = normalized
    ? n!.calculation
    : (doc.documentAmounts.calculation.totals ?? null);
  if (totals === null) return null;
  const lineTotals = new Map(totals.lines.map((t) => [t.index, t]));
  const normalizedLines = new Map((n?.lines ?? []).map((l) => [l.index, l]));

  const lines: ExportedInvoiceLine[] = doc.lines.map((l) => {
    const t = lineTotals.get(l.index);
    const nl = normalized ? normalizedLines.get(l.index) : undefined;
    return {
      index: l.index,
      code: l.edefCode ?? l.code,
      name: l.name,
      itemType: l.itemType,
      group: l.taxGroup,
      unit: l.unit,
      quantity: l.quantity,
      unitPrice: nl ? nl.unitPrice : l.unitPrice,
      originalPrice: nl ? nl.originalPrice : l.originalPrice,
      priceModification: nl ? nl.priceModification : l.priceModification,
      amount: t?.amount ?? '',
      specificTaxAmount: t?.specificTaxAmount ?? '0.00',
    };
  });

  const s = doc.normalization;
  return {
    id: String(doc._id),
    number: doc.number,
    series: doc.series ?? null,
    type: doc.type,
    typeLabel: INVOICE_TYPE_LABELS[doc.type],
    status: doc.status,
    issuedAt: new Date(doc.issuedAt).toISOString(),
    emissionMode: doc.emissionMode ?? null,
    environment: doc.environment ?? null,
    isf: doc.isf ?? null,
    customer: { type: doc.customer.type, name: doc.customer.name, nif: doc.customer.nif },
    currency: normalized ? 'CDF' : doc.currency,
    amountsSource: normalized ? 'normalized_cdf' : 'document',
    documentCurrency: doc.currency,
    priceMode: doc.priceMode,
    lines,
    groups: totals.groups.map((g) => ({
      group: g.group,
      ratePercent: g.ratePercent,
      ht: g.ht,
      vat: g.vat,
      specificTax: g.specificTax,
      total: g.total,
    })),
    totals: { total: totals.total, vatTotal: totals.vatTotal, specificTax: totals.specificTax },
    payments: (normalized ? n!.payments : doc.payments).map((p) => ({
      method: p.method,
      amount: p.amount,
    })),
    conversion: doc.conversion
      ? {
          rate: doc.conversion.rate,
          rateDate: doc.conversion.rateDate,
          rateSource: doc.conversion.rateSource,
        }
      : null,
    counterValueUsd: n?.counterValueUsd ?? null,
    creditNote: doc.creditNote
      ? {
          nature: doc.creditNote.nature,
          originNumber: doc.creditNote.originNumber ?? null,
          reference: doc.creditNote.reference ?? null,
        }
      : null,
    dgi:
      doc.status === 'normalized' && s
        ? {
            codeDefDgi: s.codeDefDgi,
            nim: s.nim,
            counters: s.counters,
            dateTime: s.dgiDateTime,
            qrCode: s.qrCode,
          }
        : null,
    softwareVersion: doc.softwareVersion ?? null,
    contentSha256: doc.contentSha256 ?? null,
    contentIntact:
      doc.contentSha256 !== null &&
      doc.contentSha256 !== undefined &&
      contentSha256Of(doc as unknown as Record<string, unknown>) === doc.contentSha256,
    journal: journal.map((j) => ({
      seq: j.seq,
      event: j.event,
      at: j.at.toISOString(),
      hash: j.hash,
    })),
  };
}

// ── CSV ───────────────────────────────────────────────────────────────────────

/**
 * Cellule CSV (RFC 4180, séparateur « ; ») : guillemets doublés, champ entre
 * guillemets s'il contient « ; », « " » ou un saut de ligne. Un TEXTE qui
 * commence par = + - @ (formule de tableur) est préfixé d'une apostrophe :
 * l'ouverture du fichier dans un tableur n'exécute rien. Les montants ne sont
 * jamais préfixés (ils ne commencent jamais par ces caractères).
 */
export function csvCell(value: string | number | boolean | null | undefined, text = true): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(cells: readonly string[]): string {
  return cells.join(';');
}

/** Marque d'ordre des octets : les tableurs lisent alors l'UTF-8 sans se tromper. */
const BOM = '﻿';

export const SALES_CSV_COLUMNS = [
  'enregistrement',
  'numero',
  'type',
  'libelle_type',
  'statut',
  'date_emission',
  'mode_emission',
  'environnement',
  'isf',
  'client_type',
  'client_nom',
  'client_nif',
  'devise',
  'source_montants',
  'devise_document',
  'mode_prix',
  'ligne',
  'code',
  'designation',
  'type_article',
  'groupe',
  'unite',
  'quantite',
  'prix_unitaire',
  'prix_origine',
  'modification_prix',
  'montant',
  'taxe_specifique',
  'taux_groupe',
  'base_ht_groupe',
  'tva_groupe',
  'total_groupe',
  'total_ttc',
  'total_tva',
  'total_taxe_specifique',
  'paiements',
  'avoir_nature',
  'avoir_reference',
  'code_def_dgi',
  'nim',
  'compteurs',
  'date_dgi',
  'version_logiciel',
  'empreinte_contenu',
  'contenu_intact',
  'journal_seq',
  'chaine_valide',
] as const;

/**
 * Journal des ventes en CSV : une ligne `ligne` par ligne de facture et une
 * ligne `groupe` par groupe de taxation, chacune portant les colonnes de la
 * facture (numéro, client, totaux, éléments DGI, état de vérification).
 */
export function salesJournalCsv(exp: SalesJournalExport): string {
  const out: string[] = [csvRow([...SALES_CSV_COLUMNS])];
  const chain = exp.chain.valid ? 'oui' : 'non';
  for (const inv of exp.invoices) {
    const head = (kind: 'ligne' | 'groupe'): string[] => [
      kind,
      csvCell(inv.number),
      csvCell(inv.type),
      csvCell(inv.typeLabel),
      csvCell(inv.status),
      csvCell(inv.issuedAt),
      csvCell(inv.emissionMode),
      csvCell(inv.environment),
      csvCell(inv.isf),
      csvCell(inv.customer.type),
      csvCell(inv.customer.name),
      csvCell(inv.customer.nif),
      csvCell(inv.currency),
      csvCell(inv.amountsSource),
      csvCell(inv.documentCurrency),
      csvCell(inv.priceMode),
    ];
    const tail: string[] = [
      csvCell(inv.totals.total, false),
      csvCell(inv.totals.vatTotal, false),
      csvCell(inv.totals.specificTax, false),
      csvCell(inv.payments.map((p) => `${p.method}=${p.amount}`).join('|')),
      csvCell(inv.creditNote?.nature),
      csvCell(inv.creditNote?.reference),
      csvCell(inv.dgi?.codeDefDgi),
      csvCell(inv.dgi?.nim),
      csvCell(inv.dgi?.counters),
      csvCell(inv.dgi?.dateTime),
      csvCell(inv.softwareVersion),
      csvCell(inv.contentSha256),
      inv.contentIntact ? 'oui' : 'non',
      csvCell(inv.journal.map((j) => `${j.seq}:${j.event}`).join('|')),
      chain,
    ];
    for (const l of inv.lines) {
      out.push(
        csvRow([
          ...head('ligne'),
          String(l.index),
          csvCell(l.code),
          csvCell(l.name),
          csvCell(l.itemType),
          csvCell(l.group),
          csvCell(l.unit),
          csvCell(l.quantity, false),
          csvCell(l.unitPrice, false),
          csvCell(l.originalPrice, false),
          csvCell(l.priceModification),
          csvCell(l.amount, false),
          csvCell(l.specificTaxAmount, false),
          '',
          '',
          '',
          '',
          ...tail,
        ]),
      );
    }
    for (const g of inv.groups) {
      out.push(
        csvRow([
          ...head('groupe'),
          '',
          '',
          '',
          '',
          csvCell(g.group),
          '',
          '',
          '',
          '',
          '',
          '',
          csvCell(g.specificTax, false),
          csvCell(g.ratePercent, false),
          csvCell(g.ht, false),
          csvCell(g.vat, false),
          csvCell(g.total, false),
          ...tail,
        ]),
      );
    }
  }
  return `${BOM}${out.join('\r\n')}\r\n`;
}

export const EXCHANGES_CSV_COLUMNS = [
  'date',
  'echange',
  'entree',
  'document',
  'numero',
  'uid_dgi',
  'environnement',
  'methode',
  'chemin',
  'statut_http',
  'duree_ms',
  'resultat',
  'code_erreur_dgi',
  'corps_requete',
  'corps_reponse',
] as const;

/** Échanges avec l'e-MCF en CSV : une ligne par entrée du journal des échanges. */
export function dgiExchangesCsv(items: readonly ExportedDgiExchange[]): string {
  const out: string[] = [csvRow([...EXCHANGES_CSV_COLUMNS])];
  for (const e of items) {
    out.push(
      csvRow([
        csvCell(e.at),
        csvCell(e.exchangeId),
        csvCell(e.entry),
        csvCell(e.invoiceId),
        csvCell(e.rn),
        csvCell(e.uid),
        csvCell(e.environment),
        csvCell(e.method),
        csvCell(e.path),
        csvCell(e.httpStatus, false),
        csvCell(e.durationMs, false),
        csvCell(e.outcome),
        csvCell(e.dgiErrorCode),
        csvCell(e.requestBody),
        csvCell(e.responseBody),
      ]),
    );
  }
  return `${BOM}${out.join('\r\n')}\r\n`;
}
