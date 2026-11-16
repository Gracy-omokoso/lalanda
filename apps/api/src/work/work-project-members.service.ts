// Membres d'un projet : utilisateurs et équipes — ADR-0060 § 4.
//
// Un utilisateur ajouté doit être membre de l'organisation et détenir `work.read`
// (404 s'il n'est pas membre, 400 `WORK_MEMBER_NOT_ELIGIBLE` sinon). Une équipe doit
// exister dans l'organisation (`hr_teams`, lue en lecture seule ; 404 sinon). Les
// membres d'une équipe ne sont JAMAIS recopiés : la portée (`WorkAccessService`) les
// résout à chaque lecture, si bien qu'un membre qui rejoint l'équipe plus tard accède
// au projet, et qu'un membre qui la quitte le perd.

import {
  WORK_PROJECT_MEMBER_LIMITS,
  distinctProjectMembers,
  memberRoleOf,
  resolveProjectRole,
  type AddProjectMembersBody,
  type WorkProjectRole,
  type WorkProjectMemberRole,
  type WorkMemberRef,
  type WorkProjectMembersView,
  type WorkProjectTeamView,
  type WorkTeamRef,
} from '@lalanda/shared/work';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { can } from '../authz/permissions.js';
import {
  conflict,
  isWorkId,
  notFound,
  oid,
  projectArchived,
  type WorkActor,
} from './work.common.js';
import type { WorkProjectAudience } from './work-access.js';
import { HR_TEAMS_COLLECTION, WorkAccessService } from './work-access.service.js';
import { WorkActivityService } from './work-activity.service.js';
import { WorkMembersService } from './work-members.service.js';
import { WorkNotifier } from './work-notifier.js';
import { WorkProjectsService } from './work-projects.service.js';
import { WorkProject, type WorkProjectDocument } from './work.schemas.js';

interface TeamRead {
  _id: unknown;
  name: string;
  leadUserId?: string | null;
  memberUserIds?: string[];
}

function teamNotFound(): never {
  notFound('HR_TEAM_NOT_FOUND', 'Équipe introuvable.');
}

/** Membres d'une équipe, responsable compris, sans doublon. */
export function teamMemberIds(t: Pick<TeamRead, 'leadUserId' | 'memberUserIds'>): string[] {
  const ids = new Set(t.memberUserIds ?? []);
  if (t.leadUserId) ids.add(t.leadUserId);
  return [...ids];
}

@Injectable()
export class WorkProjectMembersService {
  constructor(
    @InjectModel(WorkProject.name) private readonly projectModel: Model<WorkProjectDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(WorkProjectsService) private readonly projects: WorkProjectsService,
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
    @Inject(WorkActivityService) private readonly activity: WorkActivityService,
    @Inject(WorkNotifier) private readonly notifier: WorkNotifier,
    @Inject(WorkAccessService) private readonly access: WorkAccessService,
  ) {}

  private async teamsOf(organizationId: string, ids: readonly string[]): Promise<TeamRead[]> {
    const valid = [...new Set(ids.filter(isWorkId))];
    if (valid.length === 0) return [];
    return (await this.connection
      .collection(HR_TEAMS_COLLECTION)
      .find(
        { organizationId, _id: { $in: valid.map(oid) } },
        { projection: { name: 1, leadUserId: 1, memberUserIds: 1 } },
      )
      .toArray()) as unknown as TeamRead[];
  }

  /** ADR-0066 § 3 : visibilité et comptes qui appartiennent au projet (404 s'il n'existe pas). */
  async audienceOf(organizationId: string, projectId: string): Promise<WorkProjectAudience> {
    const project = await this.projects.requireOwn(organizationId, projectId);
    const teams = await this.teamsOf(organizationId, project.memberTeamIds ?? []);
    const members = new Set<string>([
      ...(project.memberUserIds ?? []),
      ...teams.flatMap(teamMemberIds),
      ...(project.ownerUserId ? [project.ownerUserId] : []),
      // ADR-0076 § 1 : l'adjoint appartient au projet.
      ...(project.deputyUserId ? [project.deputyUserId] : []),
    ]);
    const roles = new Map<string, WorkProjectRole>();
    for (const userId of members) {
      roles.set(
        userId,
        resolveProjectRole({
          userId,
          ownerUserId: project.ownerUserId,
          deputyUserId: project.deputyUserId ?? null,
          memberUserIds: project.memberUserIds,
          memberTeamIds: project.memberTeamIds,
          memberRoles: project.memberRoles ?? [],
          userTeamIds: teams
            .filter((t) => teamMemberIds(t).includes(userId))
            .map((t) => String(t._id)),
        }),
      );
    }
    return { visibility: project.visibility ?? 'organization', members, roles };
  }

