// ─────────────────────────────────────────────────────────────────────────────
// Logique pure de la coquille de la console Lalanda (ADR-0053 — P1, § 2.1)
//
// La console est l'espace des OPÉRATEURS de la plateforme. Elle vit dans son
// propre groupe de routes, `(console)`, sous l'URL `/admin` conservée : pas de
// sélecteur d'organisation, pas de barre BUILD · RUN · GROW, pas de cloche ni de
// `TermsGate` d'organisation. Tout ce qui DÉCIDE de son affichage vit ici, testé
// sans DOM (vitest en environnement `node`).
//
// ── Ce que ce fichier ne fait pas ─────────────────────────────────────────────
//
// Il n'AUTORISE rien. Les actions viennent de `GET /me/platform-access` (P0), et
// chaque route `/admin/**` est gardée côté API. Masquer un module est un confort ;
// une divergence produit au pire un module en trop qui répond 403, jamais un droit
// en trop. AUCUN nom de rôle n'est lu ici : seules les actions décident.
// ─────────────────────────────────────────────────────────────────────────────

import { isPlatformAction, type PlatformAction } from '@lalanda/shared/platform';

/** URL de la console (décision ouverte n° 1 : même domaine, `/admin`). */
export const CONSOLE_BASE = '/admin';

/** Retour vers l'espace organisation : sa page d'arrivée (ADR-0038 § 5). */
export const ESPACE_ORGANISATION_HREF = '/accueil';

/** Action qui ouvre la console (ADR-0053 § 5.2 : détenue par les six rôles). */
export const ACTION_CONSOLE: PlatformAction = 'platform.console.read';

/**
 * `disponible` : l'écran existe. `bientot` : le module est prévu par l'ADR et son
 * lot n'est pas livré — la page le dit plutôt que de répondre 404.
 */
export type EtatModule = 'disponible' | 'bientot';

export interface ModuleConsole {
  /** Clé stable de rendu et de test. */
  id: string;
  /** Premier segment sous `/admin` ; `''` pour le tableau de bord. */
  segment: string;
  label: string;
  /** Ce que contient le module, en une ligne (cartes du tableau de bord). */
  description: string;
  /** L'action plateforme qui ouvre le module (§ 5.1, colonne « Module »). */
  action: PlatformAction;
  etat: EtatModule;
}

/**
 * Les modules de la console, dans l'ordre du § 6 de l'ADR.
 *
 * Les segments des écrans repris de S21b (`organisations`, `utilisateurs`,
 * `integrations`, `journal`) sont conservés : liens, docs et tests restent justes.
 * Lots à venir : fonctionnalités (P4), annonces (P6),
 * statistiques et finances (P7) ; Country Packs et modèles sectoriels n'ont pas
 * encore de lot d'écran (leurs routes d'API existent).
 */
export const CONSOLE_MODULES: readonly ModuleConsole[] = [
  {
    id: 'tableau-de-bord',
    segment: '',
    label: 'Tableau de bord',
    description: 'Volumes de la plateforme et actes interdits à tout opérateur.',
    action: 'platform.console.read',
    etat: 'disponible',
  },
  {
    id: 'organisations',
    segment: 'organisations',
    label: 'Organisations',
    description: 'Rechercher une organisation, son offre et son état de suspension.',
    action: 'platform.orgs.read',
    etat: 'disponible',
  },
  {
    id: 'comptes',
    segment: 'utilisateurs',
    label: 'Comptes',
    description: 'Rechercher un compte, ses rôles plateforme et son blocage.',
    action: 'platform.users.read',
    etat: 'disponible',
  },
  {
    id: 'abonnements',
    segment: 'abonnements',
    label: 'Abonnements et paiements',
    description: 'Abonnements, file des paiements manuels et octrois sans paiement.',
    action: 'platform.billing.read',
    // ADR-0053 — P3
    etat: 'disponible',
  },
  {
    id: 'fonctionnalites',
    segment: 'fonctionnalites',
    label: 'Fonctionnalités par offre',
    description: 'Ce que chaque offre permet, et les dérogations par organisation.',
    action: 'platform.features.read',
    etat: 'bientot',
  },
  {
    id: 'integrations',
    segment: 'integrations',
    label: 'Intégrations',
    description: 'Secrets chiffrés des fournisseurs de la plateforme, en écriture seule.',
    action: 'platform.integrations.manage',
    etat: 'disponible',
  },
  {
    id: 'journal',
    segment: 'journal',
    label: 'Journal',
    description: 'Journal des gestes plateforme. Aucun événement d’une organisation.',
    action: 'platform.audit.read',
    etat: 'disponible',
  },
  {
    id: 'annonces',
    segment: 'annonces',
    label: 'Annonces',
    description: 'Messages in-app par catégorie de destinataires, approuvés à deux.',
    action: 'platform.announcements.draft',
    etat: 'bientot',
  },
  {
    id: 'statistiques',
    segment: 'statistiques',
    label: 'Statistiques',
    description: 'Agrégats de la plateforme, sans aucune case de moins de cinq organisations.',
    action: 'platform.stats.read',
    etat: 'bientot',
  },
  {
    id: 'finances',
    segment: 'finances',
    label: 'Finances du site',
    description: 'Encaissements constatés et revenu récurrent déclaré, en USD.',
    action: 'platform.finance.read',
    etat: 'bientot',
  },
  {
    id: 'packs',
    segment: 'packs',
    label: 'Country Packs',
    description: 'Plans comptables et règles pays, publiés par leur gestionnaire.',
    action: 'platform.packs.manage',
    etat: 'bientot',
  },
  {
    id: 'modeles',
    segment: 'modeles',
    label: 'Modèles sectoriels',
    description: 'Modèles de départ proposés aux organisations.',
    action: 'platform.templates.manage',
    etat: 'bientot',
  },
] as const;

