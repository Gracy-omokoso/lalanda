// Contrats d'entrée du module MFA.
//
// `.strict()` PARTOUT (finding F-05 de docs/29) : une clé inconnue est un `400`
// et non un silence. Sur ces routes le point n'est pas théorique — un
// `{ code, userId }` accepté puis ignoré ressemblerait, en revue comme en test
// manuel, à une route qui accepte de vérifier le facteur de quelqu'un d'autre.
// La refuser en `400` rend l'absence de ce paramètre visible.

import { z } from 'zod';

/**
 * Code à six chiffres, ou code de secours.
 *
 * La normalisation (espaces, tirets, casse) est faite par `totp.ts` et
 * `backup-codes.ts`, pas ici : ce schéma borne la TAILLE pour qu'aucune saisie
 * démesurée n'atteigne scrypt ou une expression régulière. 64 caractères
 * laissent largement la place à un code de secours formaté (11) ou à un TOTP
 * espacé (7).
 */
const CodeField = z.string().min(1).max(64);

/** Mot de passe courant — jamais journalisé, jamais renvoyé. */
const PasswordField = z.string().min(1).max(512);

/**
 * Démarrage d'enrôlement.
 *
 * Le mot de passe est EXIGÉ. Sans lui, une session volée suffirait à lier
 * l'application d'authentification de l'ATTAQUANT au compte de la victime : le
 * MFA, censé fermer la porte, la verrouillerait sur l'attaquant — qui
 * satisferait alors le second facteur que la victime ne pourrait plus produire.
 * C'est le mode d'échec le plus coûteux de tout ce module, et il coûte un champ
 * à fermer.
 */
export const MfaEnrollSchema = z.object({ currentPassword: PasswordField }).strict();
export type MfaEnrollInput = z.infer<typeof MfaEnrollSchema>;

/** Confirmation de l'enrôlement par un premier code. */
export const MfaActivateSchema = z.object({ code: CodeField }).strict();
export type MfaActivateInput = z.infer<typeof MfaActivateSchema>;

/** Présentation du second facteur pour la session courante. */
export const MfaVerifySchema = z.object({ code: CodeField }).strict();
export type MfaVerifyInput = z.infer<typeof MfaVerifySchema>;

/**
 * Désactivation : mot de passe ET second facteur.
 *
 * Exiger les deux n'est pas de la ceinture-bretelles. Le mot de passe seul
 * laisserait un mot de passe compromis désactiver la protection contre les mots
 * de passe compromis. Le facteur seul laisserait un téléphone déverrouillé,
 * ramassé sur une table, retirer la protection du compte. Les deux ensemble
 * exigent ce que le MFA promet d'exiger.
 */
export const MfaDisableSchema = z
  .object({ currentPassword: PasswordField, code: CodeField })
  .strict();
export type MfaDisableInput = z.infer<typeof MfaDisableSchema>;

/** Régénération du jeu de codes de secours. */
export const MfaRegenerateBackupSchema = z.object({ currentPassword: PasswordField }).strict();
export type MfaRegenerateBackupInput = z.infer<typeof MfaRegenerateBackupSchema>;
