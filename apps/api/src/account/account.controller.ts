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
//   POST   /account/avatar               → téléverse la photo (corps BINAIRE brut)
//   DELETE /account/avatar               → retire la photo
//   GET    /account/avatar/:token        → sert l'image (jeton signé — avatar-url.ts)
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
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Req,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { getAuth } from '../auth/auth.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ObjectStorageUnavailableError } from '../storage/object-storage.service.js';
import { UserThrottlerGuard } from '../security/user-throttler.guard.js';
import { AccountAuthGuard } from './account-auth.guard.js';
import { AvatarService, type AvatarRecord } from './avatar.service.js';
import { AVATAR_URL_TTL_SECONDS, avatarUrlFor } from './avatar-url.js';
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MIN_IMAGE_DIMENSION,
  validateAndSanitizeImage,
} from './image-validation.js';
import { readRequestBody } from './request-body.js';
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
  /**
   * Initiales calculées côté serveur.
   *
   * TOUJOURS SERVIES, y compris quand une photo existe. Ce n'est pas une
   * redondance : c'est le repli dont l'interface a besoin pendant le chargement
   * de l'image, si l'URL a expiré, ou si le stockage est momentanément
   * indisponible. Une pastille vide serait un défaut visible ; des initiales ne
   * le sont jamais.
   */
  initials: string;
  /**
   * URL absolue de la photo de profil, ou `null` s'il n'y en a pas.
   *
   * Jeton signé à durée limitée (`AVATAR_URL_TTL_SECONDS`) : une URL fraîche est
   * frappée À CHAQUE lecture de profil. L'interface ne doit donc pas la
   * conserver au-delà de la vie de sa page. Voir avatar-url.ts pour la décision.
   */
  avatarUrl: string | null;
  /** Métadonnées de la photo, `null` sans photo. Sert au cadrage et à l'accessibilité. */
  avatar: AvatarView | null;
  locale: string;
  timezone: string;
  /** Demande de changement d'email en attente, ou `null`. */
  pendingEmailChange: PendingEmailChangeView | null;
}

export interface AvatarView {
  /** Type MIME RÉEL, déduit du contenu à l'upload. */
  contentType: string;
  width: number;
  height: number;
  /** Taille des octets ASSAINIS effectivement stockés, pas de ceux reçus. */
  byteSize: number;
  updatedAt: string;
}

