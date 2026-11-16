// Membres d'un projet et visibilité (ADR-0060 § 3 et § 4).
//
// Un projet garde deux listes : des UTILISATEURS ajoutés un à un et des ÉQUIPES
// (RH, `@lalanda/shared/hr` — `TeamView`). Une équipe ajoutée donne accès à ses
// membres COURANTS, résolus à chaque lecture : la rejoindre plus tard ouvre le
// projet, la quitter le ferme. Rien n'est recopié.

import { z } from 'zod';

import type { WorkProjectVisibility } from './constants.js';
// ADR-0076 § 1 : rôle d'un membre dans le projet.
import { WORK_PROJECT_MEMBER_ROLES, type WorkProjectMemberRole } from './roles.js';
import { WorkId } from './schemas.js';
import type { WorkMemberRef } from './views.js';

/** Bornes techniques des membres d'un projet. */
export const WORK_PROJECT_MEMBER_LIMITS = {
  usersMax: 200,
  teamsMax: 50,
} as const;

function idSet(max: number, what: string) {
  return z
    .array(WorkId, { error: `Liste ${what} attendue.` })
    .max(max, { message: `${max} ${what} au plus.` })
    .superRefine((ids, ctx) => {
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({
          code: 'custom',
          message: 'Un identifiant figure deux fois.',
          params: { code: 'WORK_ID_DUPLICATE' },
        });
      }
    });
}

/**
 * `POST /work/projects/:projectId/members` — ajoute des utilisateurs et des équipes
 * (déjà présents : ignorés). Au moins un des deux.
 */
export const AddProjectMembersBody = z
  .object({
    userIds: idSet(WORK_PROJECT_MEMBER_LIMITS.usersMax, 'd’utilisateurs').optional(),
    teamIds: idSet(WORK_PROJECT_MEMBER_LIMITS.teamsMax, 'd’équipes').optional(),
    // ADR-0076 § 1 : rôle des personnes et équipes ajoutées (défaut : Membre).
    role: z.enum(WORK_PROJECT_MEMBER_ROLES, { error: 'Rôle : member ou viewer.' }).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.userIds?.length ?? 0) + (v.teamIds?.length ?? 0) === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Ajoutez au moins un membre ou une équipe.',
        params: { code: 'WORK_MEMBERS_EMPTY' },
      });
    }
  });
export type AddProjectMembersBody = z.output<typeof AddProjectMembersBody>;

/**
 * `PUT /work/projects/:projectId/members/users/:userId/role` et `…/teams/:teamId/role`
 * (ADR-0076 § 1).
 */
export const SetProjectMemberRoleBody = z
  .object({ role: z.enum(WORK_PROJECT_MEMBER_ROLES, { error: 'Rôle : member ou viewer.' }) })
  .strict();
export type SetProjectMemberRoleBody = z.output<typeof SetProjectMemberRoleBody>;

/** Équipe proposée par le module (sélecteur « Ajouter une équipe »). */
export interface WorkTeamRef {
  teamId: string;
  name: string;
  memberCount: number;
}

/** Équipe ajoutée à un projet, avec ses membres courants. */
export interface WorkProjectTeamView extends WorkTeamRef {
  members: WorkMemberRef[];
  /** ADR-0076 § 1 : rôle de l'équipe dans le projet (absent : Membre). */
  role?: WorkProjectMemberRole;
}

/** Utilisateur ajouté individuellement. */
export interface WorkProjectUserView extends WorkMemberRef {
  /** Peut être responsable d'une tâche (`work.update`). */
  canUpdate: boolean;
  /** ADR-0076 § 1 : rôle dans le projet (absent : Membre). */
  role?: WorkProjectMemberRole;
}

/** `GET /work/projects/:projectId/members`. */
export interface WorkProjectMembersView {
  projectId: string;
  visibility: WorkProjectVisibility;
  owner: WorkMemberRef | null;
  /** ADR-0076 § 1 : Adjoint du chef de projet. */
  deputy?: WorkMemberRef | null;
  users: WorkProjectUserView[];
  teams: WorkProjectTeamView[];
  /** Personnes distinctes qui accèdent au projet par leur appartenance (responsable compris). */
  memberCount: number;
  /**
   * L'appelant peut-il modifier les membres et la visibilité ? `work.manage`, ou chef et
   * adjoint du projet (ADR-0076 § 1).
   */
  canManage: boolean;
}

/** Fonction pure : personnes distinctes d'un projet (responsable, membres directs, équipes). */
export function distinctProjectMembers(input: {
  ownerUserId: string | null;
  /** ADR-0076 § 1 : l'adjoint compte parmi les personnes du projet. */
  deputyUserId?: string | null;
  userIds: readonly string[];
  teams: readonly { members: readonly { userId: string }[] }[];
}): string[] {
  const out = new Set<string>();
  if (input.ownerUserId) out.add(input.ownerUserId);
  if (input.deputyUserId) out.add(input.deputyUserId);
  for (const id of input.userIds) out.add(id);
  for (const t of input.teams) for (const m of t.members) out.add(m.userId);
  return [...out];
}
