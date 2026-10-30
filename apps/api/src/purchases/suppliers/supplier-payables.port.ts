// Port « reste dû par fournisseur » (ADR-0044 § 3.1). ADR-0044 — P2.
//
// La fiche fournisseur affiche le reste à payer par devise (liste, si l'appelant
// détient aussi `treasury.read`) et refuse l'archivage d'un fournisseur qui a des
// factures validées non soldées (`409 SUPPLIER_HAS_OPEN_PAYABLES`). Les factures et
// les paiements appartiennent aux lots P4 et P5 : ce port les lira. Motif des ports
// de la trésorerie et du brief : un jeton, une interface, un fournisseur NUL par
// défaut — tant qu'aucune facture n'existe, aucun reste n'est dû.

import type { PurchaseCurrency } from '@lalanda/shared/purchases';

export const SUPPLIER_PAYABLES_SOURCE = Symbol('SUPPLIER_PAYABLES_SOURCE');

/** Reste à payer non nul, par devise (jamais additionné entre devises). */
export type RemainingByCurrency = Partial<Record<PurchaseCurrency, string>>;

export interface SupplierPayablesSource {
  /** Reste à payer des factures validées de chaque fiche ; une fiche sans dette est absente. */
  remainingBySupplier(
    organizationId: string,
    supplierIds: readonly string[],
  ): Promise<Map<string, RemainingByCurrency>>;
}

export const noSupplierPayables: SupplierPayablesSource = {
  remainingBySupplier: async () => new Map(),
};
