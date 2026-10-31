// Port des stocks de la marge d'un projet — ADR-0046 § 6.4. ADR-0046 — S7.
//
// Motif de `work-purchases.port.ts` : un jeton, une interface, un fournisseur nul par
// défaut. Le fournisseur réel (`stock/margin/stock-margin.source.ts`) lit `stock_items`
// et `stock_movements` en LECTURE SEULE par la connexion, sans dépendre du module des
// stocks : aucun cycle d'injection.
//
// Appelé seulement si l'appelant détient `stock.read` ET voit les valeurs
// (`purchase.read` ou `treasury.read`, `canSeeStockValues`) ; sinon rien n'est lu et la
// vue rend `materials: null`. Le moteur rend le matériel INFORMATIF : jamais soustrait.

import type { StockItemInput, StockMovementInput } from '@lalanda/engine';

export const WORK_STOCK_SOURCE = Symbol('WORK_STOCK_SOURCE');

/** Articles sortis pour le projet et TOUS leurs mouvements (le coût moyen se rejoue). */
export interface WorkStockRead {
  items: StockItemInput[];
  movements: StockMovementInput[];
}

export interface WorkStockSource {
  /** `null` : module des stocks absent (tests) — la vue rend alors `materials: null`. */
  stockOf(organizationId: string, projectId: string): Promise<WorkStockRead | null>;
}

/** Sans module des stocks : rien n'est lu. */
export const noWorkStock: WorkStockSource = {
  stockOf: async () => null,
};
