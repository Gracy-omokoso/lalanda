// Espace compte (S20b) — profil, sécurité, sessions, préférences.
//
//   GET    /account/profile              → identité + préférences de profil
//   PUT    /account/profile              → nom affiché, langue, fuseau
//   GET    /account/preferences          → thème, devise par défaut, notifications
//   PUT    /account/preferences          → écriture des mêmes
//   GET    /account/sessions             → sessions actives (courante marquée)
//   DELETE /account/sessions/:id         → révocation d'une session
//   POST   /account/sessions/revoke-others → révocation de toutes les autres
//   GET    /account/email/change         → demande de changement en attente
//   POST   /account/email/change         → ouvre une demande (vérification requise)
//   DELETE /account/email/change         → annule la demande
//   GET    /account/deletion             → le compte peut-il être supprimé ?
//   POST   /account/delete               → suppression définitive
//
// RÈGLE D'ISOLATION, VALABLE POUR TOUTES LES ROUTES CI-DESSOUS :
// le propriétaire des données est TOUJOURS `@CurrentUser().id`, c'est-à-dire
// l'utilisateur de la session. Aucune route n'accepte d'identifiant d'utilisateur,
// ni en paramètre d'URL, ni en query, ni dans le corps — les schémas zod sont
// `.strict()`, si bien qu'un `userId` glissé dans un corps produit un 400 au lieu
// d'être ignoré en silence. Il n'existe donc pas de forme d'appel permettant de
// lire ou d'écrire le compte d'autrui : ce n'est pas un contrôle qu'on pourrait
// oublier d'écrire quelque part, c'est l'absence de tout paramètre le permettant.

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { getAuth } from '../auth/auth.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AccountAuthGuard } from './account-auth.guard.js';
import {
  DeleteAccountSchema,
  PutPreferencesSchema,
  PutProfileSchema,
  RequestEmailChangeSchema,
  SUPPORTED_LOCALES,
  DISPLAY_CURRENCIES,
  THEMES,
} from './account.dto.js';
import { AccountSessionsService, type SessionView } from './account-sessions.service.js';
import {
  AccountService,
  type DeletionAssessment,
  type PreferencesView,
} from './account.service.js';
import { EmailChangeService } from './email-change.service.js';

type SessionUser = { id: string; email: string; name?: string | null };

export interface ProfileView {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  /** Initiales calculées côté serveur — pas d'upload de photo dans ce lot. */
  initials: string;
  locale: string;
  timezone: string;
  /** Demande de changement d'email en attente, ou `null`. */
  pendingEmailChange: PendingEmailChangeView | null;
}

export interface PendingEmailChangeView {
  newEmail: string;
  expiresAt: string;
  requestedAt: string;
  /**
   * `true` seulement si l'email de vérification a RÉELLEMENT été remis au serveur
   * SMTP. `false` quand aucun SMTP n'est configuré ou que l'envoi a échoué :
   * l'utilisateur ne peut alors pas terminer le changement seul, et l'interface
   * doit le dire plutôt que d'inviter à consulter une boîte qui ne recevra rien.
   */
  verificationDelivered: boolean;
  /** Raison lisible quand `verificationDelivered` est faux. */
  reason: string | null;
}

@Controller('account')
// `AccountAuthGuard` et non `AuthGuard` : l'espace compte doit rester joignable
// SANS organisation (ADR-0012/0013, risque n°2). Voir account-auth.guard.ts.
@UseGuards(AccountAuthGuard)
export class AccountController {
  constructor(
    @Inject(AccountService) private readonly account: AccountService,
    @Inject(AccountSessionsService) private readonly sessions: AccountSessionsService,
    @Inject(EmailChangeService) private readonly emailChange: EmailChangeService,
  ) {}

  // ─── Profil ────────────────────────────────────────────────────────────────

  @Get('profile')
  async getProfile(@CurrentUser() user: SessionUser): Promise<ProfileView> {
    const [prefs, pending] = await Promise.all([
      this.account.getPreferences(user.id),
      this.emailChange.findPending(user.id),
    ]);
    return toProfileView(user, prefs, pending, await this.account.readEmailVerified(user.id));
  }

  @Put('profile')
  async putProfile(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<ProfileView> {
    const parsed = PutProfileSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
    }

    // Le nom vit dans la collection `user` de better-auth : on passe par son API
    // plutôt que d'écrire la collection à la main, pour ne pas contourner ses
    // propres hooks et invalidations de cache de session.
    await getAuth().api.updateUser({
      body: { name: parsed.data.name },
      headers: headersOf(req),
    });

    const prefs = await this.account.saveProfilePreferences(user.id, {
      locale: parsed.data.locale,
      timezone: parsed.data.timezone,
    });
    const pending = await this.emailChange.findPending(user.id);

    return toProfileView(
      { ...user, name: parsed.data.name },
      prefs,
      pending,
      await this.account.readEmailVerified(user.id),
    );
  }

  // ─── Préférences ───────────────────────────────────────────────────────────

  /** Valeurs acceptées, servies avec les préférences : l'UI ne les code pas en dur. */
  @Get('preferences')
  async getPreferences(@CurrentUser() user: SessionUser): Promise<
    PreferencesView & {
      options: {
        locales: readonly string[];
        themes: readonly string[];
        currencies: readonly string[];
      };
    }
  > {
    const prefs = await this.account.getPreferences(user.id);
    return {
      ...prefs,
      options: { locales: SUPPORTED_LOCALES, themes: THEMES, currencies: DISPLAY_CURRENCIES },
    };
  }

