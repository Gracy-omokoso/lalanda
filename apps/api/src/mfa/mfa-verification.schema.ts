// ─────────────────────────────────────────────────────────────────────────────
// PREUVE DE SECOND FACTEUR POUR UNE SESSION DONNÉE
//
// Même forme, même raisonnement et même index que `platform_reauth`
// (ADR-0013 §5) : une ligne par (utilisateur, session) ayant présenté un second
// facteur, avec une date d'expiration. Aucun code, aucun secret, aucun jeton —
// seulement l'empreinte de la session (`auth/session-fingerprint.ts`).
//
// ── Pourquoi cette collection existe, alors que `mfa_credentials` dit déjà
//    qui a un facteur actif ────────────────────────────────────────────────────
//
// Parce que « détenir un facteur » et « avoir prouvé qu'on le détient » ne sont
// pas la même chose. Si l'accès plateforme n'exigeait que l'existence d'un
// facteur, un cookie de session volé continuerait d'ouvrir `/admin` sans que
// l'attaquant n'ait jamais eu le téléphone — le MFA n'aurait déplacé la barrière
// que d'un cran, jusqu'à la première connexion. C'est le mode d'échec le plus
// courant des MFA mal posées, et il donne un faux sentiment de protection.
//
// La ligne est liée à l'empreinte de session : révoquer une session
// (docs/17 § S20b) rend sa preuve inutilisable sans qu'aucun code ne s'en occupe,
// puisque le jeton — donc l'empreinte — change.
// ─────────────────────────────────────────────────────────────────────────────

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * Durée de validité d'une vérification, par session.
 *
 * 8 heures — une journée de travail. Le choix est un arbitrage, et il est ouvert
 * (voir docs/17 § MFA plateforme) :
 *   • plus court (10 min, comme la ré-authentification par mot de passe) ferait
 *     saisir un code toutes les dix minutes à un opérateur qui consulte le
 *     journal d'audit, et la première réaction humaine à cette friction est de
 *     laisser l'application d'authentification ouverte à côté du navigateur —
 *     ce qui annule le facteur de possession;
 *   • plus long (durée de la session, plusieurs jours) reviendrait à ne demander
 *     le second facteur qu'à la connexion, c'est-à-dire à protéger le mot de
 *     passe et non l'accès plateforme.
 *
 * La ré-authentification par mot de passe de dix minutes (ADR-0013 §5) N'EST PAS
 * remplacée : elle reste exigée avant toute écriture d'intégration. Les deux
 * fenêtres répondent à deux questions différentes — « est-ce bien cette
 * personne ? » à l'entrée de l'espace, « est-ce bien elle, maintenant, devant ce
 * clavier ? » avant de remplacer une clé de paiement.
 */
export const MFA_VERIFICATION_TTL_MS = 8 * 60 * 60_000;

@Schema({ collection: 'mfa_verifications', timestamps: true, strict: true })
export class MfaVerification {
  // Pas d'`index: true` : l'index composé ci-dessous couvre déjà toute recherche
  // par `userId` (préfixe d'index composé).
  @Prop({ type: String, required: true })
  userId!: string;

  /** SHA-256 du jeton de session. Jamais le jeton. */
  @Prop({ type: String, required: true })
  sessionFingerprint!: string;

  /**
   * Facteur présenté : code TOTP, ou code de secours.
   *
   * Conservé pour l'investigation : une série de vérifications par code de
   * secours signale soit un téléphone perdu, soit quelqu'un qui a mis la main
   * sur la feuille de codes. Les deux méritent d'être vus.
   */
  @Prop({ type: String, required: true, enum: ['totp', 'backup_code'] })
  method!: 'totp' | 'backup_code';

  @Prop({ type: Date, required: true })
  verifiedAt!: Date;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type MfaVerificationDocument = HydratedDocument<MfaVerification>;
export const MfaVerificationSchema = SchemaFactory.createForClass(MfaVerification);

MfaVerificationSchema.index({ userId: 1, sessionFingerprint: 1 }, { unique: true });

/**
 * Purge deux heures après expiration.
 *
 * Le TTL est un CONFORT de nettoyage, jamais le contrôle : le garde filtre sur
 * `expiresAt` à chaque requête. Sans ce filtre, le délai de balayage de MongoDB
 * (jusqu'à 60 s) prolongerait silencieusement chaque fenêtre — et un délai de
 * balayage n'est pas une politique de sécurité.
 */
MfaVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7200 });
