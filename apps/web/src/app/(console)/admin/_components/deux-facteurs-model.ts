// Double authentification de la console — modèle pur (ADR-0053 — P8).
//
// La coquille de console lit `twoFactor` dans `GET /me/platform-access` et choisit l'écran :
// enrôlement (opérateur non enrôlé), vérification (session non vérifiée) ou la console.
// Elle ne décide de rien : l'API refuse de toute façon (`403 PLATFORM_2FA_REQUIRED`,
// `401 PLATFORM_2FA_VERIFICATION_REQUIRED`).

import {
  PLATFORM_TWO_FACTOR,
  formatBackupCode,
  looksLikeBackupCode,
  looksLikeTotpCode,
  type PlatformTwoFactorStatus,
} from '@lalanda/shared/platform';

import type { PlatformSecondFactor } from '@/lib/api';

export type EtatDeuxFacteurs = 'non-concerne' | 'enrolement' | 'verification' | 'ok';

/** Écran à montrer avant la console. Un non-opérateur n'est pas concerné (refus ordinaire). */
export function etatDeuxFacteurs(acces: {
  isPlatformOperator: boolean;
  twoFactor?: PlatformTwoFactorStatus | null;
}): EtatDeuxFacteurs {
  const tf = acces.twoFactor;
  if (!acces.isPlatformOperator || !tf || !tf.required) return 'non-concerne';
  if (!tf.enrolled) return 'enrolement';
  return tf.sessionVerified ? 'ok' : 'verification';
}

/** Routes appelées par la coquille pour la double authentification (en plus de l'accès). */
export const DEUX_FACTEURS_SHELL_CALLS = [
  '/admin/two-factor/enrollment',
  '/admin/two-factor/enrollment/confirm',
  '/admin/reauth',
] as const;

/**
 * Un seul champ pour le code : six chiffres → code TOTP ; douze caractères de l'alphabet
 * des codes de secours → code de secours. Rien d'autre n'est envoyé.
 */
export function secondFacteurDe(saisie: string): PlatformSecondFactor | null {
  const brut = saisie.trim();
  if (looksLikeTotpCode(brut)) return { code: brut.replace(/\s/g, '') };
  if (looksLikeBackupCode(brut)) return { backupCode: brut };
  return null;
}

/** Code d'enrôlement : six chiffres seulement (un code de secours n'existe pas encore). */
export function codeEnrolementValide(saisie: string): boolean {
  return looksLikeTotpCode(saisie);
}

/** Texte des codes de secours à copier ou enregistrer — une ligne par code. */
export function texteCodesDeSecours(codes: readonly string[], email: string | null): string {
  return [
    'Lalanda — codes de secours de la console',
    email ? `Compte : ${email}` : null,
    'Chaque code ne sert qu’une fois. Conservez-les hors de votre téléphone.',
    '',
    ...codes.map(formatBackupCode),
  ]
    .filter((l): l is string => l !== null)
    .join('\n');
}

/**
 * Connexion en deux temps (ADR-0074 § 10) : le mot de passe, PUIS le code, sur deux écrans.
 * Les deux partent toujours ENSEMBLE dans la même requête (`POST /admin/reauth`, contrat
 * inchangé) ; l'écran ne vérifie rien seul. Après un refus, on retourne à l'étape fautive :
 * mot de passe refusé (ou connexion Google à refaire) → étape du mot de passe ; sinon on
 * reste sur le code, vidé pour une nouvelle saisie.
 */
export type EtapeConnexion = 'motdepasse' | 'code';

export function etapeApresErreur(err: unknown): EtapeConnexion {
  const code = (err as { detail?: { code?: unknown } } | null)?.detail?.code;
  return code === 'INVALID_PASSWORD' || code === 'REAUTH_GOOGLE_REQUIRED' ? 'motdepasse' : 'code';
}

/** Le bouton « Continuer » de l'étape du mot de passe. */
export function motDePassePret(motDePasse: string, facultatif: boolean): boolean {
  return facultatif || motDePasse !== '';
}

/** Message d'erreur lisible pour les codes de la double authentification. */
export function messageDeuxFacteurs(err: unknown, defaut: string): string {
  const detail = (err as { detail?: { code?: unknown } } | null)?.detail;
  switch (detail?.code) {
    case 'INVALID_TWO_FACTOR_CODE':
      return 'Code refusé. Vérifiez l’heure de votre téléphone et saisissez le code affiché maintenant.';
    case 'TWO_FACTOR_LOCKED':
      return `Trop d’essais : la vérification est bloquée ${PLATFORM_TWO_FACTOR.lockMinutes} minutes.`;
    case 'INVALID_PASSWORD':
      return 'Mot de passe incorrect.';
    case 'TWO_FACTOR_CODE_REQUIRED':
      return 'Saisissez le code de votre application ou un code de secours.';
    case 'REAUTH_GOOGLE_REQUIRED':
      return 'Reconnectez-vous avec Google, puis recommencez.';
    case 'SECRETS_UNAVAILABLE':
      return 'Le coffre de secrets de la plateforme est indisponible : prévenez l’exploitation.';
    default:
      return err instanceof Error && err.message ? err.message : defaut;
  }
}
