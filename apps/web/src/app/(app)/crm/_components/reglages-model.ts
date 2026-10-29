// Réglages du CRM — motifs de perte paramétrables (ADR-0040 § 2.5). Logique pure.
//
// Les règles de contenu (clé `^[a-z0-9_-]{1,32}$`, libellé 1–60, 30 motifs au
// plus) sont celles de l'API : l'écran les applique pour ne pas proposer un
// ajout que le serveur refuserait. Le serveur reste seul juge.

import type { LostReason } from '@/lib/api-crm';

export const MAX_MOTIFS = 30;

/** Clé lisible tirée du libellé : minuscules sans accents, « _ » pour séparer. */
export function cleMotif(label: string): string {
  return label
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
}

/**
 * Liste augmentée d'un motif, ou `null` si l'ajout est impossible : libellé
 * vide ou trop long, clé déjà prise, plafond atteint.
 */
export function ajouterMotif(motifs: readonly LostReason[], libelle: string): LostReason[] | null {
  const label = libelle.trim();
  if (label === '' || label.length > 60 || motifs.length >= MAX_MOTIFS) return null;
  let key = cleMotif(label);
  if (key === '') return null;
  if (motifs.some((m) => m.key === key)) {
    let n = 2;
    while (motifs.some((m) => m.key === `${key.slice(0, 29)}_${n}`)) n += 1;
    key = `${key.slice(0, 29)}_${n}`;
  }
  return [...motifs, { key, label, active: true }];
}
