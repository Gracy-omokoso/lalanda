// Liens du second volet RH avec « Mes tâches » et les projets — ADR-0051 § 7.3, § 7.5.
// ADR-0051 — H14.
//
// Forme des éléments seulement. Agrégés À LA LECTURE par `HR_AGENDA_SOURCE` (motif
// d'ADR-0045 — H3) : rien n'est copié dans `work_tasks`. Un élément disparaît dès que sa
// cause disparaît (note validée, remboursée, avance régularisée, correction décidée).
// Pas de case à cocher : valider, payer ou décider est un geste de l'écran propriétaire.
//
// AUCUN montant, aucun motif, jamais « sur salaire » : une avance est « Avance AV… »
// pour tous (§ 7.5, critère 15).

import { HR_AGENDA_ID_PREFIX } from './leave.js';

/** Natures d'éléments ajoutées à `HR_AGENDA_SOURCE` par ce lot. */
export const HR_LINK_AGENDA_KINDS = [
  'expense_approval',
  'expense_to_pay',
  'advance_to_settle',
  'attendance_correction',
] as const;
export type HrLinkAgendaKind = (typeof HR_LINK_AGENDA_KINDS)[number];

/** Pastilles (forme et libellé, pas seulement une couleur — ADR-0030 § 5). */
export const HR_LINK_AGENDA_LABELS: Readonly<Record<HrLinkAgendaKind, string>> = Object.freeze({
  expense_approval: 'Frais à valider',
  expense_to_pay: 'À rembourser',
  advance_to_settle: 'Avance à régulariser',
  attendance_correction: 'Correction de pointage',
});

/** Pièce visée par un élément. */
export type HrLinkEntityType = 'expense_report' | 'advance' | 'attendance_correction';

/** Écrans ouverts par un clic (§ 10). */
export const HR_EXPENSES_TO_APPROVE_LINK = '/rh/frais?vue=a-valider';
export const HR_EXPENSES_TO_PAY_LINK = '/rh/frais?vue=a-payer';
export const HR_EXPENSES_ALL_LINK = '/rh/frais?vue=toutes';
export const HR_MY_EXPENSES_LINK = '/rh/moi/frais';
export const HR_PRESENCES_LINK = '/rh/presences';

/**
 * Note de frais, avance ou correction de pointage qui attend un geste de l'appelant.
 * `label` : « Note de frais NF2611-000004 », « Avance AV2611-000002 », « Correction du
 * 2026-11-03 » — jamais un montant ni une nature d'avance.
 */
export interface HrLinkTaskItem {
  source: 'hr';
  kind: HrLinkAgendaKind;
  /** `hr:<nature>:<pièce>`, stable. */
  id: string;
  entityType: HrLinkEntityType;
  entityId: string;
  /** Numéro `NF…` ou `AV…` ; `null` pour une correction. */
  number: string | null;
  label: string;
  /** Collaborateur concerné (la note, l'avance ou la correction est la sienne). */
  employeeName: string;
  /** Jour `AAAA-MM-JJ` (Kinshasa) : soumission, validation, échéance annoncée ou jour corrigé. */
  dueDate: string | null;
  priority: 'none';
  rank: string;
  done: false;
  kindLabel: string;
  href: string;
}

export function hrLinkAgendaId(kind: HrLinkAgendaKind, entityId: string): string {
  return `${HR_AGENDA_ID_PREFIX}${kind}:${entityId}`;
}

// ── Frais refacturables d'un projet (§ 7.3) ─────────────────────────────────

/**
 * Ligne de frais marquée « refacturable », imputée au projet et REMBOURSÉE (ou soldée par
 * une avance) : ses dépenses de trésorerie existent. `amount` : somme de ces dépenses
 * (montant de la ligne), lue, jamais recalculée. Libellé sans nom (décision ouverte
 * n° 10) ; aucune facture n'est créée.
 */
export interface WorkRebillableExpenseView {
  /** `<reportId>:<lineIndex>`. */
  key: string;
  reportId: string;
  reportNumber: string | null;
  lineIndex: number;
  spentOn: string;
  category: string;
  /** « Frais NF… — {libellé de la ligne} ». */
  label: string;
  currency: 'CDF' | 'USD';
  amount: string;
  merchant: string | null;
}

export interface WorkRebillableExpensesView {
  projectId: string;
  items: WorkRebillableExpenseView[];
  /** Vrai si la lecture a été bornée. */
  truncated: boolean;
}
