// ─────────────────────────────────────────────────────────────────────────────
// Double authentification de la console — ADR-0053 — P8 (décision n° 2 retenue)
//
//   GET  /admin/two-factor                          état (opérateur, enrôlé ou non)
//   POST /admin/two-factor/enrollment               secret neuf : QR code + clé manuelle
//   POST /admin/two-factor/enrollment/confirm       mot de passe + code → 10 codes de secours
//   POST /admin/users/:userId/two-factor/reset      super-administrateur DISTINCT, motif, ré-auth
//
// Les trois premières sont ouvertes à un opérateur NON enrôlé (`'enrollment'`) : c'est le
// chemin d'enrôlement qui garantit qu'aucun opérateur existant n'est enfermé dehors à la
// mise en ligne. Elles exigent quand même un rôle plateforme (`platform.console.read`) :
// un compte d'organisation ne s'enrôle pas ici (non concerné, ADR-0053 § 2.4).
//
// Ni le secret ni les codes ne sont journalisés ; les codes de secours ne sont servis
// qu'UNE fois, dans la réponse de confirmation.
// ─────────────────────────────────────────────────────────────────────────────

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import {
  PLATFORM_LIMITS,
  PLATFORM_REASON_CATEGORIES,
  type PlatformTwoFactorStatus,
} from '@lalanda/shared/platform';

import type { AuthenticatedRequest } from '../../auth/auth.guard.js';
import {
  AllowPlatformTwoFactorPending,
  PlatformConsoleRoute,
  RequirePlatformAction,
} from '../../authz/authz.decorators.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { PlatformAuthGuard } from '../../authz/platform-auth.guard.js';
import { RequireRecentReauth } from '../../integrations/reauth.guard.js';
import { ReauthService, sessionFingerprint } from '../../integrations/reauth.service.js';
import {
  PlatformTwoFactorService,
  type EnrollmentStart,
} from '../../platform-two-factor/platform-two-factor.service.js';
import { INTEGRATION_WRITE_THROTTLE } from '../../security/throttling.js';
import { UserThrottlerGuard } from '../../security/user-throttler.guard.js';

const ConfirmEnrollmentSchema = z
  .object({
    /** Absent pour un compte créé par Google (connexion de moins de 10 minutes exigée). */
    password: z.string().min(1).max(256).optional(),
    code: z.string().min(1).max(32),
  })
  .strict();

const ResetSchema = z
  .object({
    reasonCategory: z.enum(PLATFORM_REASON_CATEGORIES),
    internalNote: z
      .string()
      .trim()
      .min(PLATFORM_LIMITS.internalNoteMinLength)
      .max(PLATFORM_LIMITS.internalNoteMaxLength),
  })
  .strict();

@Controller('admin')
@UseGuards(PlatformAuthGuard, PermissionsGuard)
@PlatformConsoleRoute()
@RequirePlatformAction('platform.console.read')
export class PlatformTwoFactorController {
  constructor(
    @Inject(PlatformTwoFactorService) private readonly twoFactor: PlatformTwoFactorService,
    @Inject(ReauthService) private readonly reauth: ReauthService,
  ) {}

  @Get('two-factor')
  @AllowPlatformTwoFactorPending('enrollment')
  async status(@Req() req: AuthenticatedRequest): Promise<PlatformTwoFactorStatus> {
    return this.twoFactor.status(req.user!.id, sessionFingerprint(req.headers.cookie));
  }

  @Post('two-factor/enrollment')
  @HttpCode(200)
  @AllowPlatformTwoFactorPending('enrollment')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: INTEGRATION_WRITE_THROTTLE })
  async startEnrollment(@Req() req: AuthenticatedRequest): Promise<EnrollmentStart> {
    return this.twoFactor.startEnrollment(req.user!.id, req.user!.email);
  }

  @Post('two-factor/enrollment/confirm')
  @HttpCode(200)
  @AllowPlatformTwoFactorPending('enrollment')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: INTEGRATION_WRITE_THROTTLE })
  async confirmEnrollment(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<{ backupCodes: string[]; status: PlatformTwoFactorStatus }> {
    const parsed = ConfirmEnrollmentSchema.safeParse(body ?? {});
    if (!parsed.success) {
      // Ni `parsed.error`, ni ses `issues` : Zod recopie parfois la valeur reçue.
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Mot de passe et code à six chiffres requis.',
      });
    }
    const userId = req.user!.id;
    const fingerprint = sessionFingerprint(req.headers.cookie);
    // Présence d'abord : une session volée d'un opérateur non enrôlé ne suffit pas à
    // enrôler l'application d'un tiers.
    await this.reauth.provePresence({
      userId,
      headers: new Headers(req.headers as Record<string, string>),
      cookieHeader: req.headers.cookie,
      password: parsed.data.password,
    });
    const { backupCodes } = await this.twoFactor.confirmEnrollment(userId, parsed.data.code);
    if (fingerprint) await this.twoFactor.markSessionVerified(userId, fingerprint);
    return { backupCodes, status: await this.twoFactor.status(userId, fingerprint) };
  }

  @Post('users/:userId/two-factor/reset')
  @HttpCode(200)
  @RequirePlatformAction('platform.roles.manage')
  @RequireRecentReauth()
  async reset(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<{ reset: true; revokedSessions: number }> {
    const parsed = ResetSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'Catégorie et note interne (10 caractères au moins) requises.',
      });
    }
    return this.twoFactor.reset(userId, parsed.data, req.user!.id);
  }
}
