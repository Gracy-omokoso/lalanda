// Approbations d'achat dans « Mes tâches » — ADR-0044 § 6.5. ADR-0044 — P3.
//
// Agrégées À LA LECTURE (motif exact de `CRM_AGENDA_SOURCE`, ADR-0040 — C4) : une
// demande `submitted` que l'appelant peut approuver y figure ; elle disparaît dès
// qu'elle est approuvée, refusée ou modifiée. Pas de case à cocher : approuver
// exige une décision, l'élément ouvre la demande. Forme de l'élément seulement.

import type { PurchaseCurrency } from './constants.js';

/** Préfixe des identifiants d'éléments : disjoints de ceux des tâches et du CRM. */
export const PURCHASES_AGENDA_ID_PREFIX = 'purchases:' as const;

/** Éléments d'approbation lus au plus dans « Mes tâches » (§ 6.5). */
export const PURCHASES_AGENDA_MAX = 200;

export interface PurchasesMyTaskItem {
  source: 'purchases';
  /** `purchases:<orderId>`. */
  id: string;
  orderId: string;
  requestNumber: string | null;
  title: string;
  supplierName: string | null;
  /** Total TTC rendu par le moteur, dans la devise de la demande. */
  total: string;
  currency: PurchaseCurrency;
  /** Jour de soumission `AAAA-MM-JJ` (Kinshasa). */
  dueDate: string;
  priority: 'none';
  /** Rang de tri dans un même jour : l'instant de soumission. */
  rank: string;
  done: false;
  /** Libellé de forme (pas seulement une couleur) : « Approbation ». */
  kindLabel: 'Approbation';
  href: string;
}

export function purchasesAgendaId(orderId: string): string {
  return `${PURCHASES_AGENDA_ID_PREFIX}${orderId}`;
}

/** Écran ouvert par un clic : la demande (`/achats/commandes/:id`). */
export function purchasesAgendaHref(orderId: string): string {
  return `/achats/commandes/${orderId}`;
}
