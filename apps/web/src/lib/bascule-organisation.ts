// Bascule d'une organisation à l'autre (ADR-0052 — O1 et O5).
//
// « Nouvelle organisation, c'est nouvelle entreprise » : après une bascule, AUCUN état de
// l'ancienne organisation ne doit survivre dans le navigateur. Les contextes React (droits,
// offre, modules, profil), le cache du routeur Next et les données chargées par chaque
// écran vivent en mémoire : seul un rechargement COMPLET de la page les vide tous à coup
// sûr. Un `router.push` + `router.refresh` ne suffisait pas : les états locaux des
// composants restés montés (sélecteur, coquille, panneaux) gardaient l'ancienne
// organisation jusqu'à leur prochaine lecture.
//
// La bascule est donc : poser le cookie, effacer les reprises de session propres à une
// organisation, laisser un message d'une ligne pour la page suivante, puis recharger.
// Les clés `localStorage` restent, elles, suffixées par organisation (ADR-0052 § 6).

import { setActiveOrgCookie } from './api';

/**
 * Clés `sessionStorage` qui décrivent une action EN COURS dans l'organisation active.
 * `lalanda.fiscalite.reprise` : reprise d'une action fiscale après ré-authentification
 * (`reauth-dialog.tsx`) — rejouée dans une autre organisation, elle viserait la mauvaise.
 */
export const CLES_SESSION_ORGANISATION = ['lalanda.fiscalite.reprise'] as const;

/** Message d'une ligne affiché après le rechargement (bannière des invitations). */
export const CLE_MESSAGE_BASCULE = 'lalanda.bascule.message';

/** « Vous êtes maintenant dans l'espace de X. » — repli neutre si le nom manque. */
export function messageBascule(nomOrganisation: string | null | undefined): string {
  const nom = nomOrganisation?.trim();
  return nom
    ? `Vous êtes maintenant dans l’espace de ${nom}.`
    : 'Vous êtes maintenant dans l’espace de cette organisation.';
}

/** Destinations admises : un chemin interne, jamais une URL fournie de l'extérieur. */
export function destinationSure(destination: string): string {
  return destination.startsWith('/') && !destination.startsWith('//') ? destination : '/accueil';
}

/** Ce dont la bascule a besoin — injecté pour être testé sans navigateur. */
export interface EnvironnementBascule {
  poserCookie: (organizationId: string) => void;
  session: Pick<Storage, 'removeItem' | 'setItem'> | null;
  recharger: (destination: string) => void;
}

function environnementNavigateur(): EnvironnementBascule {
  let session: Storage | null = null;
  try {
    session = window.sessionStorage;
  } catch {
    session = null; // stockage bloqué : la bascule se fait quand même, sans message
  }
  return {
    poserCookie: setActiveOrgCookie,
    session,
    recharger: (destination) => window.location.assign(destination),
  };
}

/**
 * Bascule vers `organisation` puis RECHARGE la page sur `destination` (par défaut
 * l'accueil). Tout l'état en mémoire de l'organisation précédente disparaît.
 */
export function basculerOrganisation(
  organisation: { id: string; name?: string | null },
  destination = '/accueil',
  env: EnvironnementBascule = environnementNavigateur(),
): void {
  env.poserCookie(organisation.id);
  if (env.session) {
    try {
      for (const cle of CLES_SESSION_ORGANISATION) env.session.removeItem(cle);
      env.session.setItem(CLE_MESSAGE_BASCULE, messageBascule(organisation.name));
    } catch {
      /* stockage plein ou bloqué : le message est perdu, pas la bascule */
    }
  }
  env.recharger(destinationSure(destination));
}

/** Lit puis efface le message laissé par la bascule (une seule fois). */
export function prendreMessageBascule(
  session: Pick<Storage, 'getItem' | 'removeItem'> | null,
): string | null {
  if (!session) return null;
  try {
    const message = session.getItem(CLE_MESSAGE_BASCULE);
    if (message !== null) session.removeItem(CLE_MESSAGE_BASCULE);
    return message && message.trim() ? message : null;
  } catch {
    return null;
  }
}
