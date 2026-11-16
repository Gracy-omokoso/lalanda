// Rôles dans un projet et droits qui en découlent — ADR-0076 § 1 et § 2.
//
// Fonctions PURES partagées par l'API (qui les applique) et le web (qui masque les
// gestes). Le serveur reste juge : le web ne fait que lire ces règles pour ne pas
// proposer un geste qui serait refusé.
//
// Rôles :
//   - `lead`   : Chef de projet (`ownerUserId`) ;
//   - `deputy` : Adjoint (`deputyUserId`, un seul) ;
//   - `member` : Membre (défaut d'une personne ou d'une équipe ajoutée) ;
//   - `viewer` : Lecteur (lit et commente seulement) ;
//   - `none`   : non membre (projet ouvert : Membre implicite, ADR-0076 § 1).
//
// Le rôle d'organisation reste un PLAFOND : sans `work.update`, rien n'est modifiable ;
// `work.manage` garde la main sur tous les projets.

/** Rôles stockés pour un membre (personne ou équipe) ; absent : `member`. */
export const WORK_PROJECT_MEMBER_ROLES = ['member', 'viewer'] as const;
export type WorkProjectMemberRole = (typeof WORK_PROJECT_MEMBER_ROLES)[number];

/** Rôle résolu d'une personne dans un projet. */
export type WorkProjectRole = 'lead' | 'deputy' | WorkProjectMemberRole | 'none';

/** Libellés d'interface (vocabulaire de l'application). */
export const WORK_PROJECT_ROLE_LABELS: Readonly<Record<WorkProjectRole, string>> = {
  lead: 'Chef de projet',
  deputy: 'Adjoint',
  member: 'Membre',
  viewer: 'Lecteur',
  none: 'Non membre',
};

/** Rôle stocké d'un membre (`work_projects.memberRoles`). */
export interface WorkProjectMemberRoleEntry {
  kind: 'user' | 'team';
  id: string;
  role: WorkProjectMemberRole;
}

/** Bornes des collaborateurs et de la liste de contrôle (ADR-0076, décision ouverte n° 5). */
export const WORK_COLLAB_LIMITS = {
  collaboratorsMax: 10,
  checklistItemsMax: 30,
  checklistTextMax: 200,
  approvalReasonMax: 500,
  statusTextMax: 2_000,
  statusHistoryMax: 50,
} as const;

/** Rôle stocké d'une personne ou d'une équipe ; absent : Membre (défaut à la lecture). */
export function memberRoleOf(
  roles: readonly WorkProjectMemberRoleEntry[] | null | undefined,
  kind: 'user' | 'team',
  id: string,
): WorkProjectMemberRole {
  return roles?.find((r) => r.kind === kind && r.id === id)?.role ?? 'member';
}

/**
 * Rôle d'une personne dans un projet : chef → adjoint → entrée PERSONNELLE (elle prime sur
 * les équipes) → meilleur rôle des équipes ajoutées dont elle est membre (Membre l'emporte
 * sur Lecteur) → non membre.
 */
export function resolveProjectRole(input: {
  userId: string;
  ownerUserId: string | null | undefined;
  deputyUserId: string | null | undefined;
  memberUserIds: readonly string[] | null | undefined;
  memberTeamIds: readonly string[] | null | undefined;
  memberRoles: readonly WorkProjectMemberRoleEntry[] | null | undefined;
  /** Équipes (RH) dont la personne est membre ou responsable. */
  userTeamIds: readonly string[];
}): WorkProjectRole {
  if (input.ownerUserId && input.ownerUserId === input.userId) return 'lead';
  if (input.deputyUserId && input.deputyUserId === input.userId) return 'deputy';
  if ((input.memberUserIds ?? []).includes(input.userId)) {
    return memberRoleOf(input.memberRoles, 'user', input.userId);
  }
  const mine = new Set(input.userTeamIds);
  let best: WorkProjectMemberRole | null = null;
  for (const teamId of input.memberTeamIds ?? []) {
    if (!mine.has(teamId)) continue;
    const role = memberRoleOf(input.memberRoles, 'team', teamId);
    if (role === 'member') return 'member';
    best = role;
  }
  return best ?? 'none';
}

