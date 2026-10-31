// Éléments des stocks dans « Mes tâches » — ADR-0046 § 6.7. ADR-0046 — S7.
//
// Agrégés À LA LECTURE (motif de `PURCHASES_AGENDA_SOURCE`) : rien n'est copié dans
// `work_tasks`. Trois natures, sans case à cocher (chacune exige un geste dans
// `/stocks`) :
//   - `count_to_count` : inventaire en cours de comptage dont l'appelant est compteur ;
//   - `count_to_validate` : inventaire soumis que l'appelant peut valider (détenteur
//     effectif de `stock.manage`, séparation des tâches appliquée) ;
//   - `pending_lines` : lignes « À traiter » ouvertes, regroupées en UN élément
//     (détenteurs de `stock.move`).
// Aucune valeur ni coût : un titre, une date, un lien.

/** Préfixe des identifiants d'éléments : disjoints de ceux des autres sources. */
export const STOCK_AGENDA_ID_PREFIX = 'stock:' as const;

export const STOCK_AGENDA_KINDS = ['count_to_count', 'count_to_validate', 'pending_lines'] as const;
export type StockAgendaKind = (typeof STOCK_AGENDA_KINDS)[number];

/** Libellé de forme (pas seulement une couleur). */
export const STOCK_AGENDA_KIND_LABELS: Readonly<Record<StockAgendaKind, string>> = Object.freeze({
  count_to_count: 'Inventaire à compter',
  count_to_validate: 'Inventaire à valider',
  pending_lines: 'À traiter',
});

export interface StockMyTaskItem {
  source: 'stock';
  kind: StockAgendaKind;
  /** `stock:count:<countId>`, `stock:validate:<countId>` ou `stock:pending`. */
  id: string;
  title: string;
  /** Jour `AAAA-MM-JJ` (Kinshasa) : début du comptage, soumission, plus ancienne ligne. */
  dueDate: string;
  priority: 'none';
  /** Rang de tri dans un même jour. */
  rank: string;
  done: false;
  kindLabel: string;
  href: string;
}

export function stockAgendaId(kind: StockAgendaKind, ref?: string): string {
  if (kind === 'pending_lines') return `${STOCK_AGENDA_ID_PREFIX}pending`;
  return `${STOCK_AGENDA_ID_PREFIX}${kind === 'count_to_count' ? 'count' : 'validate'}:${ref ?? ''}`;
}

/** Écran ouvert par un clic. */
export function stockAgendaHref(kind: StockAgendaKind, countId?: string): string {
  return kind === 'pending_lines' ? '/stocks/a-traiter' : `/stocks/inventaires/${countId ?? ''}`;
}
