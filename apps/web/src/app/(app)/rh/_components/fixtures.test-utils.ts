// Fabriques de vues de l'API RH pour les tests des modèles (lot H6).

import type { HrEmployeeView, LeaveRequestView } from '@/lib/api-hr';

export function employe(p: Partial<HrEmployeeView> = {}): HrEmployeeView {
  return {
    id: 'e1',
    firstName: 'Awa',
    lastName: 'Mbuyi',
    preferredName: null,
    employeeNumber: null,
    jobTitle: 'Comptable',
    departmentId: null,
    managerEmployeeId: null,
    contractType: 'permanent',
    startDate: '2026-01-16',
    endDate: null,
    status: 'active',
    userId: 'u1',
    workEmail: null,
    workPhone: null,
    workLocation: null,
    probationEndDate: null,
    contractEndDate: null,
    exitCategory: null,
    notes: null,
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...p,
  };
}

export function demande(p: Partial<LeaveRequestView> = {}): LeaveRequestView {
  return {
    id: 'r1',
    employeeId: 'e1',
    typeId: 't1',
    typeLabel: 'Congés',
    start: { date: '2026-11-02', half: 'full' },
    end: { date: '2026-11-06', half: 'full' },
    days: '5.00',
    reason: null,
    status: 'pending',
    steps: ['manager'],
    approvals: [],
    createdBy: 'u1',
    revision: 1,
    createdAt: '2026-10-30T08:00:00.000Z',
    updatedAt: '2026-10-30T08:00:00.000Z',
    ...p,
  };
}
