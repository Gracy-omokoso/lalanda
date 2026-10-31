import { describe, expect, it } from 'vitest';

import {
  AssignAssetBody,
  CompleteMaintenanceBody,
  CreateAssetBody,
  CreateCoverageBody,
  CreateMaintenanceBody,
  DisposeAssetBody,
  UpdateAssetSettingsBody,
} from './index.js';

type Issues = { issues: { params?: { code?: string }; message: string }[] };
const codes = (r: { success: boolean; error?: unknown }): string[] =>
  r.success ? [] : (r.error as Issues).issues.map((i) => i.params?.code ?? i.message);

const ID = 'a'.repeat(24);

describe('équipements — contrats HTTP (ADR-0046 — S5)', () => {
  it('fiche : coût en chaîne, estimation facultative, corps strict', () => {
    const base = {
      name: ' Portable ',
      categoryId: ID,
      acquisition: { on: '2026-01-15', cost: '1200', currency: 'USD' },
    };
    const parsed = CreateAssetBody.parse(base);
    expect(parsed.name).toBe('Portable');
    expect(parsed.acquisition.cost).toBe('1200.00');
    expect(parsed.managementDepreciation).toBeUndefined();
    expect(CreateAssetBody.safeParse({ ...base, organizationId: 'x' }).success).toBe(false);
    expect(
      codes(CreateAssetBody.safeParse({ ...base, acquisition: { ...base.acquisition, cost: 1 } })),
    ).toContain('DECIMAL_MUST_BE_STRING');
  });

  it('cession déclarée : un prix exige sa devise', () => {
    expect(
      codes(
        DisposeAssetBody.safeParse({
          expectedRevision: 1,
          on: '2026-10-01',
          kind: 'sold',
          proceeds: '100',
          reason: 'Vendu',
        }),
      ),
    ).toContain('CURRENCY_REQUIRED');
  });

  it('affectation, maintenance, couverture, réglages', () => {
    expect(
      AssignAssetBody.safeParse({
        expectedRevision: 1,
        assignee: { kind: 'employee', employeeId: ID },
      }).success,
    ).toBe(true);
    expect(
      codes(
        CreateMaintenanceBody.safeParse({
          kind: 'corrective',
          recurrence: { everyMonths: 6 },
          plannedOn: '2026-01-01',
        }),
      ),
    ).toContain('RECURRENCE_PREVENTIVE_ONLY');
    expect(codes(CreateMaintenanceBody.safeParse({ kind: 'preventive' }))).toContain(
      'FIELD_REQUIRED',
    );
    expect(
      codes(
        CompleteMaintenanceBody.safeParse({ expectedRevision: 1, doneOn: '2026-01-01', cost: '5' }),
      ),
    ).toContain('CURRENCY_REQUIRED');
    expect(
      codes(
        CreateCoverageBody.safeParse({
          kind: 'warranty',
          provider: 'X',
          startOn: '2026-02-01',
          endOn: '2026-01-01',
        }),
      ),
    ).toContain('END_BEFORE_START');
    expect(
      UpdateAssetSettingsBody.safeParse({ expectedRevision: 0, reminderDays: 121 }).success,
    ).toBe(false);
  });
});
