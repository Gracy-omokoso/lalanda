// `GET /organizations/setup-progress` — avancement de la mise en route de CHAQUE
// organisation de l'appelant, pour le sélecteur (ADR-0052 — O1).
//
// Ouvert à tout utilisateur connecté, comme `GET /organizations` : la liste vient de SES
// appartenances, jamais d'un paramètre, et la réponse ne porte que des compteurs (aucune
// valeur, critère 2). Lire le statut de complétude est ouvert à tout membre (§ 7) : on ne
// renvoie rien qu'il ne pourrait lire en basculant sur l'organisation.

import { Controller, Get, Inject, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import type { OrganizationSetupProgress } from './organization-setup-progress.model.js';
import { OrganizationSetupService } from './organization-setup.service.js';

@Controller('organizations')
@UseGuards(AuthGuard)
export class OrganizationSetupProgressController {
  constructor(
    @Inject(OrganizationSetupService) private readonly setup: OrganizationSetupService,
    @Inject(OrganizationsService) private readonly orgs: OrganizationsService,
  ) {}

  @Get('setup-progress')
  async list(
    @CurrentUser() user: { id: string },
  ): Promise<{ organizations: OrganizationSetupProgress[] }> {
    const rows = await this.orgs.listForUser(user.id);
    const organizations = await this.setup.progressOf(rows.map(({ org }) => String(org._id)));
    return { organizations };
  }
}
