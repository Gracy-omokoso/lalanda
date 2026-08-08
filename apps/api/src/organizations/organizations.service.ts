import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { ORG_ROLE_RANK, normalizeOrgRole, type OrgRole } from '../authz/permissions.js';
import {
  MEMBERSHIP_SCHEMA_VERSION,
  Membership,
  type MembershipDocument,
} from './membership.schema.js';
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
      _schemaVersion: MEMBERSHIP_SCHEMA_VERSION,
    });

    return org;
  }

  /**
   * Organisation principale d'un utilisateur : le rôle le plus privilégié d'abord,
   * puis, à rang égal, la membership la plus ancienne (l'org auto-provisionnée à
   * l'inscription).
   *
   * ── Bug corrigé en S20a (ADR-0012 §7, « piège découvert ») ───────────────────
   *
   * Le tri d'origine était `.sort({ role: -1, createdAt: 1 })`. Il ne triait pas
   * par privilège : il exploitait le fait que, sur les deux SEULES valeurs
   * d'alors, `'owner' > 'member'` en ordre ALPHABÉTIQUE. Avec les huit slugs de
   * docs/12 cet accident se retourne — `'viewer'`, `'project_manager'` et
   * `'finance_director'`… trient tous après ou avant `'owner'` sans aucun rapport
   * avec le privilège. Un utilisateur propriétaire de A et lecteur de B aurait
   * basculé sur B, silencieusement, sans erreur visible.
   *
   * Le tri se fait donc en mémoire sur `ORG_ROLE_RANK`, une donnée explicite. Le
   * volume est celui des organisations d'UN utilisateur (une poignée) : aucune
   * raison de complexifier avec un `$addFields` d'agrégation.
   *
   * Test de non-régression : `organizations.service.test.ts` (propriétaire de A,
   * lecteur de B → doit atterrir sur A, quel que soit l'ordre de création).
   */
  async findPrimaryOrgForUser(userId: string): Promise<OrganizationDocument | null> {
    const memberships = await this.membershipModel.find({ userId }).sort({ createdAt: 1 }).exec();
    if (memberships.length === 0) return null;

    const rankOf = (m: MembershipDocument): number => {
      const role = normalizeOrgRole(m.role);
      // Un rôle inconnu (document corrompu, futur slug non déployé) ne doit pas
      // gagner le tri : on le classe derrière tous les rôles connus.
      return role === undefined ? Number.MAX_SAFE_INTEGER : ORG_ROLE_RANK[role];
    };

    // `find().sort({ createdAt: 1 })` a déjà ordonné par ancienneté; `sort` est
    // stable en JavaScript, la comparaison par rang préserve donc ce départage.
    const primary = [...memberships].sort((a, b) => rankOf(a) - rankOf(b))[0]!;
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
  ): Promise<Array<{ org: OrganizationDocument; role: OrgRole; canClosePeriods: boolean }>> {
    const memberships = await this.membershipModel.find({ userId }).sort({ createdAt: 1 }).exec();
    if (memberships.length === 0) return [];
    const orgIds = memberships.map((m) => m.organizationId);
    const orgs = await this.orgModel.find({ _id: { $in: orgIds } }).exec();
    const byId = new Map<string, OrganizationDocument>(
      orgs.map((o) => [String(o._id), o as OrganizationDocument]),
    );
    // `flatMap` plutôt que `map().filter()` : il élimine les organisations
    // introuvables ET affine le type, sans prédicat de type à maintenir.
    return memberships.flatMap((m) => {
      const org = byId.get(m.organizationId);
      if (!org) return [];
      return [
        {
          org,
          // Tolère un document non encore migré (`member`) : l'API ne doit pas
          // s'effondrer si elle tourne avant la migration (compatibilité N-1).
          role: normalizeOrgRole(m.role) ?? 'viewer',
          canClosePeriods: m.canClosePeriods === true,
        },
      ];
    });
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
      role: 'owner',
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
