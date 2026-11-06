// Paramètres de la rubrique Projets — règles d'écran pures (ADR-0061), testées.
//
// Deux volets : « Mes notifications » (chacun, pour soi) et « Comportement des
// projets » (organisation, `work.manage`). L'écran prépare les corps ; le serveur
// valide et APPLIQUE chaque réglage (aucun n'est décoratif).

import {
  WORK_NOTIFICATION_EVENTS,
  type PutWorkNotificationPreferencesBody,
  type PutWorkSettingsBody,
  type WorkBehaviorSettings,
  type WorkNotificationEvent,
  type WorkNotificationPreferences,
  type WorkSettingsView,
  type WhatsAppNumberStatus,
  type WhatsAppUnavailableReason,
  type WhatsAppView,
} from '@lalanda/shared/work';

export const ONGLETS_PARAMETRES = [
  { id: 'notifications', label: 'Mes notifications' },
  { id: 'comportement', label: 'Comportement des projets' },
  // ADR-0064 : connexion de l'espace Slack (`organization.manage`).
  { id: 'slack', label: 'Slack' },
] as const;
export type OngletParametres = (typeof ONGLETS_PARAMETRES)[number]['id'];

/** Canaux réglables d'un événement. */
export type CanalNotification = 'bell' | 'email' | 'slack' | 'whatsapp';

// ── ADR-0065 : WhatsApp ───────────────────────────────────────────────────────

/** Valeur proposée dans le champ du numéro (indicatif de la RDC). */
export const NUMERO_WHATSAPP_INITIAL = '+243 ';

/** Étape du bloc « WhatsApp » de « Mes notifications ». */
export type EtapeWhatsApp = 'indisponible' | 'saisie' | 'code' | 'verifie' | 'a-reprendre';

export function etapeWhatsApp(v: WhatsAppView): EtapeWhatsApp {
  if (!v.available) return 'indisponible';
  const n = v.number;
  if (!n) return 'saisie';
  if (n.code) return 'code';
  if (n.status === 'verified') return 'verifie';
  if (n.status === 'pending') return 'saisie';
  return 'a-reprendre';
}

/**
 * Colonne WhatsApp du tableau : visible quand le fournisseur est disponible ; ses
 * interrupteurs ne s'allument qu'avec un numéro vérifié (le serveur refuse sinon).
 */
export function colonneWhatsApp(v: WhatsAppView | null): { visible: boolean; active: boolean } {
  if (!v || !v.available) return { visible: false, active: false };
  return { visible: true, active: v.number?.status === 'verified' };
}

export function libelleIndisponibleWhatsApp(r: WhatsAppUnavailableReason | null): string {
  switch (r) {
    case 'switched_off':
      return 'WhatsApp est momentanément coupé sur Lalanda. Vos autres notifications continuent.';
    case 'provider_error':
      return 'WhatsApp est momentanément indisponible : l’équipe Lalanda a été prévenue. Vos autres notifications continuent.';
    default:
      return 'WhatsApp n’est pas encore disponible sur Lalanda. Rien ne change pour vos notifications (cloche et e-mail).';
  }
}

export function libelleEtatWhatsApp(status: WhatsAppNumberStatus | null): string {
  switch (status) {
    case 'verified':
      return 'Vérifié';
    case 'pending':
      return 'Code envoyé';
    case 'to_verify':
      return 'À vérifier';
    case 'opted_out':
      return 'Désactivé par « STOP »';
    default:
      return 'Aucun numéro';
  }
}

/** Explication d'un numéro à reprendre (« à vérifier », « STOP »). */
export function explicationReprise(status: WhatsAppNumberStatus | null): string | null {
  if (status === 'to_verify') {
    return 'WhatsApp n’a pas pu remettre de message à ce numéro. Vérifiez-le, puis demandez un nouveau code.';
  }
  if (status === 'opted_out') {
    return 'Vous avez répondu « STOP » : plus aucun message ne vous est envoyé. Demandez un nouveau code pour réactiver WhatsApp.';
  }
  return null;
}

export function ongletParametres(
  v: string | null,
  gerer: boolean,
  diriger = false,
): OngletParametres {
  if (v === 'comportement' && gerer) return 'comportement';
  if (v === 'slack' && diriger) return 'slack';
  return 'notifications';
}

/** Onglets visibles : « Comportement » pour `work.manage`, « Slack » pour `organization.manage`. */
export function ongletsVisibles(
  gerer: boolean,
  diriger: boolean,
): (typeof ONGLETS_PARAMETRES)[number][] {
  return ONGLETS_PARAMETRES.filter(
    (o) =>
      o.id === 'notifications' ||
      (o.id === 'comportement' && gerer) ||
      (o.id === 'slack' && diriger),
  );
}

/**
 * Retour de l'aller-retour Slack (`?slack=…` posé par l'API) : message affiché et ton.
 * `null` si le paramètre est absent ou inconnu (rien à dire).
 */
