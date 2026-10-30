// Nouvelle acceptation des conditions après connexion (ADR-0043, docs/28 § 2.3 bis).
//
// Modèle pur de l'écran `TermsGate` : il décide QUOI afficher à partir de la
// réponse de `GET /legal/terms/acceptance`, sans rien savoir du rendu.
//
// Trois règles portées ici, et testées :
//
// 1. PAS DE CLIGNOTEMENT. Tant que la réponse n'est pas arrivée (`checking`),
//    rien n'est affiché : un utilisateur à jour ne voit jamais la fenêtre
//    s'ouvrir puis se refermer.
// 2. PAS DE BLOCAGE À VIE. Si la vérification échoue (réseau, 5xx), on ne
//    bloque pas l'application sur une supposition : un bandeau discret propose
//    de réessayer. Seule une réponse explicite `isCurrent: false` bloque. Une
//    session absente (401) n'affiche rien : la connexion est gérée ailleurs.
// 3. LA VERSION ENVOYÉE EST CELLE AFFICHÉE. Si le serveur exige une version
//    plus récente que celle embarquée dans la page (déploiement pendant la
//    session), accepter ne suffit pas : on demande de recharger la page plutôt
//    que d'enregistrer un accord sur un texte que l'utilisateur n'a pas vu.

export interface TermsAcceptanceState {
  currentVersion: string;
  acceptedVersion: string | null;
  isCurrent: boolean;
}

export type TermsGatePhase =
  /** Réponse attendue : rien n'est affiché. */
  | { kind: 'checking' }
  /** À jour, ou pas de session : rien n'est affiché. */
  | { kind: 'current' }
  /** Accord à (re)donner : fenêtre bloquante. */
  | { kind: 'required'; previousVersion: string | null }
  /** La page embarque une version plus ancienne que celle du serveur. */
  | { kind: 'reload'; serverVersion: string }
  /** Vérification impossible : bandeau non bloquant avec « Réessayer ». */
  | { kind: 'check-failed' };

/** Phase à partir de la réponse du serveur et de la version embarquée. */
export function phaseFromAcceptance(
  view: TermsAcceptanceState,
  displayedVersion: string,
): TermsGatePhase {
  if (view.isCurrent) return { kind: 'current' };
  if (view.currentVersion !== displayedVersion) {
    return { kind: 'reload', serverVersion: view.currentVersion };
  }
  return { kind: 'required', previousVersion: view.acceptedVersion };
}

/** Phase quand la lecture a échoué. Une session absente n'affiche rien. */
export function phaseFromCheckError(error: unknown): TermsGatePhase {
  return httpStatus(error) === 401 ? { kind: 'current' } : { kind: 'check-failed' };
}

/** Le bouton « Accepter » est-il actif ? Jamais sans la case cochée. */
export function canAccept({ checked, busy }: { checked: boolean; busy: boolean }): boolean {
  return checked && !busy;
}

/** Message affiché sous le bouton quand l'enregistrement de l'accord échoue. */
export function acceptErrorMessage(error: unknown): string {
  const status = httpStatus(error);
  if (status === 401) {
    return 'Votre session a expiré. Déconnectez-vous puis reconnectez-vous pour accepter les conditions.';
  }
  if (status === 400) {
    return 'Cette version des conditions n’est plus en vigueur. Rechargez la page pour lire la version actuelle.';
  }
  return 'Votre accord n’a pas pu être enregistré. Vérifiez votre connexion, puis réessayez.';
}

function httpStatus(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: unknown }).status;
    return typeof status === 'number' ? status : null;
  }
  return null;
}
