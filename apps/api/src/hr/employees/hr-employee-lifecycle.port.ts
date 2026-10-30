// Port des effets d'une sortie, d'une réintégration ou d'une anonymisation sur les
// lots suivants (ADR-0045 § 3.1). ADR-0045 — H2.
//
// Le lot H2 pose la sortie, la réintégration et l'anonymisation de la FICHE et des
// DONNÉES SENSIBLES. Ce qui appartient aux autres lots s'y branche par ce port, motif
// de `my-tasks.ports.ts` (jeton, interface, fournisseur nul par défaut) :
//   - H3 : annuler les absences futures approuvées d'un collaborateur qui sort
//     (`taken_reversal` au grand livre) ;
//   - H4 : effacer les documents sensibles d'un collaborateur anonymisé.
// Chaque méthode reçoit la session de la transaction de H2 : l'effet et la sortie
// sont validés ou annulés ensemble.

import type { ClientSession } from 'mongoose';

export const HR_EMPLOYEE_LIFECYCLE = Symbol('HR_EMPLOYEE_LIFECYCLE');

export interface HrEmployeeLifecycleEvent {
  organizationId: string;
  employeeId: string;
  actorUserId: string;
  session: ClientSession;
}

export interface HrEmployeeLifecycle {
  onExit(event: HrEmployeeLifecycleEvent & { endDate: string }): Promise<void>;
  onAnonymize(event: HrEmployeeLifecycleEvent): Promise<void>;
}

/** Fournisseur nul : tant que H3 et H4 ne sont pas branchés, rien d'autre ne bouge. */
export const noHrEmployeeLifecycle: HrEmployeeLifecycle = {
  onExit: async () => undefined,
  onAnonymize: async () => undefined,
};
