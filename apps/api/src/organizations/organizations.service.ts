import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { MEMBERSHIP_SCHEMA_VERSION, Membership, type MembershipDocument } from './membership.schema.js';
import { Organization, type OrganizationDocument } from './organization.schema.js';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectModel(Organization.name) private readonly orgModel: Model<OrganizationDocument>,
    @InjectModel(Membership.name) private readonly membershipModel: Model<MembershipDocument>,
  ) {}

  /**
   * Crée l'organisation personnelle par défaut d'un utilisateur nouvellement inscrit
   * + un membership `owner`. Idempotent : ne fait rien si l'utilisateur a déjà une org.
   */
  async provisionPersonalOrgForUser(userId: string, name: string): Promise<OrganizationDocument> {
    const existing = await this.membershipModel.findOne({ userId }).exec();
    if (existing) {
      const org = await this.orgModel.findById(existing.organizationId).exec();
      if (org) return org;
    }

    const slug = await this.uniqueSlug(name);
    const org = await this.orgModel.create({
      name: `${name}'s Workspace`,
      slug,
      type: 'solo',
      pays: 'CD',
      ownerId: userId,
      _schemaVersion: 1,
    });

    await this.membershipModel.create({
      userId,
      organizationId: org.id,
      role: 'proprietaire',
      _schemaVersion: MEMBERSHIP_SCHEMA_VERSION,
    });

    return org;
  }

  /**
   * Retourne l'organisation principale d'un utilisateur : celle dont il est
   * `proprietaire` en priorité, sinon la membership la plus ancienne (l'org
   * auto-provisionnée à l'inscription).
   *
   * S20a : le tri `{ role: -1 }` d'origine reposait sur l'ordre alphabétique de
   * `owner` > `member`. Avec huit rôles cet accident n'est plus une règle — la
   * priorité est désormais explicite.
   */
  async findPrimaryOrgForUser(userId: string): Promise<OrganizationDocument | null> {
    const memberships = await this.membershipModel.find({ userId }).sort({ createdAt: 1 }).exec();
    if (memberships.length === 0) return null;
    const primary =
      memberships.find((m) => normalizeOrgRole(m.role) === 'proprietaire') ?? memberships[0]!;
    return this.orgModel.findById(primary.organizationId).exec();
  }

  /** Vérifie qu'un user est membre d'une org — utilisé par les guards. */
  async isMember(userId: string, organizationId: string): Promise<boolean> {
    const m = await this.membershipModel.findOne({ userId, organizationId }).lean().exec();
    return m !== null;
  }

  async findOrgById(id: string): Promise<OrganizationDocument> {
    const org = await this.orgModel.findById(id).exec();
    if (!org) throw new NotFoundException({ code: 'ORG_NOT_FOUND' });
    return org;
  }

  /**
   * Liste toutes les organisations dont l'utilisateur est membre, avec son rôle.
   * Utilisé par l'org-switcher côté UI.
   */
  async listForUser(
    userId: string,
  ): Promise<Array<{ org: OrganizationDocument; role: 'owner' | 'member' }>> {
    const memberships = await this.membershipModel.find({ userId }).sort({ createdAt: 1 }).exec();
    if (memberships.length === 0) return [];
    const orgIds = memberships.map((m) => m.organizationId);
    const orgs = await this.orgModel.find({ _id: { $in: orgIds } }).exec();
    const byId = new Map(orgs.map((o) => [String(o._id), o]));
    return memberships
      .map((m) => ({ org: byId.get(m.organizationId)!, role: m.role }))
      .filter((x) => x.org);
  }

  /**
   * Crée une nouvelle organisation pour un utilisateur existant et lui attribue
   * le rôle owner. Utilisé quand l'utilisateur crée une org supplémentaire depuis l'UI.
   */
  async createForUser(
    userId: string,
    input: {
      name: string;
      type?: 'solo' | 'agence' | 'incubateur' | 'banque' | 'ecole';
      pays?: string;
    },
  ): Promise<OrganizationDocument> {
    const trimmed = input.name.trim();
    if (trimmed.length === 0) {
      throw new NotFoundException({ code: 'INVALID_ORG_NAME' });
    }
    const slug = await this.uniqueSlug(trimmed);
    const org = await this.orgModel.create({
      name: trimmed,
      slug,
      type: input.type ?? 'solo',
      pays: input.pays ?? 'CD',
      ownerId: userId,
      _schemaVersion: 1,
    });
    await this.membershipModel.create({
      userId,
      organizationId: org.id,
      role: 'proprietaire',
      _schemaVersion: MEMBERSHIP_SCHEMA_VERSION,
    });
    return org;
  }

  private async uniqueSlug(base: string): Promise<string> {
    const seed =
      base
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'org';

    // Essaie seed, puis seed-2, seed-3, ...
    for (let i = 0; i < 20; i++) {
      const candidate = i === 0 ? seed : `${seed}-${i + 1}`;
      const clash = await this.orgModel.exists({ slug: candidate });
      if (!clash) return candidate;
    }
    // Fallback : suffixe aléatoire pour ne jamais bloquer une inscription.
    return `${seed}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
