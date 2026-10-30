// Contrats des absences (ADR-0045 § 2.5 à § 2.7, § 3.3). ADR-0045 — H3.
import { describe, expect, it } from 'vitest';

import {
  CreateLeaveLedgerEntryBody,
  CreateLeaveRequestBody,
  CreateLeaveTypeBody,
  UpdateHrSettingsBody,
  hrLeaveAgendaId,
} from './leave.js';

const codes = (r: { success: boolean; error?: { issues: { params?: unknown }[] } }) =>
  (r.error?.issues ?? []).map((i) => (i.params as { code?: string } | undefined)?.code);

describe('contrats des absences', () => {
  it('type créé sans droit par défaut (`accrual: none`) ; corps strict', () => {
    const t = CreateLeaveTypeBody.parse({ label: 'Formation' });
    expect(t).toMatchObject({
      accrual: { kind: 'none' },
      deductsFromBalance: false,
      hrOnly: false,
    });
    expect(CreateLeaveTypeBody.safeParse({ label: 'X', droits: 30 }).success).toBe(false);
    // Jours d'acquisition : chaîne, jamais nombre ; 60 au plus.
    expect(
      codes(CreateLeaveTypeBody.safeParse({ label: 'X', accrual: { kind: 'monthly', days: 2 } })),
    ).toContain('DECIMAL_MUST_BE_STRING');
    expect(
      codes(
        CreateLeaveTypeBody.safeParse({ label: 'X', accrual: { kind: 'monthly', days: '61' } }),
      ),
    ).toContain('DAYS_TOO_LARGE');
  });

  it('demande : la fin ne précède pas le début, à la demi-journée près ; 366 jours au plus', () => {
    const id = 'a'.repeat(24);
    const ok = CreateLeaveRequestBody.safeParse({
      typeId: id,
      start: { date: '2027-03-01', half: 'pm' },
      end: { date: '2027-03-01', half: 'pm' },
    });
    expect(ok.success).toBe(true);
    expect(
      codes(
        CreateLeaveRequestBody.safeParse({
          typeId: id,
          start: { date: '2027-03-01', half: 'pm' },
          end: { date: '2027-03-01', half: 'am' },
        }),
      ),
    ).toContain('LEAVE_END_BEFORE_START');
    expect(
      codes(
        CreateLeaveRequestBody.safeParse({
          typeId: id,
          start: { date: '2027-01-01', half: 'full' },
          end: { date: '2028-01-03', half: 'full' },
        }),
      ),
    ).toContain('LEAVE_TOO_LONG');
  });

  it('grand livre : attribution ou ajustement signé, non nul, note obligatoire', () => {
    const base = {
      employeeId: 'b'.repeat(24),
      typeId: 'c'.repeat(24),
      kind: 'adjustment',
      days: '-1.5',
      effectiveOn: '2027-01-01',
      note: 'Correction',
    };
    expect(CreateLeaveLedgerEntryBody.parse(base).days).toBe('-1.50');
    expect(CreateLeaveLedgerEntryBody.safeParse({ ...base, kind: 'taken' }).success).toBe(false);
    expect(codes(CreateLeaveLedgerEntryBody.safeParse({ ...base, days: '0' }))).toContain(
      'DAYS_ZERO',
    );
    expect(CreateLeaveLedgerEntryBody.safeParse({ ...base, note: '' }).success).toBe(false);
  });

  it('réglages : le circuit n’est pas dans `PUT /hr/settings` ; clés de contrat uniques', () => {
    expect(
      UpdateHrSettingsBody.safeParse({ expectedRevision: 0, approvalFlow: 'hr_only' }).success,
    ).toBe(false);
    const dup = UpdateHrSettingsBody.safeParse({
      expectedRevision: 0,
      contractTypes: [
        { key: 'a', label: 'A', hasEndDate: false, active: true },
        { key: 'a', label: 'B', hasEndDate: false, active: true },
      ],
    });
    expect(codes(dup)).toContain('CONTRACT_TYPE_DUPLICATE');
    expect(hrLeaveAgendaId('r1')).toBe('hr:leave:r1');
  });
});
