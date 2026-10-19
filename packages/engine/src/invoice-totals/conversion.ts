// ─────────────────────────────────────────────────────────────────────────────
// Conversion d'un document commercial en CDF (ADR-0023 § S25e.4 et § S25e.9)
//
// La facture normalisée est libellée en CDF et la DGI recalcule ses totaux à
// partir des PRIX UNITAIRES (O5) : on convertit donc chaque prix unitaire, prix
// d'origine et taxe spécifique par unité, puis `computeInvoiceTotals` recalcule
// le document en CDF. Les totaux CDF diffèrent de quelques centimes de
// « total USD × taux » : c'est assumé, seuls les montants CDF ont valeur fiscale.
//
// Arrondi unique : au centime le plus proche, demi vers le haut, sur la valeur
// EXACTE prix × taux (aucun arrondi intermédiaire, `roundRatio`).
//
// Signatures figées par le jalon E0 ; corps du chantier E1.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SCALE,
  formatAmount,
  formatTrimmed,
  hasAtMostDecimals,
  parseFixed,
  roundRatio,
  splitDecimal,
  type Fixed,
} from './decimal.js';
import {
  DOCUMENT_CURRENCIES,
  type ConvertibleLine,
  type CurrencyConversionInput,
  type CurrencyConversionResult,
  type InvoiceCheckIssue,
  type OriginLine,
  type PaymentInput,
} from './invoice-checks.types.js';
import { discountedUnitPrice, type LineDiscount } from './pricing.js';
import type { DecimalString, SpecificTax } from './types.js';

export const CURRENCY_CONVERSION_VERSION = '1.0.0';

/** Taux sous forme de texte → décimal canonique le plus court, ou null (≤ 8 décimales, > 0). */
function canonicalRate(text: string): DecimalString | null {
  const parts = splitDecimal(text);
  if (parts === null || !hasAtMostDecimals(parts, 8)) return null;
  const fixed = parseFixed(text);
  return fixed !== null && fixed > 0n ? formatTrimmed(fixed) : null;
}

// ── frontière JSON : début ───────────────────────────────────────────────────
// Seul endroit du fichier où un `number` JavaScript apparaît (test de lecture des
// sources). Cette fonction convertit, elle ne calcule pas.

/** Taux de change reçu de la DGI (nombre JSON) → décimal canonique, jusqu'à 8 décimales ;
 *  null si non fini, ≤ 0, en notation exponentielle ou plus précis.
 *
 *  Le nombre est lu par sa représentation la plus courte (`String(n)`). Un littéral
 *  écrit « 1e3 » dans le JSON vaut le nombre 1000 et ne se distingue plus après
 *  `JSON.parse` : seule une représentation exponentielle (1e-7, 1e21) est refusée,
 *  comme toute valeur qui n'est pas un nombre (une chaîne « 1e3 », par exemple). */
export function decimalFromJsonRate(value: number): DecimalString | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !(value > 0)) return null;
  return canonicalRate(String(value));
}
// ── frontière JSON : fin ─────────────────────────────────────────────────────

type ConvertedLines = Extract<CurrencyConversionResult, { ok: true }>['lines'];
type ConvertedLine = ConvertedLines extends readonly (infer L)[] ? L : never;
/** Position d'une ligne (entier), sans écrire le type flottant natif. */
type Index = OriginLine['index'];

/** Décimal strictement positif d'au plus `max` décimales ; lève une erreur sinon. */
function positive(value: unknown, max: 2 | 3, label: string): Fixed {
  const parts = splitDecimal(value);
  const fixed = parts !== null && hasAtMostDecimals(parts, max) ? parseFixed(value) : null;
  if (fixed === null || fixed <= 0n) {
    throw new RangeError(
      `${label} : décimal strictement positif d’au plus ${max} décimales attendu, reçu ${JSON.stringify(value)}`,
    );
  }
  return fixed;
}

