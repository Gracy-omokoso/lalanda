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
 * applicatif doit lire les CGU, pas atterrir sur `/accueil`. N'étant ni
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
  // ADR-0038 — page d'arrivée et bureaux des trois modules.
  '/accueil',
  '/build',
  '/run',
  '/grow',
  // ADR-0038 — les initiatives (nom interne : projets). `/projects` reste listé :
  // la redirection 308 de `next.config.mjs` passe avant le middleware, mais
  // une ancienne URL ne doit jamais devenir une page ouverte si elle saute.
  '/initiatives',
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
  // S21b — la console Lalanda (`/admin`) n'est plus listée ici : elle a sa propre
  // liste, `CONSOLE_PREFIXES` (ADR-0053 — P1), et reste protégée par
  // `isProtectedPath`.
  // S25c (ADR-0022) — clients et catalogue. Exige une session ET une
  // organisation active, comme `/organisation` ; seule la première est vue ici.
  '/ventes',
  // ADR-0040 § 8.1 — application CRM, sortie de `/ventes`. Session ET
  // organisation active, comme `/ventes` ; `/ventes` reste listé (les anciennes
  // URL `/ventes/crm/**` sont redirigées en 308 par `next.config.mjs`).
  '/crm',
  // ADR-0034 — dépenses et trésorerie. Session ET organisation active, comme `/ventes`.
  '/tresorerie',
  // ADR-0032 — espace Croissance (GROW). Session ET organisation active, comme
  // `/ventes` ; seule la première est vue ici.
  '/croissance',
  // ADR-0036 — Idea Lab (BUILD). Session ET organisation active, comme `/croissance`.
  '/idees',
  // ADR-0037 — business plan narratif (BUILD).
  '/business-plan',
  // ADR-0039 — L2 : boîte de notifications (session ET organisation active).
  '/notifications',
  // ADR-0039 — projets et tâches du RUN (module `work`). Session ET organisation
  // active ; `/projets` est distinct de `/projects` (initiatives BUILD).
  '/projets',
  // ADR-0044 § 8 — achats et fournisseurs (RUN). Session ET organisation active.
  '/achats',
  // ADR-0045 § 8 — ressources humaines (RUN). Session ET organisation active.
  '/rh',
  // ADR-0046 — S8 : stocks, équipements et documents (RUN). Session ET
  // organisation active ; équipements et documents ont leur coquille dès S8.
  '/stocks',
  '/equipements',
  '/documents',
  // ADR-0049 — K8 : comptabilité (RUN). Session ET organisation active.
  '/comptabilite',
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
  return (
    isConsolePath(pathname) ||
    PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  );
}

/**
 * ADR-0053 — P1 : la console Lalanda, espace des opérateurs de la plateforme,
 * séparé de l'espace organisation (groupe de routes `(console)`, même domaine,
 * URL `/admin` conservée — décision ouverte n° 1).
 *
 * Le middleware n'y vérifie QUE la session : il ne connaît pas les rôles
 * plateforme, et prétendre le contraire donnerait un faux sentiment de
 * protection. Les actions plateforme sont vérifiées par l'API à chaque appel
 * `/admin/**`, et la coquille de console se referme sur un écran de refus
 * explicite. C'est une redirection de CONFORT, pas un contrôle d'accès.
 *
 * La console n'exige AUCUNE organisation active (ADR-0053 § 2.2) : un opérateur
 * sans appartenance doit pouvoir l'ouvrir.
 */
export const CONSOLE_PREFIXES = ['/admin'] as const;

/** Ce chemin appartient-il à la console Lalanda ? Frontière de segment. */
export function isConsolePath(pathname: string): boolean {
  return CONSOLE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * En-têtes posés par le middleware sur toute page de la console : jamais mise en
 * cache (un écran d'opérateur ne doit survivre ni dans un cache partagé ni dans
 * l'historique d'un poste prêté), jamais indexée.
 */
export const CONSOLE_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

/**
 * ADR-0048 — pages PUBLIQUES sans session : le formulaire de prospects d'une
 * organisation (`/f/<jeton>`), ouvert par un visiteur anonyme de son site.
 *
 * Ni protégées (un visiteur n'a pas de compte), ni marketing (un membre connecté
 * qui ouvre le lien pour le vérifier doit voir le formulaire, pas `/accueil`).
 * Le jeton fait autorité côté API ; ce classement n'est que l'aiguillage.
 */
export const PUBLIC_FORM_PREFIXES = [
  '/f',
  // ADR-0069 : vérification publique d'une carte de service (`/v/<jeton>`).
  '/v',
] as const;

/** Ce chemin est-il une page publique de formulaire (ADR-0048) ? */
export function isPublicFormPath(pathname: string): boolean {
  return PUBLIC_FORM_PREFIXES.some((prefix) => pathname.startsWith(`${prefix}/`));
}

/** Ce chemin est-il une page d'authentification ? */
export function isAuthPath(pathname: string): boolean {
  return pathname === '/login' || pathname === '/register';
}

/** Ce chemin est-il une page marketing publique ? */
export function isMarketingPath(pathname: string): boolean {
  return (MARKETING_PATHS as readonly string[]).includes(pathname);
}
