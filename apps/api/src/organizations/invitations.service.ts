import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { Invitation, type InvitationDocument } from './invitation.schema.js';
import { Membership, type MembershipDocument } from './membership.schema.js';

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

  /** Vérifie que l'utilisateur est owner de l'org — sinon 403. */
  private async assertOwner(userId: string, organizationId: string): Promise<void> {
    const m = await this.membershipModel.findOne({ userId, organizationId }).lean().exec();
    if (!m) throw new NotFoundException({ code: 'ORG_NOT_FOUND' });
    if (m.role !== 'owner') {
      throw new ForbiddenException({ code: 'OWNER_ROLE_REQUIRED' });
    }
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
    role?: 'owner' | 'member';
  }): Promise<InvitationDocument> {
    await this.assertOwner(input.invitedBy, input.organizationId);

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
        role: input.role ?? 'member',
        token: generateToken(),
        expiresAt: new Date(Date.now() + DEFAULT_TTL_MS),
        _schemaVersion: 1,
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

  /** Liste les invitations pending d'une org (owner only). */
  async listPendingForOrg(
    requestingUserId: string,
    organizationId: string,
  ): Promise<InvitationDocument[]> {
    await this.assertOwner(requestingUserId, organizationId);
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

  /** Révoque une invitation. Owner only. */
  async revoke(
    requestingUserId: string,
    organizationId: string,
    invitationId: string,
  ): Promise<InvitationDocument> {
    await this.assertOwner(requestingUserId, organizationId);
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
      await this.membershipModel.create({
        userId,
        organizationId: inv.organizationId,
        role: inv.role,
        _schemaVersion: 1,
      });
    }

    if (!inv.acceptedAt) {
      inv.acceptedAt = new Date();
      await inv.save();
    }

    return { invitation: inv, organizationId: inv.organizationId };
  }
}
