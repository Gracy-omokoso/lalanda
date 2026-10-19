// Cas envoyés par l'outil d'étalonnage des arrondis — ADR-0024 § 7.1 (chantier F4).
//
// Les cas viennent TELS QUELS du moteur (`INVOICE_TOTALS_REFERENCE_CASES`
// d'origine `calibration` et `dgi_example`, ADR-0022 § S25d.6), plus le cas de
// contre-valeur (`CURRENCY_REFERENCE_CASES`, `devise-contre-valeur`) porté par
// la facture modèle. Ce fichier n'invente aucun montant et ne calcule rien
// lui-même : tous les totaux viennent de `computeInvoiceTotals`.
//
// Construction MINIMALE de la requête : juste ce qu'il faut pour que la DGI
// recalcule les totaux. Aucune donnée de client réelle ; le NIF est celui que
// la DGI renvoie pour le jeton de test (jamais saisi à la main).

import {
  CALIBRATION_ROUNDING_POLICIES,
  CURRENCY_REFERENCE_CASES,
  DGI_ROUNDING_POLICY,
  INVOICE_TOTALS_REFERENCE_CASES,
  TAX_GROUP_LETTERS,
  computeInvoiceTotals,
  decimalFromJsonNumber,
  decimalFromJsonRate,
  decimalToJsonNumber,
  usdCounterValue,
  type DecimalString,
  type InvoiceTotals,
  type InvoiceTotalsInput,
  type InvoiceTotalsReferenceCase,
  type TaxGroupLetter,
  type TaxRateTable,
} from '@lalanda/engine';

import { EdefInvoiceRequestSchema, type EdefInvoiceRequest } from '../edef-invoice.types.js';
import type { EdefCurrencyRate, EdefReferenceData } from '../edef.types.js';

/** Identifiant du cas de contre-valeur (ADR-0022 § S25d.6, ligne `devise`). */
export const COUNTER_VALUE_CASE_ID = 'devise-contre-valeur';
/** Facture qui porte la contre-valeur : la facture modèle de la documentation DGI. */
export const COUNTER_VALUE_BASE_CASE_ID = 'dgi-modele';

export interface CalibrationCase {
  /** Identifiant du cas de référence, ou `devise-contre-valeur`. */
  id: string;
  /** Cas de référence dont l'entrée est envoyée. */
  baseCaseId: string;
  origin: InvoiceTotalsReferenceCase['origin'];
  reliability: InvoiceTotalsReferenceCase['reliability'] | 'to_calibrate';
  /**
   * Compte pour le choix de la politique (ADR-0024 § 7.3 : « cas `calibration`
   * et cas fiables »). Les exemples DGI non fiables sont envoyés pour
   * information seulement.
   */
  decisive: boolean;
  input: InvoiceTotalsInput;
  counterValue: boolean;
}

function referenceCase(id: string): InvoiceTotalsReferenceCase {
  const found = INVOICE_TOTALS_REFERENCE_CASES.find((c) => c.id === id);
  if (!found) throw new Error(`Cas de référence introuvable : ${id}`);
  return found;
}

/**
 * Cas à envoyer, dans un ordre stable : cas d'origine `calibration` et
 * `dgi_example` dont le calcul aboutit (les cas de refus ne s'envoient pas), puis
 * le cas de contre-valeur.
 */
export function selectCalibrationCases(): CalibrationCase[] {
  const cases: CalibrationCase[] = INVOICE_TOTALS_REFERENCE_CASES.filter(
    (c) => (c.origin === 'calibration' || c.origin === 'dgi_example') && c.expected.ok,
  ).map((c) => ({
    id: c.id,
    baseCaseId: c.id,
    origin: c.origin,
    reliability: c.reliability,
    decisive: c.origin === 'calibration' || c.reliability === 'reliable',
    input: c.input,
    counterValue: false,
  }));

  const currency = CURRENCY_REFERENCE_CASES.find((c) => c.id === COUNTER_VALUE_CASE_ID);
  if (currency) {
    const base = referenceCase(COUNTER_VALUE_BASE_CASE_ID);
    cases.push({
      id: COUNTER_VALUE_CASE_ID,
      baseCaseId: base.id,
      origin: base.origin,
      reliability: currency.reliability,
      decisive: true,
      input: base.input,
      counterValue: true,
    });
  }
  return cases;
}

/** Groupes de taxation utilisés par un cas, ordre A → P. */
export function groupsOf(input: InvoiceTotalsInput): TaxGroupLetter[] {
  const used = new Set(input.lines.map((l) => l.taxGroup));
  return TAX_GROUP_LETTERS.filter((g) => used.has(g));
}

export type RatesResolution =
  | {
      ok: true;
      /** Taux publiés par la DGI pour les groupes du cas : ce sont eux qui servent au calcul. */
      rates: TaxRateTable;
      /** Groupes dont le taux du cas diffère du taux publié (information). */
      differences: { group: TaxGroupLetter; caseRate: DecimalString | null; dgiRate: string }[];
    }
  | { ok: false; reason: string };

/**
 * Taux du cas, lus dans la liste `taxGroups` de la DGI (comme le fait le gel d'une
 * facture). Un exemple DGI dont le taux diffère du taux publié est une
 * recalculation hypothétique (exemples « à 19 % ») : il n'a pas d'objet face à
 * la DGI et n'est pas envoyé.
 */
