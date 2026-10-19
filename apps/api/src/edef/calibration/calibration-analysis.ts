// Analyse d'un étalonnage — ADR-0024 § 7.3 (chantier F4).
//
// Compare les totaux renvoyés par la DGI à notre calcul sous chacune des quatre
// politiques candidates, applique la règle de choix, et prépare la PROPOSITION
// de relevé `ROUNDING_CALIBRATION`. L'outil n'écrit jamais ce relevé : une
// personne le recopie, le relit et le commite (ADR-0024 § 7.3).
//
// Règle de choix : la politique retenue est celle des quatre qui donne zéro
// différence sur TOUS les cas décisifs envoyés (cas `calibration` et cas
// fiables). Une seule → proposée. Aucune ou plusieurs → « non décidé ».

import {
  CALIBRATION_ROUNDING_POLICIES,
  DGI_ROUNDING_POLICY,
  EDEF_TOTALS_FIELDS,
  compareWithEdefResponse,
  decimalFromJsonNumber,
  isValidDecimal,
  toEdefTotals,
  type DecimalString,
  type InvoiceTotals,
  type TaxRateTable,
  type TotalsDifference,
} from '@lalanda/engine';

import type { CounterValueSource } from './calibration-cases.js';
import { expectedCurTotal } from './calibration-cases.js';

export interface PolicyComparison {
  policyId: string;
  identical: boolean;
  differences: readonly TotalsDifference[];
}

/** Valeur reçue de la DGI, en texte tel que reçu (un nombre JSON par sa forme la plus courte). */
export function receivedText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function sameAmount(ours: DecimalString, received: unknown): boolean {
  let text: string | null = null;
  if (typeof received === 'number') text = decimalFromJsonNumber(received);
  else if (typeof received === 'string' && isValidDecimal(received, 2)) text = received;
  if (text === null) return false;
  const cents = (v: string): bigint => {
    const [i = '0', f = ''] = v.split('.');
    return BigInt(i) * 100n + BigInt((f + '00').slice(0, 2));
  };
  return cents(ours) === cents(text);
}

/**
 * Compare la réponse brute du `POST` à nos totaux sous chaque politique, avec
 * `compareWithEdefResponse` du moteur (jamais d'arrondi pour « faire
 * coïncider »). Pour le cas de contre-valeur, `curTotal` est comparé en plus.
 */
export function compareUnderPolicies(
  predicted: readonly { policyId: string; totals: InvoiceTotals }[],
  rates: TaxRateTable,
  raw: Readonly<Record<string, unknown>>,
  counterValue: CounterValueSource | null,
): { comparisons: PolicyComparison[]; matchedPolicies: string[] } {
  const comparisons = predicted.map(({ policyId, totals }) => {
    const { differences } = compareWithEdefResponse(totals, rates, raw);
    const all: TotalsDifference[] = [...differences];
    if (counterValue) {
      const ours = expectedCurTotal(totals, counterValue);
      if (!sameAmount(ours, raw['curTotal'])) {
        all.push({ field: 'curTotal', ours, dgi: receivedText(raw['curTotal']) });
      }
    }
    return { policyId, identical: all.length === 0, differences: all };
  });
  return {
    comparisons,
    matchedPolicies: comparisons.filter((c) => c.identical).map((c) => c.policyId),
  };
}

/** Nos totaux au format e-DEF, par politique (pour le rapport). */
export function oursByPolicy(
  predicted: readonly { policyId: string; totals: InvoiceTotals }[],
  rates: TaxRateTable,
  counterValue: CounterValueSource | null,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const { policyId, totals } of predicted) {
    const edef = toEdefTotals(totals, rates) as Record<string, string | null>;
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(edef)) if (v !== null) fields[k] = v;
    if (counterValue) fields['curTotal'] = expectedCurTotal(totals, counterValue);
    out[policyId] = fields;
  }
  return out;
}

/**
 * Champs comparés, TELS QUE REÇUS (forme du relevé `dgiTotals`). Pour le cas de
 * contre-valeur, `curRate` (le taux ENVOYÉ, tel que reçu de la liste
 * `currencyRates`) est ajouté : sans lui, `curTotal` ne se recalculerait pas.
 */
export function dgiTotalsAsReceived(
  raw: Readonly<Record<string, unknown>>,
  counterValue: CounterValueSource | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  const fields: string[] = [...EDEF_TOTALS_FIELDS, ...(counterValue ? ['curTotal'] : [])];
  for (const field of fields) {
    const text = receivedText(raw[field]);
    if (text !== null) out[field] = text;
  }
  if (counterValue) out['curRate'] = counterValue.rate;
  return out;
}

// ── Règle de choix ───────────────────────────────────────────────────────────

export type CaseStatus = 'compared' | 'skipped' | 'refused' | 'no_response' | 'not_sent';

export interface CaseOutcomeForVerdict {
  id: string;
  decisive: boolean;
  status: CaseStatus;
  matchedPolicies?: readonly string[];
}

export type Verdict =
  | { decided: true; policyId: string; reason: string }
  | {
      decided: false;
      /** Politiques sans différence sur tous les cas décisifs comparés. */
      candidates: string[];
      /** Mêmes candidates, en écartant les cas où AUCUNE politique ne convient. */
      candidatesIgnoringOutsidePolicy: string[];
      reason: string;
    };

function intersect(sets: readonly (readonly string[])[]): string[] {
  const all = CALIBRATION_ROUNDING_POLICIES.map((p) => p.id);
  return all.filter((id) => sets.every((s) => s.includes(id)));
}

