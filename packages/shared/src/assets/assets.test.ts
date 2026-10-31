import { describe, expect, it } from 'vitest';

import {
  ASSET_DEFAULT_CATEGORIES,
  ASSET_MANAGEMENT_ESTIMATE_LABEL,
  ASSET_NUMBER_PATTERN,
  ASSET_SETTINGS_DEFAULTS,
  ASSET_STATUSES,
  AssetAmount,
  AssetAssigneeSchema,
  AssetManagementDepreciationSchema,
  AssetMaintenanceRecurrenceSchema,
  EXPIRY_STATUSES,
} from './index.js';

type Issues = { issues: { params?: { code?: string }; message: string }[] };
const codes = (r: { success: boolean; error?: unknown }): string[] =>
  r.success ? [] : (r.error as Issues).issues.map((i) => i.params?.code ?? i.message);

describe('équipements — constantes (ADR-0046 § 3)', () => {
  it('statuts, numéro non annuel, échéances', () => {
    expect(ASSET_STATUSES).toContain('disposed');
    expect(ASSET_NUMBER_PATTERN.test('EQ-000001')).toBe(true);
    expect(ASSET_NUMBER_PATTERN.test('EQ2610-000001')).toBe(false);
    expect([...EXPIRY_STATUSES]).toEqual(['expired', 'due_soon', 'ok']);
  });

  it('catégories proposées sans durée ; réglages par défaut', () => {
    expect(ASSET_DEFAULT_CATEGORIES).toHaveLength(6);
    expect(ASSET_SETTINGS_DEFAULTS).toEqual({
      reminderDays: 30,
      maintenanceDueSoonDays: 7,
      showDepreciationEstimate: true,
    });
  });

  it('l’estimation est étiquetée comme telle (O7)', () => {
    expect(ASSET_MANAGEMENT_ESTIMATE_LABEL).toContain('Estimation de gestion');
    expect(ASSET_MANAGEMENT_ESTIMATE_LABEL).toContain(
      'n’est pas un amortissement comptable ou fiscal',
    );
  });
});

describe('équipements — briques de schéma', () => {
  it('estimation : durée 1 à 50 ans saisie, aucune valeur par défaut', () => {
    expect(
      AssetManagementDepreciationSchema.parse({
        years: 3,
        residualValue: '0',
        startOn: '2026-01-15',
      }),
    ).toEqual({ years: 3, residualValue: '0.00', startOn: '2026-01-15' });
    expect(
      AssetManagementDepreciationSchema.safeParse({
        years: 0,
        residualValue: '0',
        startOn: '2026-01-15',
      }).success,
    ).toBe(false);
    expect(
      AssetManagementDepreciationSchema.safeParse({ residualValue: '0', startOn: '2026-01-15' })
        .success,
    ).toBe(false);
  });

  it('affectation : quatre natures, strictes', () => {
    expect(AssetAssigneeSchema.parse({ kind: 'employee', employeeId: 'A'.repeat(24) })).toEqual({
      kind: 'employee',
      employeeId: 'a'.repeat(24),
    });
    expect(
      AssetAssigneeSchema.safeParse({ kind: 'employee', workProjectId: 'a'.repeat(24) }).success,
    ).toBe(false);
    expect(
      AssetAssigneeSchema.safeParse({ kind: 'supplier', supplierId: 'a'.repeat(24) }).success,
    ).toBe(false);
  });

  it('montants en chaînes ; récurrence de 1 à 60 mois', () => {
    expect(AssetAmount.parse('1200')).toBe('1200.00');
    expect(codes(AssetAmount.safeParse(1200))).toEqual(['DECIMAL_MUST_BE_STRING']);
    expect(AssetMaintenanceRecurrenceSchema.safeParse({ everyMonths: 6 }).success).toBe(true);
    expect(AssetMaintenanceRecurrenceSchema.safeParse({ everyMonths: 61 }).success).toBe(false);
  });
});
