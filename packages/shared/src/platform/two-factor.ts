// Double authentification de la console Lalanda (ADR-0053 — P8, décision n° 2 retenue le
// 3 nov. 2026). Constantes et fonctions pures partagées par l'API et le web : aucune
// décision d'accès ici, l'API impose.
//
// ── Ce qui est exigé ──────────────────────────────────────────────────────────
//
// Tout opérateur (au moins un rôle plateforme actif) : un code TOTP (RFC 6238, 6 chiffres,
// 30 secondes, SHA-1 — le réglage que lisent toutes les applications d'authentification
// usuelles) pour ouvrir la console sur une session, et à chaque ré-authentification de la
// console (mot de passe + code, ou un code de secours). Les comptes d'organisation ne sont
// pas concernés.

export const PLATFORM_TWO_FACTOR = {
  /** Émetteur affiché par l'application d'authentification. */
  issuer: 'Lalanda',
  digits: 6,
  periodSeconds: 30,
  /** Un pas avant ou après le pas courant (dérive d'horloge du téléphone). */
  window: 1,
  /** Taille du secret TOTP, en octets (160 bits, RFC 4226 § 4). */
  secretBytes: 20,
  /** Codes de secours remis à l'enrôlement, montrés une seule fois. */
  backupCodeCount: 10,
  /** Caractères d'un code de secours (alphabet Crockford sans ambiguïté, 5 bits chacun). */
  backupCodeLength: 12,
  /** Échecs consécutifs tolérés avant verrouillage. */
  maxFailedAttempts: 5,
  /** Durée du verrouillage après trop d'échecs. */
  lockMinutes: 15,
  /** Durée de validité de la vérification d'une session de console (= session de console). */
  sessionVerificationHours: 12,
} as const;

/** Codes d'erreur de la double authentification (ADR-0053 § 7, P8). */
export const PLATFORM_TWO_FACTOR_ERROR_CODES = [
  /** Opérateur non enrôlé : seul l'enrôlement lui est ouvert (403). */
  'PLATFORM_2FA_REQUIRED',
  /** Opérateur enrôlé, session pas encore vérifiée par un code (401). */
  'PLATFORM_2FA_VERIFICATION_REQUIRED',
  /** Code TOTP ou de secours absent du corps de la ré-authentification de console (401). */
  'TWO_FACTOR_CODE_REQUIRED',
  /** Code refusé (401). */
  'INVALID_TWO_FACTOR_CODE',
  /** Trop d'échecs consécutifs (429). */
  'TWO_FACTOR_LOCKED',
  /** Enrôlement déjà actif (409). */
  'TWO_FACTOR_ALREADY_ENROLLED',
  /** Aucun enrôlement en cours ou actif (409). */
  'TWO_FACTOR_NOT_ENROLLED',
  /** Réinitialiser sa propre double authentification (409). */
  'SELF_RESET_FORBIDDEN',
  /** Coffre indisponible (`SECRETS_MASTER_KEY` absente) (503). */
  'SECRETS_UNAVAILABLE',
] as const;

export type PlatformTwoFactorErrorCode = (typeof PLATFORM_TWO_FACTOR_ERROR_CODES)[number];

/** État servi à l'interface par `GET /me/platform-access` et `GET /admin/two-factor`. */
export interface PlatformTwoFactorStatus {
  /** Vrai pour tout opérateur : la console exige la double authentification. */
  required: boolean;
  /** Enrôlement terminé (code vérifié). */
  enrolled: boolean;
  /** Cette session a été vérifiée par un code depuis moins de 12 heures. */
  sessionVerified: boolean;
  /** Codes de secours encore utilisables (0 si non enrôlé). */
  backupCodesRemaining: number;
}

/** Alphabet de Crockford : ni I, L, O, U — rien qui se confonde à la lecture. */
export const BACKUP_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Forme canonique d'un code saisi : majuscules, sans espaces ni tirets, `O`→`0`,
 * `I`/`L`→`1` (règle de Crockford). Un code de secours recopié à la main reste reconnu.
 */
export function normalizeTwoFactorInput(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

/** Code TOTP plausible (6 chiffres, après normalisation) ? */
export function looksLikeTotpCode(raw: string): boolean {
  return new RegExp(`^\\d{${PLATFORM_TWO_FACTOR.digits}}$`).test(normalizeTwoFactorInput(raw));
}

/** Code de secours plausible (12 caractères de l'alphabet, après normalisation) ? */
export function looksLikeBackupCode(raw: string): boolean {
  const code = normalizeTwoFactorInput(raw);
  if (code.length !== PLATFORM_TWO_FACTOR.backupCodeLength) return false;
  return [...code].every((c) => BACKUP_CODE_ALPHABET.includes(c));
}

/** Présentation d'un code de secours : trois groupes de quatre (`ABCD-EFGH-JKMN`). */
export function formatBackupCode(code: string): string {
  const c = normalizeTwoFactorInput(code);
  return c.match(/.{1,4}/g)?.join('-') ?? c;
}
