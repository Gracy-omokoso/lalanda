// ─────────────────────────────────────────────────────────────────────────────
// ROUTES `/account/mfa` — le second facteur d'un compte
//
// ── Pourquoi sous `/account` et non sous `/admin` ─────────────────────────────
//
// Parce que ces routes doivent rester atteignables par quelqu'un que le second
// facteur EMPÊCHE d'entrer dans `/admin`. Les placer sous `/admin` fermerait la
// seule porte permettant de satisfaire la condition qui ferme `/admin` : un
// opérateur nouvellement nommé ne pourrait jamais s'enrôler, et un opérateur
// ayant perdu son téléphone ne pourrait jamais présenter un code de secours. Le
// contrôle d'accès serait parfaitement étanche et parfaitement inutilisable.
//
// C'est le même raisonnement que `GET /me/platform-access` (S21b) et que l'espace
// compte (S20b) : lire ou établir ses PROPRES moyens d'authentification ne peut
// pas exiger un droit, sous peine de circularité.
//
// ── Portée par la session, sans exception ─────────────────────────────────────
//
// Aucune route ici n'accepte d'identifiant d'utilisateur, sous aucune forme.
// Ce n'est pas un contrôle qu'on pourrait oublier d'écrire : c'est l'absence de
// tout paramètre permettant de désigner autrui, et les schémas `.strict()`
// transforment un `userId` injecté en `400` plutôt qu'en silence (docs/17 § S20b,
// même propriété, même formulation).
//
// ── Pas d'organisation exigée ─────────────────────────────────────────────────
//
// Un rôle plateforme est indépendant de toute appartenance à une organisation
// (ADR-0012 §2). Exiger une organisation active ici enfermerait dehors un
// opérateur qui n'en a aucune. Les routes ne déclarent donc aucune permission
// d'organisation, et `routes-coverage.test.ts` porte la justification.
// ─────────────────────────────────────────────────────────────────────────────

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { MFA_VERIFY_THROTTLE } from '../security/throttling.js';
import { UserThrottlerGuard } from '../security/user-throttler.guard.js';
import type { MfaStatusView } from './mfa-credential.schema.js';
import {
  MfaActivateSchema,
  MfaDisableSchema,
  MfaEnrollSchema,
  MfaRegenerateBackupSchema,
  MfaVerifySchema,
} from './mfa.dto.js';
import { MfaService, type MfaEnrollmentView } from './mfa.service.js';

@Controller('account/mfa')
@UseGuards(AuthGuard)
export class MfaController {
  constructor(@Inject(MfaService) private readonly mfa: MfaService) {}

  /** État du facteur de l'appelant. Ne révèle ni secret ni empreinte. */
  @Get()
  async status(@Req() req: AuthenticatedRequest): Promise<MfaStatusView> {
    return this.mfa.statusOf(req.user!.id);
  }

  /**
   * Démarre (ou recommence) un enrôlement. Mot de passe exigé — voir `mfa.dto.ts`.
   *
   * Quota par utilisateur : l'enrôlement fait un `verifyPassword` puis un
   * chiffrement, et sa réponse contient un secret. Le laisser sans limite
   * offrirait un oracle de mot de passe à qui détient une session.
   */
  @Post('enroll')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: MFA_VERIFY_THROTTLE })
  async enroll(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<MfaEnrollmentView> {
    const parsed = MfaEnrollSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.issues);
    return this.mfa.enroll({
      userId: req.user!.id,
      accountName: req.user!.email,
      headers: headersOf(req),
      currentPassword: parsed.data.currentPassword,
    });
  }

  /** Confirme l'enrôlement et remet les codes de secours — affichés UNE fois. */
  @Post('activate')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: MFA_VERIFY_THROTTLE })
  async activate(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<{ backupCodes: string[]; status: MfaStatusView }> {
    const parsed = MfaActivateSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.issues);
    return this.mfa.activate({ userId: req.user!.id, code: parsed.data.code });
  }

  /**
   * Présente le second facteur pour CETTE session et ouvre la fenêtre.
   *
   * C'est la route que l'écran `/admin` appelle après un `403
   * MFA_STEP_UP_REQUIRED`. Elle est la principale cible de force brute du
   * module — d'où le quota par utilisateur ici et le verrouillage par compte
   * dans le service, qui ne mesurent pas la même chose (voir `recordFailure`).
   */
  @Post('verify')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: MFA_VERIFY_THROTTLE })
  async verify(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<{ verified: true; expiresAt: string; method: 'totp' | 'backup_code' }> {
    const parsed = MfaVerifySchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.issues);
    const { expiresAt, method } = await this.mfa.verify({
      userId: req.user!.id,
      code: parsed.data.code,
      cookieHeader: req.headers.cookie,
    });
    return { verified: true, expiresAt: expiresAt.toISOString(), method };
  }

  /** Remplace le jeu de codes de secours. Les anciens deviennent inutilisables. */
  @Post('backup-codes')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: MFA_VERIFY_THROTTLE })
  async regenerate(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<{ backupCodes: string[] }> {
    const parsed = MfaRegenerateBackupSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.issues);
    return this.mfa.regenerateBackupCodes({
      userId: req.user!.id,
      headers: headersOf(req),
      currentPassword: parsed.data.currentPassword,
    });
  }

  /**
   * Désactive le facteur. Mot de passe ET code exigés.
   *
   * `@Delete` avec un corps : inhabituel mais correct (RFC 9110 ne l'interdit
   * pas, Express et `fetch` le transmettent). L'alternative — un `POST
   * /disable` — cacherait la nature destructrice de l'opération derrière un
   * verbe de création.
   */
  @Delete()
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: MFA_VERIFY_THROTTLE })
  async disable(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<{ disabled: true }> {
    const parsed = MfaDisableSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.issues);
    await this.mfa.disable({
      userId: req.user!.id,
      headers: headersOf(req),
      currentPassword: parsed.data.currentPassword,
      code: parsed.data.code,
    });
    return { disabled: true };
  }
}

function headersOf(req: AuthenticatedRequest): Headers {
  return new Headers(req.headers as Record<string, string>);
}

/**
 * `400` de validation SANS le détail Zod.
 *
 * `parsed.error` recopie la valeur reçue dans certains messages — ici, le mot de
 * passe ou le code que l'appelant vient d'envoyer. Le renvoyer les remettrait
 * dans la réponse, et donc dans les journaux du client (même raisonnement que
 * `integrations.controller.ts`). On ne rend que les NOMS de champs fautifs.
 */
function invalidBody(issues: ReadonlyArray<{ path: PropertyKey[] }>): BadRequestException {
  return new BadRequestException({
    code: 'VALIDATION_ERROR',
    message: 'Corps de requête invalide.',
    fields: issues.map((i) => i.path.join('.')),
  });
}
