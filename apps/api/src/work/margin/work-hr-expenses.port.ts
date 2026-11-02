// Port des frais du personnel d'un projet — ADR-0051 § 7.3. ADR-0051 — H14.
//
// Motif de `work-stock.port.ts` : un jeton, une interface, un fournisseur nul par défaut.
// Le fournisseur réel (`hr/work/hr-work-expenses.source.ts`) lit `hr_expense_reports` et
// `treasury_expenses` en LECTURE SEULE par la connexion, sans dépendre du module RH ni de
// la trésorerie : aucun cycle d'injection.
//
// - `claimsOf` : lignes APPROUVÉES non (entièrement) remboursées imputées au projet ; le
//   moteur de la marge les rend INFORMATIVES (`pendingExpenseClaims`) et en retranche les
//   dépenses déjà créées pour elles : jamais soustraites, jamais comptées deux fois.
// - `rebillableOf` : lignes marquées « refacturables » dont les dépenses de
//   remboursement existent (remboursées ou soldées par une avance), libellées SANS nom
//   (décision ouverte n° 10). Aucune facture n'est créée.

import type { WorkMarginExpenseClaimInput } from '@lalanda/engine';
import type { WorkRebillableExpenseView } from '@lalanda/shared/hr';

export const WORK_HR_EXPENSES_SOURCE = Symbol('WORK_HR_EXPENSES_SOURCE');

export interface WorkHrExpensesSource {
  /** `null` : module RH absent (tests) — la vue rend alors `pendingExpenseClaims: null`. */
  claimsOf(
    organizationId: string,
    projectId: string,
  ): Promise<WorkMarginExpenseClaimInput[] | null>;
  rebillableOf(
    organizationId: string,
    projectId: string,
  ): Promise<{ items: WorkRebillableExpenseView[]; truncated: boolean }>;
}

/** Sans module RH : rien n'est lu. */
export const noWorkHrExpenses: WorkHrExpensesSource = {
  claimsOf: async () => null,
  rebillableOf: async () => ({ items: [], truncated: false }),
};
