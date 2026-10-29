// Relances du CRM dans « Mes tâches » — ADR-0040 — C4 (§ 5, O3).
//
// Une seule liste, sans copie : `GET /work/my-tasks` lit en plus, en lecture
// seule, les activités CRM non faites assignées à l'appelant et à échéance. Chaque
// élément porte sa SOURCE ; cocher appelle la route du module propriétaire
// (`POST /crm/activities/:id/complete`, `…/reopen`). Ce fichier ne contient que
// la forme de l'élément et le lien qu'il ouvre : aucune règle métier.

/** Natures d'activité CRM (ADR-0035 § 2), recopiées pour garder le contrat sans dépendance. */
export type CrmAgendaActivityKind = 'call' | 'meeting' | 'note' | 'follow_up';

/** Préfixe des identifiants d'éléments CRM : disjoints de ceux des tâches. */
export const CRM_AGENDA_ID_PREFIX = 'crm:' as const;

/** Éléments lus au plus PAR SOURCE dans « Mes tâches » (§ 5.2). */
export const MY_TASKS_MAX_PER_SOURCE = 500;

/** Élément CRM de « Mes tâches » et de son calendrier (§ 5.2). */
export interface CrmMyTaskItem {
  source: 'crm';
  /** `crm:<activityId>`. */
  id: string;
  activityId: string;
  kind: CrmAgendaActivityKind;
  /** « Appel », « Réunion », « Relance »… */
  kindLabel: string;
  subject: string;
  notes: string | null;
  /** Jour d'échéance `AAAA-MM-JJ` au jour de Kinshasa (`dueDay`). */
  dueDate: string;
  /** Instant d'échéance ISO 8601 (l'heure est conservée quand on déplace le jour). */
  dueAt: string;
  priority: 'none';
  /** Rang de tri dans un même jour : l'instant d'échéance. */
  rank: string;
  done: false;
  accountId: string | null;
  accountName: string | null;
  opportunityId: string | null;
  opportunityTitle: string | null;
  contactId: string | null;
  contactName: string | null;
  customerId: string | null;
  assigneeUserId: string;
  /** Révision de l'activité (`expectedRevision` des écritures). */
  revision: number;
  /** Écran ouvert par un clic : l'opportunité, sinon le compte, sinon le contact. */
  href: string;
}

/**
 * Lien d'une relance (routes de l'application `/crm`, ADR-0040 § 8.1) :
 * l'opportunité, sinon le compte, sinon le contact, sinon la liste des activités.
 */
export function crmAgendaHref(a: {
  activityId: string;
  opportunityId: string | null;
  accountId: string | null;
  contactId: string | null;
}): string {
  if (a.opportunityId) return `/crm/opportunites/${a.opportunityId}`;
  if (a.accountId) return `/crm/comptes/${a.accountId}`;
  if (a.contactId) return `/crm/contacts?contact=${a.contactId}`;
  return `/crm/activites?activite=${a.activityId}`;
}

/** Identifiant d'élément d'une activité (`crm:<activityId>`). */
export function crmAgendaId(activityId: string): string {
  return `${CRM_AGENDA_ID_PREFIX}${activityId}`;
}