  /** `GET /work/teams` — équipes de l'organisation (sélecteur), sans leurs membres. */
  async listTeams(organizationId: string): Promise<WorkTeamRef[]> {
    const docs = (await this.connection
      .collection(HR_TEAMS_COLLECTION)
      .find({ organizationId }, { projection: { name: 1, leadUserId: 1, memberUserIds: 1 } })
      .sort({ name: 1 })
      .toArray()) as unknown as TeamRead[];
    return docs
      .map((t) => ({ teamId: String(t._id), name: t.name, memberCount: teamMemberIds(t).length }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }

  async get(
    organizationId: string,
    projectId: string,
    actor: WorkActor,
  ): Promise<WorkProjectMembersView> {
    const project = await this.projects.requireOwn(organizationId, projectId);
    const userIds = project.memberUserIds ?? [];
    const teams = await this.teamsOf(organizationId, project.memberTeamIds ?? []);
    const allIds = [
      ...userIds,
      ...teams.flatMap(teamMemberIds),
      ...(project.ownerUserId ? [project.ownerUserId] : []),
      ...(project.deputyUserId ? [project.deputyUserId] : []),
    ];
    const [refs, perms, rights] = await Promise.all([
      this.members.refs(allIds),
      this.members.permissions(organizationId, userIds),
      this.access.rightsOn(organizationId, project, actor),
    ]);
    const roles = project.memberRoles ?? [];
    const ref = (id: string): WorkMemberRef => WorkMembersService.refOf(refs, id);
    const byName = (a: WorkMemberRef, b: WorkMemberRef) => a.name.localeCompare(b.name, 'fr');
    const teamViews: WorkProjectTeamView[] = teams
      .map((t) => {
        const members = teamMemberIds(t).map(ref).sort(byName);
        return {
          teamId: String(t._id),
          name: t.name,
          memberCount: members.length,
          members,
          role: memberRoleOf(roles, 'team', String(t._id)),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return {
      projectId,
      visibility: project.visibility ?? 'organization',
      owner: project.ownerUserId ? ref(project.ownerUserId) : null,
      deputy: project.deputyUserId ? ref(project.deputyUserId) : null,
      users: userIds
        .map((id) => {
          const m = perms.get(id);
          return {
            ...ref(id),
            canUpdate: m !== undefined && can(m.role, 'work.update', m.context),
            role: memberRoleOf(roles, 'user', id),
          };
        })
        .sort(byName),
      teams: teamViews,
      memberCount: distinctProjectMembers({
        ownerUserId: project.ownerUserId,
        deputyUserId: project.deputyUserId ?? null,
        userIds,
        teams: teamViews,
      }).length,
      // ADR-0076 § 1 : chef, adjoint ou `work.manage`.
      canManage: rights.canManage,
    };
  }

  async add(
    organizationId: string,
    projectId: string,
    body: AddProjectMembersBody,
    actor: WorkActor,
    opts: { trusted?: boolean } = {},
  ): Promise<WorkProjectMembersView> {
    const project = await this.projects.requireOwn(organizationId, projectId);
    if (project.status === 'archived') projectArchived();
    // ADR-0076 § 1 : chef, adjoint ou `work.manage`. Un ajout par assignation (ADR-0066 § 3)
    // passe par `addByAssignment`, déjà décidé par la règle de l'assigné.
    if (!opts.trusted) await this.access.assertManage(organizationId, project, actor);
    const userIds = body.userIds ?? [];
    const teamIds = body.teamIds ?? [];
    await this.members.requireEligible(
      organizationId,
      userIds,
      'work.read',
      'WORK_MEMBER_NOT_ELIGIBLE',
      'userIds',
    );
    const teams = await this.teamsOf(organizationId, teamIds);
    if (teams.length !== new Set(teamIds).size) teamNotFound();

    const currentUsers = new Set(project.memberUserIds ?? []);
    const currentTeams = new Set(project.memberTeamIds ?? []);
    const newUsers = userIds.filter((u) => !currentUsers.has(u));
    const newTeams = teams.filter((t) => !currentTeams.has(String(t._id)));
    if (currentUsers.size + newUsers.length > WORK_PROJECT_MEMBER_LIMITS.usersMax) {
      conflict(
        'WORK_PROJECT_MEMBER_LIMIT',
        `Un projet compte au plus ${WORK_PROJECT_MEMBER_LIMITS.usersMax} membres ajoutés un à un : ajoutez plutôt une équipe.`,
      );
    }
    if (currentTeams.size + newTeams.length > WORK_PROJECT_MEMBER_LIMITS.teamsMax) {
      conflict(
        'WORK_PROJECT_TEAM_LIMIT',
        `Un projet compte au plus ${WORK_PROJECT_MEMBER_LIMITS.teamsMax} équipes.`,
      );
    }
    if (newUsers.length + newTeams.length > 0) {
      // ADR-0076 § 1 : rôle des nouveaux venus ; Membre (défaut) n'écrit rien.
      const role = body.role ?? 'member';
      const roleEntries =
        role === 'member'
          ? []
          : [
              ...newUsers.map((id) => ({ kind: 'user' as const, id, role })),
              ...newTeams.map((t) => ({ kind: 'team' as const, id: String(t._id), role })),
            ];
      await this.projectModel
        .updateOne(
          { _id: project._id, organizationId },
          {
            $addToSet: {
              memberUserIds: { $each: newUsers },
              memberTeamIds: { $each: newTeams.map((t) => String(t._id)) },
            },
            $set: {
              updatedBy: actor.userId,
              ...(roleEntries.length > 0
                ? {
                    memberRoles: [
                      ...(project.memberRoles ?? []).filter(
                        (r) => !roleEntries.some((e) => e.kind === r.kind && e.id === r.id),
                      ),
                      ...roleEntries,
                    ],
                  }
                : {}),
            },
            $inc: { revision: 1 },
          },
        )
        .exec();
      await this.activity.record(organizationId, {
        projectId,
        actorUserId: actor.userId,
        kind: 'project.member_added',
        data: { userIds: newUsers, teamIds: newTeams.map((t) => String(t._id)), role },
      });
      // ADR-0061 § 2 : « ajouté à un projet » — personnes ajoutées et membres des équipes.
      await this.notifier.projectEvent({
        organizationId,
        recipients: [...newUsers, ...newTeams.flatMap(teamMemberIds)],
        kind: 'work.added_to_project',
        projectId,
        title: `Vous avez été ajouté au projet ${project.name}`,
        actorUserId: actor.userId,
      });
    }
    return this.get(organizationId, projectId, actor);
  }

  /**
   * ADR-0076 § 1 : change le rôle (Membre, Lecteur) d'une personne ou d'une équipe déjà
   * membre. Chef, adjoint ou `work.manage`. Le chef et l'adjoint gardent leur rôle propre.
   */
  async setRole(
    organizationId: string,
    projectId: string,
    kind: 'user' | 'team',
    id: string,
    role: WorkProjectMemberRole,
    actor: WorkActor,
  ): Promise<WorkProjectMembersView> {
    const project = await this.projects.requireOwn(organizationId, projectId);
    if (project.status === 'archived') projectArchived();
    await this.access.assertManage(organizationId, project, actor);
    const list = kind === 'user' ? (project.memberUserIds ?? []) : (project.memberTeamIds ?? []);
    if (!list.includes(id)) {
      notFound('WORK_MEMBER_NOT_FOUND', 'Ce membre ou cette équipe ne fait pas partie du projet.');
    }
    const from = memberRoleOf(project.memberRoles, kind, id);
    if (from !== role) {
      const rest = (project.memberRoles ?? []).filter((r) => !(r.kind === kind && r.id === id));
      await this.projectModel
        .updateOne(
          { _id: project._id, organizationId },
          {
            $set: {
              memberRoles: role === 'member' ? rest : [...rest, { kind, id, role }],
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
        )
        .exec();
      await this.activity.record(organizationId, {
        projectId,
        actorUserId: actor.userId,
        kind: 'project.member_role_changed',
        data: { kind, id, from, to: role },
      });
    }
    return this.get(organizationId, projectId, actor);
  }

  async removeUser(
    organizationId: string,
    projectId: string,
    userId: string,
    actor: WorkActor,
  ): Promise<WorkProjectMembersView> {
    return this.remove(organizationId, projectId, { memberUserIds: userId }, actor, {
      userIds: [userId],
    });
  }

  async removeTeam(
    organizationId: string,
    projectId: string,
    teamId: string,
    actor: WorkActor,
  ): Promise<WorkProjectMembersView> {
    return this.remove(organizationId, projectId, { memberTeamIds: teamId }, actor, {
      teamIds: [teamId],
    });
  }

  private async remove(
    organizationId: string,
    projectId: string,
    pull: Record<string, string>,
    actor: WorkActor,
    data: Record<string, unknown>,
  ): Promise<WorkProjectMembersView> {
    const project = await this.projects.requireOwn(organizationId, projectId);
    if (project.status === 'archived') projectArchived();
    await this.access.assertManage(organizationId, project, actor);
    const [field, value] = Object.entries(pull)[0]!;
    const current = (project as unknown as Record<string, string[] | undefined>)[field] ?? [];
    if (!current.includes(value)) {
      notFound('WORK_MEMBER_NOT_FOUND', 'Ce membre ou cette équipe ne fait pas partie du projet.');
    }
    await this.projectModel
      .updateOne(
        { _id: project._id, organizationId },
        {
          $pull: {
            ...pull,
            // ADR-0076 § 1 : le rôle part avec le membre.
            memberRoles: { kind: field === 'memberUserIds' ? 'user' : 'team', id: value },
          },
          $set: { updatedBy: actor.userId },
          $inc: { revision: 1 },
        },
      )
      .exec();
    await this.activity.record(organizationId, {
      projectId,
      actorUserId: actor.userId,
      kind: 'project.member_removed',
      data,
    });
    return this.get(organizationId, projectId, actor);
  }
}