  @Put('preferences')
  async putPreferences(
    @CurrentUser() user: SessionUser,
    @Body() body: unknown,
  ): Promise<PreferencesView> {
    const parsed = PutPreferencesSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    return this.account.savePreferences(user.id, parsed.data);
  }

  // ─── Sessions ──────────────────────────────────────────────────────────────

  @Get('sessions')
  async listSessions(@Req() req: Request): Promise<{ sessions: SessionView[] }> {
    return { sessions: await this.sessions.list(headersOf(req)) };
  }

  @Delete('sessions/:id')
  async revokeSession(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ revoked: number; wasCurrent: boolean }> {
    return this.sessions.revoke(headersOf(req), id);
  }

  @Post('sessions/revoke-others')
  @HttpCode(200)
  async revokeOtherSessions(@Req() req: Request): Promise<{ revoked: number }> {
    return this.sessions.revokeOthers(headersOf(req));
  }

  // ─── Changement d'email ────────────────────────────────────────────────────

  @Get('email/change')
  async getEmailChange(
    @CurrentUser() user: SessionUser,
  ): Promise<{ pending: PendingEmailChangeView | null }> {
    return { pending: toPendingView(await this.emailChange.findPending(user.id)) };
  }

  @Post('email/change')
  @HttpCode(202)
  async requestEmailChange(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<{ pending: PendingEmailChangeView }> {
    const parsed = RequestEmailChangeSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    const headers = headersOf(req);
    await this.emailChange.assertPassword(headers, parsed.data.currentPassword);
    const created = await this.emailChange.request(
      user.id,
      user.email,
      parsed.data.newEmail,
      headers,
      user.name ?? null,
    );
    // 202 et non 200 : la demande est ACCEPTÉE, le changement n'est pas appliqué.
    return { pending: toPendingView(created)! };
  }

  @Delete('email/change')
  async cancelEmailChange(@CurrentUser() user: SessionUser): Promise<{ canceled: boolean }> {
    return this.emailChange.cancel(user.id);
  }

  // ─── Suppression du compte ─────────────────────────────────────────────────

  /**
   * Éligibilité à la suppression, consultable AVANT toute saisie : l'utilisateur
   * doit apprendre qu'il est le dernier propriétaire d'une organisation en
   * arrivant sur l'écran, pas après avoir tapé son adresse et son mot de passe.
   */
  @Get('deletion')
  async deletionEligibility(@CurrentUser() user: SessionUser): Promise<DeletionAssessment> {
    return this.account.assessDeletion(user.id);
  }

  @Post('delete')
  @HttpCode(200)
  async deleteAccount(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<{ deleted: true; deletedOrganizations: number }> {
    const parsed = DeleteAccountSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST', issues: parsed.error.issues });
    }

    // Confirmation forte n°1 : l'adresse saisie doit être celle du compte.
    if (parsed.data.confirmEmail !== user.email.trim().toLowerCase()) {
      throw new BadRequestException({
        code: 'EMAIL_MISMATCH',
        message: 'L’adresse saisie ne correspond pas à celle de votre compte.',
      });
    }

    // Confirmation forte n°2 : le mot de passe courant.
    await this.emailChange.assertPassword(headersOf(req), parsed.data.currentPassword);

    const { deletedOrganizations } = await this.account.deleteAccount(user.id);
    return { deleted: true, deletedOrganizations };
  }
}

function headersOf(req: Request): Headers {
  return new Headers(req.headers as Record<string, string>);
}

function toPendingView(
  doc: { newEmail: string; expiresAt: Date; createdAt: Date; notifiedAt: Date | null } | null,
): PendingEmailChangeView | null {
  if (!doc) return null;
  const delivered = doc.notifiedAt !== null;
  return {
    newEmail: doc.newEmail,
    expiresAt: doc.expiresAt.toISOString(),
    requestedAt: doc.createdAt.toISOString(),
    verificationDelivered: delivered,
    reason: delivered
      ? null
      : 'EMAIL_NON_DELIVRE : le lien de vérification n’a pas pu être envoyé — ' +
        'aucun serveur SMTP configuré, ou envoi en échec (docs/17, ADR-0014).',
  };
}

function toProfileView(
  user: SessionUser,
  prefs: PreferencesView,
  pending: Parameters<typeof toPendingView>[0],
  emailVerified: boolean,
): ProfileView {
  const name = user.name?.trim() ?? '';
  return {
    id: user.id,
    name,
    email: user.email,
    emailVerified,
    initials: initialsOf(name, user.email),
    locale: prefs.locale,
    timezone: prefs.timezone,
    pendingEmailChange: toPendingView(pending),
  };
}

/**
 * Initiales d'affichage — l'avatar de ce lot (pas d'upload de fichier : le
 * stockage S3 n'est pas branché, cf. docs/17 § Schéma d'environnement).
 * Repli sur l'email quand aucun nom n'est renseigné, pour ne jamais rendre une
 * pastille vide.
 */
export function initialsOf(name: string, email: string): string {
  const words = name.split(/\s+/).filter((w) => w.length > 0);
  if (words.length >= 2) {
    return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
  }
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  const local = email.split('@')[0] ?? '';
  return (local.slice(0, 2) || '?').toUpperCase();
}
