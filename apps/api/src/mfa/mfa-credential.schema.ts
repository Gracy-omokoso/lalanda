// ─────────────────────────────────────────────────────────────────────────────
// FACTEUR TOTP D'UN UTILISATEUR — un document par compte, au plus.
//
// ── Ce que ce document contient, et ce qu'il ne contient pas ─────────────────
//
// Il contient le secret TOTP CHIFFRÉ (AES-256-GCM, primitive d'ADR-0013 réutilisée
// telle quelle — voir `mfa.service.ts` pour l'emplacement logique choisi) et les
// EMPREINTES des codes de secours. Il ne contient jamais : un secret en clair, un
// code de secours en clair, un code déjà saisi, ni les quatre derniers caractères
// du secret (`last4` est forcé à `null` — quatre caractères base32 offriraient
// 20 bits d'un secret qui en a 160).
//
// Un accès en LECTURE à cette collection ne permet donc ni de calculer un code,
// ni de deviner un code de secours. Il permet de savoir QUI a activé le MFA —
// information non secrète, et de toute façon déductible du comportement de l'API.
//
// ── Pourquoi `status` et non un simple booléen ────────────────────────────────
//
// L'enrôlement a deux temps : le serveur produit un secret, puis l'utilisateur
// prouve qu'il l'a bien enregistré en renvoyant un code. Entre les deux, le
// facteur EXISTE mais ne protège rien — et surtout, il ne doit pas encore être
// exigé, sinon quelqu'un qui abandonne l'enrôlement en cours de route se
// retrouverait enfermé dehors par un facteur qu'il n'a jamais configuré.
// `pending` nomme cet état ; un booléen l'aurait laissé implicite et quelqu'un
// aurait fini par le lire comme « actif ».
// ─────────────────────────────────────────────────────────────────────────────

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/** États d'un facteur. Union fermée (docs/26). */
export const MFA_STATUSES = ['pending', 'active'] as const;
export type MfaStatus = (typeof MFA_STATUSES)[number];

/**
 * Nombre d'échecs consécutifs avant verrouillage de la vérification.
 *
 * Le quota `UserThrottlerGuard` compte les requêtes par utilisateur et par
 * fenêtre ; ce compteur-ci compte les ÉCHECS, et il est remis à zéro par un
 * succès. La différence compte : un opérateur qui se trompe deux fois puis
 * réussit ne doit rien subir, tandis qu'un attaquant qui échoue cinq fois de
 * suite doit être arrêté même s'il a pris soin de rester sous le quota de
 * requêtes.
 */
export const MFA_MAX_FAILED_ATTEMPTS = 5;

/** Durée du verrouillage après `MFA_MAX_FAILED_ATTEMPTS` échecs. */
export const MFA_LOCK_MS = 15 * 60_000;

/** Empreinte d'un code de secours et son état de consommation. */
@Schema({ _id: false })
export class BackupCodeEntry {
  /** Empreinte scrypt, base64. Jamais le code. */
  @Prop({ type: String, required: true })
  hash!: string;

  /** Date de consommation, `null` tant que le code est utilisable. */
  @Prop({ type: Date, default: null })
  usedAt!: Date | null;
}

export const BackupCodeEntrySchema = SchemaFactory.createForClass(BackupCodeEntry);

/** Valeur chiffrée, forme d'ADR-0013 §1 recopiée en sous-document. */
@Schema({ _id: false })
export class EncryptedSecret {
  @Prop({ type: String, required: true })
  alg!: string;

  @Prop({ type: String, required: true })
  keyId!: string;

  @Prop({ type: String, required: true })
  salt!: string;

  @Prop({ type: String, required: true })
  iv!: string;

  @Prop({ type: String, required: true })
  ciphertext!: string;

  @Prop({ type: String, required: true })
  authTag!: string;

  /**
   * TOUJOURS `null` pour un secret TOTP — voir l'en-tête de fichier. Le champ
   * existe pour que la forme reste celle d'`EncryptedValue` et que la primitive
   * d'ADR-0013 s'applique sans adaptateur.
   */
  @Prop({ type: String, default: null })
  last4!: string | null;

