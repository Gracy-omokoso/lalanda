// Notifications des Projets par WhatsApp — ADR-0065.
//
// UN numéro WhatsApp « Lalanda » commun à toutes les organisations (API officielle
// WhatsApp Business Cloud de Meta). Chaque personne saisit SON numéro, le prouve par un
// code à 6 chiffres reçu sur WhatsApp, et choisit les événements qu'elle veut y recevoir.
//
// Ce fichier porte les contrats échangés entre l'API et l'écran, plus deux fonctions
// pures partagées : normalisation d'un numéro au format E.164 et masquage pour
// l'affichage et les journaux. Le numéro est une donnée PERSONNELLE : aucune route ne
// le renvoie à quelqu'un d'autre que son titulaire.

import { z } from 'zod';

/** Indicatif proposé par défaut (République démocratique du Congo). */
export const WHATSAPP_DEFAULT_COUNTRY_CODE = '+243';

/** Durée de validité d'un code de vérification. */
export const WHATSAPP_CODE_TTL_MINUTES = 10;
/** Essais de saisie par code. */
export const WHATSAPP_CODE_MAX_ATTEMPTS = 5;
/** Codes envoyés au plus par personne et par heure glissante. */
export const WHATSAPP_CODES_PER_HOUR = 3;
/** Plafond mensuel d'envois par organisation quand la plateforme n'en fixe pas. */
export const WHATSAPP_DEFAULT_MONTHLY_LIMIT = 1000;

/**
 * État du numéro d'une personne.
 * - `pending` : saisi, code envoyé, pas encore prouvé ;
 * - `verified` : prouvé — les notifications peuvent partir ;
 * - `to_verify` : WhatsApp n'a pas pu remettre un message à ce numéro (numéro invalide
 *   ou sans WhatsApp) — plus aucun envoi jusqu'à une nouvelle vérification ;
 * - `opted_out` : la personne a répondu « STOP » (ou « ARRET ») — plus aucun envoi
 *   jusqu'à une nouvelle vérification de sa part.
 */
export const WHATSAPP_NUMBER_STATUSES = ['pending', 'verified', 'to_verify', 'opted_out'] as const;
export type WhatsAppNumberStatus = (typeof WHATSAPP_NUMBER_STATUSES)[number];

/**
 * Pourquoi WhatsApp est indisponible :
 * - `not_configured` : fournisseur absent, incomplet ou désactivé dans `/admin` ;
 * - `switched_off` : interrupteur d'exploitation `WHATSAPP_ENABLED=false` ;
 * - `provider_error` : Meta a refusé le jeton de la plateforme (fournisseur signalé dans
 *   `/admin`, envois suspendus jusqu'à un test de connexion réussi).
 */
export const WHATSAPP_UNAVAILABLE_REASONS = [
  'not_configured',
  'switched_off',
  'provider_error',
] as const;
export type WhatsAppUnavailableReason = (typeof WHATSAPP_UNAVAILABLE_REASONS)[number];

/** `GET /work/whatsapp` — la vue de l'appelant, et seulement la sienne. */
export interface WhatsAppView {
  available: boolean;
  unavailableReason: WhatsAppUnavailableReason | null;
  /** Numéro de l'APPELANT (jamais celui d'un autre membre), ou `null`. */
  number: {
    /** E.164 complet — montré à son seul titulaire. */
    phone: string;
    /** Forme masquée (`+243 81 *** **12`), celle des journaux. */
    phoneMasked: string;
    status: WhatsAppNumberStatus;
    verifiedAt: string | null;
    /** Code en attente de saisie, s'il y en a un. */
    code: { sentAt: string; expiresAt: string; attemptsLeft: number } | null;
  } | null;
  /** Codes que l'appelant peut encore demander dans l'heure glissante. */
  codesLeftThisHour: number;
  /** Envois WhatsApp de l'organisation ce mois-ci (heure de Kinshasa). */
  quota: { month: string; used: number; limit: number; reached: boolean };
}

/**
 * Normalise un numéro saisi en E.164 (`+243812345612`), ou `null` s'il est invalide.
 *
 * Accepte les espaces, points, tirets et parenthèses ; `00` vaut `+` ; un numéro
 * national congolais (`0812345612`, ou neuf chiffres) reçoit l'indicatif `+243`. Un
 * numéro `+243` doit compter exactement neuf chiffres après l'indicatif.
 */
export function normalizeWhatsAppPhone(input: string): string | null {
  if (typeof input !== 'string' || input.length > 40) return null;
  const compact = input.trim().replace(/[\s.\-()/]/g, '');
  if (!/^\+?\d+$/.test(compact)) return null;
  let e164: string;
  if (compact.startsWith('+')) e164 = compact;
  else if (compact.startsWith('00')) e164 = `+${compact.slice(2)}`;
  else if (compact.startsWith('0')) e164 = `${WHATSAPP_DEFAULT_COUNTRY_CODE}${compact.slice(1)}`;
  else if (compact.length === 9) e164 = `${WHATSAPP_DEFAULT_COUNTRY_CODE}${compact}`;
  else e164 = `+${compact}`;
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) return null;
  if (e164.startsWith('+243') && !/^\+243[1-9]\d{8}$/.test(e164)) return null;
  return e164;
}

/**
 * Forme masquée d'un numéro E.164 : `+243 81 *** **12` pour la RDC, sinon les quatre
 * premiers caractères et les deux derniers chiffres (`+331 *** **78`). Seule forme
 * admise dans les journaux, l'audit et les messages d'erreur.
 */
export function maskWhatsAppPhone(e164: string): string {
  if (/^\+243\d{9}$/.test(e164)) return `+243 ${e164.slice(4, 6)} *** **${e164.slice(-2)}`;
  if (e164.length < 8) return '***';
  return `${e164.slice(0, 4)} *** **${e164.slice(-2)}`;
}

/** `POST /work/whatsapp/number` — saisir (ou changer) son numéro : un code part. */
export const PostWhatsAppNumberBody = z
  .object({
    phone: z
      .string({ error: 'Numéro de téléphone attendu.' })
      .trim()
      .min(1, { message: 'Numéro de téléphone attendu.' })
      .max(40, { message: '40 caractères au plus.' }),
  })
  .strict();
export type PostWhatsAppNumberBody = z.output<typeof PostWhatsAppNumberBody>;

/** `POST /work/whatsapp/number/verify` — le code reçu sur WhatsApp. */
export const VerifyWhatsAppNumberBody = z
  .object({
    code: z
      .string({ error: 'Code attendu.' })
      .trim()
      .regex(/^\d{6}$/, { message: 'Le code compte 6 chiffres.' }),
  })
  .strict();
export type VerifyWhatsAppNumberBody = z.output<typeof VerifyWhatsAppNumberBody>;
