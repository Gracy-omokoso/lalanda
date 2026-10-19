// ─────────────────────────────────────────────────────────────────────────────
// Contrôles d'un avoir (ADR-0023 § S25e.5 et § S25e.9)
//
// Règles DGI reprises en substance, pour un avoir rattaché à une facture (natures
// COR, RAN, RAM ; un RRR n'a pas de contrainte de ligne ni de quantité) : les
// articles crédités figurent sur l'origine ; quantité créditée ≤ quantité vendue,
// y compris en cumul de plusieurs avoirs partiels ; prix unitaire identique à
// l'origine. La DGI refuse aussi un avoir dont le montant excède l'origine : avec
// l'arrondi par groupe, des avoirs partiels cumulés peuvent dépasser d'un centime,
// d'où `CREDIT_NOTE_AMOUNT_EXCEEDS_ORIGIN` (avertissement en brouillon, refus au
// gel : c'est l'API qui choisit).
//
// La nature (COR, RAN, RAM, RRR), le type d'origine, la devise et le mode de prix
// sont contrôlés par l'API (ADR-0023 § S25e.5) : ce module ne voit que des lignes
// et des montants. Pour un RRR rattaché, l'appel avec `lines: []` ne contrôle que
// le montant cumulé.
//
// Quantités et montants en chaînes, arithmétique `bigint` (`decimal.ts`). Un
// décimal illisible lève une `RangeError` : les lignes ont déjà passé
// `computeInvoiceTotals`, l'origine est un document figé.
//
// Signatures figées par le jalon E0 ; corps du chantier E1.
// ─────────────────────────────────────────────────────────────────────────────

import {
  formatAmount,
  formatTrimmed,
  hasAtMostDecimals,
  parseFixed,
  splitDecimal,
  type Fixed,
} from './decimal.js';
import type { CreditNoteCheck, InvoiceCheckIssue, OriginLine } from './invoice-checks.types.js';
import type { DecimalString } from './types.js';

type Index = OriginLine['index'];
type QuantityByLine = readonly { lineIndex: Index; quantity: DecimalString }[];

/** Décimal d'au plus `max` décimales, ≥ 0 (ou > 0 si `strict`) ; lève une erreur sinon. */
function read(value: unknown, max: 2 | 3, label: string, strict: boolean): Fixed {
  const parts = splitDecimal(value);
  const fixed = parts !== null && hasAtMostDecimals(parts, max) ? parseFixed(value) : null;
  if (fixed === null || (strict && fixed <= 0n)) {
    throw new RangeError(
      `${label} : décimal ${strict ? 'strictement positif ' : ''}d’au plus ${max} décimales attendu, reçu ${JSON.stringify(value)}`,
    );
  }
  return fixed;
}

interface Origin {
  sold: Map<Index, Fixed>;
  price: Map<Index, Fixed>;
  order: readonly Index[];
}

function readOrigin(originLines: readonly OriginLine[]): Origin {
  const sold = new Map<Index, Fixed>();
  const price = new Map<Index, Fixed>();
  for (const line of originLines) {
    if (sold.has(line.index)) {
      throw new RangeError(`Ligne d’origine ${line.index} présente deux fois.`);
    }
    sold.set(line.index, read(line.quantity, 3, `Origine, ligne ${line.index}, quantité`, true));
    price.set(line.index, read(line.unitPrice, 2, `Origine, ligne ${line.index}, prix`, true));
  }
  return { sold, price, order: originLines.map((line) => line.index) };
}

/** Quantités déjà créditées, additionnées par ligne d'origine ; une ligne inconnue est une erreur. */
function readCredited(origin: Origin, alreadyCredited: QuantityByLine): Map<Index, Fixed> {
  const credited = new Map<Index, Fixed>(origin.order.map((index) => [index, 0n]));
  for (const entry of alreadyCredited) {
    const current = credited.get(entry.lineIndex);
    if (current === undefined) {
      throw new RangeError(`Quantité déjà créditée sur une ligne inconnue : ${entry.lineIndex}.`);
    }
    credited.set(
      entry.lineIndex,
      current + read(entry.quantity, 3, `Déjà crédité, ligne ${entry.lineIndex}`, false),
    );
  }
  return credited;
}

function byLine(origin: Origin, values: (index: Index) => Fixed) {
  return origin.order.map((lineIndex) => ({
    lineIndex,
    quantity: formatTrimmed(values(lineIndex)),
  }));
}

/** Lignes présentes sur l'origine, prix unitaire identique, quantité cumulée ≤ vendue,
 *  montant cumulé comparé à celui de l'origine.
 *
 *  `creditedAfter` = déjà crédité + cet avoir ; `remainingAfter` = vendu − crédité,
 *  ramené à 0 en cas de dépassement (signalé). Quantités au format canonique le plus
 *  court (« 2.375 », « 0 »), une entrée par ligne d'origine, dans l'ordre de l'origine.
 *  `lineIndex` d'un problème = position de la ligne dans l'avoir ;
 *  `details.lineIndex` = ligne d'origine visée. */
