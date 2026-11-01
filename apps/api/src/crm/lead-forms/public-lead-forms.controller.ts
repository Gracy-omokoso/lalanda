// Routes PUBLIQUES du formulaire de prospects — ADR-0048 § 5.2.
//
// Ni session, ni cookie, ni permission : le jeton fait autorité et n'ouvre que
// SON formulaire. Inscrites, avec leur justification, dans `SANS_PERMISSION`
// de `routes-coverage.test.ts`. La journalisation HTTP automatique est coupée
// pour ce préfixe (`app.module.ts`) : elle écrirait l'adresse distante.

import type { PublicLeadFormView, PublicLeadSubmissionResult } from '@lalanda/shared/crm';
import { Body, Controller, Get, Header, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';

import { leadFormIpHash } from './lead-form-crypto.js';
import {
  clientIpOf,
  LeadFormFormThrottlerGuard,
  LeadFormIpThrottlerGuard,
} from './lead-form-throttler.guard.js';
import { LeadIntakeService } from './lead-intake.service.js';

@Controller('public/lead-forms')
export class PublicLeadFormsController {
  constructor(@Inject(LeadIntakeService) private readonly intake: LeadIntakeService) {}

  @Get(':token')
  @Header('cache-control', 'no-store')
  async config(@Param('token') token: string): Promise<PublicLeadFormView> {
    return this.intake.config(token);
  }

  @Post(':token/submissions')
  @Header('cache-control', 'no-store')
  @UseGuards(LeadFormIpThrottlerGuard, LeadFormFormThrottlerGuard)
  async submit(
    @Param('token') token: string,
    @Body() body: unknown,
    @Req() req: { ips?: string[]; ip?: string },
  ): Promise<PublicLeadSubmissionResult> {
    return this.intake.submit(token, body, leadFormIpHash(clientIpOf(req)));
  }
}
