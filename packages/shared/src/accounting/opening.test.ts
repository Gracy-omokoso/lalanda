// Contrats de la reprise de l'existant (ADR-0049 § 3.2). ADR-0049 — K7.

import { describe, expect, it } from 'vitest';

import { CreateAccountingOpeningBody, ValidateAccountingOpeningBody } from './opening.js';

describe('reprise — contrats', () => {
  it('une ligne porte un débit OU un crédit ; compte du plan ou compte d’attente', () => {
    const ok = CreateAccountingOpeningBody.safeParse({
      reason: 'Reprise',
      exclude: ['treasury:abc'],
      lines: [
        { accountNumber: 'ATTENTE', credit: '10' },
        { accountNumber: '521', currency: 'USD', debit: '1.50' },
      ],
    });
    expect(ok.success).toBe(true);
    expect(ok.data?.lines[0]?.credit).toBe('10.00');
    for (const line of [
      { accountNumber: '521', debit: '1.00', credit: '1.00' },
      { accountNumber: '521' },
      { accountNumber: 'CAPITAL', debit: '1.00' },
      { accountNumber: '521', debit: '-1.00' },
      { accountNumber: '521', currency: 'EUR', debit: '1.00' },
    ]) {
      expect(
        CreateAccountingOpeningBody.safeParse({ reason: 'R', lines: [line] }).success,
        JSON.stringify(line),
      ).toBe(false);
    }
  });

  it('motif obligatoire, champs inconnus refusés', () => {
    expect(CreateAccountingOpeningBody.safeParse({ reason: ' ', lines: [] }).success).toBe(false);
    expect(
      CreateAccountingOpeningBody.safeParse({ reason: 'R', lines: [], date: '2026-10-01' }).success,
    ).toBe(false);
    expect(ValidateAccountingOpeningBody.safeParse({ expectedRevision: 1 }).success).toBe(true);
    expect(ValidateAccountingOpeningBody.safeParse({}).success).toBe(false);
  });
});