  @Prop({ type: Date, required: true })
  updatedAt!: Date;

  @Prop({ type: String, required: true })
  updatedBy!: string;
}

export const EncryptedSecretSchema = SchemaFactory.createForClass(EncryptedSecret);

@Schema({ collection: 'mfa_credentials', timestamps: true, strict: true })
export class MfaCredential {
  /** Un facteur par utilisateur — index unique plus bas. */
  @Prop({ type: String, required: true })
  userId!: string;

  @Prop({ type: String, required: true, enum: MFA_STATUSES })
  status!: MfaStatus;

  @Prop({ type: EncryptedSecretSchema, required: true })
  secret!: EncryptedSecret;

  @Prop({ type: [BackupCodeEntrySchema], default: [] })
  backupCodes!: BackupCodeEntry[];

  /** Sel commun au jeu de codes de secours, base64. Voir `backup-codes.ts`. */
  @Prop({ type: String, default: null })
  backupSalt!: string | null;

  /**
   * Pas de temps du DERNIER code accepté — la protection contre le rejeu.
   *
   * Un code TOTP reste calculable pendant 90 secondes (fenêtre de ±1 pas). Sans
   * ce compteur, un code lu par-dessus l'épaule, capté dans un journal de proxy
   * ou hameçonné reste utilisable une deuxième fois par quelqu'un d'autre. Avec
   * lui, `verify` refuse tout pas inférieur ou égal au dernier accepté : le code
   * est consommé au sens strict.
   *
   * `null` tant qu'aucun code n'a été accepté.
   */
  @Prop({ type: Number, default: null })
  lastUsedStep!: number | null;

  /** Échecs consécutifs. Remis à zéro par un succès. */
  @Prop({ type: Number, required: true, default: 0 })
  failedAttempts!: number;

  /** Verrouillage actif jusqu'à cette date, `null` sinon. */
  @Prop({ type: Date, default: null })
  lockedUntil!: Date | null;

  /** Date d'activation — `null` tant que `status` vaut `pending`. */
  @Prop({ type: Date, default: null })
  activatedAt!: Date | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type MfaCredentialDocument = HydratedDocument<MfaCredential>;
export const MfaCredentialSchema = SchemaFactory.createForClass(MfaCredential);

/**
 * Un seul facteur par utilisateur.
 *
 * L'unicité est portée par la BASE et non par un `findOne` préalable : deux
 * requêtes d'enrôlement concurrentes (double-clic, onglet dupliqué) créeraient
 * autrement deux secrets, dont un seul serait dans l'application
 * d'authentification — et l'utilisateur verrait ses codes refusés sans
 * comprendre. Le service utilise `findOneAndUpdate(..., { upsert: true })`, dont
 * l'atomicité repose précisément sur cet index.
 */
MfaCredentialSchema.index({ userId: 1 }, { unique: true });

/**
 * PAS de TTL sur ce document, y compris à l'état `pending`.
 *
 * Un enrôlement abandonné laisse une ligne `pending` qui ne protège rien et
 * n'exige rien. La purger automatiquement introduirait une course : le document
 * pourrait disparaître entre l'affichage du QR code et la saisie du premier
 * code, transformant un enrôlement correct en « secret inconnu ». Une nouvelle
 * demande d'enrôlement remplace le document de toute façon.
 */

/**
 * Vue publique d'un facteur — ce que l'API a le droit de dire.
 *
 * Aucun champ dérivé du secret, aucune empreinte, aucun sel. Le type existe pour
 * que l'oubli soit impossible : une réponse se construit à partir de cette
 * interface, jamais par recopie du document.
 */
export interface MfaStatusView {
  /** Facteur actif (donc opposable) ? */
  enabled: boolean;
  /** Enrôlement commencé mais non confirmé ? */
  pending: boolean;
  /** Codes de secours encore utilisables. */
  backupCodesRemaining: number;
  /** Date d'activation, ISO, ou `null`. */
  activatedAt: string | null;
  /** Vérification bloquée jusqu'à cette date (ISO) après échecs répétés. */
  lockedUntil: string | null;
}
