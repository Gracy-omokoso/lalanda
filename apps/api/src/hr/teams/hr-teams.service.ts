// Équipes de l'organisation — ADR-0060 § 2.
//
// Isolation : chaque requête porte `organizationId` ; une équipe d'une autre
// organisation répond 404, un membre qui n'appartient pas à l'organisation aussi
// (`MEMBER_NOT_FOUND`). Nom unique dans l'organisation (`409 HR_TEAM_NAME_EXISTS`).
// Le responsable est toujours membre. Supprimer une équipe retire l'accès qu'elle
// donnait aux projets (la portée se résout à la lecture ; aucun projet n'est modifié).

import {
  HR_TEAM_LIMITS,
  type AddTeamMembersBody,
  type CreateTeamBody,
  type TeamListView,
  type TeamMemberView,
  type TeamView,
  type UpdateTeamBody,
} from '@lalanda/shared/hr';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { MembersService } from '../../organizations/members.service.js';
import { Membership, type MembershipDocument } from '../../organizations/membership.schema.js';
import { conflict, isDuplicateKey, staleRevision } from '../../sales/sales.errors.js';
import { isObjectIdHex, normalizeForSearch } from '../../sales/search.js';
import { Team, type TeamDocument, type TeamLean } from './team.schema.js';

export interface TeamActor {
  userId: string;
  role: string;
}

const FORMER_MEMBER = 'Ancien membre';

function teamNotFound(): never {
  throw new NotFoundException({ code: 'HR_TEAM_NOT_FOUND', message: 'Équipe introuvable.' });
}

function memberNotFound(): never {
  throw new NotFoundException({
    code: 'MEMBER_NOT_FOUND',
    message: 'Membre introuvable dans cette organisation.',
  });
}

function nameExists(): never {
  conflict('HR_TEAM_NAME_EXISTS', 'Une équipe porte déjà ce nom.');
}

/** Membres d'une équipe, responsable compris, sans doublon. */
export function membersWithLead(lead: string | null, members: readonly string[]): string[] {
  const out = [...new Set(members)];
  if (lead && !out.includes(lead)) out.unshift(lead);
  return out;
}

