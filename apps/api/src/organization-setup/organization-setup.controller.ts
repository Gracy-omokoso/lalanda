// `GET /organizations/current/setup` — statut de complétude (ADR-0052 § 3). ADR-0052 — O0.
//
// Ouvert à TOUT MEMBRE de l'organisation active (§ 7, option O5) : aucune action RBAC
// nouvelle, et pas de `@RequirePermission` — la route ne renvoie que des booléens et des
// codes (critère 2), comme `/me/permissions` ne renvoie que les droits de l'appelant.
// `AuthGuard` a déjà vérifié l'appartenance ; `canAct` est calculé avec les droits
// EFFECTIFS (titre + écarts, ADR-0041), résolus ici comme le fait `MeController`.

import type { OrganizationSetupView } from '@lalanda/shared/organization-setup';
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { AuthzService } from '../authz/authz.service.js';
import { effectiveActions } from '../authz/permissions.js';
import { OrganizationSetupService } from './organization-setup.service.js';

@Controller('organizations/current')
@UseGuards(AuthGuard)
export class OrganizationSetupController {
  constructor(
    @Inject(OrganizationSetupService) private readonly setup: OrganizationSetupService,
    @Inject(AuthzService) private readonly authz: AuthzService,
  ) {}

  @Get('setup')
  async read(
    @CurrentUser() user: { id: string },
    @CurrentOrgId() orgId: string,
  ): Promise<OrganizationSetupView> {
    const resolved = await this.authz.resolveOrgRole(user.id, orgId);
    // Appartenance supprimée entre `AuthGuard` et ici : aucun droit, jamais d'erreur.
    const actions = resolved ? effectiveActions(resolved.role, resolved.context) : [];
    return this.setup.view(orgId, actions);
  }
}
