// ─────────────────────────────────────────────────────────────────────────────
// ROUTES `/admin` (S21b — ADR-0012 §4)
//
// ── Les trois interdits absolus ne sont exposés NULLE PART ────────────────────
//
// `plan.approve`, `period.close` et `report.export` sont refusés à tous les
// rôles plateforme, super-administrateur compris (ADR-0012 §4). Il n'existe donc
// ici ni route de validation de plan, ni route de clôture, ni route d'export.
// Ce n'est pas un oubli à combler plus tard : approuver et clôturer engagent le
// client vis-à-vis de sa banque, exporter produit un fichier de ses données
// financières. Un test de couverture vérifie qu'aucune route `/admin` ne déclare
// l'une de ces trois actions — la propriété doit survivre à la prochaine route
// ajoutée par quelqu'un qui n'aura pas lu ce commentaire.
//
// ── Répartition des rôles ─────────────────────────────────────────────────────
//
// La lecture est ouverte à `platform_admin` et `platform_support` (consultation
// pour le diagnostic). L'écriture sur les organisations exige `platform_admin`,
// l'écriture sur les rôles plateforme exige `platform_super_admin` — attribuer
// un rôle, c'est distribuer du pouvoir sur la plateforme.
// ─────────────────────────────────────────────────────────────────────────────

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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { AuthzService } from '../authz/authz.service.js';
import { RequirePlatformRole } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { PlatformAuditService } from '../integrations/platform-audit.service.js';
import {
  AdminService,
  type AdminActor,
  type AdminOrganizationSummary,
  type AdminUserSummary,
  type PlatformOverview,
} from './admin.service.js';
import {
  DisableUserSchema,
  GrantPlatformRoleSchema,
  SetPlanSchema,
  SuspendOrganizationSchema,
} from './admin.dto.js';

export interface PlatformAuditEventView {
  id: string;
  action: string;
  actorUserId: string;
  actorRole: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
}

@Controller('admin')
@UseGuards(AuthGuard, PermissionsGuard)
// Plancher du contrôleur : sans AUCUN rôle plateforme, tout `/admin` est fermé.
// Chaque route resserre ensuite pour ses écritures.
@RequirePlatformRole('platform_super_admin', 'platform_admin', 'platform_support')
export class AdminController {
  constructor(
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(PlatformAuditService) private readonly audit: PlatformAuditService,
    @Inject(AuthzService) private readonly authz: AuthzService,
  ) {}

  /**
   * Acteur inscrit dans l'audit.
   *
   * Les rôles sont RELUS ici plutôt que déduits de la route : `PermissionsGuard`
   * vérifie qu'un rôle suffisant est détenu, mais ne dit pas lequel, et une route
   * ouverte à trois rôles ne peut donc pas se contenter du décorateur. Un journal
   * qui inscrirait « platform_admin » parce que c'est le rôle attendu par la
   * route, alors que l'acteur est support, mentirait exactement là où on le
   * consulte : en investigation.
   */
  private async actorOf(req: AuthenticatedRequest): Promise<AdminActor> {
    const roles = await this.authz.platformRolesOf(req.user!.id);
    return { userId: req.user!.id, platformRole: roles.join(',') || 'aucun' };
  }

  // ── Tableau de bord ────────────────────────────────────────────────────────

  @Get('overview')
  async overview(): Promise<PlatformOverview> {
    return this.admin.overview();
  }

  // ── Organisations ──────────────────────────────────────────────────────────

  @Get('organizations')
  async listOrganizations(
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ): Promise<{ organizations: AdminOrganizationSummary[] }> {
    return {
      organizations: await this.admin.listOrganizations({ q, limit: toInt(limit) }),
    };
  }

  @Get('organizations/:organizationId')
  async getOrganization(
    @Param('organizationId') organizationId: string,
  ): Promise<AdminOrganizationSummary> {
    return this.admin.getOrganization(organizationId);
  }

