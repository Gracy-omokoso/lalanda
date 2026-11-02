// Logique pure de la boîte de notifications (ADR-0039 § 8, lot L2).
//
// Même discipline que `nav-model.ts` : ce qui DÉCIDE — compteur affiché, nom
// accessible de la cloche, libellés des types, date relative, mises à jour
// locales après un marquage, lien sûr — vit ici et se teste sans DOM. La cloche
// (`_components/notifications-bell.tsx`) et la page `/notifications` ne font
// qu'assembler.

import {
  NOTIFICATION_KINDS,
  NOTIFICATION_LIMITS,
  isNotificationHref,
  type NotificationKind,
  type NotificationView,
} from '@lalanda/shared/notifications';

export const NOTIFICATIONS_HREF = '/notifications';

/** Nombre de notifications du panneau de la cloche (ADR-0039 § 8 : les 20 dernières). */
export const TAILLE_PANNEAU = NOTIFICATION_LIMITS.bellPanelSize;

/** Intervalle d'interrogation du compteur quand l'onglet est visible (60 s). */
export const INTERVALLE_COMPTEUR_MS = NOTIFICATION_LIMITS.unreadPollMs;

/** Libellé et explication de chaque type (préférences, page). */
export const LIBELLES_TYPES: Record<NotificationKind, { label: string; aide: string }> = {
  'work.task_assigned': {
    label: 'Tâche assignée',
    aide: 'Quelqu’un vous confie une tâche.',
  },
  'work.mentioned': {
    label: 'Mention',
    aide: 'Quelqu’un vous cite dans un commentaire.',
  },
  'work.comment_on_followed': {
    label: 'Commentaire sur une tâche suivie',
    aide: 'Nouveau commentaire sur une tâche que vous suivez.',
  },
  'work.task_due_soon': {
    label: 'Échéance proche',
    aide: 'Une de vos tâches arrive à échéance.',
  },
  'work.task_overdue': {
    label: 'Tâche en retard',
    aide: 'Une de vos tâches a dépassé son échéance.',
  },
  'work.milestone_completed': {
    label: 'Jalon terminé',
    aide: 'Un jalon d’un projet dont vous êtes responsable est terminé.',
  },
  // ADR-0040 — C4 § 5.4 : relances et opportunités du CRM.
  'crm.activity_assigned': {
    label: 'Relance assignée',
    aide: 'Quelqu’un vous confie un appel, une réunion ou une relance client.',
  },
  'crm.activity_due_soon': {
    label: 'Relance proche',
    aide: 'Une de vos relances clients arrive à échéance.',
  },
  'crm.activity_overdue': {
    label: 'Relance en retard',
    aide: 'Une de vos relances clients a dépassé son échéance.',
  },
  'crm.opportunity_assigned': {
    label: 'Opportunité confiée',
    aide: 'Vous devenez responsable d’une opportunité.',
  },
  'crm.opportunity_won': {
    label: 'Opportunité gagnée',
    aide: 'Une opportunité dont vous êtes responsable est gagnée.',
  },
  // ADR-0041 — A4 : décision ouverte n° 10, sans détail.
  'organization.permissions_changed': {
    label: 'Autorisations modifiées',
    aide: 'Vos autorisations dans l’organisation ont changé.',
  },
  // ADR-0044 — P0 (§ 6.5) : achats et fournisseurs.
  'purchases.approval_requested': {
    label: 'Demande d’achat à approuver',
    aide: 'Une demande d’achat attend votre approbation.',
  },
  'purchases.request_approved': {
    label: 'Demande d’achat approuvée',
    aide: 'Votre demande d’achat est approuvée et devient un bon de commande.',
  },
  'purchases.request_rejected': {
    label: 'Demande d’achat refusée',
    aide: 'Votre demande d’achat est refusée, avec le motif de l’approbateur.',
  },
  'purchases.invoice_variance': {
    label: 'Facture fournisseur en écart',
    aide: 'Une facture fournisseur ne correspond pas à la commande ou à la réception.',
  },
  'purchases.invoice_due_soon': {
    label: 'Facture fournisseur à payer bientôt',
    aide: 'Une facture fournisseur arrive à échéance.',
  },
  'purchases.invoice_overdue': {
    label: 'Facture fournisseur en retard',
    aide: 'Une facture fournisseur a dépassé son échéance.',
  },
  'purchases.supplier_payment_details_changed': {
    label: 'Coordonnées de paiement modifiées',
    aide: 'Les coordonnées bancaires ou mobile money d’un fournisseur ont changé.',
  },
  // ADR-0045 — H0 (§ 6.1) : ressources humaines. Aucun libellé ne nomme un type
  // d'absence confidentiel, un montant ni un numéro.
  'hr.leave_requested': {
    label: 'Absence à valider',
    aide: 'Une demande d’absence attend votre validation.',
  },
  'hr.leave_approved': {
    label: 'Absence validée',
    aide: 'Une demande d’absence est validée.',
  },
  'hr.leave_rejected': {
    label: 'Absence refusée',
    aide: 'Une demande d’absence est refusée, avec le motif du validateur.',
  },
  'hr.leave_cancelled': {
    label: 'Absence annulée',
    aide: 'Une absence déjà validée est annulée.',
  },
  'hr.probation_ending': {
    label: 'Fin de période d’essai proche',
    aide: 'La période d’essai d’un collaborateur arrive à son terme.',
  },
  'hr.contract_ending': {
    label: 'Fin de contrat proche',
    aide: 'Le contrat d’un collaborateur arrive à son terme.',
  },
  'hr.document_expiring': {
    label: 'Document RH bientôt expiré',
    aide: 'Un document ou une pièce d’identité d’un collaborateur arrive à expiration.',
  },
  'hr.checklist_item_assigned': {
    label: 'Tâche d’accueil ou de départ confiée',
    aide: 'Un élément d’une liste d’accueil ou de départ vous est confié.',
  },
  'hr.bank_details_changed': {
    label: 'Coordonnées bancaires modifiées',
    aide: 'Les coordonnées bancaires ou mobile money d’un collaborateur ont changé.',
  },
  // ADR-0051 — H8 (§ 7.5) : second volet RH. Aucun libellé ne porte un montant, un motif,
  // une note ni la mention « sur salaire ».
  'hr.expense_submitted': {
    label: 'Note de frais à valider',
    aide: 'Une note de frais attend votre validation.',
  },
  'hr.expense_approved': {
    label: 'Note de frais validée',
    aide: 'Une note de frais est validée ; elle attend son remboursement.',
  },
  'hr.expense_rejected': {
    label: 'Note de frais refusée',
    aide: 'Une note de frais est refusée, avec le commentaire du validateur.',
  },
  'hr.expense_reimbursed': {
    label: 'Note de frais remboursée',
    aide: 'Une note de frais est remboursée.',
  },
  'hr.advance_submitted': {
    label: 'Avance à valider',
    aide: 'Une demande d’avance attend votre validation.',
  },
  'hr.advance_decided': {
    label: 'Avance validée ou refusée',
    aide: 'Une demande d’avance a reçu une décision.',
  },
  'hr.advance_disbursed': {
    label: 'Avance versée',
    aide: 'Une avance est versée, ou attend son versement.',
  },
  'hr.advance_overdue': {
    label: 'Avance à régulariser',
    aide: 'Une avance versée n’est pas régularisée à la date annoncée.',
  },
  'hr.attendance_correction_requested': {
    label: 'Correction de pointage à décider',
    aide: 'Une demande de correction de pointage attend votre décision.',
  },
  'hr.attendance_correction_decided': {
    label: 'Correction de pointage décidée',
    aide: 'Votre demande de correction de pointage a reçu une décision.',
  },
  'hr.shifts_published': {
    label: 'Planning publié',
    aide: 'De nouveaux créneaux de planning vous concernent.',
  },
  'hr.shift_changed': {
    label: 'Créneau modifié',
    aide: 'Un créneau publié qui vous concerne a changé.',
  },
  'hr.review_step': {
    label: 'Évaluation : étape à faire',
    aide: 'Une évaluation attend votre action (rédaction, prise de connaissance).',
  },
  'hr.goal_proposed': {
    label: 'Objectif proposé',
    aide: 'Un objectif individuel attend votre accord.',
  },
  'hr.goal_agreed': {
    label: 'Objectif convenu',
    aide: 'Un objectif individuel est convenu.',
  },
  // ADR-0046 — S0 (§ 6.7) : stocks, équipements, documents. Aucun libellé ne porte un
  // coût, une valeur ni le titre d'un document.
  'stock.below_reorder': {
    label: 'Article sous le seuil',
    aide: 'Le stock d’un article est passé sous son seuil d’alerte.',
  },
  'stock.negative': {
    label: 'Stock négatif',
    aide: 'Une vente ou une annulation a rendu le stock d’un article négatif.',
  },
  'stock.pending_lines': {
    label: 'Entrées ou sorties à traiter',
    aide: 'De nouvelles lignes attendent un rattachement, une unité ou un coût.',
  },
  'stock.count_assigned': {
    label: 'Inventaire à compter',
    aide: 'Un inventaire vous est confié.',
  },
  'stock.count_submitted': {
    label: 'Inventaire à valider',
    aide: 'Un inventaire compté attend la validation de ses écarts.',
  },
  'assets.maintenance_due': {
    label: 'Maintenance à prévoir',
    aide: 'Une intervention de maintenance d’un équipement est due ou en retard.',
  },
  'assets.coverage_expiring': {
    label: 'Garantie ou assurance bientôt expirée',
    aide: 'Une garantie, une assurance ou un contrat d’un équipement arrive à échéance.',
  },
  'documents.expiring': {
    label: 'Document bientôt expiré',
    aide: 'Un document de la bibliothèque arrive à sa date d’expiration.',
  },
};

