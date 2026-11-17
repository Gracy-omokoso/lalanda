// Lien de désinscription des e-mails de l'espace externe — ADR-0079 § 9.
//
//   GET /portal/notifications/preference?jeton=   préférence du compte du jeton
//   PUT /portal/notifications/preference          { jeton, preference }
//
// PUBLIQUES, sans session : le jeton signé (HMAC, clé HKDF d'`AUTH_SECRET`) désigne UN
// compte externe et ne règle QUE ses e-mails ; il n'ouvre pas l'espace externe et ne
// renvoie ni nom, ni adresse, ni projet. Jeton faux ou compte inconnu : même
// `404 EXTERNAL_PREFERENCE_NOT_FOUND`. Écriture soumise à `PortalOriginGuard` (origine
// = `WEB_URL`, corps JSON) et au garde de débit global. Inscrites dans `SANS_PERMISSION`
// de `routes-coverage.test.ts`.

import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  PutPortalPreferenceByTokenBody,
  type PortalNotificationPreferenceView,
} from '@lalanda/shared/work';

import { invalidRequest } from '../../sales/sales.errors.js';
import { PortalOriginGuard } from './portal-origin.guard.js';
import { readExternalPreferenceToken } from './work-external-crypto.js';
import { WorkExternalNotifier } from './work-external-notifier.js';

function notFound(): never {
  throw new NotFoundException({
    code: 'EXTERNAL_PREFERENCE_NOT_FOUND',
    message: 'Ce lien n’est plus valable.',
  });
}

@Controller('portal/notifications')
@UseGuards(PortalOriginGuard)
export class PortalNotificationsController {
  constructor(@Inject(WorkExternalNotifier) private readonly notifier: WorkExternalNotifier) {}

  @Get('preference')
  @Header('cache-control', 'no-store')
  async get(@Query('jeton') jeton: unknown): Promise<PortalNotificationPreferenceView> {
    const ref = typeof jeton === 'string' ? readExternalPreferenceToken(jeton) : null;
    if (!ref) notFound();
    const preference = await this.notifier.preferenceOf(ref.organizationId, ref.accountId);
    if (!preference) notFound();
    return { preference };
  }

  @Put('preference')
  async put(@Body() body: unknown): Promise<PortalNotificationPreferenceView> {
    const parsed = PutPortalPreferenceByTokenBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    const ref = readExternalPreferenceToken(parsed.data.jeton);
    if (!ref) notFound();
    const ok = await this.notifier.setPreference(
      ref.organizationId,
      ref.accountId,
      parsed.data.preference,
    );
    if (!ok) notFound();
    return { preference: parsed.data.preference };
  }
}
