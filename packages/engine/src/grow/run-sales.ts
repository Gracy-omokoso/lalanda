// ─────────────────────────────────────────────────────────────────────────────
// GROW — ventes RUN lues document par document (ADR-0032 § 2)
//
// Le chiffre d'affaires d'un document est celui d'ADR-0031 : `revenueAmountsFor`
// (bases HT hors groupes H, I, J, L, N ; le CDF normalisé d'abord, seule valeur
// fiscale ; aucun taux de change). Depuis l'amendement du 27 oct. 2026, GROW ne
// porte plus sa propre règle (l'ancien `grow/sales-revenue.ts` provisoire est
// retiré) : il ne fait qu'AJOUTER ce que ses indicateurs demandent — mois civil
// de Kinshasa, client et nature récurrente de chaque document.
//
// Factures finales de la série réelle, FV/EV moins avoirs FA/EA ; les acomptes
// FT/ET sont exclus ET comptés (ADR-0031, décision ouverte n° 1). Un document sans
// représentation dans la devise de référence est exclu et compté.
//
// Arithmétique exacte : entiers `bigint` en virgule fixe (10⁸), comme
// `invoice-totals` dont on réutilise l'arithmétique interne sans la modifier.
// ─────────────────────────────────────────────────────────────────────────────

import { CENT, parseFixed, roundHalfUp, type Fixed } from '../invoice-totals/decimal.js';
import { revenueAmountsFor } from '../receivables/aggregation.js';
import type { RevenueDocumentInput, RevenueGroupAmount } from '../receivables/types.js';
import { kinshasaMonthOf } from './periods.js';
import type { GrowMonth, GrowSalesDocument } from './types.js';

/** Statuts finaux (ADR-0023 § S25e.14 : `final` = `issued` + `normalized`). */
const FINAL_STATUSES: readonly string[] = ['issued', 'normalized'];
const SALE_TYPES: readonly string[] = ['FV', 'EV'];
const CREDIT_TYPES: readonly string[] = ['FA', 'EA'];
const DEPOSIT_TYPES: readonly string[] = ['FT', 'ET'];

/** Nature récurrente d'un document au regard des articles déclarés récurrents. */
export type GrowRecurrence = 'recurrent' | 'non_recurrent' | 'mixte';

/** Chiffre d'affaires signé d'un document, dans la devise de référence. */
export interface GrowRevenueEntry {
  documentId: string;
  month: GrowMonth;
  customerKey: string | null;
  customerName: string | null;
  /** Virgule fixe signée : négative pour un avoir. */
  amount: Fixed;
  recurrence: GrowRecurrence;
}

export interface GrowSalesRevenue {
  /** Devise de référence ; `null` si aucune ne peut être retenue sans taux. */
  currency: string | null;
  /** Pourquoi `currency` est `null`. */
  currencyIssue: 'AUCUNE_VENTE' | 'DEVISE_DE_REFERENCE_INDETERMINEE' | null;
  entries: readonly GrowRevenueEntry[];
  excluded: { acomptes: number; serieEssai: number; autreDevise: number };
  /** Devises rencontrées parmi les documents retenus en principe. */
  currenciesSeen: readonly string[];
}

function recurrenceOf(
  lineItems: readonly (string | null)[],
  recurring: ReadonlySet<string>,
): GrowRecurrence {
  if (recurring.size === 0 || lineItems.length === 0) return 'non_recurrent';
  let yes = 0;
  for (const id of lineItems) if (id !== null && recurring.has(id)) yes += 1;
  if (yes === 0) return 'non_recurrent';
  return yes === lineItems.length ? 'recurrent' : 'mixte';
}

/**
 * Document GROW → entrée d'ADR-0031. La première représentation est celle du
 * document ; une représentation CDF supplémentaire est celle de la normalisation.
 */
function revenueDocumentOf(doc: GrowSalesDocument, issuedOn: string): RevenueDocumentInput {
  const [own, ...others] = doc.amounts;
  const normalized = others.find((a) => a.currency === 'CDF') ?? null;
  const groups = (g: readonly { group: string; ht: string }[]) =>
    g as readonly RevenueGroupAmount[];
  return {
    id: doc.id,
    issuedOn,
    kind: CREDIT_TYPES.includes(doc.type) ? 'credit_note' : 'invoice',
    document: {
      currency: (own?.currency ?? '') as RevenueDocumentInput['document']['currency'],
      groups: groups(own?.groups ?? []),
    },
    normalized: normalized ? { currency: 'CDF', groups: groups(normalized.groups) } : null,
  };
}

