// Relances CRM cochées et déplacées depuis « Mes tâches » — ADR-0040 — C4 § 5.3.
//
// Chaque module garde son seul écrivain : « Mes tâches » appelle la route DU CRM
// pour un élément `source: 'crm'` (`POST /crm/activities/:id/complete`,
// `…/reopen`, `PUT /crm/activities/:id` pour déplacer l'échéance). Fichier
// propre au lot C4 : `api-crm.ts` appartient à l'application `/crm` (lot C5).

import type { CrmMyTaskItem } from '@lalanda/shared/crm';

import { jsonRequest } from './api';

/** Activité rendue par le CRM après une écriture (forme d'`ActivityView`, partielle). */
export interface CrmActivityResult {
  id: string;
  done: boolean;
  dueAt: string | null;
  dueDay: string | null;
  revision: number;
}

const id = (value: string): string => encodeURIComponent(value);

export const crmAgendaApi = {
  complete: (activityId: string, expectedRevision: number) =>
    jsonRequest<CrmActivityResult>(`/crm/activities/${id(activityId)}/complete`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  reopen: (activityId: string, expectedRevision: number) =>
    jsonRequest<CrmActivityResult>(`/crm/activities/${id(activityId)}/reopen`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  /** Remplace l'activité en gardant tous ses champs ; seule l'échéance change. */
  moveDue: (item: CrmMyTaskItem, dueAt: string) =>
    jsonRequest<CrmActivityResult>(`/crm/activities/${id(item.activityId)}`, {
      method: 'PUT',
      body: {
        kind: item.kind,
        subject: item.subject,
        notes: item.notes,
        dueAt,
        opportunityId: item.opportunityId,
        contactId: item.contactId,
        customerId: item.customerId,
        assigneeUserId: item.assigneeUserId,
        done: false,
        expectedRevision: item.revision,
      },
    }),
};
