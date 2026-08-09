// Classement des routes web par besoin de session.
//
// Extrait de `middleware.ts` pour être testable : le middleware importe
// `next/server`, que les tests unitaires (vitest en environnement node) n'ont pas
// à charger. La règle, elle, est de la logique pure — et c'est exactement le
// genre de liste qu'on oublie de compléter en ajoutant un espace, ce qui laisse
// des pages protégées ouvertes sans que rien ne le signale.

/** Routes marketing publiques. Un authentifié y est renvoyé vers l'application. */
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
  // S21b — espace admin plateforme. Le middleware n'y vérifie QUE la session :
  // il ne connaît pas les rôles plateforme, et prétendre le contraire donnerait
  // un faux sentiment de protection. Le rôle est vérifié par `PermissionsGuard`
  // à chaque appel d'API, et l'espace se referme sur un écran de refus explicite
  // (voir `admin/layout.tsx`). C'est délibérément une redirection de CONFORT,
  // pas un contrôle d'accès.
  '/admin',
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
