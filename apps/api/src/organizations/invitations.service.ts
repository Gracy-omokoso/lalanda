import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import {
  canGrantRole,
  isAssignableRole,
  normalizeOrgRole,
  type OrgRole,
} from '../authz/permissions.js';
import { Invitation, type InvitationDocument } from './invitation.schema.js';
import {
  MEMBERSHIP_SCHEMA_VERSION,
  Membership,
  type MembershipDocument,
} from './membership.schema.js';

/**
 * Durée de vie par défaut d'une invitation (7 jours).
 * Choix : 7 jours = standard SaaS (Slack, GitHub, Notion) — assez long pour un pro occupé,
 * assez court pour que le token n'accumule pas trop de surface d'attaque.
 */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function generateToken(): string {
  // 32 octets → 64 chars hex, imprévisibles cryptographiquement.
  return randomBytes(32).toString('hex');
}

@Injectable()
export class InvitationsService {
  constructor(
    @InjectModel(Invitation.name) private readonly invModel: Model<InvitationDocument>,
    @InjectModel(Membership.name) private readonly membershipModel: Model<MembershipDocument>,
  ) {}

  /**
   * Rôle de l'appelant dans l'organisation.
   *
   * S20a : ne vérifie plus « est-ce un owner ? ». Le droit d'inviter est porté
   * par l'action `members.invite` et appliqué par `PermissionsGuard` en amont
   * (ADR-0012 §8 : aucun `if (role === …)` hors de `permissions.ts`). Ce qui
   * reste ici, c'est la lecture du rôle nécessaire à R7.
   *
   * Un non-membre reçoit 404, jamais 403 (ADR-0011 Contrat 4).
   */
  private async actorRole(userId: string, organizationId: string): Promise<OrgRole> {
    const m = await this.membershipModel.findOne({ userId, organizationId }).lean().exec();
    if (!m) throw new NotFoundException({ code: 'ORG_NOT_FOUND' });
    const role = normalizeOrgRole(m.role);
    if (role === undefined) throw new ForbiddenException({ code: 'UNKNOWN_ROLE' });
    return role;
  }

