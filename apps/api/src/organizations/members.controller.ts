import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { CurrentOrgRole } from '../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import {
  ASSIGNABLE_ORG_ROLES,
  ORG_ROLES,
  ORG_ROLE_DESCRIPTIONS,
  ORG_ROLE_LABELS,
  grantableRoles,
  type OrgRole,
} from '../authz/permissions.js';
import { MembersService } from './members.service.js';

const ChangeRoleSchema = z.object({ role: z.enum(ORG_ROLES) });
const CloseRightSchema = z.object({ value: z.boolean() });
const TransferSchema = z.object({ userId: z.string().min(1) });

export interface MemberView {
  userId: string;
  role: OrgRole;
  roleLabel: string;
  canClosePeriods: boolean;
  acceptedAt: string | null;
  /** L'UI doit-elle interdire toute action sur cette ligne ? (R1, dernier propriétaire) */
  isLastOwner: boolean;
}

export interface RoleOption {
  value: OrgRole;
  label: string;
  description: string;
  /** L'acteur courant peut-il attribuer ce rôle ? (R7) */
  grantable: boolean;
}

/**
 * Gestion des membres d'une organisation (S20a, ADR-0012 §6).
 *
 * Toutes les routes portent `:orgId` : `PermissionsGuard` évalue le rôle de
 * l'appelant DANS CETTE organisation, pas dans son organisation active. Un
 * non-membre reçoit 404, jamais 403 (ADR-0011 Contrat 4).
 *
 * ── Lacune assumée ──────────────────────────────────────────────────────────
 * docs/12 ne définit aucune action « lire les membres ». La consultation du
 * trombinoscope est donc gardée par `organization.manage`, l'action la plus
 * proche — ce qui la réserve aux `owner` et `admin`. C'est le choix restrictif :
 * l'inverse (l'ouvrir à tous via `project.read`) inventerait une permission que
 * la spécification ne donne pas. À arbitrer avec la lacune n°3 d'ADR-0012.
 */
@Controller('organizations/:orgId')
@UseGuards(AuthGuard, PermissionsGuard)
export class MembersController {
  constructor(@Inject(MembersService) private readonly members: MembersService) {}

  @Get('members')
  @RequirePermission('organization.manage')
  async list(
    @Param('orgId') orgId: string,
    @CurrentOrgRole() actorRole: OrgRole,
  ): Promise<{ members: MemberView[]; roleOptions: RoleOption[] }> {
    const rows = await this.members.list(orgId);
    const owners = rows.filter((r) => r.role === 'owner').length;
    const grantable = new Set(grantableRoles(actorRole));

    return {
      members: rows.map((r) => ({
        userId: r.userId,
        role: r.role,
        roleLabel: ORG_ROLE_LABELS[r.role],
        canClosePeriods: r.canClosePeriods,
        acceptedAt: r.acceptedAt ? r.acceptedAt.toISOString() : null,
        // R1 rendu visible dans l'UI : le dernier propriétaire n'est ni
        // rétrogradable ni révocable. Le serveur refuse de toute façon (409
        // LAST_OWNER) — ceci évite d'offrir un bouton qui échouera.
        isLastOwner: r.role === 'owner' && owners === 1,
      })),
      roleOptions: ASSIGNABLE_ORG_ROLES.map((value) => ({
        value,
        label: ORG_ROLE_LABELS[value],
        description: ORG_ROLE_DESCRIPTIONS[value],
        grantable: grantable.has(value),
      })),
    };
  }

  @Patch('members/:userId/role')
  @RequirePermission('organization.manage')
  async changeRole(
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() actorRole: OrgRole,
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
    @Body() body: unknown,
  ): Promise<{ member: MemberView }> {
    const parsed = ChangeRoleSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    const row = await this.members.changeRole({
      organizationId: orgId,
      actorUserId: user.id,
      actorRole,
      targetUserId,
      role: parsed.data.role,
    });
    return { member: await this.viewOf(orgId, row) };
  }

  /** Accorde ou retire la clôture au Comptable — la seule case ⚙ du modèle. */
  @Patch('members/:userId/close-right')
  @RequirePermission('organization.manage')
  async setCloseRight(
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() actorRole: OrgRole,
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
    @Body() body: unknown,
  ): Promise<{ member: MemberView }> {
    const parsed = CloseRightSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    const row = await this.members.setCanClosePeriods({
      organizationId: orgId,
      actorUserId: user.id,
      actorRole,
      targetUserId,
      value: parsed.data.value,
    });
    return { member: await this.viewOf(orgId, row) };
  }

  @Delete('members/:userId')
  @RequirePermission('organization.manage')
  async revoke(
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() actorRole: OrgRole,
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
  ): Promise<{ revoked: true }> {
    await this.members.revoke({
      organizationId: orgId,
      actorUserId: user.id,
      actorRole,
      targetUserId,
    });
    return { revoked: true };
  }

  /**
   * Transfert de propriété — l'unique manière de faire d'un autre membre le
   * propriétaire, et donc l'unique manière pour un propriétaire unique de se
   * rétrograder. Le guard exige `organization.manage`; le service exige en plus
   * que l'acteur soit lui-même `owner`.
   */
  @Post('transfer-ownership')
  @RequirePermission('organization.manage')
  async transfer(
    @CurrentUser() user: { id: string },
    @Param('orgId') orgId: string,
    @Body() body: unknown,
  ): Promise<{ previousOwner: MemberView; newOwner: MemberView }> {
    const parsed = TransferSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    const { previousOwner, newOwner } = await this.members.transferOwnership({
      organizationId: orgId,
      actorUserId: user.id,
      targetUserId: parsed.data.userId,
    });
    return {
      previousOwner: await this.viewOf(orgId, previousOwner),
      newOwner: await this.viewOf(orgId, newOwner),
    };
  }

  /** Recalcule `isLastOwner` après écriture — l'état a pu changer. */
  private async viewOf(
    orgId: string,
    row: { userId: string; role: OrgRole; canClosePeriods: boolean; acceptedAt: Date | null },
  ): Promise<MemberView> {
    const owners = (await this.members.list(orgId)).filter((r) => r.role === 'owner').length;
    return {
      userId: row.userId,
      role: row.role,
      roleLabel: ORG_ROLE_LABELS[row.role],
      canClosePeriods: row.canClosePeriods,
      acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
      isLastOwner: row.role === 'owner' && owners === 1,
    };
  }
}
