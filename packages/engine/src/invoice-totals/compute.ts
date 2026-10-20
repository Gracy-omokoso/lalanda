// ─────────────────────────────────────────────────────────────────────────────
// Totaux d'une facture, exactement comme la DGI les recalcule
// (ADR-0022 § S25d.3 et S25d.4 ; règles DGI de calcul n° 1 à 8).
//
// Fonction pure : aucune base, aucun réseau, aucune horloge. Les montants
// entrent et sortent comme chaînes décimales ; tout le calcul se fait en
// `bigint` à virgule fixe (`decimal.ts`). Les deux ambiguïtés de la
// documentation DGI — arrondi de la TVA (a) et arrondi du montant de ligne (b)
// — sont des axes de `RoundingPolicy` : l'environnement de test DGI les a
// tranchées le 20 oct. 2026 (politique `dgi-cd-2026.2`) sans réécriture du calcul.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SCALE,
  formatAmount,
  formatTrimmed,
  hasAtMostDecimals,
  isZeroDecimal,
  looksNegative,
  mulExact,
  parseFixed,
  roundHalfUp,
  roundRatio,
  splitDecimal,
  type Fixed,
} from './decimal.js';
import { isItemTypeAllowed, isTaxGroupLetter, taxGroupDefinition } from './tax-groups.js';
import {
  ITEM_TYPES,
  TAX_GROUP_LETTERS,
  type GroupTotals,
  type InvoiceLineInput,
  type InvoiceTotalsInput,
  type InvoiceTotalsIssue,
  type InvoiceTotalsIssueCode,
  type InvoiceTotalsResult,
  type LineTotals,
  type RoundingPolicy,
  type SpecificTax,
  type TaxGroupLetter,
  type TaxRateTable,
} from './types.js';

/**
 * Version du calcul, enregistrée avec chaque facture (distincte d'`ENGINE_VERSION`).
 * 1.0.0 : politique par défaut `dgi-cd-2026.1`. 1.1.0 (20 oct. 2026) : politique par
 * défaut `dgi-cd-2026.2`, issue de l'étalonnage réel (ADR-0024 § 7.3) ; l'algorithme
 * est inchangé, seule la politique par défaut change.
 */
export const INVOICE_TOTALS_VERSION = '1.1.0';

/**
 * Politique par défaut du calcul 1.0.0 : montant de ligne arrondi ligne par ligne,
 * TVA du groupe arrondie au centime supérieur (lecture littérale de la règle DGI
 * n° 5). L'étalonnage du 20 oct. 2026 l'a contredite : la DGI arrondit la TVA au
 * plus proche. Conservée pour relire et recalculer à l'identique les documents
 * calculés en 1.0.0 (`roundingPolicyId: 'dgi-cd-2026.1'`) ; jamais pour un calcul
 * nouveau.
 */
export const DGI_ROUNDING_POLICY_2026_1: RoundingPolicy = Object.freeze({
  id: 'dgi-cd-2026.1',
  lineAmount: 'per_line',
  vat: 'up',
});

/**
 * Politique par défaut (calcul 1.1.0) : montant de ligne arrondi ligne par ligne,
 * TVA du groupe arrondie au plus proche, demi vers le haut. Étalonnée contre
 * l'environnement de test de la DGI le 20 oct. 2026 : seule des quatre lectures
 * sans aucune différence sur les 12 cas décisifs (relevé `ROUNDING_CALIBRATION`).
 */
export const DGI_ROUNDING_POLICY: RoundingPolicy = Object.freeze({
  id: 'dgi-cd-2026.2',
  lineAmount: 'per_line',
  vat: 'half_up',
});

/** Tout montant doit rester sous 10¹³ : au-delà, un nombre JSON à 2 décimales
 *  n'est plus exact côté DGI (15 chiffres significatifs). */
export const INVOICE_AMOUNT_LIMIT: Fixed = 10_000_000_000_000n * SCALE;