export function resolveRates(
  c: CalibrationCase,
  taxGroups: EdefReferenceData['taxGroups'],
): RatesResolution {
  const rates: Partial<Record<TaxGroupLetter, DecimalString>> = {};
  const differences: { group: TaxGroupLetter; caseRate: DecimalString | null; dgiRate: string }[] =
    [];
  for (const group of groupsOf(c.input)) {
    const published = taxGroups[group.toLowerCase()];
    if (published === undefined) {
      return { ok: false, reason: `groupe ${group} absent de la liste taxGroups de la DGI` };
    }
    const dgiRate = decimalFromJsonNumber(published);
    if (dgiRate === null) {
      return { ok: false, reason: `taux du groupe ${group} illisible (${String(published)})` };
    }
    const caseRate = c.input.rates[group] ?? null;
    if (caseRate === null || !sameDecimal(caseRate, dgiRate)) {
      if (c.origin === 'dgi_example') {
        return {
          ok: false,
          reason: `taux du cas (${caseRate ?? 'absent'} %) différent du taux publié par la DGI pour ${group} (${dgiRate} %) : exemple recalculé, sans objet face à la DGI`,
        };
      }
      differences.push({ group, caseRate, dgiRate });
    }
    rates[group] = dgiRate;
  }
  return { ok: true, rates, differences };
}

function sameDecimal(a: DecimalString, b: DecimalString): boolean {
  const norm = (v: string): string => {
    const [i = '0', f = ''] = v.split('.');
    const fraction = f.replace(/0+$/, '');
    return `${i.replace(/^0+(?=\d)/, '')}${fraction ? `.${fraction}` : ''}`;
  };
  return norm(a) === norm(b);
}

/** Contre-valeur envoyée : taux et date TELS QUE REÇUS de la liste `currencyRates`. */
export interface CounterValueSource {
  rate: DecimalString;
  rateJson: number;
  date: string;
}

export function usdRateOf(list: readonly EdefCurrencyRate[]): CounterValueSource | null {
  const usd = list.find((r) => r.type === 'USD');
  if (!usd || usd.rate === null || !usd.date) return null;
  const rate = decimalFromJsonRate(usd.rate);
  return rate === null ? null : { rate, rateJson: usd.rate, date: usd.date };
}

/** Nos totaux sous chacune des quatre politiques candidates. */
export function predictions(
  c: CalibrationCase,
  rates: TaxRateTable,
): { policyId: string; totals: InvoiceTotals }[] {
  return CALIBRATION_ROUNDING_POLICIES.map((policy) => {
    const result = computeInvoiceTotals({ ...c.input, rates, policy });
    if (!result.ok) {
      throw new Error(
        `Cas ${c.id} : le moteur refuse le calcul sous ${policy.id} (${result.issues
          .map((i) => i.code)
          .join(', ')})`,
      );
    }
    return { policyId: policy.id, totals: result.totals };
  });
}

/** Contre-valeur attendue (même règle sous les quatre politiques). */
export function expectedCurTotal(totals: InvoiceTotals, source: CounterValueSource): DecimalString {
  return usdCounterValue(totals.total, source.rate);
}

/** `CAL-AAAAMMJJ-<cas>-<mode>` : hors de toute série de facturation (ADR-0024 § 7.2). */
export function calibrationRn(caseId: string, mode: 'ttc' | 'ht', now: Date): string {
  const d = now.toISOString().slice(0, 10).replaceAll('-', '');
  return `CAL-${d}-${caseId}-${mode}`;
}

export interface CalibrationRequestContext {
  nif: string;
  isf: string;
  rn: string;
  rates: TaxRateTable;
  clientTypeDesc: string | null;
  counterValue: CounterValueSource | null;
}

/**
 * Requête minimale d'un cas. Les montants dépendant de la politique (taxe
 * spécifique de ligne, paiement) sont ceux de la politique par défaut
 * `DGI_ROUNDING_POLICY`, comme pour une vraie facture. Le corps est validé par le
 * schéma du contrat avant tout envoi.
 */
export function buildCalibrationRequest(
  c: CalibrationCase,
  ctx: CalibrationRequestContext,
): EdefInvoiceRequest {
  const computed = computeInvoiceTotals({
    ...c.input,
    rates: ctx.rates,
    policy: DGI_ROUNDING_POLICY,
  });
  if (!computed.ok) throw new Error(`Cas ${c.id} : calcul refusé par le moteur.`);
  const totals = computed.totals;

  const body: EdefInvoiceRequest = {
    nif: ctx.nif,
    rn: ctx.rn,
    mode: c.input.priceMode,
    isf: ctx.isf,
    type: 'FV',
    items: c.input.lines.map((line, i) => {
      const lineTotals = totals.lines[i];
      const item: EdefInvoiceRequest['items'][number] = {
        code: `CAL-${i + 1}`,
        name: `Étalonnage ${c.baseCaseId} ligne ${i + 1}`,
        type: line.itemType,
        price: decimalToJsonNumber(line.unitPrice),
        quantity: decimalToJsonNumber(line.quantity),
        taxGroup: line.taxGroup,
      };
      if (line.specificTax && lineTotals?.specificTaxValue) {
        item.taxSpecificValue = lineTotals.specificTaxValue;
        item.taxSpecificAmount = decimalToJsonNumber(lineTotals.specificTaxAmount);
      }
      return item;
    }),
    client: ctx.clientTypeDesc ? { type: 'PP', typeDesc: ctx.clientTypeDesc } : { type: 'PP' },
    operator: { name: 'Étalonnage Lalanda' },
    payment: [{ name: 'ESPECES', amount: decimalToJsonNumber(totals.total) }],
    cmta: `Étalonnage des arrondis, cas ${c.id} — facture de test annulée aussitôt.`,
  };
  if (ctx.counterValue) {
    body.curCode = 'USD';
    body.curRate = ctx.counterValue.rateJson;
    body.curDate = ctx.counterValue.date;
  }
  return EdefInvoiceRequestSchema.parse(body);
}