function zeroAfterConversion(
  lineIndex: Index | null,
  field: string,
  amount: DecimalString,
  rate: DecimalString,
  extra: Readonly<Record<string, string>> = {},
): InvoiceCheckIssue {
  const where = lineIndex === null ? 'Un paiement' : `Ligne ${lineIndex + 1}`;
  return {
    code: 'CONVERTED_AMOUNT_ZERO',
    lineIndex,
    message: `${where} : le montant ${amount}, converti au taux ${rate}, s’arrondit à 0,00 CDF.`,
    details: { field, amount, rate, ...extra },
  };
}

function rateIssue(message: string, rate: string): InvoiceCheckIssue {
  return { code: 'EXCHANGE_RATE_INVALID', lineIndex: null, message, details: { rate } };
}

/** Lignes et paiements d'entrée contrôlés : un document qui arrive ici a déjà passé
 *  `computeInvoiceTotals` et `checkPayments` dans sa devise ; une valeur illisible est
 *  une erreur de programmation (`RangeError`), pas un problème de l'utilisateur. */
function readLine(line: ConvertibleLine, index: Index) {
  const label = `Ligne ${index + 1}`;
  const unitPrice = positive(line.unitPrice, 2, `${label}, prix unitaire`);
  positive(line.quantity, 3, `${label}, quantité`);
  const original =
    line.originalPrice === null
      ? null
      : positive(line.originalPrice, 2, `${label}, prix d’origine`);
  if (line.discount !== null && original === null) {
    throw new RangeError(`${label} : une remise exige un prix d’origine.`);
  }
  const discountAmount =
    line.discount?.kind === 'total_amount'
      ? positive(line.discount.value, 2, `${label}, remise`)
      : null;
  const perUnitTax =
    line.specificTax?.kind === 'per_unit'
      ? positive(line.specificTax.amount, 2, `${label}, taxe spécifique`)
      : null;
  return { unitPrice, original, discountAmount, perUnitTax };
}

/** Libellé de remise d'une ligne CDF inchangée (conversion identité). */
function identityModification(line: ConvertibleLine, index: Index): string | null {
  if (line.discount === null || line.originalPrice === null) return null;
  const result = discountedUnitPrice({
    originalPrice: line.originalPrice,
    quantity: line.quantity,
    discount: line.discount,
  });
  if (!result.ok) throw new RangeError(`Ligne ${index + 1} : ${result.issue.message}`);
  return result.priceModification;
}

/**
 * USD → CDF : prix × taux arrondi au plus proche (demi vers le haut), 2 déc. ;
 * taxe spécifique par unité idem ; pourcentages inchangés ; remise en montant
 * reconvertie et libellé recalculé par discountedUnitPrice. CDF → CDF : identité.
 *
 * Ligne avec remise : le prix d'origine est converti, puis le prix après remise est
 * recalculé en CDF par `discountedUnitPrice` (même pourcentage, ou montant de remise
 * converti) ; le prix après remise USD n'est pas converti directement, pour que le
 * libellé (« Remise 10 % », « Remise 22 623,21 CDF ») reste exact en CDF.
 *
 * Refus (tous rendus d'un coup) : taux illisible, ≤ 0, à plus de 8 décimales, ou
 * différent de 1 pour un document en CDF → `EXCHANGE_RATE_INVALID` ; prix, prix
 * d'origine, taxe par unité, remise ou paiement converti à 0,00 →
 * `CONVERTED_AMOUNT_ZERO` ; paiement illisible → `PAYMENT_AMOUNT_INVALID`.
 * Les paiements convertis sont à réconcilier avec le total CDF (`reconcilePayments`).
 */
