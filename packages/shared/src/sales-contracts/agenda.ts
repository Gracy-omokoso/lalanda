// Alertes des engagements clients dans « Mes tâches » — ADR-0050 § 6. ADR-0050 — V6.
//
// Agrégées À LA LECTURE (motif exact de `CRM_AGENDA_SOURCE`, ADR-0040 — C4, et de
// `HR_AGENDA_SOURCE`, ADR-0045 — H3) : rien n'est copié dans `work_tasks`. Un élément
// disparaît dès que sa cause disparaît (contrat approuvé, reconduction constatée,
// brouillon émis…). Pas de case à cocher : « cocher » renvoie à l'écran propriétaire
// (ADR-0040 § 5.3). Forme de l'élément seulement.
//
// AUCUN libellé ne juge une clause : Lalanda calcule des dates à partir des clauses
// SAISIES (§ 9, critère 18) ; jamais « conforme », « valable » ni « reconduit
// automatiquement ».

/** Préfixe des identifiants d'éléments (§ 6) : disjoints de ceux des autres sources. */
export const SALES_CONTRACTS_AGENDA_ID_PREFIX = 'sct:' as const;

/** Éléments lus au plus dans « Mes tâches ». */
export const SALES_CONTRACTS_AGENDA_MAX = 200;

/**
 * Nature d'un élément : celles du moteur (`contractAlerts`, § 6) et l'acompte émis non
 * « traité » alors qu'une facture finale existe (`DEPOSIT_NOT_RESOLVED`, § 5.2).
 */
export const SALES_CONTRACT_AGENDA_KINDS = [
  'contract_to_approve',
  'amendment_to_approve',
  'notice_deadline',
  'term_end',
  'renewal_to_record',
  'signed_copy_missing',
  'subscription_drafts_to_issue',
  'occurrence_blocked',
  'deposit_not_resolved',
] as const;
export type SalesContractAgendaKind = (typeof SALES_CONTRACT_AGENDA_KINDS)[number];

/** Pastille (forme et libellé, pas seulement une couleur — ADR-0030 § 5). */
export const SALES_CONTRACT_AGENDA_LABELS: Readonly<Record<SalesContractAgendaKind, string>> =
  Object.freeze({
    contract_to_approve: 'Contrat à approuver',
    amendment_to_approve: 'Avenant à approuver',
    notice_deadline: 'Préavis',
    term_end: 'Fin de terme',
    renewal_to_record: 'Reconduction à constater',
    signed_copy_missing: 'Copie signée manquante',
    subscription_drafts_to_issue: 'Brouillons à émettre',
    occurrence_blocked: 'Échéance bloquée',
    deposit_not_resolved: 'Acompte à traiter',
  });

export interface SalesContractMyTaskItem {
  source: 'sales_contracts';
  kind: SalesContractAgendaKind;
  /** `sct:<nature>:…`, stable. */
  id: string;
  title: string;
  /** Ligne secondaire : client, motifs d'une échéance bloquée, nombre de brouillons. */
  detail: string | null;
  contractId: string | null;
  amendmentId: string | null;
  orderId: string | null;
  /** Jour `AAAA-MM-JJ` (Kinshasa) affiché ; `null` = sans échéance. */
  dueDate: string | null;
  priority: 'none';
  /** Rang de tri dans un même jour. */
  rank: string;
  done: false;
  kindLabel: string;
  /** Nombre agrégé (brouillons à émettre), 1 sinon. */
  count: number;
  href: string;
}

/** Écran d'un contrat (`/ventes/contrats/:id`). */
export function salesContractHref(contractId: string): string {
  return `/ventes/contrats/${contractId}`;
}

/** Écran d'une commande client (`/ventes/commandes/:id`). */
export function salesOrderHref(orderId: string): string {
  return `/ventes/commandes/${orderId}`;
}

/** Liste des factures, où s'émettent les brouillons d'échéance (§ 5.3). */
export const SALES_INVOICES_HREF = '/ventes/factures';
