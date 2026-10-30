// Réglages RH — ADR-0045 § 3.3. ADR-0045 — H2 (lecture et valeurs par défaut).
//
//   GET /hr/settings   hr.read
//
// L'écriture (`PUT`, `hr.manage`, et `leave.approve` pour changer le circuit) vient
// avec l'écran des réglages ; elle n'appartient pas au lot H2.

import type { HrSettingsView } from '@lalanda/shared/hr';
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { HrSettingsService } from './hr-settings.service.js';

@Controller('hr/settings')
@UseGuards(AuthGuard, PermissionsGuard)
export class HrSettingsController {
  constructor(@Inject(HrSettingsService) private readonly settings: HrSettingsService) {}

  @Get()
  @RequirePermission('hr.read')
  async get(@CurrentOrgId() orgId: string): Promise<HrSettingsView> {
    return this.settings.view(orgId);
  }
}
