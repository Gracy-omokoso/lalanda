// Port des achats de la marge d'un projet — ADR-0044 § 6.1. ADR-0044 — P6.
//
// Motif de `morning-brief.ports.ts` : un jeton, une interface, un fournisseur nul
// par défaut. Le fournisseur réel (`purchases/margin/purchases-margin.source.ts`)
// lit `supplier_invoices` et `purchase_orders` en LECTURE SEULE par la connexion,
// sans dépendre du module des achats (qui dépend lui-même de la trésorerie et des
// ventes) : aucun cycle d'injection.
//
// Appelé seulement si l'appelant détient `purchase.read` (contrôle `can()` du
// service de la marge) ; sinon rien n'est lu et la vue rend `purchases: null`.

import type { WorkMarginOrderInput, WorkMarginPayableInput } from '@lalanda/engine';

export const WORK_PURCHASES_SOURCE = Symbol('WORK_PURCHASES_SOURCE');

/** Achats d'un projet, déjà filtrés sur l'organisation. Aucun calcul : le moteur décide. */
export interface WorkPurchasesRead {
  payables: WorkMarginPayableInput[];
  orders: WorkMarginOrderInput[];
}

export interface WorkPurchasesSource {
  /** `null` : module des achats absent (tests) — la vue rend alors `purchases: null`. */
  purchasesOf(organizationId: string, projectId: string): Promise<WorkPurchasesRead | null>;
}

/** Sans module des achats : rien n'est lu. */
export const noWorkPurchases: WorkPurchasesSource = {
  purchasesOf: async () => null,
};
