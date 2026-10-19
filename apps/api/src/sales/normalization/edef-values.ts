// Lecture des valeurs renvoyées par la DGI — ADR-0024 § 3.4, § 3.5 et § 4.2.
//
// Aucune arithmétique : on CONSERVE les valeurs telles que reçues (chaînes), et
// on compare des décimaux par leur écriture canonique (zéros de fin retirés).
// La comparaison des 67 champs de totaux est celle du moteur
// (`compareWithEdefResponse`) ; ce fichier ne traite que ce que le moteur ne
// couvre pas : `curTotal` et la vérification d'appartenance d'une demande.

import {
  EDEF_TOTALS_FIELDS,
  compareWithEdefResponse,
  decimalFromJsonNumber,
  type InvoiceTotals,
  type TaxRateTable,
} from '@lalanda/engine';

/** Champs de totaux conservés tels que reçus (`normalization.dgiTotals`). */
export const KEPT_DGI_FIELDS: readonly string[] = [...EDEF_TOTALS_FIELDS, 'curTotal'];

/** Valeurs de totaux de la réponse brute, en chaînes TELLES QUE REÇUES. */
export function dgiTotalsAsStrings(raw: Readonly<Record<string, unknown>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of KEPT_DGI_FIELDS) {
    const value = raw[field];
    if (value === undefined || value === null) continue;
    out[field] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return out;
}

/** Écriture canonique d'un décimal (`64.50` → `64.5`, `64.00` → `64`) ; `null` si illisible. */
function canonical(value: unknown): string | null {
  let text: string | null = null;
  if (typeof value === 'number') text = decimalFromJsonNumber(value);
  else if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) text = value;
  if (text === null) return null;
  const [int, frac = ''] = text.split('.');
  const intPart = int!.replace(/^0+(?=\d)/, '');
  const fracPart = frac.replace(/0+$/, '');
  return fracPart === '' ? intPart : `${intPart}.${fracPart}`;
}

/** Même décimal, à l'écriture près. Une valeur illisible n'est jamais égale. */
export function sameDecimal(received: unknown, ours: string): boolean {
  const a = canonical(received);
  return a !== null && a === canonical(ours);
}

export interface Difference {
  field: string;
  ours: string | null;
  dgi: string | null;
}

/**
 * Comparaison complète de la réponse du `POST` : les 67 champs par le moteur,
 * plus `curTotal` quand une contre-valeur USD est transmise (un champ absent
 * vaut 0, comme pour le moteur — donc une différence).
 */
export function compareSubmission(
  ours: InvoiceTotals,
  rates: TaxRateTable,
  raw: Readonly<Record<string, unknown>>,
  counterValueUsd: string | null,
): { identical: boolean; differences: Difference[] } {
  const engine = compareWithEdefResponse(ours, rates, raw);
  const differences: Difference[] = engine.differences.map((d) => ({
    field: d.field,
    ours: d.ours,
    dgi: d.dgi,
  }));
  if (counterValueUsd !== null && !sameDecimal(raw['curTotal'], counterValueUsd)) {
    const received = raw['curTotal'];
    differences.push({
      field: 'curTotal',
      ours: counterValueUsd,
      dgi:
        received === undefined || received === null
          ? null
          : typeof received === 'string'
            ? received
            : JSON.stringify(received),
    });
  }
  return { identical: differences.length === 0, differences };
}
