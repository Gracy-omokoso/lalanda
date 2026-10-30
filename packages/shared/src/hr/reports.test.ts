// Rapports RH (ADR-0045 § 3.3). ADR-0045 — H5.

import { describe, expect, it } from 'vitest';

import { HrRegisterExportQuery, HrReportsQuery } from './reports.js';

describe('HrReportsQuery (ADR-0045 § 3.3)', () => {
  it('période valide, inversée ou trop longue ; corps strict', () => {
    expect(HrReportsQuery.safeParse({ from: '2026-01-01', to: '2026-12-31' }).success).toBe(true);
    expect(HrReportsQuery.safeParse({ from: '2026-02-01', to: '2026-01-01' }).success).toBe(false);
    expect(HrReportsQuery.safeParse({ from: '2000-01-01', to: '2026-01-01' }).success).toBe(false);
    expect(
      HrReportsQuery.safeParse({ from: '2026-01-01', to: '2026-01-31', salaire: '1' }).success,
    ).toBe(false);
    expect(HrRegisterExportQuery.safeParse({ departmentId: 'x' }).success).toBe(false);
  });
});
