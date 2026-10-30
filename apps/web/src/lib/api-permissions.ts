// Client de l'API des autorisations par membre — ADR-0041 § 6, lot A5.
//
// Fichier voisin de `api.ts` (même `jsonRequest`, mêmes erreurs) : l'ADR demande
// de ne pas grossir `api.ts` (§ Découpage, zones de conflit). Les types étendent
// ceux d'`api.ts` des champs ajoutés par les lots A2 et A4.
//
// Rien ici ne DÉCIDE d'un droit : le vocabulaire (domaines, libellés,
// dépendances, paires, lignes des titres) vient de `GET /authz/catalog`, les
// droits effectifs de `GET /me/permissions` et `GET …/members`. Le web ne
// recopie aucune table de la matrice.

import {
  EVENEMENT_REFUS_API,
  jsonRequest,
  type InvitationView,
  type MemberView,
  type MyPermissionsView,
  type OrgAction,
  type OrgRole,
  type RoleOption,
} from './api';

export { EVENEMENT_REFUS_API };

// ─── Catalogue (`GET /authz/catalog`) ────────────────────────────────────────

export interface CatalogueDomaine {
  key: string;
  label: string;
  actions: OrgAction[];
}

export interface CatalogueLigneTitre {
  role: OrgRole;
  label: string;
  description: string;
  /** Cases accordées par le titre. */
  actions: OrgAction[];
  /** Case ⚙ : accordée au cas par cas (droit de clôture du Comptable). */
  conditional: OrgAction[];
}

export interface CatalogueAutorisations {
  domains: CatalogueDomaine[];
  labels: Record<OrgAction, string>;
  /** Dépendances DIRECTES ; `baseAction` s'y ajoute pour toute autre action. */
  dependencies: Partial<Record<OrgAction, OrgAction[]>>;
  /** Socle : non retirable tant qu'une autre autorisation est détenue. */
  baseAction: OrgAction;
  sodPairs: Array<[OrgAction, OrgAction]>;
  nonDelegable: OrgAction[];
  roleMatrix: CatalogueLigneTitre[];
  /**
   * État de l'interrupteur `MEMBER_PERMISSIONS_ENABLED`, SI l'API le publie un
   * jour. Absent aujourd'hui : l'écran le découvre au premier
   * `409 MEMBER_PERMISSIONS_DISABLED`.
   */
  memberPermissionsEnabled?: boolean;
}

// ─── Mes autorisations (`GET /me/permissions` étendu) ───────────────────────

export interface MesPermissions extends MyPermissionsView {
  /** Ligne du titre seule (case ⚙ selon le droit de clôture), sans l'écart. */
  roleActions: OrgAction[];
  grants: OrgAction[];
  revokes: OrgAction[];
  customized: boolean;
  /** Ce que l'appelant peut ajouter à autrui : ses droits effectifs moins le non délégable. */
  grantableActions: OrgAction[];
  permissionsRevision: number;
  /** Voir `CatalogueAutorisations.memberPermissionsEnabled`. */
  memberPermissionsEnabled?: boolean;
}

/** Membre tel que servi par `GET …/members` depuis le lot A4. */
export interface MembreAutorisations extends MemberView {
  grants: OrgAction[];
  revokes: OrgAction[];
  /** Droits effectifs : titre + ajouts − retraits, case ⚙ comprise. */
  effective: OrgAction[];
  customized: boolean;
  /** À renvoyer en `expectedRevision` lors d'une écriture. */
  permissionsRevision: number;
}

/** Invitation listée avec son écart (« l'invitation listée affiche son écart »). */
export interface InvitationAutorisations extends InvitationView {
  grants: OrgAction[];
  revokes: OrgAction[];
}

export interface Ecart {
  grants: OrgAction[];
  revokes: OrgAction[];
}

/**
 * Lecture tolérante : une API d'avant A2/A4 (N-1) n'envoie pas les champs
 * nouveaux. Absents, ils valent « exactement le titre » (ADR-0041 § 9.1).
 */
export function normaliserMesPermissions(brut: MyPermissionsView): MesPermissions {
  const p = brut as Partial<MesPermissions> & MyPermissionsView;
  const grants = p.grants ?? [];
  const revokes = p.revokes ?? [];
  return {
    ...p,
    roleActions: p.roleActions ?? p.actions,
    grants,
    revokes,
    customized: p.customized ?? (grants.length > 0 || revokes.length > 0),
    grantableActions: p.grantableActions ?? [],
    permissionsRevision: p.permissionsRevision ?? 0,
  };
}

