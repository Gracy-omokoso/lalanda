// Client des synchronisations du module Projets — ADR-0077.
//
//   § 1 : contrat signé → projet, lien lu des deux côtés ;
//   § 4 : validation hebdomadaire des feuilles de temps.
//
// Les formes viennent des contrats partagés `@lalanda/shared/work`, jamais recopiées.

import type {
  CreateProjectFromContractBody,
  DecideTimesheetBody,
  DecideTimesheetWithReasonBody,
  PendingTimesheetView,
  SubmitTimesheetBody,
  TimesheetApprovalView,
  WorkProjectContractView,
  WorkProjectFromContractView,
} from '@lalanda/shared/work';

import { jsonRequest } from './api';

const id = encodeURIComponent;

export const workSyncApi = {
  /** Contrat signé → projet, ou projet du devis / de l'opportunité relié (`work.manage` + `sales.read`). */
  createFromContract: (body: CreateProjectFromContractBody) =>
    jsonRequest<WorkProjectFromContractView>('/work/projects/from-contract', {
      method: 'POST',
      body,
    }),
  /** Projet du contrat, ou `null` (`work.read` + `sales.read`). */
  projectForContract: (contractId: string) =>
    jsonRequest<{ projectId: string | null }>(`/work/contracts/${id(contractId)}/project`, {
      method: 'GET',
    }),
  /** Contrat que suit le projet, sans montant, ou `null` (`work.read` + `sales.read`). */
  contractOfProject: (projectId: string) =>
    jsonRequest<{ contract: WorkProjectContractView | null }>(
      `/work/projects/${id(projectId)}/contract`,
      { method: 'GET' },
    ),

  /** Le membre soumet sa semaine. */
  submitTimesheet: (body: SubmitTimesheetBody) =>
    jsonRequest<TimesheetApprovalView>('/work/timesheets/submit', { method: 'POST', body }),
  approveTimesheet: (body: DecideTimesheetBody) =>
    jsonRequest<TimesheetApprovalView>('/work/timesheets/approve', { method: 'POST', body }),
  returnTimesheet: (body: DecideTimesheetWithReasonBody) =>
    jsonRequest<TimesheetApprovalView>('/work/timesheets/return', { method: 'POST', body }),
  reopenTimesheet: (body: DecideTimesheetWithReasonBody) =>
    jsonRequest<TimesheetApprovalView>('/work/timesheets/reopen', { method: 'POST', body }),
  /** Semaines soumises que l'appelant peut valider. */
  pendingTimesheets: () =>
    jsonRequest<{ items: PendingTimesheetView[] }>('/work/timesheets/pending', { method: 'GET' }),
};
