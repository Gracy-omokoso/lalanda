// Motif d'un geste de la console (ADR-0053 — P2) : catégorie, message destiné au client,
// note interne. Fonctions pures, testées ; l'API juge de toute façon (`400 REASON_REQUIRED`).

import {
  PLATFORM_LIMITS,
  PLATFORM_REASON_CATEGORIES,
  PLATFORM_REASON_CATEGORY_LABELS,
  type PlatformReasonCategory,
} from '@lalanda/shared/platform';

export interface MotifSaisi {
  reasonCategory: PlatformReasonCategory | '';
  clientMessage: string;
  internalNote: string;
}

export const MOTIF_VIDE: MotifSaisi = { reasonCategory: '', clientMessage: '', internalNote: '' };

export const CATEGORIES_MOTIF = PLATFORM_REASON_CATEGORIES.map((c) => ({
  valeur: c,
  libelle: PLATFORM_REASON_CATEGORY_LABELS[c],
}));

export const NOTE_INTERNE_MIN = PLATFORM_LIMITS.internalNoteMinLength;

/** La note interne atteint-elle la longueur exigée ? */
export function noteInterneValide(note: string): boolean {
  return note.trim().length >= NOTE_INTERNE_MIN;
}

/**
 * Le motif est-il complet ? `avecCategorie` : bloquer, suspendre, changer d'offre ;
 * `avecMessageClient` : tout geste qui paraît au journal du client.
 */
export function motifComplet(
  motif: MotifSaisi,
  exige: { avecCategorie: boolean; avecMessageClient: boolean },
): boolean {
  if (exige.avecCategorie && motif.reasonCategory === '') return false;
  if (exige.avecMessageClient && motif.clientMessage.trim() === '') return false;
  return noteInterneValide(motif.internalNote);
}

/** Recherche de comptes : trois caractères au moins (`400 SEARCH_REQUIRED` sinon). */
export function rechercheSuffisante(q: string): boolean {
  return q.trim().length >= PLATFORM_LIMITS.searchMinLength;
}

/** Échéance par défaut du rôle Support : la plus longue permise (90 jours). */
export function echeanceSupportParDefaut(maintenant: Date): string {
  return new Date(
    maintenant.getTime() + PLATFORM_LIMITS.supportRoleMaxDays * 86_400_000 - 60_000,
  ).toISOString();
}