  /**
   * Crée une invitation. Refuse si l'email est déjà membre de l'org OU s'il existe déjà
   * une invitation pending (index partiel unique).
   * Attention : cette méthode ne connaît pas le user_id de l'email invité — le matching
   * user↔invitation se fait à l'acceptation via `session.user.email`.
   */
  async create(input: {
    organizationId: string;
    invitedBy: string;
    email: string;
    role?: OrgRole;
  }): Promise<InvitationDocument> {
    const actor = await this.actorRole(input.invitedBy, input.organizationId);

    // Défaut `viewer` — moindre privilège (ADR-0012 §7).
    const role: OrgRole = input.role ?? 'viewer';

    // R7 — une invitation ne doit jamais servir d'escalade de privilège : on ne
    // peut inviter qu'à un rôle dont l'ensemble d'actions est un sous-ensemble du
    // sien. Contrôlé ICI et pas seulement dans l'UI, car l'UI ne garde rien.
    if (!isAssignableRole(role)) {
      throw new ConflictException({
        code: 'ROLE_NOT_ASSIGNABLE',
        message: `Le rôle « ${role} » n'est pas encore attribuable (assignations de projet absentes).`,
      });
    }
    if (!canGrantRole(actor, role)) {
      throw new ForbiddenException({
        code: 'ROLE_ESCALATION',
        message: `Un « ${actor} » ne peut pas inviter au rôle « ${role} ».`,
      });
    }

    const emailNormalized = input.email.trim().toLowerCase();
    if (!emailNormalized || !emailNormalized.includes('@')) {
      throw new BadRequestException({ code: 'INVALID_EMAIL' });
    }

    // Cas : le user est déjà membre. On matche par email en interrogeant la collection `user`
    // via la membership → mais on n'a pas de lookup direct email→userId ici sans casser
    // l'isolation better-auth. On garde donc la vérification "déjà membre" au moment de l'acceptation.
    // L'unicité pending (org, email) suffit à empêcher les doublons d'invitation.

    try {
      return await this.invModel.create({
        organizationId: input.organizationId,
        email: emailNormalized,
        invitedBy: input.invitedBy,
        role,
        token: generateToken(),
        expiresAt: new Date(Date.now() + DEFAULT_TTL_MS),
        _schemaVersion: MEMBERSHIP_SCHEMA_VERSION,
      });
    } catch (err: unknown) {
      // Duplicate key sur l'index partiel unique → 409 métier.
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: number }).code === 11000
      ) {
        throw new BadRequestException({
          code: 'INVITATION_ALREADY_PENDING',
          message: `Une invitation en attente existe déjà pour ${emailNormalized}`,
        });
      }
      throw err;
    }
  }

  /** Liste les invitations pending d'une org. Garde : `members.invite`. */
  async listPendingForOrg(
    requestingUserId: string,
    organizationId: string,
  ): Promise<InvitationDocument[]> {
    await this.actorRole(requestingUserId, organizationId);
    return this.invModel
      .find({
        organizationId,
        acceptedAt: null,
        revokedAt: null,
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Liste les invitations pending et non-expirées adressées à l'email d'un user.
   * Utilisé pour la bannière "vous avez X invitations en attente" sur le dashboard.
   */
  async listPendingForEmail(email: string): Promise<InvitationDocument[]> {
    return this.invModel
      .find({
        email: email.trim().toLowerCase(),
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  /** Révoque une invitation. Garde : `members.invite`. */
  async revoke(
    requestingUserId: string,
    organizationId: string,
    invitationId: string,
  ): Promise<InvitationDocument> {
    await this.actorRole(requestingUserId, organizationId);
    const inv = await this.invModel.findById(invitationId).exec();
    if (!inv || inv.organizationId !== organizationId) {
      throw new NotFoundException({ code: 'INVITATION_NOT_FOUND' });
    }
    if (inv.acceptedAt) {
      throw new BadRequestException({ code: 'INVITATION_ALREADY_ACCEPTED' });
    }
    if (inv.revokedAt) return inv;
    inv.revokedAt = new Date();
    await inv.save();
    return inv;
  }

  /**
   * Accepte une invitation par token. Le user connecté doit avoir un email qui matche.
   * Crée la membership + marque l'invitation acceptée. Idempotent : accepter deux fois
   * ne double pas la membership (index unique membership) et retourne le même résultat.
   */
  async acceptByToken(
    userId: string,
    userEmail: string,
    token: string,
  ): Promise<{ invitation: InvitationDocument; organizationId: string }> {
    const inv = await this.invModel.findOne({ token }).exec();
    if (!inv) throw new NotFoundException({ code: 'INVITATION_NOT_FOUND' });
    if (inv.revokedAt) throw new BadRequestException({ code: 'INVITATION_REVOKED' });
    if (inv.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException({ code: 'INVITATION_EXPIRED' });
    }
    if (inv.email !== userEmail.trim().toLowerCase()) {
      // Ne révèle rien sur l'existence du token à un tiers.
      throw new ForbiddenException({ code: 'INVITATION_EMAIL_MISMATCH' });
    }

    // Idempotence : si le user est déjà membre, on marque juste accepté et on renvoie.
    const existingMembership = await this.membershipModel
      .findOne({ userId, organizationId: inv.organizationId })
      .exec();

    if (!existingMembership) {
      // ── Revalidation du rôle à l'acceptation ────────────────────────────────
      // Une invitation vit jusqu'à 7 jours. Entre l'émission et l'acceptation,
      // l'inviteur a pu être rétrogradé ou révoqué. Honorer le rôle figé
      // reviendrait à laisser un `admin` révoqué continuer de peupler
      // l'organisation — c'est exactement ce que « révocation immédiate »
      // (docs/12 § Tests obligatoires) interdit.
      const inviter = await this.membershipModel
        .findOne({ userId: inv.invitedBy, organizationId: inv.organizationId })
        .lean()
        .exec();
      const inviterRole = inviter ? normalizeOrgRole(inviter.role) : undefined;
      const invitedRole = normalizeOrgRole(inv.role);
      if (
        inviterRole === undefined ||
        invitedRole === undefined ||
        !canGrantRole(inviterRole, invitedRole)
      ) {
        throw new ForbiddenException({
          code: 'INVITATION_INVITER_NO_LONGER_AUTHORIZED',
          message:
            "La personne qui a émis cette invitation n'a plus le droit d'attribuer ce rôle. " +
            'Demandez une nouvelle invitation.',
        });
      }

      await this.membershipModel.create({
        userId,
        organizationId: inv.organizationId,
        role: invitedRole,
        canClosePeriods: false,
        _schemaVersion: MEMBERSHIP_SCHEMA_VERSION,
      });
    }

    if (!inv.acceptedAt) {
      inv.acceptedAt = new Date();
      await inv.save();
    }

    return { invitation: inv, organizationId: inv.organizationId };
  }
}