/** Droits d'un appelant sur un projet (calculés par `projectRights`). */
export interface WorkProjectRights {
  role: WorkProjectRole;
  /** Gestion du projet : chef, adjoint (internes, `work.update`) ou `work.manage`. */
  canManage: boolean;
  /** Créer des tâches (Membre, Membre implicite, gestion). */
  canCreateTasks: boolean;
  /** Commenter (toute personne qui voit le projet, avec `work.update`). */
  canComment: boolean;
  /** Saisir son temps (pas le Lecteur). */
  canLogTime: boolean;
  /** Peut être responsable, collaborateur ou validateur (pas le Lecteur). */
  assignable: boolean;
  /** Le projet a un chef ou un adjoint (règle des tâches libres, ADR-0076 § 2). */
  hasLead: boolean;
}

/**
 * Droits sur un projet. `internal` : rôle d'organisation qui peut être chef ou adjoint (ni
 * Invité externe, ni Stagiaire). `orgCanUpdate` / `orgCanManage` : droits EFFECTIFS
 * `work.update` / `work.manage`.
 */
export function projectRights(input: {
  role: WorkProjectRole;
  orgCanUpdate: boolean;
  orgCanManage: boolean;
  internal: boolean;
  hasLead: boolean;
}): WorkProjectRights {
  const { role, orgCanUpdate, orgCanManage, internal, hasLead } = input;
  if (!orgCanUpdate) {
    return {
      role,
      canManage: false,
      canCreateTasks: false,
      canComment: false,
      canLogTime: false,
      assignable: false,
      hasLead,
    };
  }
  const leads = (role === 'lead' || role === 'deputy') && internal;
  const viewer = role === 'viewer';
  return {
    role,
    canManage: orgCanManage || leads,
    canCreateTasks: orgCanManage || !viewer,
    canComment: true,
    canLogTime: orgCanManage || !viewer,
    assignable: !viewer,
    hasLead,
  };
}

/** Droits d'un appelant sur une tâche (ADR-0076 § 2 et § 4). */
export interface WorkTaskRights {
  /** Modifier (titre, dates, colonne hors « terminé », responsable, étiquettes…). */
  canEdit: boolean;
  /** Terminer ou rouvrir (et glisser vers ou hors de la colonne « terminé »). */
  canComplete: boolean;
  /** Cocher ou décocher la liste de contrôle. */
  canCheck: boolean;
}

/**
 * Droits sur une tâche :
 *   - modifier : gestion, responsable, collaborateur, créateur, ou tout Membre si la
 *     tâche est sans responsable ;
 *   - terminer : gestion ou responsable ; tâche sans responsable : responsable de la tâche
 *     parente (sous-tâche), ou tout Membre qui peut la modifier si le projet n'a ni chef ni
 *     adjoint ;
 *   - cocher : gestion, responsable, collaborateurs.
 */
export function taskRights(input: {
  userId: string;
  project: WorkProjectRights;
  task: {
    assigneeUserId: string | null;
    collaboratorUserIds: readonly string[];
    createdBy: string | null;
  };
  parent?: { assigneeUserId: string | null } | null;
}): WorkTaskRights {
  const { userId, project, task, parent } = input;
  if (project.canManage) return { canEdit: true, canComplete: true, canCheck: true };
  if (!project.canCreateTasks) return { canEdit: false, canComplete: false, canCheck: false };
  const assignee = task.assigneeUserId === userId;
  const collaborator = task.collaboratorUserIds.includes(userId);
  const free = task.assigneeUserId === null;
  const canEdit = assignee || collaborator || task.createdBy === userId || free;
  const canComplete =
    assignee ||
    (free &&
      ((parent?.assigneeUserId ?? null) === userId ||
        (!project.hasLead && canEdit && (parent?.assigneeUserId ?? null) === null)));
  return { canEdit, canComplete, canCheck: assignee || collaborator };
}
