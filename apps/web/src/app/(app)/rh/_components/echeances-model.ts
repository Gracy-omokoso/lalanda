// Échéances RH (ADR-0045 § 3.3, § 6.4) — logique pure, lot H7.
//
// Fins d'essai, fins de contrat, documents et pièces d'identité qui expirent :
// liste, dates et délais restants (`daysLeft`) rendus par l'API (moteur
// `hrDeadlines`). L'écran met en forme et filtre ; il ne compte aucun jour.

import { HR_LIMITS } from '@lalanda/shared/hr';

import type { HrDeadlinesView } from '@/lib/api-hr-admin';

import { LIBELLES_PIECE } from './sensible-model';
import { formatJour, lienCollaborateur } from './rh-model';

export type Echeance = HrDeadlinesView['items'][number];
export type NatureEcheance = Echeance['kind'];

export const NATURES_ECHEANCE: readonly NatureEcheance[] = [
  'probation_end',
  'contract_end',
  'document_expiry',
  'id_expiry',
];

export const LIBELLES_ECHEANCE: Record<NatureEcheance, string> = {
  probation_end: 'Fin de période d’essai',
  contract_end: 'Fin de contrat',
  document_expiry: 'Document qui expire',
  id_expiry: 'Pièce d’identité qui expire',
};

/** Horizon demandé à l'API : `null` = délais des réglages (§ 2.2). */
export const HORIZONS: readonly (number | null)[] = [
  null,
  7,
  30,
  60,
  90,
  HR_LIMITS.reminderDaysMax,
];

export function libelleHorizon(h: number | null): string {
  return h === null ? 'Délais des réglages' : `${h} prochains jours`;
}

export function horizonDepuis(valeur: string): number | null {
  const n = Number(valeur);
  return HORIZONS.includes(n) ? n : null;
}

/** Délai rendu par l'API, en mots. */
export function libelleDelai(joursRestants: number): string {
  if (joursRestants < 0) {
    const n = -joursRestants;
    return `dépassée de ${n} jour${n >= 2 ? 's' : ''}`;
  }
  if (joursRestants === 0) return 'aujourd’hui';
  if (joursRestants === 1) return 'demain';
  return `dans ${joursRestants} jours`;
}

export function tonDelai(joursRestants: number): 'danger' | 'warning' | 'neutral' {
  if (joursRestants < 0) return 'danger';
  if (joursRestants <= 7) return 'warning';
  return 'neutral';
}

/** Précision d'une ligne : document (libellé servi, masqué hors ayants droit) ou pièce. */
export function detailEcheance(e: Echeance): string | null {
  if (e.kind === 'document_expiry') return e.documentLabel;
  if (e.kind === 'id_expiry') return e.idKind ? LIBELLES_PIECE[e.idKind] : 'Pièce d’identité';
  return null;
}

/** Destination d'une carte : l'onglet de la fiche qui porte l'échéance. */
export function lienEcheance(e: Echeance): string {
  const base = lienCollaborateur(e.employeeId);
  if (e.kind === 'document_expiry') return `${base}/documents`;
  if (e.kind === 'id_expiry') return `${base}/sensible`;
  return base;
}

export function phraseDate(e: Echeance): string {
  return `${formatJour(e.date)} — ${libelleDelai(e.daysLeft)}`;
}

export function filtrerEcheances(
  items: readonly Echeance[],
  nature: NatureEcheance | '',
): Echeance[] {
  return nature === '' ? [...items] : items.filter((e) => e.kind === nature);
}

/** Phrase des délais en vigueur (réglages), rendus par l'API. */
export function phraseHorizons(v: Pick<HrDeadlinesView, 'horizons'>): string {
  return `Rappels : fin d’essai ${v.horizons.probationEnd} jours avant, fin de contrat ${v.horizons.contractEnd} jours avant, document ${v.horizons.documentExpiry} jours avant.`;
}
