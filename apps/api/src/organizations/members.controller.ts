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
import { memberPermissionsEnabled } from '../authz/authz.service.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../authz/current-org-permissions.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { OrgRoleInput } from '../authz/org-role.dto.js';
import {
  ACTIONS,
  ASSIGNABLE_ORG_ROLES,
  ORG_ROLE_DESCRIPTIONS,
  ORG_ROLE_LABELS,
  grantableRoles,
  type Action,
  type OrgRole,
} from '../authz/permissions.js';
import {
  MembersService,
  canManageMember,
  type ActorPermissions,
  type MemberRow,
} from './members.service.js';

// ADR-0041 § 6 — actions validées par le vocabulaire (`isAction`), motif ≤ 280.
const ActionInput = z.enum(ACTIONS as unknown as [Action, ...Action[]]);
const ActionList = z.array(ActionInput).max(ACTIONS.length * 2);
const Revision = z.number().int().min(0);
const Reason = z.string().max(280);

const ChangeRoleSchema = z
  .object({
    role: OrgRoleInput,
    grants: ActionList.optional(),
    revokes: ActionList.optional(),
    expectedRevision: Revision.optional(),
    reason: Reason.optional(),
  })
  .strict();
const CloseRightSchema = z
  .object({ value: z.boolean(), expectedRevision: Revision.optional() })
  .strict();
const PermissionsSchema = z
  .object({
    grants: ActionList,
    revokes: ActionList,
    expectedRevision: Revision,
    reason: Reason.optional(),
  })
  .strict();
const TransferSchema = z.object({ userId: z.string().min(1) });

