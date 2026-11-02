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
// ── Répartition des droits (ADR-0053 — P2) ────────────────────────────────────
//
// Chaque route déclare son ACTION plateforme (`@RequirePlatformAction`), jugée contre
// la matrice d'ADR-0053 § 5.2 : plus aucune liste de rôles recopiée ici. Toute
// ÉCRITURE de la console exige en outre une ré-authentification de moins de dix
// minutes (`@RequireRecentReauth`, § 2.4) et un motif écrit ; la lecture d'une fiche
// détaillée exige un motif de consultation et est journalisée (§ 2.6).
// ─────────────────────────────────────────────────────────────────────────────

import {
  BadRequestException,
  Body,
  ConflictException,
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

import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { AuthzService } from '../authz/authz.service.js';
import { PlatformConsoleRoute, RequirePlatformAction } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
// ADR-0053 — P0
import { PlatformAuthGuard } from '../authz/platform-auth.guard.js';
// ADR-0053 — P2
import { RequireRecentReauth } from '../integrations/reauth.guard.js';
// ADR-0053 — P3
import {
  PlatformBillingService,
  type AdminPlanGrantView,
} from './billing/platform-billing.service.js';
import {
  AdminService,
  type AdminActor,
  type AdminOrganizationDetail,
  type AdminOrganizationSummary,
  type AdminUserDetail,
  type AdminUserSummary,
  type PlatformOverview,
} from './admin.service.js';
import {
  BlockUserInputSchema,
  DisableUserSchema,
  PlatformSearchQuerySchema,
  PlatformViewReasonQuerySchema,
  RestoreOrganizationInputSchema,
  SetPlanSchema,
  SuspendOrganizationInputSchema,
  UnblockUserInputSchema,
  grantPlatformRoleInputSchema,
  invalidBody,
} from './admin.dto.js';

@Controller('admin')
// ADR-0053 — P0 : console sans organisation (F2). `PlatformAuthGuard` ne résout aucune
// organisation ; l'autorisation reste celle de `PermissionsGuard`, rôles PLATEFORME seuls.
@UseGuards(PlatformAuthGuard, PermissionsGuard)
@PlatformConsoleRoute()
// ADR-0053 — P2 : plancher du contrôleur = ouvrir la console ; chaque route le remplace par
// son action. Sans AUCUN rôle plateforme, tout `/admin` est fermé.
@RequirePlatformAction('platform.console.read')
export class AdminController {
  constructor(
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(AuthzService) private readonly authz: AuthzService,
    // ADR-0053 — P3
    @Inject(PlatformBillingService) private readonly billing: PlatformBillingService,
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

  // ADR-0053 — P0 : tableau de bord ouvert aux six rôles plateforme (`platform.console.read`,
  // corrige F7) ; il ne sert que des compteurs agrégés de la plateforme.
  @Get('overview')
  @RequirePlatformAction('platform.console.read')
  async overview(): Promise<PlatformOverview> {
    return this.admin.overview();
  }

  // ── Organisations ──────────────────────────────────────────────────────────

  /** Première page sans recherche ; au-delà, `q` de trois caractères (§ 2.6). */
  @Get('organizations')
  @RequirePlatformAction('platform.orgs.read')
  async listOrganizations(
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ): Promise<{ organizations: AdminOrganizationSummary[] }> {
    return {
      organizations: await this.admin.listOrganizations({ q, limit: toInt(limit) }),
    };
  }

  /**
   * Fiche détaillée : motif de consultation obligatoire (`?reason=`), lecture journalisée.
   *
   * NOTE — le paramètre s'appelle `organizationId` et NON `orgId`. C'est
   * délibéré : `PermissionsGuard` traite un `:orgId` de route comme
   * « l'organisation dont il faut résoudre le rôle de l'appelant », et un
   * opérateur plateforme n'est membre d'aucune de ces organisations. Nommé
   * `orgId`, la route renverrait 404 ORG_NOT_FOUND à un super-administrateur
   * parfaitement légitime.
   */
  @Get('organizations/:organizationId')
  @RequirePlatformAction('platform.orgs.read')
  async getOrganization(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Query('reason') reason?: string,
  ): Promise<AdminOrganizationDetail> {
    const parsed = PlatformViewReasonQuerySchema.safeParse({ reason });
    if (!parsed.success) throw reasonRequired();
    return this.admin.viewOrganization(organizationId, parsed.data.reason, await this.actorOf(req));
  }

  /**
   * Changement de plan — route HISTORIQUE (ADR-0053 § 7), servie une version encore.
   *
   * ADR-0053 — P3 : le palliatif de P2 (`409 SECOND_PERSON_REQUIRED`) est levé. La route
   * passe désormais par les OCTROIS (`platform_plan_grants`) : une offre payante devient
   * un octroi sans échéance — actif, ou en attente d'une seconde personne (§ 5.3) ;
   * `free` retire l'octroi en cours (ou annule la demande en attente). Plus jamais `setPlan`, qui remettait `active` sans
   * trace (F4). La console utilise `/admin/billing/grants`.
   */
  @Patch('organizations/:organizationId/plan')
  @RequirePlatformAction('platform.billing.grant')
  @RequireRecentReauth()
  async setPlan(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() body: unknown,
  ): Promise<AdminOrganizationSummary & { grant: AdminPlanGrantView }> {
    const parsed = SetPlanSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidBody(parsed.error, 'Offre, catégorie, message client et note interne requis.');
    }
    const actor = await this.actorOf(req);
    const { plan, reasonCategory, clientMessage, internalNote } = parsed.data;
    let grant: AdminPlanGrantView;
    if (plan === 'free') {
      const current = await this.billing.openGrantOf(organizationId);
      if (!current) {
        throw new ConflictException({
          code: 'NO_ACTIVE_GRANT',
          message: 'Aucun octroi en cours : l’offre souscrite par le client s’applique déjà.',
        });
      }
      grant = await this.billing.revokeGrant(
        String(current._id),
        { internalNote, clientMessage },
        actor,
      );
    } else {
      grant = await this.billing.createGrant(
        { targetOrganizationId: organizationId, plan, reasonCategory, clientMessage, internalNote },
        actor,
      );
    }
    return { ...(await this.admin.getOrganization(organizationId)), grant };
  }

  @Post('organizations/:organizationId/suspend')
  @RequirePlatformAction('platform.orgs.suspend')
  @RequireRecentReauth()
  async suspend(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() body: unknown,
  ): Promise<AdminOrganizationSummary> {
    const parsed = SuspendOrganizationInputSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidBody(parsed.error, 'Catégorie, message client et note interne requis.');
    }
    return this.admin.suspendOrganization(organizationId, parsed.data, await this.actorOf(req));
  }

  @Post('organizations/:organizationId/restore')
  @RequirePlatformAction('platform.orgs.suspend')
  @RequireRecentReauth()
  async restore(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() body: unknown,
  ): Promise<AdminOrganizationSummary> {
    return this.liftWithReason(req, organizationId, body);
  }

  /** Route HISTORIQUE de levée (§ 7) : même corps motivé que `restore`. */
  @Delete('organizations/:organizationId/suspend')
  @RequirePlatformAction('platform.orgs.suspend')
  @RequireRecentReauth()
  async lift(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() body: unknown,
  ): Promise<AdminOrganizationSummary> {
    return this.liftWithReason(req, organizationId, body);
  }

  private async liftWithReason(
    req: AuthenticatedRequest,
    organizationId: string,
    body: unknown,
  ): Promise<AdminOrganizationSummary> {
    const parsed = RestoreOrganizationInputSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw invalidBody(parsed.error, 'Motif de levée et message client requis.');
    }
    return this.admin.liftSuspension(organizationId, parsed.data, await this.actorOf(req));
  }

  // ── Utilisateurs ───────────────────────────────────────────────────────────

  /**
   * Recherche OBLIGATOIRE (F8) : sans `q` de trois caractères, `400 SEARCH_REQUIRED` —
   * plus aucun annuaire d'adresses servi sans recherche.
   */
  @Get('users')
  @RequirePlatformAction('platform.users.read')
  async listUsers(
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ): Promise<{ users: AdminUserSummary[] }> {
    const parsed = PlatformSearchQuerySchema.safeParse({ q });
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'SEARCH_REQUIRED',
        message: 'Recherche obligatoire : trois caractères au moins.',
      });
    }
    return { users: await this.admin.searchUsers({ q: parsed.data.q, limit: toInt(limit) }) };
  }

  @Get('users/:userId')
  @RequirePlatformAction('platform.users.read')
  async getUser(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Query('reason') reason?: string,
  ): Promise<AdminUserDetail> {
    const parsed = PlatformViewReasonQuerySchema.safeParse({ reason });
    if (!parsed.success) throw reasonRequired();
    return this.admin.viewUser(userId, parsed.data.reason, await this.actorOf(req));
  }

  @Post('users/:userId/block')
  @RequirePlatformAction('platform.users.block')
  @RequireRecentReauth()
  async block(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<AdminUserSummary> {
    const parsed = BlockUserInputSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error, 'Catégorie et note interne requises.');
    return this.admin.blockUser(userId, parsed.data, await this.actorOf(req));
  }

  @Post('users/:userId/unblock')
  @RequirePlatformAction('platform.users.block')
  @RequireRecentReauth()
  async unblock(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<AdminUserSummary> {
    const parsed = UnblockUserInputSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error, 'Note interne requise.');
    return this.admin.unblockUser(userId, parsed.data, await this.actorOf(req));
  }

  /** Attribution d'un rôle plateforme — super-administrateur uniquement. */
  @Post('users/:userId/platform-roles')
  @RequirePlatformAction('platform.roles.manage')
  @RequireRecentReauth()
  async grantRole(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<AdminUserSummary> {
    const parsed = grantPlatformRoleInputSchema(new Date()).safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error, 'Rôle plateforme et motif requis.');
    return this.admin.grantPlatformRole(
      userId,
      parsed.data.role,
      { reason: parsed.data.reason, expiresAt: parsed.data.expiresAt },
      await this.actorOf(req),
    );
  }

  @Delete('users/:userId/platform-roles/:role')
  @RequirePlatformAction('platform.roles.manage')
  @RequireRecentReauth()
  async revokeRole(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Param('role') role: string,
  ): Promise<AdminUserSummary> {
    return this.admin.revokePlatformRole(userId, role, await this.actorOf(req));
  }

  /** Route HISTORIQUE (§ 7), remplacée par `block` / `unblock` : même motif exigé. */
  @Patch('users/:userId/disabled')
  @RequirePlatformAction('platform.users.block')
  @RequireRecentReauth()
  async setDisabled(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<AdminUserSummary> {
    const parsed = DisableUserSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error, '`disabled` et note interne requis.');
    const actor = await this.actorOf(req);
    return parsed.data.disabled
      ? this.admin.blockUser(
          userId,
          { reasonCategory: parsed.data.reasonCategory!, internalNote: parsed.data.internalNote },
          actor,
        )
      : this.admin.unblockUser(userId, { internalNote: parsed.data.internalNote }, actor);
  }

  // ADR-0053 — P5 : le journal plateforme (`GET /admin/audit-events`, filtres, export,
  // événements de sécurité) vit dans `audit/admin-audit.controller.ts`.
}

function toInt(raw: string | undefined): number | undefined {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) ? n : undefined;
}

function reasonRequired(): BadRequestException {
  return new BadRequestException({
    code: 'REASON_REQUIRED',
    message:
      'Motif de consultation obligatoire (assistance, facturation, sécurité, abus, demande légale).',
  });
}
