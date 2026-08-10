// Logique pure du menu du compte (ADR-0016 §1).
//
// Isolée du rendu pour la même raison que `organization-model.ts` et
// `admin-model.ts` : `apps/web` exécute vitest en environnement `node`, sans
// DOM. Ce qui DÉCIDE — la liste des entrées, leur ordre, leurs groupes, leur
// conditionnement, l'entrée allumée par le chemin courant — vit ici et se teste
// sans monter un composant. Le `.tsx` se contente d'assembler.
//
// Rien de ce fichier n'AUTORISE quoi que ce soit. Une entrée masquée est un
// CONFORT d'interface, jamais un contrôle d'accès : `PermissionsGuard` refuse
// côté API de toute façon (ADR-0012 §8). Une divergence entre ce module et la
// matrice de permissions produit au pire une entrée en trop dans un menu —
// jamais un droit en trop.
//
// Corollaire à ne pas relâcher : AUCUN `if (role === …)` ici. Le seul fait
// consommé est un drapeau booléen servi par le serveur (`canReadAdmin`, issu de
// `GET /me/platform-access`).

/** Un lien du menu. `id` est stable et sert de clé de rendu comme de clé de test. */
export interface UserMenuLink {
  kind: 'link';
  id: string;
  href: string;
  label: string;
  /** Court rappel de ce que la section contient, pour ne pas avoir à deviner. */
  hint: string;
  /**
   * Groupe d'appartenance. Un changement de groupe entre deux entrées dessine un
   * séparateur — le rendu n'a donc aucune position particulière à connaître.
   */
  group: number;
}

/** La déconnexion n'est pas une destination : elle n'a pas de `href`. */
export interface UserMenuAction {
  kind: 'action';
  id: 'signout';
  label: string;
  group: number;
}

export type UserMenuItem = UserMenuLink | UserMenuAction;

/**
 * Faits servis par le serveur dont dépend la visibilité.
 *
 * `canReadAdmin` est déjà chargé par le header aujourd'hui : le menu n'émet
 * AUCUN appel supplémentaire au titre de la visibilité (ADR-0016 §1).
 */
export interface UserMenuFacts {
  /** `GET /me/platform-access`. Défaut `false` : voir `entreesMenu`. */
  canReadAdmin: boolean;
}

/**
 * Les six entrées du menu, dans l'ordre exact de l'ADR-0016 §1.
 *
 * Deux groupes : le premier est ce qui appartient à la PERSONNE, le second ce
 * qui appartient à l'organisation et à la plateforme. La déconnexion est seule
 * dans un troisième, parce qu'une action destructive de session ne doit pas
 * border un lien qu'on visait.
 *
 * « Membres » n'y figure pas volontairement : c'est un onglet de `/organisation`
 * (ADR-0016 §3). L'entrée « Organisation » est la porte, et ce qu'il y a
 * derrière est filtré par les permissions réelles, là où le filtrage existe
 * déjà.
 */
const ITEMS: readonly (UserMenuItem & { besoin: keyof UserMenuFacts | null })[] = [
  {
    kind: 'link',
    id: 'tableau-de-bord',
    href: '/projects',
    label: 'Tableau de bord',
    hint: 'Vos projets et leur avancement',
    group: 1,
    besoin: null,
  },
  {
    kind: 'link',
    id: 'compte',
    href: '/compte',
    label: 'Mon compte',
    hint: 'Profil, sécurité, préférences',
    group: 1,
    besoin: null,
  },
  {
    kind: 'link',
    id: 'organisation',
    href: '/organisation',
    label: 'Organisation',
    hint: 'Membres, paramètres, facturation, journal',
    group: 2,
    besoin: null,
  },
  {
    kind: 'link',
    id: 'souscription',
    href: '/souscription',
    label: 'Abonnement',
    hint: 'Plan, essai et changement d’offre',
    group: 2,
    besoin: null,
  },
  {
    kind: 'link',
    id: 'admin',
    href: '/admin',
    label: 'Administration',
    hint: 'Plateforme : organisations, packs, journaux',
    group: 2,
    besoin: 'canReadAdmin',
  },
  { kind: 'action', id: 'signout', label: 'Déconnexion', group: 3, besoin: null },
] as const;

/**
 * Entrées réellement proposées.
 *
 * Une entrée conditionnée dont le fait n'est pas encore connu ne s'affiche PAS
 * « en attendant » : `canReadAdmin` vaut `false` tant que
 * `GET /me/platform-access` n'a pas répondu, et un échec de cet appel le laisse
 * à `false`. Le défaut est de ne rien proposer plutôt que de proposer une page
 * qui répondra 403 (ADR-0016 §5).
 */
export function entreesMenu(faits: UserMenuFacts): UserMenuItem[] {
  return ITEMS.filter((item) => item.besoin === null || faits[item.besoin]).map(
    ({ besoin: _besoin, ...item }) => item,
  );
}

/**
 * `true` si un séparateur doit précéder `item`.
 *
 * Le séparateur se déduit du changement de groupe et non d'un index codé en
 * dur : quand « Administration » disparaît, le groupe 2 garde deux entrées et le
 * dessin reste juste — aucun séparateur orphelin, aucun groupe vide.
 */
export function separateurAvant(items: readonly UserMenuItem[], index: number): boolean {
  if (index <= 0) return false;
  return items[index]!.group !== items[index - 1]!.group;
}

/**
 * Identifiant de l'entrée correspondant au chemin courant, ou `null`.
 *
 * Comparaison sur des FRONTIÈRES DE SEGMENT, jamais sur un préfixe nu — même
 * précaution que `segmentActif` (`admin-model.ts`) et `isProtectedPath`
 * (`lib/routes.ts`) : `/comptes-annuels` commence par `/compte` sans en faire
 * partie, et un `startsWith` allumerait « Mon compte » depuis une page
 * étrangère. À l'inverse `/compte/securite` DOIT allumer « Mon compte » : le
 * menu ne liste qu'une entrée par espace, elle vaut pour tout l'espace.
 *
 * La correspondance la plus longue gagne, pour rester juste le jour où un espace
 * serait imbriqué dans un autre.
 */
export function entreeActive(pathname: string, items: readonly UserMenuItem[]): string | null {
  let trouve: UserMenuLink | null = null;
  for (const item of items) {
    if (item.kind !== 'link') continue;
    if (pathname !== item.href && !pathname.startsWith(`${item.href}/`)) continue;
    if (trouve === null || item.href.length > trouve.href.length) trouve = item;
  }
  return trouve?.id ?? null;
}

/**
 * Nom accessible du déclencheur.
 *
 * Il annonce l'IDENTITÉ, pas seulement l'adresse : l'avatar est `aria-hidden`
 * (il ne porte aucune information que ce libellé ne donne déjà), donc ce texte
 * est la seule chose qu'un lecteur d'écran entend du bouton.
 *
 * Le nom affiché est préféré à l'adresse quand il existe — c'est ce que la
 * personne a choisi. Tant que le profil n'est pas chargé, il n'y a que
 * l'adresse de session, et c'est déjà une identité valable.
 */
export function libelleDeclencheur(identite: { nom?: string | null; email: string }): string {
  const nom = identite.nom?.trim();
  return `Menu du compte — ${nom && nom.length > 0 ? nom : identite.email}`;
}
