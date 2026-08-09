// Logique pure de la page Membres (S20a — ADR-0012 §6).
//
// Isolée du rendu pour être testable : `apps/web` n'a pas d'environnement DOM
// (vitest en `node`, cf. apps/web/vitest.config.ts). Tout ce qui décide vit ici,
// les `.tsx` ne font que l'assemblage.
//
// Rien de ce fichier n'AUTORISE quoi que ce soit : le serveur reste seul juge
// (`authz/permissions.ts`). Ce module décide seulement de ce qu'on AFFICHE, à
// partir des drapeaux que le serveur a calculés (`isLastOwner`, `manageable`,
// `grantable`). Une divergence produit au pire un bouton en trop, jamais un
// droit en trop.

import type { MemberView, OrgRole, RoleOption } from '@/lib/api';

/**
 * Nom affichable d'un membre.
 *
 * L'identité vient de better-auth et peut manquer (compte supprimé dont la
 * membership a survécu). On dégrade sans jamais effacer la ligne : c'est
 * justement celle qu'un propriétaire voudra révoquer.
 */
export function nomAffiche(member: Pick<MemberView, 'userId' | 'email' | 'name'>): string {
  if (member.name && member.name.trim() !== '') return member.name.trim();
  if (member.email && member.email.trim() !== '') return member.email.trim();
  return `Compte supprimé (${member.userId.slice(-6)})`;
}

/** Ligne secondaire : email, ou rien si le nom l'affiche déjà. */
export function sousTitre(member: Pick<MemberView, 'email' | 'name'>): string | null {
  if (!member.email) return null;
  if (!member.name || member.name.trim() === '') return null;
  return member.email;
}

/**
 * Pourquoi le rôle de ce membre n'est-il pas modifiable ? `null` s'il l'est.
 *
 * Le message est rendu À CÔTÉ du contrôle désactivé, jamais à la place : une
 * commande absente n'explique rien, et « pourquoi ne puis-je pas ? » est
 * exactement la question que pose un propriétaire unique.
 */
export function raisonNonModifiable(member: MemberView): string | null {
  if (member.isLastOwner) {
    return 'Dernier propriétaire : transférez la propriété avant de changer ce rôle.';
  }
  if (!member.manageable) {
    return 'Ce membre détient des droits que vous n’avez pas.';
  }
  return null;
}

/** Pourquoi ce membre n'est-il pas révocable ? `null` s'il l'est. */
export function raisonNonRevocable(member: MemberView): string | null {
  if (member.isLastOwner) {
    return 'Dernier propriétaire : l’organisation ne peut pas rester sans gouvernance.';
  }
  if (!member.manageable) {
    return 'Ce membre détient des droits que vous n’avez pas.';
  }
  return null;
}

/**
 * Le droit conditionnel de clôture (case ⚙) est-il pertinent pour ce membre ?
 *
 * `accountant` est la seule ligne de la matrice à porter une case `conditional`.
 * Afficher l'interrupteur ailleurs promettrait un effet que l'API refuse
 * (`400 CONDITIONAL_RIGHT_NOT_APPLICABLE`).
 */
export function afficheDroitCloture(member: MemberView): boolean {
  return member.role === 'accountant';
}

/**
 * Un membre peut-il recevoir la propriété ?
 *
 * Le transfert est réservé à un propriétaire (le service l'exige en plus du
 * guard) et n'a de sens que vers quelqu'un d'autre.
 */
export function ciblesDeTransfert(members: readonly MemberView[], moiUserId: string): MemberView[] {
  return members.filter((m) => m.userId !== moiUserId && m.role !== 'owner');
}

/**
 * Ligne de l'acteur courant dans la liste des membres — `null` s'il ne s'y
 * trouve pas.
 *
 * C'est la SEULE source du rôle de l'acteur dans cette page. `GET /organizations`
 * est appelé une fois au montage : après un transfert de propriété, son
 * `roleLabel` dit encore « Propriétaire » alors que l'acteur est devenu
 * Administrateur. Un rôle périmé affiché à côté de commandes recalculées, elles,
 * à partir des drapeaux frais, c'est l'interface qui se contredit — et le
 * transfert est justement l'opération qui rétrograde l'acteur lui-même.
 */
export function membreActeur(
  members: readonly MemberView[],
  moiUserId: string | null,
): MemberView | null {
  if (!moiUserId) return null;
  return members.find((m) => m.userId === moiUserId) ?? null;
}

