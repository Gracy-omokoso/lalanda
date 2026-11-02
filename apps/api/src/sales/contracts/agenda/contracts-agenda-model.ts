// Règles pures des alertes des engagements — ADR-0050 § 6. ADR-0050 — V6.
//
// Aucune base, aucune horloge : les éléments viennent du moteur (`contractAlerts`, § 7) ;
// ce fichier décide seulement QUI les voit (droits EFFECTIFS passés par l'appelant,
// ADR-0041 ; jamais un rôle) et les met en forme. La séparation des tâches est celle de
// la route d'approbation (`contractApprovalDecision`) : un élément « à approuver » n'est
// montré qu'à qui peut effectivement approuver.
//
// Aucun libellé ne juge une clause (critère 18) : des dates calculées à partir des
// clauses SAISIES, jamais « conforme », « valable » ni « reconduit automatiquement ».

import type { ContractAlert } from '@lalanda/engine';
import {
  SALES_CONTRACTS_AGENDA_ID_PREFIX,
  SALES_CONTRACT_AGENDA_LABELS,
  SALES_INVOICES_HREF,
  salesContractHref,
  salesOrderHref,
  type SalesContractMyTaskItem,
} from '@lalanda/shared/sales-contracts';

import { contractApprovalDecision } from '../../../authz/permissions.js';
import { BLOCK_MESSAGES, frenchDay } from '../subscriptions/sales-subscriptions-model.js';

/** Titre d'un élément ou d'une notification : 200 caractères au plus. */
export const AGENDA_TITLE_MAX = 200;

export function clip(raw: string, max = AGENDA_TITLE_MAX): string {
  return raw.length <= max ? raw : `${raw.slice(0, max - 1)}…`;
}

/** Contrat tel que l'agenda le présente (lecture seule). */
export interface AgendaContractRef {
  id: string;
  number: string;
  title: string;
  customerName: string | null;
  ownerUserId: string;
  createdBy: string;
  submittedBy: string | null;
}

/** Avenant tel que l'agenda le présente. */
export interface AgendaAmendmentRef {
  id: string;
  number: string;
  createdBy: string;
  submittedBy: string | null;
}

/** L'appelant : ses droits EFFECTIFS et le contexte de l'approbateur unique. */
export interface AgendaViewer {
  userId: string;
  holdsApprove: boolean;
  holdsInvoice: boolean;
  /** Détenteurs effectifs de `sales.contract.approve` (`countApprovers`). */
  approverCount: number;
  allowSoleApprover: boolean;
}

/**
 * L'élément est-il pour l'appelant ? `owner` : le responsable ; `invoicers` : détenteur
 * de `sales.invoice` ; `approvers` : détenteur de `sales.contract.approve` qui peut
 * approuver CE document (ni créateur ni soumetteur, sauf approbateur unique).
 */
export function isForViewer(
  alert: ContractAlert,
  viewer: AgendaViewer,
  doc: { submittedBy: string | null; createdBy: string } | null,
): boolean {
  switch (alert.audience) {
    case 'owner':
      return alert.ownerUserId !== null && alert.ownerUserId === viewer.userId;
    case 'invoicers':
      return viewer.holdsInvoice;
    case 'approvers': {
      if (!viewer.holdsApprove) return false;
      if (alert.kind !== 'contract_to_approve' && alert.kind !== 'amendment_to_approve') {
        return true;
      }
      if (doc === null) return false;
      return contractApprovalDecision({
        approverUserId: viewer.userId,
        submittedBy: doc.submittedBy,
        createdBy: doc.createdBy,
        holdersCount: viewer.approverCount,
        allowSoleApprover: viewer.allowSoleApprover,
      }).ok;
    }
  }
}

/** Messages des motifs d'une échéance bloquée (codes partagés), dans l'ordre reçu. */
export function blockedDetail(reasons: readonly string[]): string | null {
  const messages = reasons.flatMap((r) =>
    r in BLOCK_MESSAGES ? [BLOCK_MESSAGES[r as keyof typeof BLOCK_MESSAGES]] : [],
  );
  return messages.length === 0 ? null : messages.join(' ');
}

const day = (d: string | null): string => (d === null ? '' : frenchDay(d));

