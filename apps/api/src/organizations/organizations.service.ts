import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { Membership, type MembershipDocument } from './membership.schema.js';
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
      role: 'owner',
      _schemaVersion: 1,
    });

    return org;
  }

  /** Retourne la première organisation d'un utilisateur (owner en priorité). */
  async findPrimaryOrgForUser(userId: string): Promise<OrganizationDocument | null> {
    const memberships = await this.membershipModel
      .find({ userId })
      .sort({ role: 1, createdAt: 1 }) // 'owner' vient avant 'member' alphabétiquement (o<m)... inversé, on trie ci-dessous
      .exec();
    if (memberships.length === 0) return null;
    // Priorité explicite : owner d'abord, puis membre.
    memberships.sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0));
    const primary = memberships[0]!;
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
