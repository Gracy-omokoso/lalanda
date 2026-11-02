// `GET /admin/stats` — statistiques agrégées de la plateforme (ADR-0053 § 6.7, § 7 — lot P7).
//
// Garde de CONSOLE : `PlatformAuthGuard` (aucune organisation résolue) puis
// `PermissionsGuard`, qui juge `platform.stats.read` contre la matrice du § 5.2
// (super-administrateur, administrateur plateforme, finance). Lecture seule : aucune
// ré-authentification. Aucune case de moins de cinq organisations n'est servie en clair.

import { Controller, Get, Inject, UseGuards } from '@nestjs/common';

import { PlatformConsoleRoute, RequirePlatformAction } from '../../authz/authz.decorators.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { PlatformAuthGuard } from '../../authz/platform-auth.guard.js';
import { AdminStatsService } from './admin-stats.service.js';
import type { PlatformStats } from './stats.js';

@Controller('admin/stats')
@UseGuards(PlatformAuthGuard, PermissionsGuard)
@PlatformConsoleRoute()
@RequirePlatformAction('platform.stats.read')
export class AdminStatsController {
  constructor(@Inject(AdminStatsService) private readonly service: AdminStatsService) {}

  @Get()
  @RequirePlatformAction('platform.stats.read')
  async stats(): Promise<PlatformStats> {
    return this.service.stats();
  }
}