const HUNDRED: Fixed = 100n * SCALE;
const RATE_LIMIT: Fixed = 1000n * SCALE;

type Field = InvoiceTotalsIssue['field'];
/** Rang de ligne (entier de position, jamais un montant). */
type LineIndex = LineTotals['index'];

function issue(
  code: InvoiceTotalsIssueCode,
  lineIndex: InvoiceTotalsIssue['lineIndex'],
  field: Field,
  message: string,
): InvoiceTotalsIssue {
  return { code, lineIndex, field, message };
}

/** Taux validés des groupes présents dans le tableau ; problèmes des taux invalides. */
export function parseRates(rates: TaxRateTable): {
  rates: Map<TaxGroupLetter, Fixed>;
  issues: InvoiceTotalsIssue[];
} {
  const parsed = new Map<TaxGroupLetter, Fixed>();
  const issues: InvoiceTotalsIssue[] = [];
  for (const letter of TAX_GROUP_LETTERS) {
    const raw: unknown = rates[letter];
    if (raw === undefined) continue;
    const fixed = parseFixed(raw);
    if (fixed === null || fixed >= RATE_LIMIT) {
      issues.push(
        issue(
          'TAX_RATE_INVALID',
          null,
          'rates',
          `Le taux du groupe ${letter} est invalide : un décimal positif ou nul, inférieur à 1000 et d'au plus 8 décimales, est attendu.`,
        ),
      );
      continue;
    }
    parsed.set(letter, fixed);
  }
  return { rates: parsed, issues };
}

interface ParsedLine {
  index: LineIndex;
  group: TaxGroupLetter;
  quantity: Fixed;
  /** Prix × quantité, exact (jusqu'à 5 décimales). */
  exactAmount: Fixed;
  /** Prix × quantité arrondi au centime le plus proche. */
  roundedAmount: Fixed;
  specificTax: SpecificTax | null;
  specificTaxFixed: Fixed; // montant par unité ou taux en %, en virgule fixe
}

/**
 * Valide un décimal strictement positif d'au plus `max` décimales ; renvoie sa
 * valeur ou pousse les problèmes (tous, pas le premier).
 */
function positiveDecimal(
  value: unknown,
  max: 2 | 3,
  lineIndex: LineIndex,
  field: 'unitPrice' | 'quantity',
  issues: InvoiceTotalsIssue[],
): Fixed | null {
  const isPrice = field === 'unitPrice';
  const label = isPrice ? 'Le prix unitaire' : 'La quantité';
  const notPositive: InvoiceTotalsIssueCode = isPrice
    ? 'PRICE_NOT_POSITIVE'
    : 'QUANTITY_NOT_POSITIVE';
  const tooPrecise: InvoiceTotalsIssueCode = isPrice ? 'PRICE_TOO_PRECISE' : 'QUANTITY_TOO_PRECISE';
  if (looksNegative(value)) {
    issues.push(issue(notPositive, lineIndex, field, `${label} doit être strictement positif.`));
    return null;
  }
  const parts = splitDecimal(value);
  if (parts === null || typeof value !== 'string') {
    issues.push(
      issue(
        'INVALID_DECIMAL',
        lineIndex,
        field,
        `${label} doit être un nombre décimal écrit avec un point, sans signe ni exposant (exemple : « 464.00 »).`,
      ),
    );
    return null;
  }
  let ok = true;
  if (!hasAtMostDecimals(parts, max)) {
    issues.push(issue(tooPrecise, lineIndex, field, `${label} admet au plus ${max} décimales.`));
    ok = false;
  }
  if (isZeroDecimal(value)) {
    issues.push(issue(notPositive, lineIndex, field, `${label} doit être strictement positif.`));
    ok = false;
  }
  return ok ? parseFixed(value) : null;
}

