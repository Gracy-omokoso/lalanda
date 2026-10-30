// Adaptation des réponses du lot H2 aux vues des écrans RH (ADR-0045 — H2).
import { describe, expect, it } from 'vitest';

import type { EmployeeView, OrgChartView } from '@lalanda/shared/hr';

import { employeeFromApi, meFromApi, orgChartFromApi, teamFromApi } from './api-hr';

const fiche: EmployeeView = {
  id: 'e1',
  firstName: 'Aline',
  lastName: 'Mbuyi',
  preferredName: null,
  displayName: 'Aline Mbuyi',
  employeeNumber: null,
  userId: 'u1',
  workEmail: null,
  workPhone: null,
  jobTitle: 'Comptable',
  departmentId: null,
  departmentName: null,
  managerEmployeeId: null,
  managerName: null,
  contractType: 'permanent',
  contractTypeLabel: 'CDI',
  startDate: '2026-01-05',
  probationEndDate: '2026-12-31',
  contractEndDate: null,
  endDate: null,
  exitCategory: null,
  status: 'active',
  derivedStatus: 'probation',
  workPattern: null,
  workLocation: null,
  leavePolicyOverrides: null,
  notes: null,
  revision: 2,
  createdAt: '2026-01-05T00:00:00.000Z',
  updatedAt: '2026-01-05T00:00:00.000Z',
};

describe('api-hr — contrats du lot H2', () => {
  it('le statut dérivé du moteur devient les drapeaux des écrans', () => {
    expect(employeeFromApi(fiche)).toMatchObject({
      onProbation: true,
      upcoming: false,
      contractTypeLabel: 'CDI',
    });
  });

  it('« moi » : soldes et demandes servis par l’API (lot H3)', () => {
    expect(
      meFromApi({
        employee: fiche,
        private: null,
        isManager: true,
        canApprove: true,
        directReportIds: [],
        teamEmployeeIds: [],
        orgChartVisible: true,
        balances: [],
        requests: [],
      }),
    ).toMatchObject({ employee: { id: 'e1' }, balances: [], requests: [], isManager: true });
  });

  it('équipe : nom d’usage et lien direct', () => {
    const t = teamFromApi({
      items: [
        {
          id: 'e2',
          displayName: 'Bea K.',
          jobTitle: 'Assistante',
          departmentId: null,
          departmentName: null,
          managerEmployeeId: 'e1',
          managerName: 'Aline Mbuyi',
          isDirect: true,
          derivedStatus: 'active',
          workEmail: null,
          workPhone: null,
          balances: [],
          absences: [],
        },
      ],
    });
    expect(t.members[0]).toMatchObject({
      direct: true,
      absences: [],
      employee: { preferredName: 'Bea K.', managerName: 'Aline Mbuyi' },
    });
  });

  it('organigramme : personnes indexées → liste, nom du service joint', () => {
    const c: OrgChartView = {
      version: '1.0.0',
      view: 'reporting',
      roots: [],
      cycleBrokenAt: [],
      headcount: 1,
      people: {
        e1: {
          displayName: 'Aline',
          jobTitle: 'Comptable',
          departmentId: 'd1',
          managerEmployeeId: null,
        },
      },
      departments: { d1: { name: 'Finance' } },
    };
    expect(orgChartFromApi(c).people).toEqual([
      {
        id: 'e1',
        name: 'Aline',
        jobTitle: 'Comptable',
        departmentId: 'd1',
        departmentName: 'Finance',
        managerEmployeeId: null,
      },
    ]);
  });
});