export function retourSlack(
  v: string | null,
): { ton: 'succes' | 'info' | 'erreur'; message: string } | null {
  switch (v) {
    case null:
      return null;
    case 'connecte':
      return { ton: 'succes', message: 'Espace Slack connecté. Les notifications peuvent partir.' };
    case 'annule':
      return { ton: 'info', message: 'Connexion annulée dans Slack : rien n’a changé.' };
    case 'erreur-etat':
      return {
        ton: 'erreur',
        message: 'Le lien de connexion a expiré ou n’est pas valide. Recommencez depuis cet écran.',
      };
    case 'erreur-session':
      return {
        ton: 'erreur',
        message:
          'La connexion doit être terminée par la personne qui l’a lancée, dans la même session.',
      };
    case 'erreur-droit':
      return {
        ton: 'erreur',
        message: 'Seuls le Propriétaire et l’Administrateur peuvent connecter Slack.',
      };
    case 'erreur-indisponible':
      return { ton: 'erreur', message: 'Slack n’est pas encore disponible sur Lalanda.' };
    default:
      return {
        ton: 'erreur',
        message: 'Slack n’a pas confirmé la connexion. Réessayez dans quelques instants.',
      };
  }
}

/** Libellé de l'état d'une connexion. */
export function libelleEtatSlack(status: string | null): string {
  switch (status) {
    case 'active':
      return 'Connecté';
    case 'reconnect_required':
      return 'À reconnecter';
    case 'uninstalled':
      return 'Application retirée de Slack — à reconnecter';
    default:
      return 'Non connecté';
  }
}

/** Bascule un canal (cloche, e-mail ou Slack) d'un événement. */
export function basculerCanal(
  p: WorkNotificationPreferences,
  event: WorkNotificationEvent,
  canal: CanalNotification,
): WorkNotificationPreferences {
  return {
    ...p,
    events: { ...p.events, [event]: { ...p.events[event], [canal]: !p.events[event][canal] } },
  };
}

/** Tout couper ou tout rétablir sur un canal. */
export function toutLeCanal(
  p: WorkNotificationPreferences,
  canal: CanalNotification,
  valeur: boolean,
): WorkNotificationPreferences {
  const events = { ...p.events };
  for (const e of WORK_NOTIFICATION_EVENTS) events[e] = { ...events[e], [canal]: valeur };
  return { ...p, events };
}

export function corpsPreferences(
  p: WorkNotificationPreferences,
  revision: number,
): PutWorkNotificationPreferencesBody {
  return { expectedRevision: revision, events: p.events, digest: p.digest };
}

/** Heures proposées pour le résumé (Kinshasa). */
export const HEURES_RESUME = Array.from({ length: 24 }, (_, h) => h);
export const libelleHeure = (h: number): string => `${String(h).padStart(2, '0')} h 00`;

export const JOURS = [
  { iso: 1, court: 'Lun', long: 'lundi' },
  { iso: 2, court: 'Mar', long: 'mardi' },
  { iso: 3, court: 'Mer', long: 'mercredi' },
  { iso: 4, court: 'Jeu', long: 'jeudi' },
  { iso: 5, court: 'Ven', long: 'vendredi' },
  { iso: 6, court: 'Sam', long: 'samedi' },
  { iso: 7, court: 'Dim', long: 'dimanche' },
] as const;

/**
 * Rôles qui gèrent les projets (`work.manage`) et peuvent donc figurer parmi les
 * créateurs. La direction (Propriétaire, Administrateur) crée toujours.
 */
export const ROLES_CREATEURS = [
  { role: 'owner', label: 'Propriétaire', direction: true },
  { role: 'admin', label: 'Administrateur', direction: true },
  { role: 'finance_director', label: 'Directeur financier', direction: false },
  // ADR-0059 : le Manager / Chef d'équipe gère aussi les projets.
  { role: 'team_manager', label: 'Manager / Chef d’équipe', direction: false },
] as const;

/** Bascule un jour ouvré ; refuse de retirer le dernier. */
export function basculerJour(jours: readonly number[], iso: number): number[] {
  const next = jours.includes(iso) ? jours.filter((j) => j !== iso) : [...jours, iso];
  return next.length === 0 ? [...jours] : [...next].sort((a, b) => a - b);
}

/**
 * Corps de `PUT /work/settings` : les réglages existants (étiquettes, colonnes,
 * « échéance proche ») repris tels quels, le comportement remplacé par `patch`.
 */
export function corpsComportement(
  s: WorkSettingsView,
  patch: Partial<WorkBehaviorSettings> & { dueSoonDays?: number },
): PutWorkSettingsBody {
  return {
    expectedRevision: s.revision,
    labels: s.labels,
    defaultColumns: s.defaultColumns,
    dueSoonDays: patch.dueSoonDays ?? s.dueSoonDays,
    projectCreatorRoles:
      patch.projectCreatorRoles !== undefined ? patch.projectCreatorRoles : s.projectCreatorRoles,
    defaultVisibility: patch.defaultVisibility ?? s.defaultVisibility,
    defaultView: patch.defaultView ?? s.defaultView,
    workingDays: patch.workingDays ?? s.workingDays,
    autoArchiveCompletedDays:
      patch.autoArchiveCompletedDays !== undefined
        ? patch.autoArchiveCompletedDays
        : s.autoArchiveCompletedDays,
    managersModerateComments: patch.managersModerateComments ?? s.managersModerateComments,
    showTaskNumbers: patch.showTaskNumbers ?? s.showTaskNumbers,
  };
}

/** « Qui peut créer » : `null` (tous les gestionnaires) ou la liste cochée. */
export function createurs(
  actuels: readonly string[] | null,
  role: string,
  coche: boolean,
): string[] | null {
  const base = actuels ?? ROLES_CREATEURS.map((r) => r.role);
  const next = coche ? [...new Set([...base, role])] : base.filter((r) => r !== role);
  const tous = ROLES_CREATEURS.every((r) => next.includes(r.role));
  return tous ? null : next;
}