/**
 * Actions plateforme servies, nettoyées : une valeur hors catalogue (API plus
 * récente, réponse altérée) est ignorée plutôt que d'ouvrir quoi que ce soit.
 * Absentes → aucune.
 */
export function actionsDe(acces: { actions?: readonly unknown[] | null } | null): PlatformAction[] {
  const brutes = acces?.actions;
  if (!Array.isArray(brutes)) return [];
  return brutes.filter(isPlatformAction);
}

/** La personne ouvre-t-elle la console ? Décide de l'écran de refus et de l'entrée du menu. */
export function ouvreConsole(acces: { actions?: readonly unknown[] | null } | null): boolean {
  return actionsDe(acces).includes(ACTION_CONSOLE);
}

/**
 * Modules proposés, dans l'ordre stable du catalogue. Sans l'action de console,
 * rien : un module n'est jamais proposé hors de la console.
 */
export function modulesVisibles(actions: readonly PlatformAction[]): ModuleConsole[] {
  if (!actions.includes(ACTION_CONSOLE)) return [];
  return CONSOLE_MODULES.filter((m) => actions.includes(m.action));
}

/** Chemin d'un module. */
export function hrefModule(m: Pick<ModuleConsole, 'segment'>): string {
  return m.segment ? `${CONSOLE_BASE}/${m.segment}` : CONSOLE_BASE;
}

/**
 * Premier segment sous `/admin`, ou `null` hors de la console.
 *
 * Frontière de SEGMENT, pas simple préfixe : `/administration` commence par
 * `/admin` sans en faire partie.
 */
export function segmentConsole(pathname: string): string | null {
  if (pathname !== CONSOLE_BASE && !pathname.startsWith(`${CONSOLE_BASE}/`)) return null;
  const reste = pathname.slice(CONSOLE_BASE.length).replace(/^\/+/, '');
  return reste.split('/')[0] ?? '';
}

/**
 * Module du chemin courant. Une sous-page (`/admin/organisations/xyz`) garde son
 * module ; un segment inconnu n'en a aucun (Next répond 404).
 */
export function moduleDuChemin(pathname: string): ModuleConsole | null {
  const segment = segmentConsole(pathname);
  if (segment === null) return null;
  return CONSOLE_MODULES.find((m) => m.segment === segment) ?? null;
}

/**
 * Ce que la coquille rend pour un chemin :
 *  - `refus-console` : la personne n'ouvre pas la console — écran de refus, et
 *    AUCUN appel `/admin/**` ne part (critère 22) ;
 *  - `refus-module` : la console s'ouvre, pas ce module — refus nommé, la page
 *    n'est pas montée (donc n'appelle rien) ;
 *  - `page` : la page est montée.
 */
export type EtatPage = 'refus-console' | 'refus-module' | 'page';

export function etatPage(pathname: string, actions: readonly PlatformAction[]): EtatPage {
  if (!actions.includes(ACTION_CONSOLE)) return 'refus-console';
  const mod = moduleDuChemin(pathname);
  // Segment inconnu : on laisse Next afficher sa 404, rien à protéger.
  if (mod === null) return 'page';
  return actions.includes(mod.action) ? 'page' : 'refus-module';
}

/** Libellé des rôles détenus, pour le bandeau. */
export function libelleRoles(roles: ReadonlyArray<{ label: string }>): string {
  return roles.length > 0 ? roles.map((r) => r.label).join(', ') : 'aucun rôle plateforme';
}

// ── Appels de la coquille (ADR-0053 § 2.1, critère 22) ──────────────────────

/**
 * Les SEULES routes que la coquille de console appelle d'elle-même. Les pages
 * appellent ensuite `/admin/**`, jamais une route d'organisation.
 */
export const CONSOLE_SHELL_CALLS = ['/me/platform-access', '/account/preferences'] as const;

/**
 * Préfixes des routes qui dépendent d'une organisation active : la console n'en
 * appelle aucune (§ 2.1).
 */
export const ROUTES_ORGANISATION = [
  '/me/permissions',
  '/me/features',
  '/notifications',
  '/organizations',
] as const;

export function estRouteOrganisation(route: string): boolean {
  return ROUTES_ORGANISATION.some((p) => route === p || route.startsWith(`${p}/`));
}