/** Valide la taxe spécifique d'une ligne ; renvoie sa valeur en virgule fixe. */
function specificTaxValue(
  specificTax: unknown,
  group: TaxGroupLetter | null,
  lineIndex: LineIndex,
  issues: InvoiceTotalsIssue[],
): Fixed | null {
  if (specificTax === null) return 0n;
  if (group !== null && isItemTypeAllowed(group, 'TAX')) {
    issues.push(
      issue(
        'SPECIFIC_TAX_NOT_ALLOWED',
        lineIndex,
        'specificTax',
        `Une taxe spécifique est interdite en groupe ${group} : l'article y est lui-même une taxe.`,
      ),
    );
    return null;
  }
  const invalid = (detail: string): null => {
    issues.push(issue('SPECIFIC_TAX_INVALID', lineIndex, 'specificTax', detail));
    return null;
  };
  if (typeof specificTax !== 'object' || specificTax === undefined) {
    return invalid('La taxe spécifique est mal formée.');
  }
  const candidate = specificTax as { kind?: unknown; amount?: unknown; rate?: unknown };
  const raw = candidate.kind === 'per_unit' ? candidate.amount : candidate.rate;
  if (candidate.kind !== 'per_unit' && candidate.kind !== 'percent') {
    return invalid('La taxe spécifique doit être un montant par unité ou un pourcentage.');
  }
  const parts = splitDecimal(raw);
  const fixed = parts !== null && hasAtMostDecimals(parts, 2) ? parseFixed(raw) : null;
  if (fixed === null || fixed <= 0n) {
    return invalid(
      'La taxe spécifique doit être un décimal strictement positif d’au plus 2 décimales.',
    );
  }
  if (candidate.kind === 'percent' && fixed >= HUNDRED) {
    return invalid('Le pourcentage de taxe spécifique doit être inférieur à 100.');
  }
  return fixed;
}

function validateLine(
  line: InvoiceLineInput,
  index: LineIndex,
  rates: ReadonlyMap<TaxGroupLetter, Fixed>,
  rawRates: TaxRateTable,
  issues: InvoiceTotalsIssue[],
): ParsedLine | null {
  const before = issues.length;
  const price = positiveDecimal(line.unitPrice, 2, index, 'unitPrice', issues);
  const quantity = positiveDecimal(line.quantity, 3, index, 'quantity', issues);

  let group: TaxGroupLetter | null = null;
  if (!isTaxGroupLetter(line.taxGroup)) {
    issues.push(
      issue(
        'UNKNOWN_TAX_GROUP',
        index,
        'taxGroup',
        `Groupe de taxation inconnu : seuls les groupes A à P sont en vigueur.`,
      ),
    );
  } else {
    group = line.taxGroup;
    if (rawRates[group] === undefined) {
      issues.push(
        issue(
          'UNKNOWN_TAX_GROUP',
          index,
          'taxGroup',
          `Le groupe ${group} n'a pas de taux dans la liste DGI figée par la facture.`,
        ),
      );
    }
  }

  const typeKnown = (ITEM_TYPES as readonly unknown[]).includes(line.itemType);
  if (!typeKnown || (group !== null && !isItemTypeAllowed(group, line.itemType))) {
    issues.push(
      issue(
        'ITEM_TYPE_NOT_ALLOWED',
        index,
        'itemType',
        group === null || !typeKnown
          ? 'Type d’article inconnu : BIE, SER ou TAX attendu.'
          : `Le type ${line.itemType} n'est pas admis en groupe ${group} (TAX seulement en L et N).`,
      ),
    );
  }

  const specificTaxFixed = specificTaxValue(line.specificTax, group, index, issues);

  if (price !== null && quantity !== null) {
    const exactAmount = mulExact(price, quantity);
    const roundedAmount = roundHalfUp(exactAmount);
    if (roundedAmount === 0n) {
      issues.push(
        issue(
          'LINE_AMOUNT_ZERO',
          index,
          null,
          'Le montant de la ligne (prix × quantité) arrondi au centime est nul.',
        ),
      );
    } else if (roundedAmount >= INVOICE_AMOUNT_LIMIT) {
      issues.push(
        issue(
          'AMOUNT_TOO_LARGE',
          index,
          null,
          "Le montant de la ligne atteint 10¹³ : un nombre JSON n'y serait plus exact.",
        ),
      );
    }
    if (issues.length === before && group !== null && specificTaxFixed !== null) {
      if (!rates.has(group)) return null; // taux invalide, déjà signalé
      return {
        index,
        group,
        quantity,
        exactAmount,
        roundedAmount,
        specificTax: line.specificTax,
        specificTaxFixed,
      };
    }
  }
  return null;
}