export function convertDocumentToCdf(input: CurrencyConversionInput): CurrencyConversionResult {
  const currencies: readonly string[] = DOCUMENT_CURRENCIES;
  const rateText = typeof input.rate === 'string' ? input.rate : `${String(input.rate)}`;
  const issues: InvoiceCheckIssue[] = [];
  if (!currencies.includes(input.from)) {
    issues.push(rateIssue(`Devise d’origine inconnue : ${String(input.from)}.`, rateText));
  }
  const parts = splitDecimal(input.rate);
  const rate = parts !== null && hasAtMostDecimals(parts, 8) ? parseFixed(input.rate) : null;
  if (rate === null || rate <= 0n) {
    issues.push(
      rateIssue(
        'Le taux de change doit être un décimal strictement positif d’au plus 8 décimales (CDF pour 1 USD).',
        rateText,
      ),
    );
  } else if (input.from === 'CDF' && rate !== SCALE) {
    issues.push(rateIssue('Un document en CDF se convertit au taux 1.', rateText));
  }
  if (issues.length > 0) return { ok: false, issues };
  const cdfPerUsd = rate as Fixed;
  const identity = input.from === 'CDF';

  /** Valeur exacte montant × taux, arrondie une seule fois au centime le plus proche. */
  const toCdf = (amount: Fixed): Fixed => roundRatio(amount * cdfPerUsd, SCALE, 'half_up');

  const lines: ConvertedLine[] = input.lines.map((line, index) => {
    const read = readLine(line, index);
    if (identity) {
      return {
        index,
        unitPrice: line.unitPrice,
        originalPrice: line.originalPrice,
        priceModification: identityModification(line, index),
        specificTax: line.specificTax,
      };
    }

    const before = issues.length;
    const convert = (value: Fixed, field: string, text: DecimalString): DecimalString => {
      const converted = toCdf(value);
      if (converted === 0n) issues.push(zeroAfterConversion(index, field, text, rateText));
      return formatAmount(converted);
    };

    const originalPrice =
      read.original === null || line.originalPrice === null
        ? null
        : convert(read.original, 'originalPrice', line.originalPrice);

    let specificTax: SpecificTax | null = line.specificTax;
    if (line.specificTax?.kind === 'per_unit' && read.perUnitTax !== null) {
      const amount = convert(read.perUnitTax, 'specificTax', line.specificTax.amount);
      specificTax = { kind: 'per_unit', amount };
    }

    if (line.discount === null) {
      const unitPrice = convert(read.unitPrice, 'unitPrice', line.unitPrice);
      return { index, unitPrice, originalPrice, priceModification: null, specificTax };
    }

    let discount: LineDiscount = line.discount;
    if (line.discount.kind === 'total_amount' && read.discountAmount !== null) {
      const value = convert(read.discountAmount, 'discount', line.discount.value);
      discount = { kind: 'total_amount', value };
    }
    if (issues.length > before || originalPrice === null) {
      // Prix d'origine ou remise nuls après conversion : déjà signalé.
      return { index, unitPrice: '0.00', originalPrice, priceModification: null, specificTax };
    }
    const result = discountedUnitPrice({ originalPrice, quantity: line.quantity, discount });
    if (!result.ok) {
      issues.push(
        result.issue.code === 'PRICE_NOT_POSITIVE'
          ? zeroAfterConversion(index, 'unitPrice', line.unitPrice, rateText)
          : {
              code: 'EXCHANGE_RATE_INVALID',
              lineIndex: index,
              message: `Ligne ${index + 1} : au taux ${rateText}, la remise ne s’applique plus en CDF (${result.issue.message})`,
              details: { field: 'discount', rate: rateText },
            },
      );
      return { index, unitPrice: '0.00', originalPrice, priceModification: null, specificTax };
    }
    return {
      index,
      unitPrice: result.unitPrice,
      originalPrice,
      priceModification: result.priceModification,
      specificTax,
    };
  });

  const payments: PaymentInput[] = input.payments.map((payment, index) => {
    const parts = splitDecimal(payment.amount);
    const amount =
      parts !== null && hasAtMostDecimals(parts, 2) ? parseFixed(payment.amount) : null;
    if (amount === null || amount <= 0n) {
      issues.push({
        code: 'PAYMENT_AMOUNT_INVALID',
        lineIndex: null,
        message: `Paiement n° ${index + 1} : le montant doit être un décimal strictement positif d’au plus 2 décimales.`,
        details: { paymentIndex: `${index}` },
      });
      return { method: payment.method, amount: payment.amount };
    }
    if (identity) return { method: payment.method, amount: payment.amount };
    const converted = toCdf(amount);
    if (converted === 0n) {
      issues.push(
        zeroAfterConversion(null, 'payment', payment.amount, rateText, {
          paymentIndex: `${index}`,
        }),
      );
    }
    return { method: payment.method, amount: formatAmount(converted) };
  });

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, conversionVersion: CURRENCY_CONVERSION_VERSION, lines, payments };
}
