// ─────────────────────────────────────────────────────────────────────────────
// RÉ-AUTHENTIFICATION AVANT ÉCRITURE SENSIBLE — ADR-0013 §5
//
// « Toute écriture sur /admin/integrations/* exige une ré-authentification datant
// de moins de 10 minutes (saisie du mot de passe; MFA dès qu'il existe). Ceci
// limite l'exploitation d'une session volée ou d'un poste laissé ouvert. »
//
// ── Repli assumé, à lever avant production ───────────────────────────────────
//
// docs/17 § Identité prévoit le MFA pour les rôles sensibles, et
// `platform_super_admin` est le plus sensible de tous. Le MFA N'EXISTE PAS dans
// le produit (docs/17 § Restant, S16a, toujours d'actualité). La ré-authentification
// par mot de passe est donc un REPLI : elle protège d'une session volée ou d'un
// poste resté ouvert, elle ne protège pas d'un mot de passe compromis, qui est
// précisément ce que le MFA couvrirait. Ce point est signalé dans la PR et dans
// docs/17 § Implémenté (S21b) : il est à lever avant toute mise en production
// portant des paiements réels.
//
// ── Pourquoi la fenêtre est liée à la SESSION et pas seulement à l'utilisateur ─
//
// Une ré-authentification indexée sur le seul `userId` profiterait à TOUTES les
// sessions de cet utilisateur : un attaquant détenant un cookie volé n'aurait
// qu'à attendre que la victime saisisse son mot de passe sur son propre poste
// pour hériter de dix minutes d'écriture. L'empreinte de session ferme cette
// porte : seule la session qui a saisi le mot de passe obtient la fenêtre.
// ─────────────────────────────────────────────────────────────────────────────

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { createHash } from 'node:crypto';
import type { Connection, Model } from 'mongoose';

import { getAuth } from '../auth/auth.js';
import { PlatformReauth, type PlatformReauthDocument } from './reauth.schema.js';

/** Durée de la fenêtre d'écriture ouverte par une ré-authentification (ADR-0013 §5). */
export const REAUTH_WINDOW_MS = 10 * 60_000;

/**
 * Moyen de ré-authentification d'un utilisateur (ADR-0021 § Conséquences).
 *
 * - `password` : l'utilisateur a un compte `credential` (mot de passe) ;
 * - `google` : il n'en a pas (compte créé par Google) — il prouve sa présence par
 *   une connexion Google récente, c'est-à-dire une session de moins de 10 minutes.
 */
export type ReauthMethod = 'password' | 'google';

/** Identifiant better-auth du fournisseur « e-mail et mot de passe ». */
const CREDENTIAL_PROVIDER_ID = 'credential';

/** Noms de cookies de session better-auth — mêmes valeurs que le middleware web. */
const SESSION_COOKIE_NAMES = ['better-auth.session_token', '__Secure-better-auth.session_token'];

/**
 * Empreinte de la session appelante.
 *
 * Le jeton de session VAUT le cookie de connexion (docs/17 § S20b) : il n'est ni
 * stocké ni journalisé. Seule son empreinte SHA-256 est conservée, ce qui suffit
 * à comparer deux sessions sans jamais détenir de quoi en usurper une.
 *
 * Retourne `null` si aucun cookie de session n'est présent — la fenêtre est alors
 * impossible à ouvrir, ce qui est le comportement voulu : sans session, il n'y a
 * rien à ré-authentifier.
 */
export function sessionFingerprint(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName && SESSION_COOKIE_NAMES.includes(rawName)) {
      const value = decodeURIComponent(rest.join('=') ?? '');
      if (!value) return null;
      return createHash('sha256').update(value).digest('hex');
    }
  }
  return null;
}

