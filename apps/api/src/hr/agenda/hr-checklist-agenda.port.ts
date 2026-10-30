// Port des éléments de liste d'entrée et de sortie dans « Mes tâches » (ADR-0045
// § 2.9, § 6.1). ADR-0045 — H3 déclare le port, nul par défaut ; le lot H4 en fournit
// le lecteur réel (`hr_checklists`, éléments assignés à l'appelant, non faits).
//
// Motif de `my-tasks.ports.ts` : un jeton, une interface, un fournisseur nul.

import type { HrChecklistTaskItem } from '@lalanda/shared/hr';

export const HR_CHECKLIST_AGENDA = Symbol('HR_CHECKLIST_AGENDA');

export interface HrChecklistAgendaReader {
  itemsOf(
    organizationId: string,
    userId: string,
    limit: number,
  ): Promise<{ items: HrChecklistTaskItem[]; truncated: boolean }>;
}

/** Tant que le lot H4 n'est pas branché : aucun élément de liste. */
export const noHrChecklistAgenda: HrChecklistAgendaReader = {
  itemsOf: async () => ({ items: [], truncated: false }),
};