/**
 * Libellé du rôle de l'acteur, frais si la liste des membres est disponible.
 *
 * Le repli sur l'instantané de l'organisation sert les rôles qui n'ont pas
 * `organization.manage` : ils reçoivent un 403 sur `GET /members`, n'ont donc
 * aucune liste — et n'ont non plus aucun moyen de changer leur propre rôle
 * depuis cette page, l'instantané ne peut pas se périmer sous leurs yeux.
 */
export function libelleRoleActeur(
  members: readonly MemberView[],
  moiUserId: string | null,
  repli: string | null,
): string | null {
  return membreActeur(members, moiUserId)?.roleLabel ?? repli;
}

/**
 * L'acteur est-il propriétaire ? Dérivé de la liste vivante, jamais d'un
 * instantané : c'est ce qui commande l'affichage du bloc de transfert.
 *
 * Sans identité connue (`GET /account/profile` en échec), on répond `false` : le
 * serveur refusera de toute façon un transfert demandé par un non-propriétaire,
 * et offrir la commande à tout le monde ferait de ce refus la règle plutôt que
 * l'exception.
 */
export function acteurEstProprietaire(
  members: readonly MemberView[],
  moiUserId: string | null,
): boolean {
  return membreActeur(members, moiUserId)?.role === 'owner';
}

/** Rôles proposables dans un sélecteur — les non-attribuables sont écartés. */
export function rolesProposables(options: readonly RoleOption[]): RoleOption[] {
  return options.filter((o) => o.grantable);
}

/**
 * Rôle proposé par défaut à l'invitation.
 *
 * `viewer` — le moins puissant — et non le plus utile. Un rôle par défaut
 * généreux se retrouve attribué par inadvertance à chaque invitation expédiée
 * sans lire le formulaire (docs/17 § Autorisation, moindre privilège).
 */
export function roleParDefaut(options: readonly RoleOption[]): OrgRole | null {
  const proposables = rolesProposables(options);
  if (proposables.length === 0) return null;
  const viewer = proposables.find((o) => o.value === 'viewer');
  return (viewer ?? proposables[proposables.length - 1]!).value;
}

/**
 * Messages des refus renvoyés par l'API des membres et des invitations.
 *
 * Le `message` du serveur est technique et parfois absent; ces phrases disent ce
 * qu'il faut FAIRE. Un code inconnu retombe sur le message brut plutôt que sur
 * un « une erreur est survenue » qui n'aide personne.
 */
const MESSAGES: Record<string, string> = {
  LAST_OWNER:
    'Une organisation garde toujours au moins un propriétaire. Transférez la propriété d’abord.',
  ROLE_ESCALATION: 'Vous ne pouvez pas attribuer un rôle plus étendu que le vôtre.',
  ROLE_NOT_ASSIGNABLE:
    'Le rôle Chef de projet sera attribuable quand les assignations de projet existeront.',
  UNKNOWN_ROLE: 'Ce rôle n’existe pas.',
  MEMBER_NOT_FOUND: 'Ce membre ne fait plus partie de l’organisation.',
  CONDITIONAL_RIGHT_NOT_APPLICABLE: 'Le droit de clôture ne s’accorde qu’à un Comptable.',
  OWNER_ROLE_REQUIRED: 'Seul un propriétaire peut transférer la propriété.',
  CANNOT_TRANSFER_TO_SELF: 'Vous êtes déjà propriétaire de cette organisation.',
  INVALID_EMAIL: 'Cette adresse email n’est pas valide.',
  INVITATION_ALREADY_PENDING: 'Une invitation est déjà en attente pour cette adresse.',
  INVITATION_ALREADY_ACCEPTED: 'Cette personne est déjà membre de l’organisation.',
  INVITATION_NOT_FOUND: 'Cette invitation n’existe plus.',
  INVITATION_REVOKED: 'Cette invitation a déjà été révoquée.',
  FORBIDDEN: 'Vous n’avez pas le droit d’effectuer cette action.',
  ORG_NOT_FOUND: 'Organisation introuvable.',
};

/** Code métier porté par une erreur d'`api.ts`, s'il y en a un. */
export function codeErreur(err: unknown): string | null {
  if (typeof err !== 'object' || err === null || !('detail' in err)) return null;
  const detail = (err as { detail: unknown }).detail;
  if (typeof detail !== 'object' || detail === null || !('code' in detail)) return null;
  const code = (detail as { code: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export function messageErreur(err: unknown, repli: string): string {
  const code = codeErreur(err);
  if (code && MESSAGES[code]) return MESSAGES[code]!;
  return err instanceof Error && err.message !== '' ? err.message : repli;
}
