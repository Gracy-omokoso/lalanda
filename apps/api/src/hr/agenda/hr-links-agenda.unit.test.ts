// Éléments « Mes tâches » des frais, avances et corrections (ADR-0051 § 7.5) et origine
// RH d'une dépense de projet (§ 7.3). ADR-0051 — H14. Fonctions pures.

import { describe, expect, it } from 'vitest';

import type { EmployeeLean } from '../employees/employee.schema.js';
import { expenseReportLineOf } from '../../work/margin/project-margin.service.js';
import { hrLinkItemsOf } from './hr-links-agenda.js';

const employee = (id: string, userId: string | null): [string, EmployeeLean] => [
  id,
  {
    firstName: 'Bea',
    lastName: 'Kanku',
    preferredName: null,
    userId,
    status: 'active',
  } as unknown as EmployeeLean,
];

describe('hrLinkItemsOf (ADR-0051 § 7.5, critère 15)', () => {
  const at = new Date('2026-11-02T23:30:00Z'); // 3 nov. à Kinshasa (UTC+1)
  const links = {
    approvals: [
      {
        entityType: 'advance' as const,
        id: 'a1',
        number: 'AV2611-000002',
        employeeId: 'e1',
        at,
        dueOn: null,
      },
    ],
    toPay: [
      {
        entityType: 'expense_report' as const,
        id: 'r1',
        number: 'NF2611-000004',
        employeeId: 'e1',
        at,
        dueOn: null,
      },
      {
        entityType: 'advance' as const,
        id: 'a2',
        number: 'AV2611-000003',
        employeeId: 'e1',
        at,
        dueOn: null,
      },
    ],
    toSettle: [
      {
        entityType: 'advance' as const,
        id: 'a3',
        number: 'AV2610-000001',
        employeeId: 'e1',
        at,
        dueOn: '2026-10-31',
      },
    ],
    corrections: [{ id: 'c1', employeeId: 'e1', date: '2026-11-01', at }],
    employees: new Map([employee('e1', 'u-bea')]),
  };

  it('quatre natures, sans case à cocher, liens vers les écrans RH, jour de Kinshasa', () => {
    const items = hrLinkItemsOf(links, 'u-other');
    expect(items.map((i) => [i.kind, i.id, i.href, i.dueDate])).toEqual([
      ['expense_approval', 'hr:expense_approval:a1', '/rh/frais?vue=a-valider', '2026-11-03'],
      ['expense_to_pay', 'hr:expense_to_pay:r1', '/rh/frais?vue=a-payer', '2026-11-03'],
      ['expense_to_pay', 'hr:expense_to_pay:a2', '/rh/frais?vue=a-payer', '2026-11-03'],
      ['advance_to_settle', 'hr:advance_to_settle:a3', '/rh/frais?vue=toutes', '2026-10-31'],
      ['attendance_correction', 'hr:attendance_correction:c1', '/rh/presences', '2026-11-03'],
    ]);
    expect(items.every((i) => i.source === 'hr' && i.done === false)).toBe(true);
    expect(items[2]!.kindLabel).toBe('À verser');
    expect(items[0]!.label).toBe('Avance AV2611-000002');
  });

  it('aucun montant, jamais « sur salaire » ; sa propre avance ouvre « Mes frais »', () => {
    const items = hrLinkItemsOf(links, 'u-bea');
    expect(JSON.stringify(items)).not.toMatch(/salaire|USD|CDF|amount/);
    expect(items.find((i) => i.kind === 'advance_to_settle')!.href).toBe('/rh/moi/frais');
  });
});

describe('expenseReportLineOf (ADR-0051 § 7.3)', () => {
  it('ligne d’origine d’une dépense possédée par les RH, sinon null', () => {
    expect(expenseReportLineOf({ kind: 'expense_report', reportId: 'r1', lineIndex: 2 })).toBe(
      'r1:2',
    );
    expect(expenseReportLineOf({ kind: 'supplier_payment', paymentId: 'p1' })).toBeNull();
    expect(expenseReportLineOf(null)).toBeNull();
    expect(expenseReportLineOf(undefined)).toBeNull();
  });
});