export interface MemberView {
  userId: string;
  /** Identité lue chez better-auth. `null` si le compte n'existe plus (voir `identitiesOf`). */
  email: string | null;
  name: string | null;
  role: OrgRole;
  roleLabel: string;
  canClosePeriods: boolean;
  acceptedAt: string | null;
  /** ADR-0041 § 6 — ajouts propres à ce membre. */
  grants: Action[];
  /** ADR-0041 § 6 — retraits propres à ce membre. */
  revokes: Action[];
  /** ADR-0041 § 6 — droits effectifs (titre + ajouts − retraits, case ⚙). */
  effective: Action[];
  /** ADR-0041 § 6 — l'écart n'est pas vide. */
  customized: boolean;
  /** ADR-0041 G8 — à renvoyer en `expectedRevision` lors d'une écriture. */
  permissionsRevision: number;
  /** L'UI doit-elle interdire toute action sur cette ligne ? (R1, dernier propriétaire) */
  isLastOwner: boolean;
  /**
   * L'acteur courant peut-il agir sur CE membre ? (R7 appliqué à la rétrogradation)
   *
   * Faux dès que la cible est plus puissante que l'acteur — un `admin` ne peut ni
   * rétrograder ni révoquer un `owner`. Le serveur refuse déjà (`403
   * ROLE_ESCALATION`); ceci évite d'afficher des commandes vouées à l'échec.
   * ADR-0041 G1 : ensemble potentiel de la cible inclus dans celui de l'acteur.
   */
  manageable: boolean;
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
    @CurrentOrgPermissions() actor: CurrentOrgPermissionsValue,
  ): Promise<{ members: MemberView[]; roleOptions: RoleOption[] }> {
    const rows = await this.members.list(orgId);
    const owners = rows.filter((r) => r.role === 'owner').length;
    const grantable = new Set(
      memberPermissionsEnabled()
        ? grantableRoles(actor.role, actor.context)
        : grantableRoles(actor.role),
    );
    const identities = await this.members.identitiesOf(rows.map((r) => r.userId));

    return {
      members: rows.map((r) => this.toView(r, actor, owners, identities.get(r.userId))),
      roleOptions: ASSIGNABLE_ORG_ROLES.map((value) => ({
        value,
        label: ORG_ROLE_LABELS[value],
        description: ORG_ROLE_DESCRIPTIONS[value],
        grantable: grantable.has(value),
      })),
    };
  }

  /**
   * Change le titre. ADR-0041 § 3 : l'écart est EFFACÉ ; un nouvel écart peut être
   * fourni dans le même appel (`grants`, `revokes`), validé contre le nouveau titre.
   */
  @Patch('members/:userId/role')
  @RequirePermission('organization.manage')
  async changeRole(
    @CurrentUser() user: { id: string },
    @CurrentOrgPermissions() actor: CurrentOrgPermissionsValue,
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
      actor,
      targetUserId,
      role: parsed.data.role,
      ...(parsed.data.grants !== undefined ? { grants: parsed.data.grants } : {}),
      ...(parsed.data.revokes !== undefined ? { revokes: parsed.data.revokes } : {}),
      ...(parsed.data.expectedRevision !== undefined
        ? { expectedRevision: parsed.data.expectedRevision }
        : {}),
      ...(parsed.data.reason !== undefined ? { reason: parsed.data.reason } : {}),
    });
    return { member: await this.viewOf(orgId, actor, row) };
  }

  /**
   * ADR-0041 § 6 — ajouts et retraits d'un membre. Remplace l'écart entier ;
   * `expectedRevision` obligatoire (`409 STALE_REVISION`). Interrupteur
   * `MEMBER_PERMISSIONS_ENABLED` éteint : `409 MEMBER_PERMISSIONS_DISABLED`.
   */
  @Patch('members/:userId/permissions')
  @RequirePermission('organization.manage')
  async setPermissions(
    @CurrentUser() user: { id: string },
    @CurrentOrgPermissions() actor: CurrentOrgPermissionsValue,
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
    @Body() body: unknown,
  ): Promise<{ member: MemberView }> {
    const parsed = PermissionsSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    const row = await this.members.setPermissions({
      organizationId: orgId,
      actorUserId: user.id,
      actor,
      targetUserId,
      grants: parsed.data.grants,
      revokes: parsed.data.revokes,
      expectedRevision: parsed.data.expectedRevision,
      ...(parsed.data.reason !== undefined ? { reason: parsed.data.reason } : {}),
    });
    return { member: await this.viewOf(orgId, actor, row) };
  }

  /**
   * Accorde ou retire la clôture au Comptable — la seule case ⚙ du modèle.
   * ADR-0041 : conservé (compatibilité N-1), soumis à G2.
   */
  @Patch('members/:userId/close-right')
  @RequirePermission('organization.manage')
  async setCloseRight(
    @CurrentUser() user: { id: string },
    @CurrentOrgPermissions() actor: CurrentOrgPermissionsValue,
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
      actor,
      targetUserId,
      value: parsed.data.value,
      ...(parsed.data.expectedRevision !== undefined
        ? { expectedRevision: parsed.data.expectedRevision }
        : {}),
    });
    return { member: await this.viewOf(orgId, actor, row) };
  }

  @Delete('members/:userId')
  @RequirePermission('organization.manage')
  async revoke(
    @CurrentUser() user: { id: string },
    @CurrentOrgPermissions() actor: CurrentOrgPermissionsValue,
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
  ): Promise<{ revoked: true }> {
    await this.members.revoke({
      organizationId: orgId,
      actorUserId: user.id,
      actor,
      targetUserId,
    });
    return { revoked: true };
  }

  /**
   * Transfert de propriété — l'unique manière de faire d'un autre membre le
   * propriétaire, et donc l'unique manière pour un propriétaire unique de se
   * rétrograder. Le guard exige `organization.manage`; le service exige en plus
   * que l'acteur soit lui-même `owner`. ADR-0041 § 3 : efface l'écart des deux.
   */
  @Post('transfer-ownership')
  @RequirePermission('organization.manage')
  async transfer(
    @CurrentUser() user: { id: string },
    @CurrentOrgPermissions() actor: CurrentOrgPermissionsValue,
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
      previousOwner: await this.viewOf(orgId, actor, previousOwner),
      newOwner: await this.viewOf(orgId, actor, newOwner),
    };
  }

  /**
   * Recalcule `isLastOwner` et `manageable` après écriture — les deux ont pu
   * changer, et c'est justement le cas intéressant : après un transfert de
   * propriété, l'ancien propriétaire n'est plus le dernier et le nouveau l'est
   * peut-être devenu.
   */
  private async viewOf(
    orgId: string,
    actor: ActorPermissions,
    row: MemberRow,
  ): Promise<MemberView> {
    const owners = (await this.members.list(orgId)).filter((r) => r.role === 'owner').length;
    const identity = (await this.members.identitiesOf([row.userId])).get(row.userId);
    return this.toView(row, actor, owners, identity);
  }

  private toView(
    r: MemberRow,
    actor: ActorPermissions,
    owners: number,
    identity: { email: string | null; name: string | null } | undefined,
  ): MemberView {
    return {
      userId: r.userId,
      email: identity?.email ?? null,
      name: identity?.name ?? null,
      role: r.role,
      roleLabel: ORG_ROLE_LABELS[r.role],
      canClosePeriods: r.canClosePeriods,
      acceptedAt: r.acceptedAt ? r.acceptedAt.toISOString() : null,
      grants: r.grants,
      revokes: r.revokes,
      effective: r.effective,
      customized: r.grants.length > 0 || r.revokes.length > 0,
      permissionsRevision: r.permissionsRevision,
      // R1 rendu visible dans l'UI : le dernier propriétaire n'est ni
      // rétrogradable ni révocable. Le serveur refuse de toute façon (409
      // LAST_OWNER) — ceci évite d'offrir un bouton qui échouera.
      isLastOwner: r.role === 'owner' && owners === 1,
      manageable: canManageMember(actor, {
        role: r.role,
        context: { canClosePeriods: r.canClosePeriods, grants: r.grants, revokes: r.revokes },
      }),
    };
  }
}