interface GroupAccumulator {
  lines: ParsedLine[];
}

interface ComputedGroup {
  totals: GroupTotals;
  total: Fixed;
  vat: Fixed;
  specificTax: Fixed;
  lineSpecificTaxes: Map<LineIndex, Fixed>;
}

function computeGroup(
  letter: TaxGroupLetter,
  rate: Fixed,
  lines: readonly ParsedLine[],
  priceMode: InvoiceTotalsInput['priceMode'],
  policy: RoundingPolicy,
): ComputedGroup {
  // Étape 2 : montant du groupe, selon l'axe (b) de la politique.
  const perLine = policy.lineAmount === 'per_line';
  const amounts = lines.map((line) => (perLine ? line.roundedAmount : line.exactAmount));
  const sum = amounts.reduce((acc, value) => acc + value, 0n);
  const groupAmount = perLine ? sum : roundHalfUp(sum);
  const vatMode = policy.vat === 'up' ? 'up' : 'half_up';

  // Étape 3 : taxe spécifique de chaque ligne (règle DGI n° 7).
  const lineSpecificTaxes = new Map<LineIndex, Fixed>();
  let specificTax = 0n;
  lines.forEach((line, position) => {
    if (line.specificTax === null) return;
    let amount: Fixed;
    if (line.specificTax.kind === 'per_unit') {
      amount = roundHalfUp(mulExact(line.specificTaxFixed, line.quantity));
    } else {
      const base = amounts[position] ?? 0n;
      // HT : base × taux / 100. TTC : base TTC ramenée au HT (non arrondie)
      // × taux / 100, soit base × taux / (100 + t), en une seule division.
      amount =
        priceMode === 'ht'
          ? roundRatio(base * line.specificTaxFixed, HUNDRED, 'half_up')
          : roundRatio(base * line.specificTaxFixed, HUNDRED + rate, 'half_up');
    }
    lineSpecificTaxes.set(line.index, amount);
    specificTax += amount;
  });

  let total: Fixed;
  let ht: Fixed;
  let vat: Fixed;
  if (taxGroupDefinition(letter).nature === 'vat_only') {
    // Étape 5 : groupe N, montant entièrement de TVA, quel que soit le mode.
    total = groupAmount;
    vat = groupAmount;
    ht = 0n;
  } else if (priceMode === 'ht') {
    ht = groupAmount + specificTax;
    vat = roundRatio(ht * rate, HUNDRED, vatMode);
    total = ht + vat;
  } else {
    total = groupAmount + roundRatio(specificTax * (HUNDRED + rate), HUNDRED, 'half_up');
    vat = roundRatio(total * rate, HUNDRED + rate, vatMode);
    ht = total - vat;
  }

  return {
    totals: {
      group: letter,
      ratePercent: formatTrimmed(rate),
      total: formatAmount(total),
      ht: formatAmount(ht),
      vat: formatAmount(vat),
      specificTax: formatAmount(specificTax),
    },
    total,
    vat,
    specificTax,
    lineSpecificTaxes,
  };
}