@Injectable()
export class HrTeamsService {
  constructor(
    @InjectModel(Team.name) private readonly teams: Model<TeamDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(MembersService) private readonly members: MembersService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async names(ids: readonly string[]): Promise<Map<string, string>> {
    const identities = await this.members.identitiesOf([...new Set(ids)]);
    const out = new Map<string, string>();
    for (const id of ids) {
      const who = identities.get(id);
      out.set(id, who?.name ?? who?.email ?? FORMER_MEMBER);
    }
    return out;
  }

  private async views(organizationId: string, docs: readonly TeamLean[]): Promise<TeamView[]> {
    const all = docs.flatMap((d) => membersWithLead(d.leadUserId, d.memberUserIds));
    const ids = docs.map((d) => String(d._id));
    const [names, usage] = await Promise.all([
      this.names(all),
      ids.length === 0
        ? []
        : this.connection
            .collection('work_projects')
            .aggregate<{ _id: string; n: number }>([
              { $match: { organizationId, memberTeamIds: { $in: ids } } },
              { $unwind: '$memberTeamIds' },
              { $match: { memberTeamIds: { $in: ids } } },
              { $group: { _id: '$memberTeamIds', n: { $sum: 1 } } },
            ])
            .toArray(),
    ]);
    const usageBy = new Map(usage.map((u) => [u._id, u.n]));
    const ref = (id: string): TeamMemberView => ({ userId: id, name: names.get(id) ?? FORMER_MEMBER });
    return docs.map((d) => {
      const members = membersWithLead(d.leadUserId, d.memberUserIds)
        .map(ref)
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      return {
        id: String(d._id),
        name: d.name,
        description: d.description ?? null,
        lead: d.leadUserId ? ref(d.leadUserId) : null,
        members,
        memberCount: members.length,
        projectCount: usageBy.get(String(d._id)) ?? 0,
        revision: d.revision,
        createdAt: new Date(d.createdAt).toISOString(),
        updatedAt: new Date(d.updatedAt).toISOString(),
      };
    });
  }

  /** Membres de l'organisation proposés comme membres d'équipe (nom seulement). */
  async candidates(organizationId: string): Promise<TeamMemberView[]> {
    const docs = await this.memberships
      .find({ organizationId }, { userId: 1 })
      .lean<{ userId: string }[]>()
      .exec();
    const ids = docs.map((d) => d.userId);
    const names = await this.names(ids);
    return ids
      .map((userId) => ({ userId, name: names.get(userId) ?? FORMER_MEMBER }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }

  async list(organizationId: string): Promise<TeamListView> {
    const docs = await this.teams
      .find({ organizationId })
      .sort({ nameKey: 1, _id: 1 })
      .lean<TeamLean[]>()
      .exec();
    return { items: await this.views(organizationId, docs) };
  }

  async requireOwn(organizationId: string, teamId: string): Promise<TeamLean> {
    if (typeof teamId !== 'string' || !isObjectIdHex(teamId)) teamNotFound();
    const doc = await this.teams
      .findOne({ _id: new Types.ObjectId(teamId), organizationId })
      .lean<TeamLean>()
      .exec();
    if (!doc) teamNotFound();
    return doc;
  }

  async get(organizationId: string, teamId: string): Promise<TeamView> {
    return (await this.views(organizationId, [await this.requireOwn(organizationId, teamId)]))[0]!;
  }

  /** Chaque utilisateur est membre de l'organisation (404 sinon). */
  private async requireMembers(organizationId: string, userIds: readonly string[]): Promise<void> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return;
    const found = await this.memberships
      .countDocuments({ organizationId, userId: { $in: ids } })
      .exec();
    if (found !== ids.length) memberNotFound();
  }

  async create(organizationId: string, body: CreateTeamBody, actor: TeamActor): Promise<TeamView> {
    const count = await this.teams.countDocuments({ organizationId }).exec();
    if (count >= HR_TEAM_LIMITS.teamsPerOrganization) {
      conflict(
        'HR_TEAM_LIMIT',
        `Une organisation compte au plus ${HR_TEAM_LIMITS.teamsPerOrganization} équipes.`,
      );
    }
    const lead = body.leadUserId ?? null;
    const members = membersWithLead(lead, body.memberUserIds ?? []);
    if (members.length > HR_TEAM_LIMITS.membersMax) {
      conflict('HR_TEAM_MEMBER_LIMIT', `${HR_TEAM_LIMITS.membersMax} membres au plus.`);
    }
    await this.requireMembers(organizationId, members);
    let created: TeamDocument;
    try {
      created = await this.teams.create({
        organizationId,
        name: body.name,
        nameKey: normalizeForSearch(body.name),
        description: body.description ?? null,
        leadUserId: lead,
        memberUserIds: members,
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        _schemaVersion: 1,
      });
    } catch (err) {
      if (isDuplicateKey(err)) nameExists();
      throw err;
    }
    await this.record(organizationId, actor, 'hr.team.created', String(created._id));
    return this.get(organizationId, String(created._id));
  }

  async update(
    organizationId: string,
    teamId: string,
    body: UpdateTeamBody,
    actor: TeamActor,
  ): Promise<TeamView> {
    const current = await this.requireOwn(organizationId, teamId);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const set: Record<string, unknown> = { updatedBy: actor.userId };
    if (body.name !== undefined) {
      set['name'] = body.name;
      set['nameKey'] = normalizeForSearch(body.name);
    }
    if (body.description !== undefined) set['description'] = body.description;
    if (body.leadUserId !== undefined) {
      if (body.leadUserId !== null) {
        await this.requireMembers(organizationId, [body.leadUserId]);
        set['memberUserIds'] = membersWithLead(body.leadUserId, current.memberUserIds);
      }
      set['leadUserId'] = body.leadUserId;
    }
    try {
      const res = await this.teams
        .updateOne(
          { _id: current._id, organizationId, revision: current.revision },
          { $set: set, $inc: { revision: 1 } },
        )
        .exec();
      if (res.matchedCount !== 1) {
        staleRevision((await this.requireOwn(organizationId, teamId)).revision);
      }
    } catch (err) {
      if (isDuplicateKey(err)) nameExists();
      throw err;
    }
    await this.record(organizationId, actor, 'hr.team.updated', teamId);
    return this.get(organizationId, teamId);
  }

  async addMembers(
    organizationId: string,
    teamId: string,
    body: AddTeamMembersBody,
    actor: TeamActor,
  ): Promise<TeamView> {
    const current = await this.requireOwn(organizationId, teamId);
    await this.requireMembers(organizationId, body.userIds);
    const next = membersWithLead(current.leadUserId, [...current.memberUserIds, ...body.userIds]);
    if (next.length > HR_TEAM_LIMITS.membersMax) {
      conflict('HR_TEAM_MEMBER_LIMIT', `${HR_TEAM_LIMITS.membersMax} membres au plus.`);
    }
    await this.teams
      .updateOne(
        { _id: current._id, organizationId },
        {
          $addToSet: { memberUserIds: { $each: body.userIds } },
          $set: { updatedBy: actor.userId },
          $inc: { revision: 1 },
        },
      )
      .exec();
    await this.record(organizationId, actor, 'hr.team.members_added', teamId, {
      count: body.userIds.length,
    });
    return this.get(organizationId, teamId);
  }

  /** Retire un membre ; retirer le responsable laisse l'équipe sans responsable. */
  async removeMember(
    organizationId: string,
    teamId: string,
    userId: string,
    actor: TeamActor,
  ): Promise<TeamView> {
    const current = await this.requireOwn(organizationId, teamId);
    if (!membersWithLead(current.leadUserId, current.memberUserIds).includes(userId)) {
      memberNotFound();
    }
    await this.teams
      .updateOne(
        { _id: current._id, organizationId },
        {
          $pull: { memberUserIds: userId },
          $set: {
            updatedBy: actor.userId,
            ...(current.leadUserId === userId ? { leadUserId: null } : {}),
          },
          $inc: { revision: 1 },
        },
      )
      .exec();
    await this.record(organizationId, actor, 'hr.team.member_removed', teamId);
    return this.get(organizationId, teamId);
  }

  async remove(organizationId: string, teamId: string, actor: TeamActor): Promise<void> {
    const current = await this.requireOwn(organizationId, teamId);
    await this.teams.deleteOne({ _id: current._id, organizationId }).exec();
    await this.record(organizationId, actor, 'hr.team.deleted', teamId, {
      name: current.name.slice(0, 80),
    });
  }

  private async record(
    organizationId: string,
    actor: TeamActor,
    action: string,
    targetId: string,
    metadata?: Record<string, string | number>,
  ): Promise<void> {
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action,
      targetType: 'hr_team',
      targetId,
      ...(metadata ? { metadata } : {}),
    });
  }
}