/** Types dans l'ordre d'affichage des préférences. */
export const TYPES_AFFICHES: readonly NotificationKind[] = NOTIFICATION_KINDS;

/** Pastille du compteur : rien à zéro, « 99+ » au-delà de 99. */
export function pastilleCompteur(nonLues: number): string | null {
  if (!Number.isFinite(nonLues) || nonLues <= 0) return null;
  return nonLues > 99 ? '99+' : String(Math.floor(nonLues));
}

/** Nom accessible du bouton de la cloche : le compteur est dit, pas seulement montré. */
export function nomAccessibleCloche(nonLues: number): string {
  if (!Number.isFinite(nonLues) || nonLues <= 0) return 'Notifications — aucune non lue';
  if (nonLues === 1) return 'Notifications — 1 non lue';
  return `Notifications — ${nonLues > 99 ? 'plus de 99' : Math.floor(nonLues)} non lues`;
}

/**
 * Lien d'une notification, revérifié avant rendu : un chemin relatif de
 * l'application, sinon la page des notifications. L'API le valide déjà ; le
 * revérifier ici ferme la porte à un lien absolu glissé en base.
 */
export function lienSur(href: string): string {
  return isNotificationHref(href) ? href : NOTIFICATIONS_HREF;
}

const MINUTE = 60_000;
const HEURE = 60 * MINUTE;
const JOUR = 24 * HEURE;