export function normaliserMembre(brut: MemberView): MembreAutorisations {
  const m = brut as Partial<MembreAutorisations> & MemberView;
  const grants = m.grants ?? [];
  const revokes = m.revokes ?? [];
  return {
    ...m,
    grants,
    revokes,
    effective: m.effective ?? [],
    customized: m.customized ?? (grants.length > 0 || revokes.length > 0),
    permissionsRevision: m.permissionsRevision ?? 0,
  };
}

export function normaliserInvitation(brut: InvitationView): InvitationAutorisations {
  const i = brut as Partial<InvitationAutorisations> & InvitationView;
  return { ...i, grants: i.grants ?? [], revokes: i.revokes ?? [] };
}

const org = (orgId: string): string => `/organizations/${encodeURIComponent(orgId)}`;
const membre = (orgId: string, userId: string): string =>
  `${org(orgId)}/members/${encodeURIComponent(userId)}`;

export const apiAutorisations = {
  getCatalogue: () => jsonRequest<CatalogueAutorisations>('/authz/catalog', { method: 'GET' }),

  getMesPermissions: async (): Promise<MesPermissions> =>
    normaliserMesPermissions(
      await jsonRequest<MyPermissionsView>('/me/permissions', { method: 'GET' }),
    ),

  listMembres: async (
    orgId: string,
  ): Promise<{ members: MembreAutorisations[]; roleOptions: RoleOption[] }> => {
    const r = await jsonRequest<{ members: MemberView[]; roleOptions: RoleOption[] }>(
      `${org(orgId)}/members`,
      { method: 'GET' },
    );
    return { members: r.members.map(normaliserMembre), roleOptions: r.roleOptions };
  },

  listInvitations: async (orgId: string): Promise<{ invitations: InvitationAutorisations[] }> => {
    const r = await jsonRequest<{ invitations: InvitationView[] }>(`${org(orgId)}/invitations`, {
      method: 'GET',
    });
    return { invitations: r.invitations.map(normaliserInvitation) };
  },

  /** Remplace l'écart ENTIER ; `409 STALE_REVISION` si la fiche a bougé entre-temps. */
  setPermissionsMembre: (
    orgId: string,
    userId: string,
    input: Ecart & { expectedRevision: number; reason?: string },
  ) =>
    jsonRequest<{ member: MemberView }>(`${membre(orgId, userId)}/permissions`, {
      method: 'PATCH',
      body: input,
    }),

  /** Change le titre : l'écart est EFFACÉ (ADR-0041 § 3). */
  changerTitre: (
    orgId: string,
    userId: string,
    input: { role: OrgRole; expectedRevision?: number },
  ) =>
    jsonRequest<{ member: MemberView }>(`${membre(orgId, userId)}/role`, {
      method: 'PATCH',
      body: input,
    }),

  /** Invitation avec écart facultatif (n'envoie les listes que si elles ne sont pas vides). */
  inviter: (orgId: string, input: { email: string; role: OrgRole } & Partial<Ecart>) => {
    const body: Record<string, unknown> = { email: input.email, role: input.role };
    if (input.grants && input.grants.length > 0) body['grants'] = input.grants;
    if (input.revokes && input.revokes.length > 0) body['revokes'] = input.revokes;
    return jsonRequest<{ invitation: InvitationView; token: string }>(`${org(orgId)}/invitations`, {
      method: 'POST',
      body,
    });
  },
};

// ─── Relecture des permissions par la coquille (ADR-0041 G8) ────────────────

/**
 * Le refus vient-il du guard des permissions (`403 { code: 'FORBIDDEN' }`) ?
 * Seul ce refus dit « vos droits ont peut-être changé ». Les autres 403 (`NO_ORGANIZATION`,
 * `PERMISSION_ESCALATION`…) ne justifient pas une relecture — et `GET /me/permissions`
 * n'émet jamais `FORBIDDEN`, ce qui exclut toute boucle.
 */
export function estRefusDePermission(detail: unknown): boolean {
  return (
    typeof detail === 'object' &&
    detail !== null &&
    'code' in detail &&
    (detail as { code: unknown }).code === 'FORBIDDEN'
  );
}

/**
 * Limiteur de relecture : un retour d'onglet ou une rafale de `403` sur une même
 * page ne doit déclencher qu'UNE lecture de `GET /me/permissions` par fenêtre de
 * `intervalleMs`.
 */
export function creerLimiteurRelecture(intervalleMs = 2000): (maintenant: number) => boolean {
  let derniere = Number.NEGATIVE_INFINITY;
  return (maintenant: number) => {
    if (maintenant - derniere < intervalleMs) return false;
    derniere = maintenant;
    return true;
  };
}

/** Code d'erreur de l'API indiquant l'interrupteur éteint. */
export const CODE_PERSONNALISATION_DESACTIVEE = 'MEMBER_PERMISSIONS_DISABLED';
