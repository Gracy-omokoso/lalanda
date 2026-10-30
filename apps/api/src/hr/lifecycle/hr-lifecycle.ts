// Effets d'une sortie et d'une anonymisation sur les absences et les documents
// (port `HR_EMPLOYEE_LIFECYCLE` posé par H2, ADR-0045 § 3.1). ADR-0045 — H3.
//
// - Sortie (H3) : les absences FUTURES du collaborateur, en attente ou approuvées,
//   sont annulées dans la transaction de la sortie (`taken_reversal` si débitées) et
//   chaque annulation est journalisée (`hr.leave.cancelled`, cause `employee_exit`).
// - Anonymisation : demandes et grand livre sont CONSERVÉS (rapports). L'effacement
//   des documents sensibles revient au lot H4, qui fournit le jeton
//   `HR_DOCUMENTS_LIFECYCLE` ci-dessous (point d'extension, nul jusque-là). Rien
//   d'autre à câbler : ce concentrateur l'appelle déjà, dans la même transaction.

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import type {
  HrEmployeeLifecycle,
  HrEmployeeLifecycleEvent,
} from '../employees/hr-employee-lifecycle.port.js';
import { HrLeaveService } from '../leave/hr-leave.service.js';

/** Jeton du lot H4 : effets d'une sortie ou d'une anonymisation sur les documents RH. */
export const HR_DOCUMENTS_LIFECYCLE = Symbol('HR_DOCUMENTS_LIFECYCLE');

export interface HrDocumentsLifecycle {
  /** Effacer les documents sensibles d'un collaborateur anonymisé (§ 2.8, § 3.1). */
  onAnonymize(event: HrEmployeeLifecycleEvent): Promise<void>;
  /** Facultatif : proposer ou préparer la liste de départ. */
  onExit?(event: HrEmployeeLifecycleEvent & { endDate: string }): Promise<void>;
}

@Injectable()
export class HrLifecycleHub implements HrEmployeeLifecycle {
  private readonly logger = new Logger('HrLifecycle');

  constructor(
    @Inject(HrLeaveService) private readonly leave: HrLeaveService,
    @Optional()
    @Inject(HR_DOCUMENTS_LIFECYCLE)
    private readonly documents: HrDocumentsLifecycle | null,
  ) {}

  async onExit(event: HrEmployeeLifecycleEvent & { endDate: string }): Promise<void> {
    const cancelled = await this.leave.cancelAfterExit(event);
    if (cancelled > 0) {
      this.logger.log(
        `Sortie ${event.employeeId} (organisation ${event.organizationId}) : ${cancelled} absence(s) future(s) annulée(s).`,
      );
    }
    await this.documents?.onExit?.(event);
  }

  async onAnonymize(event: HrEmployeeLifecycleEvent): Promise<void> {
    await this.documents?.onAnonymize(event);
  }
}