@Injectable()
export class ReauthService {
  constructor(
    @InjectModel(PlatformReauth.name) private readonly model: Model<PlatformReauthDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * L'utilisateur a-t-il un mot de passe ? Lu dans la collection `account` de
   * better-auth, qui n'expose pas ce fait dans la session.
   *
   * `account.userId` est un ObjectId chez better-auth ; la chaîne est acceptée
   * aussi, pour ne pas dépendre d'un détail de stockage de la bibliothèque.
   */
  async methodOf(userId: string): Promise<ReauthMethod> {
    const db = this.connection.db;
    if (!db) {
      // Sans base, on ne sait pas : le chemin le plus exigeant (mot de passe) est
      // retenu, jamais celui qui ouvrirait la fenêtre sans preuve.
      return 'password';
    }
    const ids: Array<string | ObjectId> = [userId];
    if (ObjectId.isValid(userId)) ids.push(new ObjectId(userId));
    const credential = await db
      .collection('account')
      .findOne(
        { userId: { $in: ids }, providerId: CREDENTIAL_PROVIDER_ID },
        { projection: { _id: 1 } },
      );
    return credential ? 'password' : 'google';
  }

  /**
   * Ré-authentification SANS mot de passe — comptes créés par Google
   * (ADR-0021 § Conséquences, décision ouverte n° 6 tranchée).
   *
   * La fenêtre s'ouvre si et seulement si :
   *   1. l'utilisateur n'a AUCUN compte `credential` — un compte à mot de passe se
   *      ré-authentifie par son mot de passe, sans exception : sinon une session
   *      volée de moins de 10 minutes suffirait à contourner la saisie ;
   *   2. la session APPELANTE a été créée il y a moins de 10 minutes — c'est la
   *      connexion Google elle-même qui tient lieu de preuve de présence.
   * Sinon `401 REAUTH_GOOGLE_REQUIRED` : l'interface propose « Se reconnecter avec
   * Google », ce qui crée une session neuve, puis rejoue la requête.
   *
   * La fenêtre expire 10 minutes après la CONNEXION, pas après cet appel : la
   * preuve date de la connexion, et la compter depuis l'appel offrirait jusqu'à
   * vingt minutes à une session vieille de neuf.
   */
  async confirmRecentSignIn(input: {
    userId: string;
    headers: Headers;
    cookieHeader: string | undefined;
  }): Promise<{ expiresAt: Date }> {
    const fingerprint = sessionFingerprint(input.cookieHeader);
    if (!fingerprint) {
      throw new UnauthorizedException({ code: 'NOT_AUTHENTICATED' });
    }
    if ((await this.methodOf(input.userId)) !== 'google') {
      throw new UnauthorizedException({
        code: 'INVALID_PASSWORD',
        message: 'Mot de passe requis.',
      });
    }

    const session = (await getAuth().api.getSession({ headers: input.headers })) as {
      user?: { id?: unknown };
      session?: { createdAt?: unknown };
    } | null;
    const createdAt = toDate(session?.session?.createdAt);
    const now = new Date();
    const sameUser = session?.user && String(session.user.id) === input.userId;
    const expiresAt = createdAt ? new Date(createdAt.getTime() + REAUTH_WINDOW_MS) : null;
    if (!sameUser || !createdAt || !expiresAt || expiresAt <= now || createdAt > now) {
      throw new UnauthorizedException({
        code: 'REAUTH_GOOGLE_REQUIRED',
        message:
          'Ré-authentification requise : reconnectez-vous avec Google pour ouvrir une ' +
          'fenêtre de 10 minutes.',
        windowMs: REAUTH_WINDOW_MS,
      });
    }

    await this.model
      .findOneAndUpdate(
        { userId: input.userId, sessionFingerprint: fingerprint },
        { $set: { confirmedAt: now, expiresAt }, $setOnInsert: { _schemaVersion: 1 } },
        { upsert: true, new: true },
      )
      .exec();
    return { expiresAt };
  }

  /**
   * Vérifie le mot de passe et ouvre la fenêtre de dix minutes.
   *
   * La vérification est déléguée à better-auth, « lui seul connaît l'algorithme
   * et le sel utilisés pour la collection `account` » — même raisonnement que
   * `account/email-change.service.ts`, dont ce code ne peut pas réutiliser la
   * méthode sans importer tout `AccountModule`.
   */
  async confirm(input: {
    userId: string;
    headers: Headers;
    cookieHeader: string | undefined;
    password: string;
  }): Promise<{ expiresAt: Date }> {
    const fingerprint = sessionFingerprint(input.cookieHeader);
    if (!fingerprint) {
      throw new UnauthorizedException({ code: 'NOT_AUTHENTICATED' });
    }

    let ok = false;
    try {
      const res = (await getAuth().api.verifyPassword({
        body: { password: input.password },
        headers: input.headers,
      })) as { status?: boolean } | null;
      ok = res?.status === true;
    } catch {
      // better-auth lève sur mot de passe invalide — traité comme un refus.
      ok = false;
    }
    if (!ok) {
      throw new UnauthorizedException({
        code: 'INVALID_PASSWORD',
        message: 'Mot de passe incorrect.',
      });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + REAUTH_WINDOW_MS);
    await this.model
      .findOneAndUpdate(
        { userId: input.userId, sessionFingerprint: fingerprint },
        { $set: { confirmedAt: now, expiresAt }, $setOnInsert: { _schemaVersion: 1 } },
        { upsert: true, new: true },
      )
      .exec();
    return { expiresAt };
  }

  /** Fenêtre ouverte pour cette session ? Sinon `401 REAUTH_REQUIRED`. */
  async assertRecent(userId: string, cookieHeader: string | undefined): Promise<void> {
    const fingerprint = sessionFingerprint(cookieHeader);
    const row = fingerprint
      ? await this.model
          .findOne({ userId, sessionFingerprint: fingerprint, expiresAt: { $gt: new Date() } })
          .lean()
          .exec()
      : null;
    if (!row) {
      throw new UnauthorizedException({
        code: 'REAUTH_REQUIRED',
        message:
          'Ré-authentification requise : saisissez votre mot de passe pour ouvrir une ' +
          'fenêtre de 10 minutes.',
        windowMs: REAUTH_WINDOW_MS,
      });
    }
  }

  /** État de la fenêtre — l'interface affiche le compte à rebours. */
  async statusOf(
    userId: string,
    cookieHeader: string | undefined,
  ): Promise<{ active: boolean; expiresAt: string | null }> {
    const fingerprint = sessionFingerprint(cookieHeader);
    if (!fingerprint) return { active: false, expiresAt: null };
    const row = await this.model
      .findOne({ userId, sessionFingerprint: fingerprint, expiresAt: { $gt: new Date() } })
      .lean()
      .exec();
    return row
      ? { active: true, expiresAt: new Date(row.expiresAt).toISOString() }
      : { active: false, expiresAt: null };
  }
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