/** Bornes servies à l'interface : elle ne les code pas en dur (comme `options` des préférences). */
export interface AvatarLimitsView {
  maxBytes: number;
  minDimension: number;
  maxDimension: number;
  acceptedTypes: readonly string[];
  urlTtlSeconds: number;
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
    @Inject(AvatarService) private readonly avatars: AvatarService,
  ) {}

  // ─── Profil ────────────────────────────────────────────────────────────────

  @Get('profile')
  async getProfile(@CurrentUser() user: SessionUser): Promise<ProfileView> {
    const [prefs, pending, avatar] = await Promise.all([
      this.account.getPreferences(user.id),
      this.emailChange.findPending(user.id),
      this.avatars.find(user.id),
    ]);
    return toProfileView(
      user,
      prefs,
      pending,
      await this.account.readEmailVerified(user.id),
      avatar,
    );
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
      await this.avatars.find(user.id),
    );
  }

  // ─── Photo de profil ───────────────────────────────────────────────────────
  //
  // Aucune de ces routes n'accepte d'identifiant d'utilisateur : le propriétaire
  // est `@CurrentUser().id`, comme partout dans ce contrôleur. Téléverser « chez
  // quelqu'un d'autre » n'est pas un contrôle qui pourrait manquer — il n'existe
  // aucun paramètre pour le demander.

  /**
   * Téléverse la photo de profil. Le corps est le FICHIER BRUT, pas du multipart.
   *
   * Quota propre : vingt écritures par heure et par utilisateur. Le seau global
   * (100 req/min par IP) ne borne pas ce qui compte ici — chaque appel écrit dans
   * un magasin d'objets, et un remplacement en boucle remplirait le bucket
   * d'orphelins bien en deçà de cette limite.
   */
  @Post('avatar')
  @HttpCode(201)
  @Throttle({ default: { ttl: 3_600_000, limit: 20 } })
  @UseGuards(UserThrottlerGuard)
  async uploadAvatar(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
  ): Promise<{ avatar: AvatarView; avatarUrl: string; initials: string }> {
    // Le type ANNONCÉ ne sert qu'à écarter tôt un envoi manifestement inadapté et
    // à rendre le refus lisible. Il ne fait AUTORITÉ SUR RIEN : le type retenu
    // est celui que `validateAndSanitizeImage` déduit du contenu.
    const annonce = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (annonce && !ACCEPTED_IMAGE_TYPES.includes(annonce as never)) {
      if (annonce !== 'application/octet-stream') {
        throw new UnsupportedMediaTypeException({
          code: 'UNSUPPORTED_IMAGE_TYPE',
          message: `Type « ${annonce} » non accepté. Attendu : ${ACCEPTED_IMAGE_TYPES.join(', ')}.`,
        });
      }
    }

    const lecture = await readRequestBody(req, MAX_IMAGE_BYTES);
    if (!lecture.ok) {
      if (lecture.reason === 'TOO_LARGE') {
        throw new HttpException(
          {
            code: 'FILE_TOO_LARGE',
            message: `Le fichier dépasse ${MAX_IMAGE_BYTES / 1024 / 1024} Mio.`,
          },
          413,
        );
      }
      throw new BadRequestException({ code: 'UPLOAD_ABORTED', message: 'Envoi interrompu.' });
    }

    const verdict = validateAndSanitizeImage(lecture.body);
    if (!verdict.ok) throw imageRejection(verdict.code, verdict.message);

    let enregistre: AvatarRecord;
    try {
      enregistre = await this.avatars.replace(user.id, verdict);
    } catch (cause) {
      throw storageFailure(cause);
    }

    return {
      avatar: toAvatarView(enregistre)!,
      avatarUrl: avatarUrlFor(enregistre.objectId),
      // Les initiales voyagent avec la photo : l'interface a de quoi afficher
      // quelque chose immédiatement, avant même que l'image soit chargée.
      initials: initialsOf(user.name?.trim() ?? '', user.email),
    };
  }

  /**
   * Retire la photo de profil. Idempotent : `removed: false` si aucune photo.
   *
   * Cette route existe parce qu'une photo qu'on ne peut pas retirer est un piège.
   * Elle ne renvoie jamais 404 pour « pas de photo » — l'état demandé est atteint.
   */
  @Delete('avatar')
  async deleteAvatar(
    @CurrentUser() user: SessionUser,
  ): Promise<{ removed: boolean; initials: string }> {
    let removed: boolean;
    try {
      removed = await this.avatars.remove(user.id);
    } catch (cause) {
      throw storageFailure(cause);
    }
    return { removed, initials: initialsOf(user.name?.trim() ?? '', user.email) };
  }

  /**
   * Bornes de validation, servies pour que l'interface ne les code pas en dur.
   *
   * `avatar-limits` et non `avatar/limits` : `GET /account/avatar/:token` vit
   * dans un autre contrôleur, et un chemin sous `avatar/` entrerait en collision
   * avec ce paramètre selon l'ordre d'enregistrement des contrôleurs. Une
   * ambiguïté de routage qui dépend d'un ordre est un bogue en attente.
   */
  @Get('avatar-limits')
  avatarLimits(): AvatarLimitsView & { storageAvailable: boolean } {
    return {
      maxBytes: MAX_IMAGE_BYTES,
      minDimension: MIN_IMAGE_DIMENSION,
      maxDimension: MAX_IMAGE_DIMENSION,
      acceptedTypes: ACCEPTED_IMAGE_TYPES,
      urlTtlSeconds: AVATAR_URL_TTL_SECONDS,
      // L'interface peut désactiver le bouton et l'expliquer, plutôt que de
      // laisser l'utilisateur découvrir un 503 après avoir choisi un fichier.
      storageAvailable: this.avatars.storageAvailability().available,
    };
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

export function toAvatarView(record: AvatarRecord | null): AvatarView | null {
  if (!record) return null;
  // Champs recopiés un par un — `objectId` reste volontairement DEHORS : il ne
  // circule que scellé dans un jeton signé (avatar-url.ts).
  return {
    contentType: record.contentType,
    width: record.width,
    height: record.height,
    byteSize: record.byteSize,
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** Traduit un refus de validation en réponse HTTP, code métier conservé. */
function imageRejection(code: string, message: string): HttpException {
  const statut =
    code === 'FILE_TOO_LARGE'
      ? 413
      : code === 'UNSUPPORTED_IMAGE_TYPE'
        ? 415
        : code === 'IMAGE_DIMENSIONS_REJECTED'
          ? 422
          : 400;
  return new HttpException({ code, message }, statut);
}

/**
 * Un stockage non configuré ou injoignable donne 503, jamais 500.
 *
 * La distinction est utile : 503 dit « le service ne peut pas répondre
 * maintenant », ce qui est vrai et réessayable. Un 500 laisserait croire à un
 * défaut de la requête, et un `S3_BUCKET_UPLOADS` oublié se chercherait dans le
 * mauvais code pendant longtemps. Même parti que `503 VAULT_UNAVAILABLE`
 * (ADR-0013) : on annonce l'indisponibilité plutôt que d'accepter une écriture
 * qu'on ne saurait pas honorer.
 */
function storageFailure(cause: unknown): HttpException {
  if (cause instanceof ObjectStorageUnavailableError) {
    return new ServiceUnavailableException({ code: 'STORAGE_UNAVAILABLE', message: cause.reason });
  }
  if (cause instanceof HttpException) return cause;
  return new ServiceUnavailableException({
    code: 'STORAGE_FAILURE',
    message: 'Le stockage des fichiers n’a pas pu traiter la demande.',
  });
}

function toProfileView(
  user: SessionUser,
  prefs: PreferencesView,
  pending: Parameters<typeof toPendingView>[0],
  emailVerified: boolean,
  avatar: AvatarRecord | null,
): ProfileView {
  const name = user.name?.trim() ?? '';
  return {
    id: user.id,
    name,
    email: user.email,
    emailVerified,
    // Servies MÊME avec une photo — voir le commentaire de `ProfileView.initials`.
    initials: initialsOf(name, user.email),
    avatarUrl: avatar ? avatarUrlFor(avatar.objectId) : null,
    avatar: toAvatarView(avatar),
    locale: prefs.locale,
    timezone: prefs.timezone,
    pendingEmailChange: toPendingView(pending),
  };
}

/**
 * Initiales d'affichage — le REPLI quand il n'y a pas de photo, et la valeur
 * servie pendant le chargement de l'image quand il y en a une.
 *
 * Repli sur l'email quand aucun nom n'est renseigné, pour ne jamais rendre une
 * pastille vide. Cette fonction est la seule source des initiales : la route
 * d'upload et celle de retrait la réutilisent au lieu de la recalculer.
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
