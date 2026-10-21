// Logique pure de la navigation latérale par module (ADR-0030 § 2).
//
// Même discipline que `user-menu-model.ts` : ce qui DÉCIDE — la liste des
// entrées, leur groupe, leur condition d'affichage, l'entrée allumée par le
// chemin courant, le filtre des modules choisis — vit ici et se teste sans DOM
// (vitest tourne en environnement `node`). Les `.tsx` ne font qu'assembler.
//
// Rien de ce fichier n'AUTORISE quoi que ce soit. Une entrée masquée est un
// confort ; `PermissionsGuard` refuse côté API de toute façon (ADR-0012 §8).
// Les conditions sont des actions servies par `GET /me/permissions` — jamais
// un nom de rôle recopié.

import type { ModuleId } from '@lalanda/ui';

import type { OrgAction } from '@/lib/api';

export type NavGroupId = ModuleId | 'organisation';

export type NavIconId =
  | 'plans'
  | 'factures'
  | 'clients'
  | 'catalogue'
  | 'pilotage'
  | 'sante'
  | 'investisseurs'
  | 'parcours'
  | 'mise-en-route'
  | 'identite'
  | 'fiscalite'
  | 'membres'
  | 'abonnement'
  | 'parametres';

export interface NavItem {
  /** Stable : clé de rendu et clé de test. */
  id: string;
  href: string;
  label: string;
  group: NavGroupId;
  icon: NavIconId;
  /** Action exigée pour AFFICHER l'entrée, ou `null` si elle est offerte à tout membre. */
  action: OrgAction | null;
}

export interface NavGroup {
  id: NavGroupId;
  /** Libellé lu par les lecteurs d'écran et affiché en en-tête de groupe. */
  label: string;
  /** Verbe du module (« Concevoir ») ; absent pour Organisation. */
  verb: string | null;
}

/** Ordre de la trajectoire : BUILD → RUN → GROW, puis l'organisation. */
export const NAV_GROUPS: readonly NavGroup[] = [
  { id: 'build', label: 'BUILD', verb: 'Concevoir' },
  { id: 'run', label: 'RUN', verb: 'Exploiter' },
  { id: 'grow', label: 'GROW', verb: 'Croître' },
  { id: 'organisation', label: 'Organisation', verb: null },
];

/**
 * Les entrées, dans l'ordre d'affichage (ADR-0030 § 2).
 *
 * Ne figurent ici que des pages qui EXISTENT — la barre ne promet rien (règle
 * d'ADR-0016). GROW : « Pilotage » (tableau de bord de l'organisation), puis les
 * trois écrans de l'espace Croissance d'ADR-0032 (santé, indicateurs
 * investisseurs, parcours).
 * « Modèle de facture » et « Journal » restent des onglets de l'espace Ventes.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: 'plans',
    href: '/projects',
    label: 'Plans financiers',
    group: 'build',
    icon: 'plans',
    action: null,
  },
  {
    id: 'factures',
    href: '/ventes/factures',
    label: 'Factures',
    group: 'run',
    icon: 'factures',
    action: 'sales.read',
  },
  {
    id: 'clients',
    href: '/ventes/clients',
    label: 'Clients',
    group: 'run',
    icon: 'clients',
    action: 'sales.read',
  },
  {
    id: 'catalogue',
    href: '/ventes/catalogue',
    label: 'Catalogue',
    group: 'run',
    icon: 'catalogue',
    action: 'sales.read',
  },
  // Le tableau de bord de l'organisation EST le pilotage : blocs par rôle,
  // ratios au rouge, écarts, validations (S21a). Offert à tout membre.
  {
    id: 'pilotage',
    href: '/organisation',
    label: 'Pilotage',
    group: 'grow',
    icon: 'pilotage',
    action: null,
  },
  // ADR-0032 — espace Croissance. Lecture sous `analytics.read`, que les huit
  // rôles détiennent : offert à tout membre, comme « Pilotage ». Santé et
  // indicateurs dépendent de l'offre ; l'écran l'explique, l'API l'impose.
  {
    id: 'sante',
    href: '/croissance/sante',
    label: 'Santé',
    group: 'grow',
    icon: 'sante',
    action: null,
  },
  {
    id: 'investisseurs',
    href: '/croissance/investisseurs',
    label: 'Indicateurs investisseurs',
    group: 'grow',
    icon: 'investisseurs',
    action: null,
  },
  {
    id: 'parcours',
    href: '/croissance/parcours',
    label: 'Parcours',
    group: 'grow',
    icon: 'parcours',
    action: null,
  },
  // Offerte à tout membre : chaque étape explique elle-même un refus (un
  // Directeur financier fait la fiscalité mais pas l'identité visuelle).
  {
    id: 'mise-en-route',
    href: '/organisation/mise-en-route',
    label: 'Mise en route',
    group: 'organisation',
    icon: 'mise-en-route',
    action: null,
  },
  {
    id: 'identite',
    href: '/organisation/identite',
    label: 'Identité visuelle',
    group: 'organisation',
    icon: 'identite',
    action: 'organization.manage',
  },
  {
    id: 'fiscalite',
    href: '/organisation/fiscalite',
    label: 'Fiscalité',
    group: 'organisation',
    icon: 'fiscalite',
    action: 'fiscal.manage',
  },
  {
    id: 'membres',
    href: '/organisation/membres',
    label: 'Membres',
    group: 'organisation',
    icon: 'membres',
    action: 'organization.manage',
  },
  {
    id: 'parametres',
    href: '/organisation/parametres',
    label: 'Paramètres',
    group: 'organisation',
    icon: 'parametres',
    action: 'organization.manage',
  },
  {
    id: 'abonnement',
    href: '/souscription',
    label: 'Abonnement',
    group: 'organisation',
    icon: 'abonnement',
    action: null,
  },
];

export const MODULE_IDS: readonly ModuleId[] = ['build', 'run', 'grow'];

/**
 * Entrées réellement proposées.
 *
 * - `actions === null` (permissions pas encore connues, ou appel en échec) : seules
 *   les entrées sans condition — même règle qu'`ongletsVisibles` (S21a). Montrer
 *   tout puis retirer fait clignoter la barre et promet des pages qui répondront 403.
 * - `modules` : choix de la mise en route (ADR-0030 § 8). `null` = tous. Il ne
 *   filtre que les groupes de module ; l'organisation reste toujours atteignable.
 *   Ce filtre est un rangement, jamais un accès.
 */
