// Membres d'un projet et visibilité (ADR-0060 § 3 et § 4).
//
// Un projet garde deux listes : des UTILISATEURS ajoutés un à un et des ÉQUIPES
// (RH, `@lalanda/shared/hr` — `TeamView`). Une équipe ajoutée donne accès à ses
// membres COURANTS, résolus à chaque lecture : la rejoindre plus tard ouvre le
// projet, la quitter le ferme. Rien n'est recopié.

import { z } from 'zod';

import type { WorkProjectVisibility } from './constants.js';
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

/** Équipe proposée par le module (sélecteur « Ajouter une équipe »). */
export interface WorkTeamRef {
  teamId: string;
  name: string;
  memberCount: number;
}

/** Équipe ajoutée à un projet, avec ses membres courants. */
export interface WorkProjectTeamView extends WorkTeamRef {
  members: WorkMemberRef[];
}

/** Utilisateur ajouté individuellement. */
export interface WorkProjectUserView extends WorkMemberRef {
  /** Peut être responsable d'une tâche (`work.update`). */
  canUpdate: boolean;
}

/** `GET /work/projects/:projectId/members`. */
export interface WorkProjectMembersView {
  projectId: string;
  visibility: WorkProjectVisibility;
  owner: WorkMemberRef | null;
  users: WorkProjectUserView[];
  teams: WorkProjectTeamView[];
  /** Personnes distinctes qui accèdent au projet par leur appartenance (responsable compris). */
  memberCount: number;
  /** L'appelant peut-il modifier les membres et la visibilité (`work.manage`) ? */
  canManage: boolean;
}

/** Fonction pure : personnes distinctes d'un projet (responsable, membres directs, équipes). */
export function distinctProjectMembers(input: {
  ownerUserId: string | null;
  userIds: readonly string[];
  teams: readonly { members: readonly { userId: string }[] }[];
}): string[] {
  const out = new Set<string>();
  if (input.ownerUserId) out.add(input.ownerUserId);
  for (const id of input.userIds) out.add(id);
  for (const t of input.teams) for (const m of t.members) out.add(m.userId);
  return [...out];
}
