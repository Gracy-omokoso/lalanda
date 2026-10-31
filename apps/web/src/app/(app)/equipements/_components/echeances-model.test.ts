// Échéances, rapports et réglages des équipements (ADR-0046 § 3.4, § 3.5).

import { describe, expect, it } from 'vitest';

import type { AssetDeadlineView } from '@/lib/api-assets';

import {
  grouperEcheances,
  lignesDevises,
  phraseDelai,
  preparerReglages,
  tonEcheance,
} from './echeances-model';

const e = (kind: AssetDeadlineView['kind'], daysLeft: number): AssetDeadlineView => ({
  kind,
  assetId: 'a',
  assetNumber: 'EQ-000001',
  assetName: 'PC',
  refId: null,
  employeeId: null,
  employeeName: null,
  date: '2026-11-01',
  daysLeft,
});

describe('échéances', () => {
  it('regroupées par urgence, groupes vides retirés', () => {
    const g = grouperEcheances([e('coverage_due_soon', 20), e('maintenance_overdue', -3)]);
    expect(g.map((x) => x.kind)).toEqual(['maintenance_overdue', 'coverage_due_soon']);
    expect(tonEcheance('maintenance_overdue')).toBe('danger');
    expect(tonEcheance('coverage_due_soon')).toBe('warning');
  });

  it('délai servi par le moteur, mis en phrase', () => {
    expect(phraseDelai(e('coverage_due_soon', 20))).toBe('dans 20 jours');
    expect(phraseDelai(e('maintenance_overdue', -1))).toBe('il y a 1 jour');
    expect(phraseDelai(e('maintenance_due_soon', 0))).toBe('aujourd’hui');
  });
});

describe('rapports', () => {
  it('une ligne par devise, jamais additionnées', () => {
    expect(
      lignesDevises([
        { currency: 'USD', total: '1200.00', count: 1 },
        { currency: 'CDF', total: '50000.00', count: 2 },
      ]),
    ).toEqual(['1 200,00 USD (1 équipement)', '50 000,00 CDF (2 équipements)']);
    expect(lignesDevises(null)).toEqual([]);
  });
});

describe('réglages', () => {
  it('délais bornés de 0 à 120 jours', () => {
    expect(
      preparerReglages(
        { reminderDays: '30', maintenanceDueSoonDays: '7', showDepreciationEstimate: true },
        0,
      ),
    ).toEqual({
      ok: true,
      corps: {
        expectedRevision: 0,
        reminderDays: 30,
        maintenanceDueSoonDays: 7,
        showDepreciationEstimate: true,
      },
    });
    expect(
      preparerReglages(
        { reminderDays: '400', maintenanceDueSoonDays: 'x', showDepreciationEstimate: false },
        1,
      ).ok,
    ).toBe(false);
  });
});
