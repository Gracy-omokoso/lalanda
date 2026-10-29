// Membres proposés par le module « work » — ADR-0039 § 8 (sélecteur de
// responsable, `@` des mentions).
//
//   GET /work/members   work.read — membres détenant `work.read`, avec ce qu'ils
//                       peuvent faire (`canUpdate` : responsable possible).
//
// Ajout au tableau des routes d'ADR-0039 § 4 : la liste des membres de
// l'organisation est gardée par `organization.manage` (`MembersController`),
// que ni l'Analyste ni le Lecteur ne détiennent ; sans cette route, l'écran ne
// pourrait proposer ni responsable ni mention. Elle ne rend ni e-mail ni rôle.

import { Controller, Get, Inject, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { WorkMembersService, type WorkMemberView } from './work-members.service.js';

@Controller('work/members')
@UseGuards(AuthGuard, PermissionsGuard)
export class WorkMembersController {
  constructor(@Inject(WorkMembersService) private readonly members: WorkMembersService) {}

  @Get()
  @RequirePermission('work.read')
  async list(@CurrentOrgId() orgId: string): Promise<{ items: WorkMemberView[] }> {
    return { items: await this.members.list(orgId) };
  }
}