/** Date relative en français ; au-delà de 6 jours, date courte au fuseau de Kinshasa. */
export function dateRelative(createdAt: string, maintenant: Date): string {
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return '';
  const ecart = maintenant.getTime() - t;
  if (ecart < MINUTE) return 'à l’instant';
  if (ecart < HEURE) return `il y a ${Math.floor(ecart / MINUTE)} min`;
  if (ecart < JOUR) return `il y a ${Math.floor(ecart / HEURE)} h`;
  const jours = Math.floor(ecart / JOUR);
  if (jours === 1) return 'hier';
  if (jours < 7) return `il y a ${jours} jours`;
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Africa/Kinshasa',
    ...(new Date(t).getUTCFullYear() !== maintenant.getUTCFullYear() ? { year: 'numeric' } : {}),
  }).format(new Date(t));
}

/** Marque une notification lue dans la liste locale (sans relire l'API). */
export function marquerLue(
  items: readonly NotificationView[],
  id: string,
  lueA: string,
): NotificationView[] {
  return items.map((n) => (n.id === id && n.readAt === null ? { ...n, readAt: lueA } : n));
}

/** Marque toute la liste locale comme lue. */
export function toutMarquerLu(
  items: readonly NotificationView[],
  lueA: string,
): NotificationView[] {
  return items.map((n) => (n.readAt === null ? { ...n, readAt: lueA } : n));
}

/** Ajoute une page à la liste, sans doublon (une notification arrivée entre deux pages). */
export function ajouterPage(
  items: readonly NotificationView[],
  page: readonly NotificationView[],
): NotificationView[] {
  const vus = new Set(items.map((n) => n.id));
  return [...items, ...page.filter((n) => !vus.has(n.id))];
}

/** Compteur après le marquage d'une notification : décrémente si elle n'était pas lue. */
export function compteurApresLecture(
  nonLues: number,
  items: readonly NotificationView[],
  id: string,
): number {
  const n = items.find((x) => x.id === id);
  return n && n.readAt === null ? Math.max(0, nonLues - 1) : nonLues;
}

/** Bascule un type dans la liste des types coupés (ordre canonique conservé). */
export function basculerTypeCoupe(
  coupes: readonly NotificationKind[],
  kind: NotificationKind,
): NotificationKind[] {
  const set = new Set(coupes);
  if (set.has(kind)) set.delete(kind);
  else set.add(kind);
  return NOTIFICATION_KINDS.filter((k) => set.has(k));
}

/** Le compteur n'est interrogé que si l'onglet est visible (ADR-0039 § 6.6). */
export function doitInterroger(visibilite: DocumentVisibilityState | undefined): boolean {
  return visibilite !== 'hidden';
}

/**
 * Événement de fenêtre émis après un marquage depuis la page : la cloche relit
 * alors son compteur sans attendre l'interrogation suivante.
 */
export const EVENEMENT_NOTIFICATIONS = 'lalanda:notifications-changees';
