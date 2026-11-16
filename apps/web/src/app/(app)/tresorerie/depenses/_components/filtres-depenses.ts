// Filtres « Fournisseur » et « Projet » de la liste des dépenses — ADR-0077 § 3.
//
// Fonctions PURES : lecture et écriture des paramètres d'URL (`?fournisseur=<id>&
// projet=<id>`), options du filtre fournisseur (fiches seulement : un nom libre n'a
// pas d'identifiant à filtrer) et période interrogée. L'API vérifie tout
// (`supplierId`, `workProjectId` validés ; fiche d'autrui : liste vide).

import type { TreasurySupplierEntry } from '@/lib/treasury-api';

import type { FournisseurDepense } from './fournisseur-depense';

const ID = /^[0-9a-f]{24}$/i;

export interface FiltresDepenses {
  /** Fiche fournisseur, `null` : toutes. */
  fournisseurId: string | null;
  /** Projet du RUN, `null` : tous. */
  projetId: string | null;
}

/** Lien « Voir toutes ses dépenses » de la fiche fournisseur. */
export function lienDepensesFournisseur(supplierId: string): string {
  return `/tresorerie/depenses?fournisseur=${encodeURIComponent(supplierId)}`;
}

/** Filtres lus de l'URL ; un identifiant malformé est ignoré. */
export function lireFiltres(
  search: URLSearchParams | { get(k: string): string | null },
): FiltresDepenses {
  const f = search.get('fournisseur');
  const p = search.get('projet');
  return {
    fournisseurId: f && ID.test(f) ? f.toLowerCase() : null,
    projetId: p && ID.test(p) ? p.toLowerCase() : null,
  };
}

/** Chaîne de requête des filtres (`''` sans filtre), dans un ordre stable. */
export function ecrireFiltres(f: FiltresDepenses): string {
  const q = new URLSearchParams();
  if (f.fournisseurId) q.set('fournisseur', f.fournisseurId);
  if (f.projetId) q.set('projet', f.projetId);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function aDesFiltres(f: FiltresDepenses): boolean {
  return f.fournisseurId !== null || f.projetId !== null;
}

/** Options du filtre fournisseur : fiches seulement, dans l'ordre de l'API. */
export function optionsFiltreFournisseur(
  entries: readonly TreasurySupplierEntry[],
): FournisseurDepense[] {
  return entries
    .filter((e): e is TreasurySupplierEntry & { supplierId: string } => e.supplierId !== null)
    .map((e) => ({ name: e.name, supplierId: e.supplierId }));
}

/**
 * Nom à afficher pour une fiche filtrée arrivée par l'URL : celui d'une dépense déjà
 * chargée de cette fiche (nom courant rendu par l'API), sinon un libellé neutre.
 */
export function nomFicheFiltree(
  supplierId: string,
  depenses: readonly { supplierId?: string | null; supplierName: string | null }[],
): string {
  const d = depenses.find((x) => x.supplierId === supplierId && x.supplierName);
  return d?.supplierName ?? 'Fiche fournisseur choisie';
}

/**
 * Période interrogée : le mois affiché, ou toutes les dates (« Tous les mois »), utile
 * pour « toutes les dépenses d'un fournisseur ou d'un projet ».
 */
export function periodeListe(
  mois: string,
  tousLesMois: boolean,
  finDeMois: (m: string) => string,
): { from?: string; to?: string } {
  return tousLesMois ? {} : { from: `${mois}-01`, to: finDeMois(mois) };
}