function assertPolicy(policy: RoundingPolicy): void {
  const lineOk = policy.lineAmount === 'per_line' || policy.lineAmount === 'per_group';
  const vatOk = policy.vat === 'up' || policy.vat === 'half_up';
  if (typeof policy.id !== 'string' || policy.id === '' || !lineOk || !vatOk) {
    throw new RangeError(`Politique d'arrondi invalide : ${JSON.stringify(policy)}`);
  }
}

/** Forme DGI de `taxSpecificValue` : « 75.00 » par unité, « 10.00% » en pourcentage. */
function specificTaxDgiValue(line: ParsedLine): string | null {
  if (line.specificTax === null) return null;
  const formatted = formatAmount(line.specificTaxFixed);
  return line.specificTax.kind === 'percent' ? `${formatted}%` : formatted;
}

/** Totaux d'une facture, exactement comme la DGI les recalcule. */
export function computeInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotalsResult {
  const policy = input.policy ?? DGI_ROUNDING_POLICY;
  assertPolicy(policy);
  const issues: InvoiceTotalsIssue[] = [];

  if (input.lines.length === 0) {
    issues.push(issue('NO_LINES', null, null, 'Une facture doit compter au moins une ligne.'));
  }
  const parsedRates = parseRates(input.rates);
  issues.push(...parsedRates.issues);

  const parsedLines: ParsedLine[] = [];
  input.lines.forEach((line, index) => {
    const parsed = validateLine(line, index, parsedRates.rates, input.rates, issues);
    if (parsed !== null) parsedLines.push(parsed);
  });
  if (issues.length > 0) return { ok: false, issues };

  // Regroupement, ordre A → P : le résultat ne dépend pas de l'ordre des lignes.
  const byGroup = new Map<TaxGroupLetter, GroupAccumulator>();
  for (const line of parsedLines) {
    const accumulator = byGroup.get(line.group) ?? { lines: [] };
    accumulator.lines.push(line);
    byGroup.set(line.group, accumulator);
  }

  const groups: GroupTotals[] = [];
  const lineSpecificTaxes = new Map<LineIndex, Fixed>();
  let total = 0n;
  let vatTotal = 0n;
  let specificTax = 0n;
  for (const letter of TAX_GROUP_LETTERS) {
    const accumulator = byGroup.get(letter);
    const rate = parsedRates.rates.get(letter);
    if (accumulator === undefined || rate === undefined) continue;
    const computed = computeGroup(letter, rate, accumulator.lines, input.priceMode, policy);
    if (computed.total >= INVOICE_AMOUNT_LIMIT) {
      issues.push(
        issue(
          'AMOUNT_TOO_LARGE',
          null,
          null,
          `Le total du groupe ${letter} atteint 10¹³ : un nombre JSON n'y serait plus exact.`,
        ),
      );
    }
    groups.push(computed.totals);
    for (const [index, amount] of computed.lineSpecificTaxes) lineSpecificTaxes.set(index, amount);
    total += computed.total;
    vatTotal += computed.vat;
    specificTax += computed.specificTax;
  }
  if (issues.length === 0 && total >= INVOICE_AMOUNT_LIMIT) {
    issues.push(
      issue(
        'AMOUNT_TOO_LARGE',
        null,
        null,
        "Le total de la facture atteint 10¹³ : un nombre JSON n'y serait plus exact.",
      ),
    );
  }
  if (issues.length > 0) return { ok: false, issues };

  const lines: LineTotals[] = parsedLines.map((line) => ({
    index: line.index,
    amount: formatAmount(line.roundedAmount),
    specificTaxAmount: formatAmount(lineSpecificTaxes.get(line.index) ?? 0n),
    specificTaxValue: specificTaxDgiValue(line),
  }));

  return {
    ok: true,
    totals: {
      calculationVersion: INVOICE_TOTALS_VERSION,
      policyId: policy.id,
      priceMode: input.priceMode,
      lines,
      groups,
      specificTax: formatAmount(specificTax),
      total: formatAmount(total),
      vatTotal: formatAmount(vatTotal),
    },
  };
}
