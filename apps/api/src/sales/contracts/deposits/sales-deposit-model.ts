// Règles pures des acomptes d'un engagement — ADR-0050 § 5.1, § 5.2. ADR-0050 — V4.
//
// Aucune base, aucune horloge, AUCUN calcul de montant : les totaux viennent du moteur
// des factures (`compose`, figés à l'émission) ; le résumé des acomptes et
// `DEPOSIT_NOT_RESOLVED` viennent du moteur `contracts` (`depositSummary`).
//
// Règle absolue (décision ouverte n° 11) : l'acompte n'est JAMAIS imputé sur la facture
// finale. Elle en reçoit seulement le RAPPEL — le code de la facture d'acompte en ligne
// de commentaire C, seul mécanisme sourcé (ADR-0023 § S25e.7). Ni ligne négative, ni
// paiement prérempli, ni avoir automatique, ni prorata, ni pourcentage.

import type { ItemType } from '@lalanda/engine';

import type { InvoiceStatus } from '../../invoices/invoice.contract.js';
import type { LinkedInvoiceRead, LiveLink } from '../links/sales-document-links.service.js';

/** Liens d'acompte d'une commande ou d'un contrat. */
export const DEPOSIT_LINK_KINDS = ['order_deposit', 'contract_deposit'] as const;

/** Liens d'une facture « finale » (vente) d'une commande ou d'un contrat. */
export const FINAL_LINK_KINDS = [
  'order_invoice',
  'contract_invoice',
  'schedule_item',
  'subscription_occurrence',
] as const;

const ISSUED: readonly InvoiceStatus[] = ['issued', 'normalized'];

export const isDepositLink = (l: LiveLink): boolean =>
  (DEPOSIT_LINK_KINDS as readonly string[]).includes(l.link.kind);

export const isFinalLink = (l: LiveLink): boolean =>
  (FINAL_LINK_KINDS as readonly string[]).includes(l.link.kind);

/**
 * Code à rappeler d'une facture d'acompte (§ 5.2) : code DEF/DGI d'une facture
 * normalisée, numéro sinon ; `null` si elle n'est pas émise en série réelle (brouillon,
 * pro forma, série d'essai, normalisation en cours ou en échec).
 */
export function depositRecallCode(invoice: LinkedInvoiceRead): string | null {
  if (!ISSUED.includes(invoice.status)) return null;
  if (invoice.series !== 'real') return null;
  const dgi = invoice.normalization?.codeDefDgi?.trim();
  if (invoice.status === 'normalized' && dgi) return dgi;
  const number = invoice.number?.trim();
  return number ? number : null;
}

/** Codes des acomptes émis d'un engagement, dans l'ordre des liens (sans doublon). */
export function depositRecallCodes(live: readonly LiveLink[]): string[] {
  const codes = live.filter(isDepositLink).flatMap((l) => {
    const c = depositRecallCode(l.invoice);
    return c === null ? [] : [c];
  });
  return [...new Set(codes)];
}

/** « Acompte FT… » / « Acomptes FT…, FT… » ; chaîne vide sans acompte émis. */
export function depositRecallText(codes: readonly string[]): string {
  if (codes.length === 0) return '';
  return `${codes.length === 1 ? 'Acompte' : 'Acomptes'} ${codes.join(', ')}`;
}

/**
 * Ligne C d'une facture finale : le rappel des acomptes EN TÊTE (mention sourcée,
 * jamais coupée la première), puis le texte de l'engagement ; tronquée à `max`.
 */
export function commentWithDepositRecall(
  base: string,
  codes: readonly string[],
  max: number,
): { text: string; truncated: boolean } {
  const recall = depositRecallText(codes);
  const full = recall === '' ? base : base === '' ? recall : `${recall} — ${base}`;
  return full.length > max
    ? { text: full.slice(0, max), truncated: true }
    : { text: full, truncated: false };
}

/**
 * Type d'article (BIE, SER, TAX) de la ligne libre d'acompte. Les groupes L et N
 * n'admettent que TAX (contrôle existant des lignes libres). Sinon, le type des lignes
 * de l'engagement est REPRIS quand il est unique (d'abord parmi celles du groupe choisi,
 * puis parmi toutes) ; à défaut, `SER` est posé et signalé (`toCheck`) : l'utilisateur
 * vérifie le brouillon avant de l'émettre. Aucune règle fiscale ici : c'est une forme.
 */
export function depositItemTypeOf(
  taxGroup: string,
  lines: readonly { taxGroup: string; itemType: ItemType }[],
): { itemType: ItemType; toCheck: boolean } {
  if (taxGroup === 'L' || taxGroup === 'N') return { itemType: 'TAX', toCheck: false };
  const unique = (ls: readonly { itemType: ItemType }[]): ItemType | null => {
    const types = [...new Set(ls.map((l) => l.itemType).filter((t) => t !== 'TAX'))];
    return types.length === 1 ? types[0]! : null;
  };
  const same = unique(lines.filter((l) => l.taxGroup === taxGroup));
  if (same !== null) return { itemType: same, toCheck: false };
  const any = unique(lines);
  if (any !== null) return { itemType: any, toCheck: false };
  return { itemType: 'SER', toCheck: true };
}

const AMOUNT = /^(\d+)(?:\.(\d{1,2}))?$/;

/** Deux montants décimaux (≤ 2 décimales) sont-ils égaux ? `null` si l'un est illisible. */
export function sameAmount(a: string | null, b: string | null): boolean | null {
  if (a === null || b === null) return null;
  const x = AMOUNT.exec(a);
  const y = AMOUNT.exec(b);
  if (x === null || y === null) return null;
  const cents = (m: RegExpExecArray) => BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'));
  return cents(x) === cents(y);
}
