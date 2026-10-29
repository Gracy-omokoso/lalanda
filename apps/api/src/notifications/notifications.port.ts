// Port de notifications in-app (ADR-0039 O6 et § 6.6) — contrat entre les modules
// PRODUCTEURS (work aujourd'hui ; CRM, factures, brief demain) et le module
// générique `notifications` (lot L2), qui stocke, déduplique, sert et marque
// comme lu sans connaître aucun producteur.
//
// Motif de `morning-brief.ports.ts` : un jeton, une interface, un fournisseur nul
// par défaut. Le module `notifications` (L2, `@Global`) fournit le jeton ; tant
// qu'il n'est pas chargé — tests d'un module producteur, lots livrés dans le
// désordre — un producteur injecte le port en FACULTATIF et retombe sur
// `noNotifications` :
//
//   constructor(
//     @Optional() @Inject(NOTIFICATIONS_PORT) port: NotificationsPort | null,
//   ) {
//     this.notifications = port ?? noNotifications;
//   }
//
// Contrat du port (toute implémentation le respecte) :
//
// - `notify()` est appelé HORS de la transaction métier : une notification
//   perdue ne défait jamais une assignation ni un commentaire. L'implémentation
//   ne lève donc pas pour une raison métier ; elle journalise ses propres échecs
//   et rend la main ;
// - l'auteur d'un geste n'est jamais notifié de son propre geste
//   (`recipientUserId === actorUserId` → ignoré) ;
// - un type coupé par le destinataire (`notification_preferences.mutedKinds`)
//   n'est pas enregistré ;
// - `dedupeKey` est unique par (organisation, destinataire) : réémettre la même
//   clé ne crée pas de doublon (rappels d'échéance rejoués) ;
// - le destinataire doit être membre de l'organisation et détenir
//   `requiredAction` au moment de l'émission ; l'action est REVÉRIFIÉE à la
//   lecture (un membre qui la perd ne voit plus ses notifications) ;
// - `href` est un chemin relatif (`isNotificationHref`), `title` ≤ 200 caractères,
//   figé à l'émission.

import type { NotificationEmission } from '@lalanda/shared/notifications';

import type { Action } from '../authz/permissions.js';

export const NOTIFICATIONS_PORT = Symbol('NOTIFICATIONS_PORT');

/** Une notification à émettre ; `requiredAction` est une action RBAC réelle. */
export type NotificationInput = NotificationEmission<Action>;

export interface NotificationsPort {
  /** Émet une notification. Ne lève pas pour une raison métier (voir l'en-tête). */
  notify(input: NotificationInput): Promise<void>;
}

/** Sans module de notifications (tests, lots non encore fusionnés) : rien n'est émis. */
export const noNotifications: NotificationsPort = {
  notify: async () => undefined,
};
