import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { OrgRoleInput } from '../authz/org-role.dto.js';
import { ORG_ROLE_LABELS, type OrgRole } from '../authz/permissions.js';
import { invitationUrl } from '../mail/mail.links.js';
import { MailService } from '../mail/mail.service.js';
import type { InvitationDocument } from './invitation.schema.js';
import { InvitationsService } from './invitations.service.js';
import { OrganizationsService } from './organizations.service.js';

const CreateInvitationSchema = z.object({
  email: z.string().email(),
  /** docs/12 § Invitations : une invitation « indique rôle et projets ». */
  role: OrgRoleInput.optional(),
});

const AcceptInvitationSchema = z.object({
  token: z.string().length(64, 'token invalide'),
});

/**
 * Représentation externe d'une invitation. Le `token` n'est retourné qu'à la création
 * (owner qui vient d'inviter) — jamais dans les listings, pour ne pas exfiltrer les tokens
 * pending côté audit / logs / capture réseau.
 */
export interface InvitationView {
  id: string;
  organizationId: string;
  email: string;
  role: OrgRole;
  roleLabel: string;
  invitedBy: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

function toView(doc: InvitationDocument): InvitationView {
  return {
    id: String(doc._id),
    organizationId: doc.organizationId,
    email: doc.email,
    role: doc.role,
    roleLabel: ORG_ROLE_LABELS[doc.role] ?? doc.role,
    invitedBy: doc.invitedBy,
    expiresAt: doc.expiresAt.toISOString(),
    acceptedAt: doc.acceptedAt ? doc.acceptedAt.toISOString() : null,
    revokedAt: doc.revokedAt ? doc.revokedAt.toISOString() : null,
    createdAt: (doc as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}

@Controller()
@UseGuards(AuthGuard, PermissionsGuard)
export class InvitationsController {
  constructor(
    @Inject(InvitationsService) private readonly invitations: InvitationsService,
    @Inject(OrganizationsService) private readonly organizations: OrganizationsService,
    private readonly mail: MailService,
  ) {}

  /**
   * Owner d'une org crée une invitation pour un email.
   *
   * L'invitation part MAINTENANT par email (S22a). Le token brut reste néanmoins
   * renvoyé dans cette réponse — et ce n'est pas une redondance :
   *  • sans SMTP configuré, c'est le SEUL moyen d'inviter quelqu'un (le lien est
   *    copiable depuis l'interface), et c'est le mode de fonctionnement documenté
   *    du produit hors production;
   *  • même avec SMTP, un email peut être classé en indésirable ou refusé par un
   *    domaine d'entreprise. Un lien copiable évite de rendre l'invitation
   *    dépendante d'une infrastructure qu'on ne maîtrise pas.
   * `emailDelivered` dit lequel des deux chemins a fonctionné, sans mentir.
   */
  @Post('organizations/:orgId/invitations')
  @RequirePermission('members.invite')
  async create(
    @CurrentUser() user: { id: string; email: string; name?: string | null },
    @Param('orgId') orgId: string,
    @Body() body: unknown,
  ): Promise<{ invitation: InvitationView; token: string; emailDelivered: boolean }> {
    const parsed = CreateInvitationSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    if (parsed.data.email.trim().toLowerCase() === user.email.trim().toLowerCase()) {
      throw new BadRequestException({ code: 'CANNOT_INVITE_SELF' });
    }
    const inv = await this.invitations.create({
      organizationId: orgId,
      invitedBy: user.id,
      email: parsed.data.email,
      role: parsed.data.role,
    });
    // Le nom de l'organisation est LU ICI et pas figé dans l'invitation : entre
    // l'émission et la lecture de l'email, il n'a pas le temps de changer, et le
    // dupliquer en base créerait un second endroit à mettre à jour lors d'un
    // renommage.
    const org = await this.organizations.findOrgById(orgId);

    // Un envoi en échec ne doit PAS annuler l'invitation : elle existe en base, son
    // lien est copiable depuis l'interface. `MailService` ne lève jamais — il
    // rapporte. (L'ancien `console.log` du token est supprimé : docs/17
    // § Journalisation interdit qu'un secret apparaisse dans les logs, et ce
    // token vaut une entrée dans l'organisation.)
    const delivery = await this.mail.sendInvitation({
      to: inv.email,
      url: invitationUrl(inv.token),
      organizationName: org.name,
      roleLabel: ORG_ROLE_LABELS[inv.role] ?? inv.role,
      inviterName: user.name ?? null,
      expiresAt: inv.expiresAt,
    });

    return { invitation: toView(inv), token: inv.token, emailDelivered: delivery.delivered };
  }

  @Get('organizations/:orgId/invitations')
  @RequirePermission('members.invite')
  async list(
    @CurrentUser() user: { id: string },
    @Param('orgId') orgId: string,
  ): Promise<{ invitations: InvitationView[] }> {
    const docs = await this.invitations.listPendingForOrg(user.id, orgId);
    return { invitations: docs.map(toView) };
  }

  @Delete('organizations/:orgId/invitations/:id')
  @RequirePermission('members.invite')
  async revoke(
    @CurrentUser() user: { id: string },
    @Param('orgId') orgId: string,
    @Param('id') id: string,
  ): Promise<{ invitation: InvitationView }> {
    const inv = await this.invitations.revoke(user.id, orgId, id);
    return { invitation: toView(inv) };
  }

  /**
   * Invitations pending destinées à l'email du user connecté — quelle que soit l'org.
   * Utilisé par la bannière du dashboard. Inclut le token car le user connecté est
   * l'invitée légitime (email vérifié par la session) — pas d'exfiltration.
   */
  @Get('invitations/pending')
  async listMine(
    @CurrentUser() user: { email: string },
  ): Promise<{ invitations: (InvitationView & { token: string })[] }> {
    const docs = await this.invitations.listPendingForEmail(user.email);
    return {
      invitations: docs.map((d) => ({ ...toView(d), token: d.token })),
    };
  }

  @Post('invitations/accept')
  async accept(
    @CurrentUser() user: { id: string; email: string },
    @Body() body: unknown,
  ): Promise<{ organizationId: string }> {
    const parsed = AcceptInvitationSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    const { organizationId } = await this.invitations.acceptByToken(
      user.id,
      user.email,
      parsed.data.token,
    );
    return { organizationId };
  }
}
