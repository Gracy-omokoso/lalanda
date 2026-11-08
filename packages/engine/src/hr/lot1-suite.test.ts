import { describe, expect, it } from 'vitest';

import { positionChangeCheck, resolveImportManagers, type ImportManagerRow } from './lot1-suite.js';

describe('positionChangeCheck', () => {
  it('refuse une date avant l’entrée ou avant l’occupation actuelle', () => {
    expect(
      positionChangeCheck({
        startDate: '2024-01-01',
        currentHoldingFrom: null,
        effectiveDate: '2023-12-31',
      }).issue,
    ).toBe('DATE_BEFORE_START');
    expect(
      positionChangeCheck({
        startDate: '2024-01-01',
        currentHoldingFrom: '2025-06-01',
        effectiveDate: '2025-05-31',
      }).issue,
    ).toBe('DATE_BEFORE_CURRENT_HOLDING');
    expect(
      positionChangeCheck({
        startDate: '2024-01-01',
        currentHoldingFrom: '2025-06-01',
        effectiveDate: '2025-06-01',
      }),
    ).toMatchObject({ ok: true, issue: null });
  });
});

describe('resolveImportManagers', () => {
  const existing = [
    {
      id: 'e1',
      managerEmployeeId: null,
      employeeNumber: 'GF-0001',
      workEmail: 'Chef@x.cd',
      active: true,
    },
    {
      id: 'e2',
      managerEmployeeId: 'e1',
      employeeNumber: 'GF-0002',
      workEmail: null,
      active: false,
    },
  ];
  const row = (r: number, p: Partial<ImportManagerRow> = {}): ImportManagerRow => ({
    row: r,
    valid: true,
    employeeNumber: null,
    workEmail: null,
    managerRef: null,
    ...p,
  });

  it('existant par matricule ou e-mail, ligne du fichier, inconnu, inactif, soi-même', () => {
    const { verdicts } = resolveImportManagers(existing, [
      row(2, { managerRef: 'gf 0001' }),
      row(3, { managerRef: 'chef@X.cd' }),
      row(4, { employeeNumber: 'GF-0100', managerRef: 'GF-0101' }),
      row(5, { employeeNumber: 'GF-0101' }),
      row(6, { managerRef: 'GF-9999' }),
      row(7, { managerRef: 'GF-0002' }),
      row(8, { employeeNumber: 'GF-0300', managerRef: 'GF-0300' }),
    ]);
    expect(verdicts.map((v) => v.kind)).toEqual([
      'existing',
      'existing',
      'row',
      'none',
      'error',
      'error',
      'error',
    ]);
    expect(verdicts[2]).toMatchObject({ managerRow: 5 });
    expect(verdicts.slice(4).map((v) => (v.kind === 'error' ? v.issue : null))).toEqual([
      'MANAGER_NOT_FOUND',
      'MANAGER_NOT_ACTIVE',
      'MANAGER_SELF',
    ]);
  });

  it('refuse les cycles entre lignes et propage les lignes écartées', () => {
    const { verdicts } = resolveImportManagers(existing, [
      row(2, { workEmail: 'a@x.cd', managerRef: 'b@x.cd' }),
      row(3, { workEmail: 'b@x.cd', managerRef: 'a@x.cd' }),
      row(4, { workEmail: 'c@x.cd', managerRef: 'd@x.cd' }),
      row(5, { workEmail: 'd@x.cd', valid: false }),
      row(6, { managerRef: 'c@x.cd' }),
      row(7, { workEmail: 'dup@x.cd' }),
      row(8, { workEmail: 'dup@x.cd' }),
      row(9, { managerRef: 'dup@x.cd' }),
    ]);
    const issues = verdicts.map((v) => (v.kind === 'error' ? v.issue : v.kind));
    expect(issues).toEqual([
      'MANAGER_CYCLE',
      'MANAGER_CYCLE',
      'MANAGER_ROW_INVALID',
      'none',
      'MANAGER_ROW_INVALID',
      'none',
      'none',
      'MANAGER_AMBIGUOUS',
    ]);
  });
});
