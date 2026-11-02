// `GET /organizations/current/setup` — statut de complétude (ADR-0052 § 3). ADR-0052 — O0.
//
// Ouvert à TOUT MEMBRE de l'organisation active (§ 7, option O5) : aucune action RBAC
// nouvelle, et pas de `@RequirePermission` — la route ne renvoie que des booléens et des
// codes (critère 2), comme `/me/permissions` ne renvoie que les droits de l'appelant.
// `AuthGuard` a déjà vérifié l'appartenance ; `canAct` est calculé avec les droits
// EFFECTIFS (titre + écarts, ADR-0041), résolus ici comme le fait `MeController`.
//
// ADR-0052 — O2/O3 : routes de DÉCLARATION (§ 4). Chacune exige l'action de son étape
// (§ 7, « déclarer pas maintenant : l'action de l'étape ») ; une route par étape pour que
// la permission reste STATIQUE et vérifiée par `routes-coverage`. Aucune route de report
// pour la fiche fiscale (critère 7) : `PUT …/deferred/fiscal` répond 404. Chaque écriture
// renvoie la vue relue, avec les droits effectifs de l'appelant.
import {
  PutOrganizationSetupModulesSchema,
  type OrganizationSetupDeferrableStep,
  type OrganizationSetupView,
} from '@lalanda/shared/organization-setup';
import { Body, Controller, Delete, Get, HttpCode, Inject, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { AuthzService } from '../authz/authz.service.js';
import { CurrentOrgRole } from '../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { effectiveActions, type OrgRole } from '../authz/permissions.js';
import { invalidRequest } from '../sales/sales.errors.js';
import { OrganizationSetupService, type SetupActor } from './organization-setup.service.js';

type User = { id: string };

@Controller('organizations/current')
@UseGuards(AuthGuard, PermissionsGuard)
export class OrganizationSetupController {
  constructor(
    @Inject(OrganizationSetupService) private readonly setup: OrganizationSetupService,
    @Inject(AuthzService) private readonly authz: AuthzService,
  ) {}

  @Get('setup')
  async read(
    @CurrentUser() user: User,
    @CurrentOrgId() orgId: string,
  ): Promise<OrganizationSetupView> {
    return this.viewFor(user, orgId);
  }

  // ── ADR-0052 — O2 : déclarations ─────────────────────────────────────────

  @Put('setup/country-confirmation')
  @RequirePermission('organization.manage')
  async confirmCountry(
    @CurrentUser() user: User,
    @CurrentOrgId() orgId: string,
    @CurrentOrgRole() role: OrgRole | undefined,
  ): Promise<OrganizationSetupView> {
    await this.setup.confirmCountry(orgId, actorOf(user, role));
    return this.viewFor(user, orgId);
  }

  @Put('setup/deferred/normalisation')
  @RequirePermission('fiscal.manage')
  deferNormalisation(
    @CurrentUser() u: User,
    @CurrentOrgId() o: string,
    @CurrentOrgRole() r: OrgRole | undefined,
  ): Promise<OrganizationSetupView> {
    return this.defer(u, o, r, 'normalisation');
  }

  @Delete('setup/deferred/normalisation')
  @HttpCode(200)
  @RequirePermission('fiscal.manage')
  undeferNormalisation(
    @CurrentUser() u: User,
    @CurrentOrgId() o: string,
    @CurrentOrgRole() r: OrgRole | undefined,
  ): Promise<OrganizationSetupView> {
    return this.undefer(u, o, r, 'normalisation');
  }

  @Put('setup/deferred/tresorerie')
  @RequirePermission('treasury.manage')
  deferTresorerie(
    @CurrentUser() u: User,
    @CurrentOrgId() o: string,
    @CurrentOrgRole() r: OrgRole | undefined,
  ): Promise<OrganizationSetupView> {
    return this.defer(u, o, r, 'tresorerie');
  }

  @Delete('setup/deferred/tresorerie')
  @HttpCode(200)
  @RequirePermission('treasury.manage')
  undeferTresorerie(
    @CurrentUser() u: User,
    @CurrentOrgId() o: string,
    @CurrentOrgRole() r: OrgRole | undefined,
  ): Promise<OrganizationSetupView> {
    return this.undefer(u, o, r, 'tresorerie');
  }

  @Put('setup/deferred/comptabilite')
  @RequirePermission('accounting.manage')
  deferComptabilite(
    @CurrentUser() u: User,
    @CurrentOrgId() o: string,
    @CurrentOrgRole() r: OrgRole | undefined,
  ): Promise<OrganizationSetupView> {
    return this.defer(u, o, r, 'comptabilite');
  }

  @Delete('setup/deferred/comptabilite')
  @HttpCode(200)
  @RequirePermission('accounting.manage')
  undeferComptabilite(
    @CurrentUser() u: User,
    @CurrentOrgId() o: string,
    @CurrentOrgRole() r: OrgRole | undefined,
  ): Promise<OrganizationSetupView> {
    return this.undefer(u, o, r, 'comptabilite');
  }

  /** « Je travaille seul ». */
  @Put('setup/deferred/equipe')
  @RequirePermission('members.invite')
  deferEquipe(
    @CurrentUser() u: User,
    @CurrentOrgId() o: string,
    @CurrentOrgRole() r: OrgRole | undefined,
  ): Promise<OrganizationSetupView> {
    return this.defer(u, o, r, 'equipe');
  }

  @Delete('setup/deferred/equipe')
  @HttpCode(200)
  @RequirePermission('members.invite')
  undeferEquipe(
    @CurrentUser() u: User,
    @CurrentOrgId() o: string,
    @CurrentOrgRole() r: OrgRole | undefined,
  ): Promise<OrganizationSetupView> {
    return this.undefer(u, o, r, 'equipe');
  }

  // ── ADR-0052 — O3 : modules de l'organisation (décision ouverte n° 3, défaut) ──

  @Put('setup/modules')
  @RequirePermission('organization.manage')
  async putModules(
    @CurrentUser() user: User,
    @CurrentOrgId() orgId: string,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<OrganizationSetupView> {
    const parsed = PutOrganizationSetupModulesSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    await this.setup.setModules(orgId, parsed.data.modules, actorOf(user, role));
    return this.viewFor(user, orgId);
  }

  private async defer(
    user: User,
    orgId: string,
    role: OrgRole | undefined,
    step: OrganizationSetupDeferrableStep,
  ): Promise<OrganizationSetupView> {
    await this.setup.defer(orgId, step, actorOf(user, role));
    return this.viewFor(user, orgId);
  }

  private async undefer(
    user: User,
    orgId: string,
    role: OrgRole | undefined,
    step: OrganizationSetupDeferrableStep,
  ): Promise<OrganizationSetupView> {
    await this.setup.undefer(orgId, step, actorOf(user, role));
    return this.viewFor(user, orgId);
  }

  private async viewFor(user: User, orgId: string): Promise<OrganizationSetupView> {
    const resolved = await this.authz.resolveOrgRole(user.id, orgId);
    // Appartenance supprimée entre `AuthGuard` et ici : aucun droit, jamais d'erreur.
    const actions = resolved ? effectiveActions(resolved.role, resolved.context) : [];
    return this.setup.view(orgId, actions);
  }
}

function actorOf(user: User, role: OrgRole | undefined): SetupActor {
  return { userId: user.id, role: role ?? 'unknown' };
}