/**
 * Chiffre d'affaires des ventes, document par document, dans la devise de référence.
 *
 * `preferredCurrency` : devise du projet de référence. À défaut, la devise est celle
 * des documents s'ils n'en ont qu'une ; sinon elle est indéterminée et aucune vente
 * n'est retenue (aucun taux n'est appliqué, ADR-0031 décision ouverte n° 3).
 */
export function salesRevenue(
  documents: readonly GrowSalesDocument[],
  preferredCurrency: string | null,
  recurringCatalogItemIds: readonly string[] = [],
): GrowSalesRevenue {
  const recurring = new Set(recurringCatalogItemIds);
  const excluded = { acomptes: 0, serieEssai: 0, autreDevise: 0 };

  // Documents qui comptent en principe : finaux, datés, série réelle, vente ou avoir.
  const candidates: { doc: GrowSalesDocument; month: GrowMonth; issuedOn: string }[] = [];
  for (const doc of documents) {
    if (!FINAL_STATUSES.includes(doc.status) || doc.issuedAt === null) continue;
    if (doc.series !== 'real') {
      excluded.serieEssai += doc.series === 'test' ? 1 : 0;
      continue;
    }
    if (DEPOSIT_TYPES.includes(doc.type)) {
      excluded.acomptes += 1;
      continue;
    }
    if (!SALE_TYPES.includes(doc.type) && !CREDIT_TYPES.includes(doc.type)) continue;
    const month = kinshasaMonthOf(doc.issuedAt);
    if (month === null) {
      throw new RangeError(`Document ${doc.id} : date d'émission illisible`);
    }
    candidates.push({ doc, month, issuedOn: `${month}-01` });
  }

  const seen = [...new Set(candidates.map((c) => c.doc.amounts[0]?.currency ?? ''))]
    .filter((c) => c !== '')
    .sort();

  let currency: string | null = preferredCurrency;
  let currencyIssue: GrowSalesRevenue['currencyIssue'] = null;
  if (currency === null) {
    if (seen.length === 0) currencyIssue = 'AUCUNE_VENTE';
    else if (seen.length === 1) currency = seen[0]!;
    else currencyIssue = 'DEVISE_DE_REFERENCE_INDETERMINEE';
  }

  const entries: GrowRevenueEntry[] = [];
  if (currency !== null) {
    for (const { doc, month, issuedOn } of candidates) {
      // La règle d'ADR-0031, telle quelle : aucune base recalculée ici.
      const amounts = revenueAmountsFor(revenueDocumentOf(doc, issuedOn), currency);
      if (!amounts.ok) {
        excluded.autreDevise += 1;
        continue;
      }
      const base = parseFixed(amounts.ht);
      if (base === null) {
        throw new RangeError(`Document ${doc.id} : base HT illisible (${amounts.ht})`);
      }
      entries.push({
        documentId: doc.id,
        month,
        customerKey: doc.customerKey,
        customerName: doc.customerName,
        amount: CREDIT_TYPES.includes(doc.type) ? -base : base,
        recurrence: recurrenceOf(doc.lineCatalogItemIds, recurring),
      });
    }
  }

  return { currency, currencyIssue, entries, excluded, currenciesSeen: seen };
}

/** Somme des montants des entrées qui satisfont `keep`. */
export function sumEntries(
  entries: readonly GrowRevenueEntry[],
  keep: (e: GrowRevenueEntry) => boolean,
): Fixed {
  let s = 0n;
  for (const e of entries) if (keep(e)) s += e.amount;
  return s;
}

/** Virgule fixe signée → nombre arrondi au centime (demi vers le haut, en valeur absolue). */
export function fixedToNumber(value: Fixed): number {
  const negative = value < 0n;
  const abs = roundHalfUp(negative ? -value : value);
  const cents = abs / CENT;
  const n = Number(cents) / 100;
  return negative ? -n : n;
}

/** Ratio de deux virgules fixes, en nombre (le dénominateur doit être non nul). */
export function fixedRatio(num: Fixed, den: Fixed): number {
  if (den === 0n) throw new RangeError('Ratio de dénominateur nul');
  // Les montants sont au centime : le passage par les centimes reste exact.
  return Number(num / CENT) / Number(den / CENT);
}