export function entreesVisibles(
  actions: readonly OrgAction[] | null,
  modules: readonly ModuleId[] | null = null,
): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (item.action !== null && (actions === null || !actions.includes(item.action))) return false;
    if (item.group === 'organisation' || modules === null) return true;
    return modules.includes(item.group);
  });
}

/** Les entrées regroupées, dans l'ordre de `NAV_GROUPS` ; un groupe vide n'est pas rendu. */
export function groupesVisibles(
  items: readonly NavItem[],
): Array<{ group: NavGroup; items: NavItem[] }> {
  return NAV_GROUPS.map((group) => ({
    group,
    items: items.filter((i) => i.group === group.id),
  })).filter((g) => g.items.length > 0);
}

/**
 * Identifiant de l'entrée correspondant au chemin, ou `null`.
 *
 * Frontière de SEGMENT, la correspondance la plus longue gagne (même précaution
 * qu'`entreeActive` du menu du compte) : `/organisation` allume « Pilotage »,
 * `/organisation/fiscalite` allume « Fiscalité » et non « Pilotage »,
 * `/ventes/factures/nouvelle` allume « Factures », `/organisations-amies`
 * n'allume rien.
 */
export function entreeActive(pathname: string, items: readonly NavItem[]): string | null {
  let trouve: NavItem | null = null;
  for (const item of items) {
    if (pathname !== item.href && !pathname.startsWith(`${item.href}/`)) continue;
    if (trouve === null || item.href.length > trouve.href.length) trouve = item;
  }
  return trouve?.id ?? null;
}

// ─── Choix des modules (mise en route, étape 4) ─────────────────────────────

/**
 * Clé de stockage du choix des modules, PAR ORGANISATION : une même personne
 * peut ne faire que de la vente dans une entreprise et que du plan dans une
 * autre. Stockage navigateur faute d'API (ADR-0030, décision D3).
 */
export function cleModules(organizationId: string): string {
  return `lalanda.modules.${organizationId}`;
}

/**
 * Relit un choix stocké. Toute valeur illisible vaut « aucun choix » (`null`,
 * donc tous les modules) : un stockage corrompu ne doit jamais vider la barre.
 */
export function lireModules(brut: string | null): ModuleId[] | null {
  if (brut === null) return null;
  let valeur: unknown;
  try {
    valeur = JSON.parse(brut);
  } catch {
    return null;
  }
  if (!Array.isArray(valeur)) return null;
  const modules = MODULE_IDS.filter((m) => valeur.includes(m));
  return modules.length > 0 ? modules : null;
}

/** Sérialise un choix ; un choix vide ou complet s'écrit `null` (rien à filtrer). */
export function ecrireModules(modules: readonly ModuleId[]): string | null {
  const propres = MODULE_IDS.filter((m) => modules.includes(m));
  if (propres.length === 0 || propres.length === MODULE_IDS.length) return null;
  return JSON.stringify(propres);
}

// ─── Barre d'actions basse (téléphone) ──────────────────────────────────────

export interface ActionRapide {
  id: 'plans' | 'factures' | 'facturer' | 'clients';
  href: string;
  label: string;
  /** L'action principale, dessinée en relief. */
  principale: boolean;
}

/**
 * Barre basse du téléphone (ADR-0030 § 6), centrée sur RUN : vendre et facturer
 * au pouce. Proposée seulement si le rôle lit les ventes ; sinon le tiroir de
 * navigation suffit et la barre n'est pas rendue (tableau vide).
 *
 * « Facturer » mène au compositeur existant : il crée un BROUILLON (pro forma),
 * ouvert à `sales.manage` côté API — un rôle en lecture seule y lira le refus
 * du serveur, d'où la condition supplémentaire.
 */
export function actionsRapides(actions: readonly OrgAction[] | null): ActionRapide[] {
  if (actions === null || !actions.includes('sales.read')) return [];
  const liste: ActionRapide[] = [
    { id: 'plans', href: '/projects', label: 'Plans', principale: false },
    { id: 'factures', href: '/ventes/factures', label: 'Factures', principale: false },
  ];
  if (actions.includes('sales.manage')) {
    liste.push({
      id: 'facturer',
      href: '/ventes/factures/nouvelle',
      label: 'Facturer',
      principale: true,
    });
  }
  liste.push({ id: 'clients', href: '/ventes/clients', label: 'Clients', principale: false });
  return liste;
}