  /**
   * Changement de plan. `platform_admin` suffit : c'est un acte de gestion
   * plateforme, pas un accès aux données du client.
   *
   * NOTE — le paramètre s'appelle `organizationId` et NON `orgId`. C'est
   * délibéré : `PermissionsGuard` traite un `:orgId` de route comme
   * « l'organisation dont il faut résoudre le rôle de l'appelant », et un
   * opérateur plateforme n'est membre d'aucune de ces organisations. Nommé
   * `orgId`, la route renverrait 404 ORG_NOT_FOUND à un super-administrateur
   * parfaitement légitime.
   */
  @Patch('organizations/:organizationId/plan')
  @RequirePlatformRole('platform_super_admin', 'platform_admin')
  async setPlan(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() body: unknown,
  ): Promise<AdminOrganizationSummary> {
    const parsed = SetPlanSchema.safeParse(body);
    if (!parsed.success) throw invalid('Plan requis (free, pro ou business).');
    return this.admin.setPlan(organizationId, parsed.data.plan, await this.actorOf(req));
  }

  @Post('organizations/:organizationId/suspend')
  @RequirePlatformRole('platform_super_admin', 'platform_admin')
  async suspend(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() body: unknown,
  ): Promise<AdminOrganizationSummary> {
    const parsed = SuspendOrganizationSchema.safeParse(body);
    if (!parsed.success) throw invalid('Motif de suspension requis (10 caractères minimum).');
    return this.admin.suspendOrganization(organizationId, parsed.data.reason, await this.actorOf(req));
  }

  @Delete('organizations/:organizationId/suspend')
  @RequirePlatformRole('platform_super_admin', 'platform_admin')
  async lift(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
  ): Promise<AdminOrganizationSummary> {
    return this.admin.liftSuspension(organizationId, await this.actorOf(req));
  }

  // ── Utilisateurs ───────────────────────────────────────────────────────────

  @Get('users')
  async listUsers(
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ): Promise<{ users: AdminUserSummary[] }> {
    return { users: await this.admin.searchUsers({ q, limit: toInt(limit) }) };
  }

  /** Attribution d'un rôle plateforme — super-administrateur uniquement. */
  @Post('users/:userId/platform-roles')
  @RequirePlatformRole('platform_super_admin')
  async grantRole(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<AdminUserSummary> {
    const parsed = GrantPlatformRoleSchema.safeParse(body);
    if (!parsed.success) throw invalid('Rôle plateforme requis.');
    return this.admin.grantPlatformRole(
      userId,
      parsed.data.role,
      { reason: parsed.data.reason, expiresAt: parsed.data.expiresAt },
      await this.actorOf(req),
    );
  }

  @Delete('users/:userId/platform-roles/:role')
  @RequirePlatformRole('platform_super_admin')
  async revokeRole(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Param('role') role: string,
  ): Promise<AdminUserSummary> {
    return this.admin.revokePlatformRole(userId, role, await this.actorOf(req));
  }

  @Patch('users/:userId/disabled')
  @RequirePlatformRole('platform_super_admin', 'platform_admin')
  async setDisabled(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<AdminUserSummary> {
    const parsed = DisableUserSchema.safeParse(body);
    if (!parsed.success) throw invalid('`disabled` booléen requis.');
    return this.admin.setUserDisabled(userId, parsed.data.disabled, await this.actorOf(req));
  }

  // ── Journal d'audit plateforme ─────────────────────────────────────────────

  /**
   * Journal des actions de PORTÉE PLATEFORME uniquement.
   *
   * Ne donne accès à aucun événement d'organisation cliente : `PlatformAuditService.list`
   * filtre sur la sentinelle `organizationId: 'platform'`. Un opérateur qui veut
   * le journal d'une organisation passe par le chemin délégué, avec consentement
   * (ADR-0012 §4, `audit.read` en `delegated` pour le support).
   */
  @Get('audit-events')
  async auditEvents(
    @Query('action') action?: string,
    @Query('actorUserId') actorUserId?: string,
    @Query('limit') limit?: string,
  ): Promise<{ events: PlatformAuditEventView[] }> {
    const docs = await this.audit.list({ action, actorUserId }, toInt(limit) ?? 100);
    return {
      events: docs.map((d) => ({
        id: String(d._id),
        action: d.action,
        actorUserId: d.actorUserId,
        actorRole: d.actorRole,
        targetType: d.targetType,
        targetId: d.targetId,
        metadata: d.metadata ?? {},
        createdAt: (d as unknown as { createdAt: Date }).createdAt.toISOString(),
      })),
    };
  }
}

function toInt(raw: string | undefined): number | undefined {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) ? n : undefined;
}

function invalid(message: string): BadRequestException {
  return new BadRequestException({ code: 'VALIDATION_ERROR', message });
}