export function decideVerdict(outcomes: readonly CaseOutcomeForVerdict[]): Verdict {
  const decisive = outcomes.filter((o) => o.decisive);
  const compared = decisive.filter((o) => o.status === 'compared');
  const missing = decisive.filter((o) => o.status !== 'compared');
  const outsidePolicy = compared.filter((o) => (o.matchedPolicies ?? []).length === 0);

  const candidates = intersect(compared.map((o) => o.matchedPolicies ?? []));
  const candidatesIgnoringOutsidePolicy = intersect(
    compared.filter((o) => !outsidePolicy.includes(o)).map((o) => o.matchedPolicies ?? []),
  );
  const undecided = (reason: string): Verdict => ({
    decided: false,
    candidates: compared.length ? candidates : [],
    candidatesIgnoringOutsidePolicy: compared.length ? candidatesIgnoringOutsidePolicy : [],
    reason,
  });

  if (compared.length === 0) return undecided('Aucun cas décisif n’a pu être comparé.');
  if (missing.length > 0) {
    return undecided(
      `Étalonnage incomplet : ${missing.length} cas décisif(s) sans comparaison (${missing
        .map((o) => o.id)
        .join(', ')}). Aucune politique n’est proposée sur une base partielle.`,
    );
  }
  if (outsidePolicy.length > 0) {
    return undecided(
      `Écart que AUCUNE des quatre politiques n’explique sur : ${outsidePolicy
        .map((o) => o.id)
        .join(', ')}. C’est une correction du moteur (ADR-0024 § 7.3), à traiter avant tout choix.`,
    );
  }
  if (candidates.length === 1) {
    const policyId = candidates[0]!;
    return {
      decided: true,
      policyId,
      reason: `Seule politique sans aucune différence sur les ${compared.length} cas décisifs.`,
    };
  }
  if (candidates.length === 0) {
    return undecided(
      'Aucune politique ne reproduit tous les cas décisifs à la fois : le CTO tranche par écrit et la question part à la DGI.',
    );
  }
  return undecided(
    `Plusieurs politiques reproduisent tous les cas (${candidates.join(', ')}) : les cas ne les départagent pas. Le CTO tranche par écrit.`,
  );
}

// ── Proposition de relevé ────────────────────────────────────────────────────

export interface RecordCase {
  caseId: string;
  priceMode: 'ttc' | 'ht';
  matchedPolicies: readonly string[];
  dgiTotals: Readonly<Record<string, string>>;
}

/**
 * Texte proposé pour `packages/engine/src/invoice-totals/rounding-calibration.ts`,
 * ou `null` si aucune politique n'est décidée. JAMAIS écrit par l'outil.
 */
export function proposeCalibrationRecord(input: {
  verdict: Verdict;
  cases: readonly RecordCase[];
  calibratedAt: string;
  reportSha256: string;
}): { text: string; requiresNewPolicy: boolean } | null {
  const { verdict } = input;
  if (!verdict.decided) return null;
  const policy = CALIBRATION_ROUNDING_POLICIES.find((p) => p.id === verdict.policyId);
  if (!policy) return null;
  const requiresNewPolicy = policy.id !== DGI_ROUNDING_POLICY.id;
  const policyId = requiresNewPolicy ? 'dgi-cd-2026.2' : policy.id;

  const q = (v: string): string => JSON.stringify(v).replaceAll('"', "'");
  const cases = input.cases
    .map((c) => {
      const totals = Object.entries(c.dgiTotals)
        .map(([k, v]) => `        ${k}: ${q(v)},`)
        .join('\n');
      return [
        '    {',
        `      caseId: ${q(c.caseId)},`,
        `      priceMode: ${q(c.priceMode)},`,
        `      matchedPolicies: [${c.matchedPolicies.map(q).join(', ')}],`,
        '      dgiTotals: {',
        totals,
        '      },',
        '    },',
      ].join('\n');
    })
    .join('\n');

  const header = requiresNewPolicy
    ? [
        `// ATTENTION : la politique observée (${policy.id} : lineAmount '${policy.lineAmount}', vat '${policy.vat}')`,
        `// n'est PAS la politique par défaut (${DGI_ROUNDING_POLICY.id}). Avant de recopier ce relevé :`,
        `// DGI_ROUNDING_POLICY devient { id: 'dgi-cd-2026.2', lineAmount: '${policy.lineAmount}', vat: '${policy.vat}' }`,
        "// et INVOICE_TOTALS_VERSION passe à '1.1.0' (ADR-0022, ADR-0024 § 7.3), revue CTO.",
      ].join('\n')
    : `// Politique observée = politique par défaut (${policy.id}) : seul le relevé change.`;

  const text = [
    '// PROPOSITION produite par l’outil d’étalonnage (ADR-0024 § 7). À relire et',
    '// recopier À LA MAIN dans packages/engine/src/invoice-totals/rounding-calibration.ts.',
    header,
    'export const ROUNDING_CALIBRATION: RoundingCalibrationRecord = Object.freeze({',
    "  status: 'calibrated',",
    `  policyId: ${q(policyId)},`,
    `  calibratedAt: ${q(input.calibratedAt)},`,
    "  environment: 'test',",
    `  source: ${q(`Étalonnage e-DEF test du ${input.calibratedAt}, rapport sha256 ${input.reportSha256} (outil apps/api/src/edef/calibration, ADR-0024 § 7).`)},`,
    `  reportSha256: ${q(input.reportSha256)},`,
    '  cases: Object.freeze([',
    cases,
    '  ]),',
    '});',
    '',
  ].join('\n');
  return { text, requiresNewPolicy };
}
