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
// consommé est ce que sert le serveur : un drapeau booléen (`canReadAdmin`, issu de
// `GET /me/platform-access`) et les actions de `GET /me/permissions`.

import type { OrgAction } from '@/lib/api';

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
 * Tous deux sont déjà chargés par la coquille : le menu n'émet AUCUN appel
 * supplémentaire au titre de la visibilité (ADR-0016 §1, ADR-0038 § 6).
 */
export interface UserMenuFacts {
  /** `GET /me/platform-access`. Défaut `false` : voir `entreesMenu`. */
  canReadAdmin: boolean;
  /**
   * `GET /me/permissions` (actions de l'organisation active), `null` tant
   * qu'elles ne sont pas connues ou si l'appel a échoué.
   */
  actions?: readonly OrgAction[] | null;
}

/**
 * Les entrées du menu, dans l'ordre d'ADR-0038 § 6 (amende ADR-0016 §1).
 *
 * Le travail quotidien (Tableau de bord, Ventes, Trésorerie, Croissance) est
 * passé dans la barre du haut, par module. Le menu redevient celui du COMPTE et
 * de l'ORGANISATION :
 *  1. ce qui appartient à la personne (Mon compte) ;
 *  2. les réglages de l'organisation, qui ne sont plus un module ;
 *  3. la plateforme (Administration, opérateurs seulement) ;
 *  4. la déconnexion, seule : une action destructive de session ne doit pas
 *     border un lien qu'on visait.
 *
 * Facturation et Journal d'audit restent des onglets de `/organisation`.
 */
const ITEMS: readonly UserMenuItem[] = [
  {
    kind: 'link',
    id: 'compte',
    href: '/compte',
    label: 'Mon compte',
    hint: 'Profil, sécurité, préférences',
    group: 1,
  },
  // Offerte à tout membre : chaque étape explique elle-même un refus (un
  // Directeur financier fait la fiscalité mais pas l'identité visuelle).
  {
    kind: 'link',
    id: 'mise-en-route',
    href: '/organisation/mise-en-route',
    label: 'Mise en route',
    hint: 'Identité, fiscalité, points de vente, modules',
    group: 2,
  },
  {
    kind: 'link',
    id: 'identite',
    href: '/organisation/identite',
    label: 'Identité visuelle',
    hint: 'Logos, couleurs et police des documents',
    group: 2,
  },
  {
    kind: 'link',
    id: 'fiscalite',
    href: '/organisation/fiscalite',
    label: 'Fiscalité',
    hint: 'Profil fiscal et facture normalisée DGI',
    group: 2,
  },
  {
    kind: 'link',
    id: 'membres',
    href: '/organisation/membres',
    label: 'Membres',
    hint: 'Invitations et rôles',
    group: 2,
  },
  {
    kind: 'link',
    id: 'parametres',
    href: '/organisation/parametres',
    label: 'Paramètres',
    hint: 'Nom, pays et devise d’affichage',
    group: 2,
  },
  {
    kind: 'link',
    id: 'souscription',
    href: '/souscription',
    label: 'Abonnement',
    hint: 'Plan, essai et changement d’offre',
    group: 2,
  },
  {
    kind: 'link',
    id: 'admin',
    href: '/admin',
    label: 'Administration',
    hint: 'Plateforme : organisations, packs, journaux',
    group: 3,
  },
  { kind: 'action', id: 'signout', label: 'Déconnexion', group: 4 },
] as const;

/**
 * Condition d'affichage d'une entrée : un drapeau de plateforme, ou une action
 * de l'organisation servie par `GET /me/permissions` — jamais un nom de rôle.
 * Une entrée absente de cette table est inconditionnelle. Les actions sont
 * celles des onglets de `/organisation` (`organization-model.ts`), pour que le
 * menu et l'espace ne se contredisent pas.
 */
const CONDITIONS: Readonly<
  Record<string, { drapeau: 'canReadAdmin' } | { action: OrgAction }>
> = {
  identite: { action: 'organization.manage' },
  fiscalite: { action: 'fiscal.manage' },
  membres: { action: 'organization.manage' },
  parametres: { action: 'organization.manage' },
  admin: { drapeau: 'canReadAdmin' },
};

/**
 * Entrées réellement proposées.
 *
 * Une entrée conditionnée dont le fait n'est pas encore connu ne s'affiche PAS
 * « en attendant » : `canReadAdmin` vaut `false` tant que
 * `GET /me/platform-access` n'a pas répondu, et des actions `null` masquent
 * toutes les entrées qui en exigent une. Le défaut est de ne rien proposer
 * plutôt que de proposer une page qui répondra 403 (ADR-0016 §5).
 */
export function entreesMenu(faits: UserMenuFacts): UserMenuItem[] {
  const actions = faits.actions ?? null;
  return ITEMS.filter((item) => {
    const besoin = CONDITIONS[item.id];
    if (besoin === undefined) return true;
    if ('drapeau' in besoin) return faits[besoin.drapeau];
    return actions !== null && actions.includes(besoin.action);
  });
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
