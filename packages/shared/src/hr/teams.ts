// Équipes de l'organisation (ADR-0060 § 2). Rangées dans les RH, servies aux Projets.
//
// Une équipe regroupe des UTILISATEURS de l'organisation (appartenances), pas des
// dossiers du personnel : elle peut traverser plusieurs services. Son responsable
// compte parmi ses membres. Ajoutée à un projet, elle y donne accès à ses membres
// COURANTS, résolus à chaque lecture (aucune copie).

import { z } from 'zod';

import {
  HrExpectedRevision,
  HrId,
  hrFr,
  hrIssue,
  hrOptionalText,
  hrRequiredText,
} from './common.js';

/** Bornes techniques des équipes. */
export const HR_TEAM_LIMITS = {
  nameMax: 80,
  descriptionMax: 1_000,
  membersMax: 200,
  teamsPerOrganization: 200,
} as const;

function uniqueIds(max: number) {
  return z
    .array(HrId, hrFr('Liste d’identifiants attendue.'))
    .max(max, { message: `${max} membres au plus.` })
    .superRefine((ids, ctx) => {
      if (new Set(ids).size !== ids.length) {
        hrIssue(ctx, 'HR_TEAM_MEMBER_DUPLICATE', 'Un membre figure deux fois.');
      }
    });
}

/** `POST /hr/teams`. */
export const CreateTeamBody = z
  .object({
    name: hrRequiredText(HR_TEAM_LIMITS.nameMax, 'Nom de l’équipe'),
    description: hrOptionalText(HR_TEAM_LIMITS.descriptionMax).optional(),
    leadUserId: HrId.nullable().optional(),
    memberUserIds: uniqueIds(HR_TEAM_LIMITS.membersMax).optional(),
  })
  .strict();
export type CreateTeamBody = z.output<typeof CreateTeamBody>;

/** `PUT /hr/teams/:teamId` — champs partiels, révision attendue. */
export const UpdateTeamBody = z
  .object({
    expectedRevision: HrExpectedRevision,
    name: hrRequiredText(HR_TEAM_LIMITS.nameMax, 'Nom de l’équipe').optional(),
    description: hrOptionalText(HR_TEAM_LIMITS.descriptionMax).optional(),
    leadUserId: HrId.nullable().optional(),
  })
  .strict();
export type UpdateTeamBody = z.output<typeof UpdateTeamBody>;

/** `POST /hr/teams/:teamId/members` — ajoute des membres (déjà présents : ignorés). */
export const AddTeamMembersBody = z
  .object({
    userIds: uniqueIds(HR_TEAM_LIMITS.membersMax).min(1, { message: 'Au moins un membre.' }),
  })
  .strict();
export type AddTeamMembersBody = z.output<typeof AddTeamMembersBody>;

export interface TeamMemberView {
  userId: string;
  name: string;
}

export interface TeamView {
  id: string;
  name: string;
  description: string | null;
  lead: TeamMemberView | null;
  members: TeamMemberView[];
  memberCount: number;
  /** Projets qui ont ajouté l'équipe (tous, quelle que soit leur visibilité : un nombre). */
  projectCount: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface TeamListView {
  items: TeamView[];
}
