// Numéro WhatsApp de l'appelant — ADR-0065 § 2.
//
//   GET    /work/whatsapp                  work.read   état, numéro de l'APPELANT, quota
//   POST   /work/whatsapp/number           work.read   saisir son numéro : un code part
//   POST   /work/whatsapp/number/verify    work.read   saisir le code reçu
//   DELETE /work/whatsapp/number           work.read   retirer son numéro
//
// Strictement PERSONNEL : chaque route agit sur l'organisation active ET l'utilisateur
// de la session. Aucun identifiant de personne n'est accepté : un Propriétaire ne lit
// ni ne change le numéro d'un collègue. Sous `/work` : fonction d'offre `run_work`.

import {
  PostWhatsAppNumberBody,
  VerifyWhatsAppNumberBody,
  type WhatsAppView,
} from '@lalanda/shared/work';
import { Body, Controller, Delete, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../authz/current-org-permissions.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { RequireFeature } from '../billing/feature.guard.js';
import { invalidRequest } from '../sales/sales.errors.js';
import { WhatsAppService, type WhatsAppActor } from './whatsapp.service.js';

type User = { id: string };

function actorOf(
  orgId: string,
  user: User,
  perms: CurrentOrgPermissionsValue | undefined,
): WhatsAppActor {
  return { organizationId: orgId, userId: user.id, role: perms?.role ?? 'unknown' };
}

@Controller('work/whatsapp')
@RequireFeature('run_work') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class WorkWhatsappController {
  constructor(@Inject(WhatsAppService) private readonly whatsapp: WhatsAppService) {}

  @Get()
  @RequirePermission('work.read')
  async view(@CurrentOrgId() orgId: string, @CurrentUser() user: User): Promise<WhatsAppView> {
    return this.whatsapp.view(orgId, user.id);
  }

  @Post('number')
  @HttpCode(200)
  @RequirePermission('work.read')
  async number(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Body() body: unknown,
  ): Promise<WhatsAppView> {
    const parsed = PostWhatsAppNumberBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.whatsapp.requestCode(actorOf(orgId, user, perms), parsed.data.phone);
  }

  @Post('number/verify')
  @HttpCode(200)
  @RequirePermission('work.read')
  async verify(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Body() body: unknown,
  ): Promise<WhatsAppView> {
    const parsed = VerifyWhatsAppNumberBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.whatsapp.verify(actorOf(orgId, user, perms), parsed.data.code);
  }

  @Delete('number')
  @RequirePermission('work.read')
  async remove(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
  ): Promise<WhatsAppView> {
    return this.whatsapp.remove(actorOf(orgId, user, perms));
  }
}