function base(
  alert: ContractAlert,
  title: string,
  detail: string | null,
  href: string,
): SalesContractMyTaskItem {
  return {
    source: 'sales_contracts',
    kind: alert.kind,
    id: alert.id,
    title: clip(title),
    detail: detail === null ? null : clip(detail, 500),
    contractId: alert.contractId,
    amendmentId: alert.amendmentId,
    orderId: null,
    dueDate: alert.dueDate,
    priority: 'none',
    rank: alert.id,
    done: false,
    kindLabel: SALES_CONTRACT_AGENDA_LABELS[alert.kind],
    count: alert.count,
    href,
  };
}

/** Élément « Mes tâches » d'une alerte du moteur ; `null` si son contrat est inconnu. */
export function itemOfAlert(
  alert: ContractAlert,
  contract: AgendaContractRef | null,
  amendment: AgendaAmendmentRef | null,
): SalesContractMyTaskItem | null {
  if (alert.kind === 'subscription_drafts_to_issue') {
    const n = alert.count;
    return base(
      alert,
      n === 1 ? '1 brouillon d’échéance à émettre' : `${n} brouillons d’échéance à émettre`,
      'Vérifiez chaque brouillon puis émettez-le, une facture à la fois.',
      SALES_INVOICES_HREF,
    );
  }
  if (contract === null) return null;
  const href = salesContractHref(contract.id);
  const who = [contract.customerName, contract.title]
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    .join(' — ');
  const detail = who === '' ? null : who;
  const ct = `contrat ${contract.number}`;
  switch (alert.kind) {
    case 'contract_to_approve':
      return base(alert, `Approuver le ${ct}`, detail, href);
    case 'amendment_to_approve':
      return amendment === null
        ? null
        : base(alert, `Approuver l’avenant ${amendment.number}`, detail, href);
    case 'notice_deadline':
      return base(alert, `Date limite de préavis le ${day(alert.dueDate)} — ${ct}`, detail, href);
    case 'term_end':
      return base(alert, `Fin du terme le ${day(alert.dueDate)} — ${ct}`, detail, href);
    case 'renewal_to_record':
      return base(
        alert,
        `Reconduction à constater — ${ct} (fin du terme le ${day(alert.dueDate)})`,
        detail,
        href,
      );
    case 'signed_copy_missing':
      return amendment === null
        ? null
        : base(alert, `Téléverser la copie signée de l’avenant ${amendment.number}`, detail, href);
    case 'occurrence_blocked':
      return base(
        alert,
        `Échéance du ${day(alert.dueDate)} bloquée — ${ct}`,
        blockedDetail(alert.reasons) ?? detail,
        href,
      );
  }
}

/** Acompte émis non « traité » alors qu'une facture finale existe (§ 5.2). */
export function depositItem(input: {
  ownerKind: 'order' | 'contract';
  ownerId: string;
  number: string;
  references: readonly string[];
}): SalesContractMyTaskItem {
  const id = `${SALES_CONTRACTS_AGENDA_ID_PREFIX}deposit_not_resolved:${input.ownerKind}:${input.ownerId}`;
  const what = `${input.ownerKind === 'order' ? 'commande' : 'contrat'} ${input.number}`;
  const refs = input.references.filter((r) => r.trim() !== '');
  return {
    source: 'sales_contracts',
    kind: 'deposit_not_resolved',
    id,
    title: clip(
      refs.length === 0
        ? `Acompte à marquer « traité » — ${what}`
        : `Acompte ${refs.join(', ')} à marquer « traité » — ${what}`,
    ),
    detail:
      'Une facture finale existe. Comment elle tient compte de l’acompte est à confirmer avec votre expert-comptable ; Lalanda ne retire rien automatiquement.',
    contractId: input.ownerKind === 'contract' ? input.ownerId : null,
    amendmentId: null,
    orderId: input.ownerKind === 'order' ? input.ownerId : null,
    dueDate: null,
    priority: 'none',
    rank: id,
    done: false,
    kindLabel: SALES_CONTRACT_AGENDA_LABELS.deposit_not_resolved,
    count: Math.max(1, input.references.length),
    href:
      input.ownerKind === 'order'
        ? salesOrderHref(input.ownerId)
        : salesContractHref(input.ownerId),
  };
}

/** Ordre stable : échéance (sans date en dernier), puis identifiant. */
export function compareAgendaItems(a: SalesContractMyTaskItem, b: SalesContractMyTaskItem): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
