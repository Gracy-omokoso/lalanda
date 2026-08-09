// Classement des routes web par besoin de session.
//
// Extrait de `middleware.ts` pour être testable : le middleware importe
// `next/server`, que les tests unitaires (vitest en environnement node) n'ont pas
// à charger. La règle, elle, est de la logique pure — et c'est exactement le
// genre de liste qu'on oublie de compléter en ajoutant un espace, ce qui laisse
// des pages protégées ouvertes sans que rien ne le signale.

/**
 * Routes marketing publiques. Un authentifié y est renvoyé vers l'application.
 *
 * LES PAGES LÉGALES N'EN FONT PAS PARTIE, et c'est délibéré (S22c). Elles vivent
 * dans le même route group `(marketing)` mais ne doivent déclencher AUCUNE
 * redirection : un membre connecté qui clique sur « CGU » depuis le footer
 * applicatif doit lire les CGU, pas atterrir sur `/projects`. N'étant ni
 * marketing, ni auth, ni protégées, elles traversent le middleware sans
 * traitement — la liste faisant foi est `lib/legal.ts`, et `legal.test.ts`
 * vérifie qu'aucune d'elles n'a glissé dans les tableaux de ce fichier.
 */
export const MARKETING_PATHS = ['/', '/pricing'] as const;

/**
 * Préfixes exigeant une session.
 *
 * `/compte` (S20b) exige une session mais AUCUNE organisation — c'est le seul
 * espace dans ce cas (ADR-0012 §9). La distinction ne concerne pas ce fichier :
 * le middleware ne regarde que le cookie de session, jamais l'organisation.
 */
export const PROTECTED_PREFIXES = [
  '/projects',
  '/members',
  '/invitations',
  '/compte',
  // S21a — l'espace organisation exige une session ET une organisation active.
  // Le middleware ne vérifie que la première : l'absence d'organisation est un
  // 403 côté API, que les pages traitent comme un état, pas comme une panne.
  '/organisation',
  // S22b — tunnel de souscription. Route AUTONOME et non un onglet de
  // `/organisation` : on y arrive depuis la page tarifs publique, depuis une
  // bannière d'essai qui expire, ou depuis le retour d'un fournisseur de
  // paiement. Un tunnel logé sous un onglet obligerait chacun de ces chemins à
  // traverser un écran qui n'a rien à voir avec la décision en cours.
  '/souscription',
] as const;

/**
 * Ce chemin exige-t-il une session ?
 *
 * La comparaison est faite sur des SEGMENTS complets : `/comptes-annuels` ne doit
 * pas être protégé par l'entrée `/compte`. Un simple `startsWith(prefix)` ferait
 * exactement cette erreur et rendrait inaccessible une future page publique dont
 * le nom commence par le même mot.
 */
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Ce chemin est-il une page d'authentification ? */
export function isAuthPath(pathname: string): boolean {
  return pathname === '/login' || pathname === '/register';
}

/** Ce chemin est-il une page marketing publique ? */
export function isMarketingPath(pathname: string): boolean {
  return (MARKETING_PATHS as readonly string[]).includes(pathname);
}
