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
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { getAuth } from '../auth/auth.js';
import { sessionFingerprint } from '../auth/session-fingerprint.js';
import { PlatformReauth, type PlatformReauthDocument } from './reauth.schema.js';

/** Durée de la fenêtre d'écriture ouverte par une ré-authentification (ADR-0013 §5). */
export const REAUTH_WINDOW_MS = 10 * 60_000;

/**
 * Empreinte de la session appelante.
 *
 * L'implémentation a été DÉPLACÉE dans `auth/session-fingerprint.ts` (S22h) :
 * le MFA plateforme en a besoin pour lier son second facteur à une session
 * précise, exactement comme cette fenêtre-ci lie sa ré-authentification. Deux
 * copies d'une primitive de sécurité divergent au premier correctif appliqué à
 * une seule des deux. Ré-exporté sans changement de signature ni de
 * comportement, pour les appelants existants.
 */
export { sessionFingerprint };

@Injectable()
export class ReauthService {
  constructor(
    @InjectModel(PlatformReauth.name) private readonly model: Model<PlatformReauthDocument>,
  ) {}

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