export function checkCreditNote(input: {
  originLines: readonly OriginLine[];
  alreadyCredited: readonly { lineIndex: number; quantity: DecimalString }[];
  lines: readonly { originLineIndex: number; quantity: DecimalString; unitPrice: DecimalString }[];
  originTotal: DecimalString;
  previousCreditTotals: readonly DecimalString[];
  creditTotal: DecimalString;
}): CreditNoteCheck {
  const origin = readOrigin(input.originLines);
  const credited = readCredited(origin, input.alreadyCredited);
  const before = new Map(credited);
  const issues: InvoiceCheckIssue[] = [];
  /** Première ligne de l'avoir qui vise chaque ligne d'origine. */
  const firstLine = new Map<Index, Index>();

  input.lines.forEach((line, position) => {
    const quantity = read(line.quantity, 3, `Avoir, ligne ${position + 1}, quantité`, true);
    const unitPrice = read(line.unitPrice, 2, `Avoir, ligne ${position + 1}, prix`, true);
    const soldPrice = origin.price.get(line.originLineIndex);
    const current = credited.get(line.originLineIndex);
    if (soldPrice === undefined || current === undefined) {
      issues.push({
        code: 'CREDIT_NOTE_LINE_NOT_IN_ORIGIN',
        lineIndex: position,
        message: `Ligne ${position + 1} de l’avoir : elle ne correspond à aucune ligne de la facture d’origine.`,
        details: { lineIndex: `${line.originLineIndex}` },
      });
      return;
    }
    if (unitPrice !== soldPrice) {
      issues.push({
        code: 'CREDIT_NOTE_PRICE_MISMATCH',
        lineIndex: position,
        message: `Ligne ${position + 1} de l’avoir : le prix unitaire (${formatAmount(unitPrice)}) doit être identique à celui de la facture d’origine (${formatAmount(soldPrice)}).`,
        details: {
          lineIndex: `${line.originLineIndex}`,
          expected: formatAmount(soldPrice),
          received: formatAmount(unitPrice),
        },
      });
    }
    if (!firstLine.has(line.originLineIndex)) firstLine.set(line.originLineIndex, position);
    credited.set(line.originLineIndex, current + quantity);
  });

  for (const [lineIndex, position] of firstLine) {
    const sold = origin.sold.get(lineIndex) ?? 0n;
    const after = credited.get(lineIndex) ?? 0n;
    if (after <= sold) continue;
    const already = before.get(lineIndex) ?? 0n;
    const remaining = sold > already ? sold - already : 0n;
    issues.push({
      code: 'CREDIT_NOTE_QUANTITY_EXCEEDED',
      lineIndex: position,
      message: `Ligne ${lineIndex + 1} de la facture d’origine : il reste ${formatTrimmed(remaining)} à créditer, l’avoir en demande ${formatTrimmed(after - already)}.`,
      details: {
        lineIndex: `${lineIndex}`,
        remaining: formatTrimmed(remaining),
        requested: formatTrimmed(after - already),
        sold: formatTrimmed(sold),
        alreadyCredited: formatTrimmed(already),
      },
    });
  }

  const originTotal = read(input.originTotal, 2, 'Montant de l’origine', false);
  const previous = input.previousCreditTotals.reduce(
    (sum, total, i) => sum + read(total, 2, `Avoir précédent n° ${i + 1}`, false),
    0n,
  );
  const cumulated = previous + read(input.creditTotal, 2, 'Montant de l’avoir', false);
  if (cumulated > originTotal) {
    issues.push({
      code: 'CREDIT_NOTE_AMOUNT_EXCEEDS_ORIGIN',
      lineIndex: null,
      message: `Le montant cumulé des avoirs (${formatAmount(cumulated)}) dépasse celui de la facture d’origine (${formatAmount(originTotal)}) de ${formatAmount(cumulated - originTotal)}.`,
      details: {
        originTotal: formatAmount(originTotal),
        creditedTotal: formatAmount(cumulated),
        excess: formatAmount(cumulated - originTotal),
      },
    });
  }

  return {
    ok: issues.length === 0,
    issues,
    creditedAfter: byLine(origin, (index) => credited.get(index) ?? 0n),
    remainingAfter: byLine(origin, (index) => {
      const sold = origin.sold.get(index) ?? 0n;
      const after = credited.get(index) ?? 0n;
      return sold > after ? sold - after : 0n;
    }),
  };
}

/** Quantité restant à créditer, par ligne de l'origine (jamais négative). */
export function remainingQuantities(
  originLines: readonly OriginLine[],
  alreadyCredited: readonly { lineIndex: number; quantity: DecimalString }[],
): readonly { lineIndex: number; quantity: DecimalString }[] {
  const origin = readOrigin(originLines);
  const credited = readCredited(origin, alreadyCredited);
  return byLine(origin, (index) => {
    const sold = origin.sold.get(index) ?? 0n;
    const done = credited.get(index) ?? 0n;
    return sold > done ? sold - done : 0n;
  });
}
