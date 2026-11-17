// Connexion à l'espace externe — ADR-0078 § 3. Routes PUBLIQUES (aucune session, aucune
// permission d'organisation), inscrites avec leur justification dans `SANS_PERMISSION` de
// `routes-coverage.test.ts`. La journalisation HTTP automatique est coupée pour ce préfixe
// (`app.module.ts`).
//
//   POST /portal/auth/request-code   { email }                      → 202, réponse unique
//   POST /portal/auth/verify         { email, code, organizationId? } → cookie de session
//   POST /portal/auth/logout                                          → 204, cookie effacé

import {
  Body,
  Controller,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  PortalRequestCodeBody,
  PortalVerifyCodeBody,
  WORK_EXTERNAL_SESSION_COOKIE,
  type PortalMeView,
} from '@lalanda/shared/work';
import type { Request, Response } from 'express';

import { invalidRequest } from '../../sales/sales.errors.js';
import { cookieOf } from './external-auth.guard.js';
import { WorkExternalAuthService } from './work-external-auth.service.js';
import {
  ExternalRequestEmailThrottlerGuard,
  ExternalRequestIpThrottlerGuard,
  ExternalVerifyEmailThrottlerGuard,
  ExternalVerifyIpThrottlerGuard,
} from './work-external-throttler.guard.js';

/** Attributs du cookie de session externe (mêmes règles de domaine que better-auth). */
export function externalCookieOptions(expires?: Date): Record<string, unknown> {
  const secure = (process.env['API_URL'] ?? '').startsWith('https://');
  const domain = process.env['AUTH_COOKIE_DOMAIN'];
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    ...(domain ? { domain } : {}),
    ...(expires ? { expires } : {}),
  };
}

@Controller('portal/auth')
export class PortalAuthController {
  constructor(@Inject(WorkExternalAuthService) private readonly auth: WorkExternalAuthService) {}

  @Post('request-code')
  @HttpCode(202)
  @Header('cache-control', 'no-store')
  @UseGuards(ExternalRequestIpThrottlerGuard, ExternalRequestEmailThrottlerGuard)
  async requestCode(@Body() body: unknown): Promise<{ sent: true }> {
    const parsed = PortalRequestCodeBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.auth.requestCode(parsed.data.email);
  }

  @Post('verify')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @UseGuards(ExternalVerifyIpThrottlerGuard, ExternalVerifyEmailThrottlerGuard)
  async verify(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ me: PortalMeView }> {
    const parsed = PortalVerifyCodeBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    const { token, expiresAt, me } = await this.auth.verify(
      parsed.data.email,
      parsed.data.code,
      parsed.data.organizationId,
    );
    res.cookie(WORK_EXTERNAL_SESSION_COOKIE, token, externalCookieOptions(expiresAt));
    return { me };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(cookieOf(req.headers.cookie, WORK_EXTERNAL_SESSION_COOKIE));
    res.clearCookie(WORK_EXTERNAL_SESSION_COOKIE, externalCookieOptions());
  }
}
