// Test verrou du relevé d'étalonnage — ADR-0024 § 7.3 (chantier F4).
//
// 1. `ROUNDING_CALIBRATION.policyId === DGI_ROUNDING_POLICY.id` : le relevé décrit
//    la politique réellement appliquée aux factures.
// 2. Chaque cas du relevé se recalcule À L'IDENTIQUE des totaux reçus de la DGI
//    (`dgiTotals`) sous cette politique : si l'on change la politique ou le
//    calcul sans refaire l'étalonnage, ce test échoue.
// 3. Un relevé `calibrated` est complet : date, source, empreinte du rapport,
//    au moins un cas.
//
// Tant que le relevé est `not_calibrated` (livraison F0), il ne porte aucun cas :
// seules les règles 1 et la forme sont vérifiées.

import { describe, expect, it } from 'vitest';

import { DGI_ROUNDING_POLICY, computeInvoiceTotals } from './compute.js';
import { usdCounterValue } from './currency.js';
import { compareWithEdefResponse } from './edef-shape.js';
import { INVOICE_TOTALS_REFERENCE_CASES } from './reference-cases.js';
import { ROUNDING_CALIBRATION, type RoundingCalibrationRecord } from './rounding-calibration.js';
import { TAX_GROUP_LETTERS, type TaxGroupLetter, type TaxRateTable } from './types.js';

/** Cas de contre-valeur de l'outil (`apps/api/src/edef/calibration`) : facture modèle + curTotal. */
const COUNTER_VALUE_CASE = { id: 'devise-contre-valeur', base: 'dgi-modele' } as const;

/** « 1.40 » et « 1.4 » sont le même montant (nombre JSON reçu). */
function canonical(v: string): string {
  return v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v;
}

/** Différences entre le relevé et notre calcul sous la politique en vigueur. */
function recordDifferences(record: RoundingCalibrationRecord): string[] {
  const problems: string[] = [];
  for (const c of record.cases) {
    const baseId = c.caseId === COUNTER_VALUE_CASE.id ? COUNTER_VALUE_CASE.base : c.caseId;
    const reference = INVOICE_TOTALS_REFERENCE_CASES.find((r) => r.id === baseId);
    if (!reference) {
      problems.push(`${c.caseId} : cas de référence inconnu`);
      continue;
    }
    if (reference.input.priceMode !== c.priceMode) {
      problems.push(`${c.caseId} : mode ${c.priceMode} ≠ ${reference.input.priceMode}`);
      continue;
    }
    // Taux : ceux que la DGI a renvoyés pour les groupes du cas.
    const rates: Partial<Record<TaxGroupLetter, string>> = {};
    const used = new Set(reference.input.lines.map((l) => l.taxGroup));
    for (const g of TAX_GROUP_LETTERS.filter((x) => used.has(x))) {
      const rate = c.dgiTotals[`t${g.toLowerCase()}`];
      if (rate === undefined) problems.push(`${c.caseId} : taux du groupe ${g} absent du relevé`);
      else rates[g] = rate;
    }
    const computed = computeInvoiceTotals({
      ...reference.input,
      rates: rates as TaxRateTable,
      policy: DGI_ROUNDING_POLICY,
    });
    if (!computed.ok) {
      problems.push(`${c.caseId} : calcul refusé par le moteur`);
      continue;
    }
    const { differences } = compareWithEdefResponse(computed.totals, rates, c.dgiTotals);
    for (const d of differences) problems.push(`${c.caseId} : ${d.field} ${d.ours} ≠ ${d.dgi}`);
    if (c.caseId === COUNTER_VALUE_CASE.id) {
      const curRate = c.dgiTotals['curRate'];
      const curTotal = c.dgiTotals['curTotal'];
      if (!curRate || !curTotal) {
        problems.push(`${c.caseId} : curRate ou curTotal absent du relevé`);
      } else if (
        canonical(usdCounterValue(computed.totals.total, curRate)) !== canonical(curTotal)
      ) {
        problems.push(`${c.caseId} : curTotal ≠ ${curTotal}`);
      }
    }
    if (!c.matchedPolicies.length) problems.push(`${c.caseId} : aucune politique retenue`);
  }
  return problems;
}

describe('relevé d’étalonnage des arrondis (verrou ADR-0024 § 7.3)', () => {
  it('décrit la politique réellement appliquée', () => {
    expect(ROUNDING_CALIBRATION.policyId).toBe(DGI_ROUNDING_POLICY.id);
    expect(ROUNDING_CALIBRATION.environment).toBe('test');
    expect(Object.isFrozen(ROUNDING_CALIBRATION)).toBe(true);
  });

  it('chaque cas du relevé se recalcule à l’identique des totaux DGI', () => {
    expect(recordDifferences(ROUNDING_CALIBRATION)).toEqual([]);
  });

  it('un relevé « calibrated » est complet ; « not_calibrated » ne porte aucun cas', () => {
    const r = ROUNDING_CALIBRATION;
    if (r.status === 'calibrated') {
      expect(r.calibratedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.reportSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(r.source).toContain(r.reportSha256 as string);
      expect(r.cases.length).toBeGreaterThan(0);
    } else {
      expect(r.calibratedAt).toBeNull();
      expect(r.reportSha256).toBeNull();
      expect(r.cases).toEqual([]);
    }
  });

  it('le verrou détecte un relevé qui ne correspond plus au calcul', () => {
    const tampered: RoundingCalibrationRecord = {
      ...ROUNDING_CALIBRATION,
      status: 'calibrated',
      cases: [
        {
          caseId: 'cal-tva-ht',
          priceMode: 'ht',
          matchedPolicies: ['cal-per-line-vat-half-up'],
          // TVA « au plus proche » : 68,96 — la politique par défaut donne 68,97.
          dgiTotals: {
            tb: '16',
            tab: '499.99',
            hab: '431.03',
            vab: '68.96',
            total: '499.99',
            vtotal: '68.96',
          },
        },
      ],
    };
    expect(recordDifferences(tampered)).toEqual(
      expect.arrayContaining([expect.stringContaining('vab 68.97 ≠ 68.96')]),
    );
  });

  it('accepte un relevé fidèle, contre-valeur comprise', () => {
    const faithful: RoundingCalibrationRecord = {
      ...ROUNDING_CALIBRATION,
      cases: [
        {
          caseId: 'devise-contre-valeur',
          priceMode: 'ttc',
          matchedPolicies: [DGI_ROUNDING_POLICY.id],
          dgiTotals: {
            ta: '0',
            tb: '16',
            taa: '3600',
            tab: '464',
            haa: '3600',
            hab: '400',
            vaa: '0',
            vab: '64',
            total: '4064',
            vtotal: '64',
            curTotal: '1.36',
            curRate: '2987.33',
          },
        },
      ],
    };
    expect(recordDifferences(faithful)).toEqual([]);
  });
});
