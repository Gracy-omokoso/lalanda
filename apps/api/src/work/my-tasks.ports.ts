// Points d'extension de « Mes tâches » — ADR-0040 — C4 § 5.2 (O3).
//
// « Une seule liste », sans copie : `GET /work/my-tasks` lit en plus, par ce
// port et en LECTURE SEULE, les activités CRM non faites, assignées à l'appelant
// et à échéance. Motif exact de `WORK_SOURCE` du brief : un jeton, une
// interface, un fournisseur nul par défaut (tests, module CRM absent).
//
// Le fournisseur réel (`crm/agenda/crm-agenda.source.ts`) ne reçoit que
// l'organisation de la session et l'appelant ; il n'est appelé que si le rôle
// détient `crm.read` (contrôlé par `WorkTasksService.myTasks`).

import type { CrmMyTaskItem } from '@lalanda/shared/crm';

export const CRM_AGENDA_SOURCE = Symbol('WORK_CRM_AGENDA_SOURCE');

export interface CrmAgendaPage {
  items: CrmMyTaskItem[];
  /** Vrai si plus de `limit` activités répondaient. */
  truncated: boolean;
}

export interface CrmAgendaReader {
  agendaOf(organizationId: string, userId: string, limit: number): Promise<CrmAgendaPage>;
}

/** Sans module CRM (tests) : aucune relance. */
export const noCrmAgenda: CrmAgendaReader = {
  agendaOf: async () => ({ items: [], truncated: false }),
};
