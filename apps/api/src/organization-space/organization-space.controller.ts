// Espace organisation (S21a) — `/organizations/current/*`.
//
// « current » = l'organisation active résolue par `AuthGuard` (cookie
// `active_org_id` ou organisation primaire), convention déjà posée par
// `GET /organizations/current/subscription` (S16b).
//
// Trois niveaux d'accès, tous décidés par la matrice (ADR-0012) :
//   dashboard  → `analytics.read`     — tous les rôles, contenu variable
//   settings   → `organization.manage` — Propriétaire, Administrateur
//   billing    → `billing.manage`      — Propriétaire seul
//
// Un 403 sur `settings` ou `billing` est une réponse NORMALE pour un Analyste :
// l'interface masque le bloc et explique, elle n'affiche pas de panne.

import { BadRequestException, Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { AuditService } from '../authz/audit.service.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { CurrentOrgRole } from '../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import type { OrgPermissionContext, OrgRole } from '../authz/permissions.js';
import { CurrentOrgRoleContext } from './current-org-role-context.decorator.js';
import {
  UpdateOrganizationSettingsSchema,
  type OrganizationBillingView,
  type OrganizationDashboardView,
  type OrganizationSettingsView,
} from './organization-space.dto.js';
import { OrganizationSpaceService } from './organization-space.service.js';

@Controller('organizations/current')
@UseGuards(AuthGuard, PermissionsGuard)
export class OrganizationSpaceController {
  constructor(
    @Inject(OrganizationSpaceService) private readonly space: OrganizationSpaceService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Tableau de bord différencié — UNE route, quatre blocs conditionnés.
   *
   * Gardée par `analytics.read`, que les huit rôles détiennent : c'est voulu.
   * L'espace organisation doit être utile à un Lecteur, pas lui renvoyer un 403 à
   * la porte. Le filtrage se fait BLOC PAR BLOC dans le service, à partir de la
   * même matrice — un bloc refusé n'est pas seulement masqué, il n'est jamais
   * chargé.
   */
  @Get('dashboard')
  @RequirePermission('analytics.read')
  async dashboard(
    @CurrentOrgId() orgId: string,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgRoleContext() ctx: OrgPermissionContext,
  ): Promise<OrganizationDashboardView> {
    // `role` est posé par `PermissionsGuard`, qui a déjà refusé un non-membre par
    // un 404. Le repli sur `viewer` couvre la membership supprimée entre le guard
    // et le handler : moindre privilège, jamais une exception.
    return this.space.readDashboard(orgId, role ?? 'viewer', ctx);
  }

  @Get('settings')
  @RequirePermission('organization.manage')
  async getSettings(@CurrentOrgId() orgId: string): Promise<OrganizationSettingsView> {
    return this.space.readSettings(orgId);
  }

  @Put('settings')
  @RequirePermission('organization.manage')
  async putSettings(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<OrganizationSettingsView> {
    const parsed = UpdateOrganizationSettingsSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
    }

    const avant = await this.space.readSettings(orgId);
    const apres = await this.space.writeSettings(orgId, parsed.data, user.id);

    // Journalisation NON bloquante (`record`, pas `recordStrict`) : modifier le
    // nom d'une organisation n'est pas un export de données financières. Perdre
    // la trace serait fâcheux, refuser le réglage à cause d'une panne de journal
    // le serait davantage (voir `AuditService`).
    await this.audit.record({
      organizationId: orgId,
      actorUserId: user.id,
      actorRole: role ?? 'unknown',
      action: 'organization.settings_updated',
      targetType: 'organization',
      targetId: orgId,
      // Ancien et nouveau nom seulement : ni logo (URL potentiellement longue),
      // ni donnée personnelle. docs/17 § Journalisation — le journal reste pauvre.
      metadata: {
        nomAvant: avant.name,
        nomApres: apres.name,
        paysAvant: avant.pays,
        paysApres: apres.pays,
        deviseApres: apres.deviseAffichage,
        logoDefini: apres.logoUrl !== null,
      },
    });

    return apres;
  }

  /**
   * Facturation — `billing.manage`, donc le Propriétaire SEUL (ADR-0012 §3 :
   * « docs/12 réserve l'abonnement au Propriétaire »). Un Administrateur reçoit
   * un 403, et c'est la règle, pas un incident.
   */
  @Get('billing')
  @RequirePermission('billing.manage')
  async billing(@CurrentOrgId() orgId: string): Promise<OrganizationBillingView> {
    return this.space.readBilling(orgId);
  }
}
