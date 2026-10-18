// Fiche fiscale de l'organisation active — ADR-0021 §2 et §10.
//
// `fiscal.manage` : Propriétaire et Directeur financier seulement, interdite à
// tous les rôles plateforme (ADR-0021 §8). Saisir l'identité qui figurera sur
// les factures normalisées engage le contribuable devant la DGI.

import { Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { CurrentOrgRole } from '../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import type { OrgRole } from '../authz/permissions.js';
import { FiscalProfileService, type FiscalProfileView } from './fiscal-profile.service.js';
import { PutFiscalProfileSchema } from './fiscal.dto.js';
import { invalidRequest } from './fiscal.errors.js';

@Controller('organizations/current/fiscal-profile')
@UseGuards(AuthGuard, PermissionsGuard)
export class FiscalProfileController {
  constructor(@Inject(FiscalProfileService) private readonly profiles: FiscalProfileService) {}

  @Get()
  @RequirePermission('fiscal.manage')
  async get(@CurrentOrgId() orgId: string): Promise<FiscalProfileView> {
    return this.profiles.view(orgId);
  }

  /** Écriture complète seulement : champs inconnus refusés, fiche toujours complète. */
  @Put()
  @RequirePermission('fiscal.manage')
  async put(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<FiscalProfileView> {
    const parsed = PutFiscalProfileSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.profiles.put(orgId, parsed.data, { userId: user.id, role: role ?? 'unknown' });
  }
}
