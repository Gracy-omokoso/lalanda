// Fournisseur d'une dépense directe — ADR-0075 (A), décision de Gracy du 13 nov. 2026.
//
// La dépense se relie à la FICHE fournisseur (`supplierId`) quand elle existe ; un
// fournisseur occasionnel reste un nom libre (achats informels, fréquents en RDC).
// Fonctions PURES : options proposées par le sélecteur et champs envoyés à l'API.

import type { TreasurySupplierEntry } from '@/lib/treasury-api';

/** Choix du sélecteur : une fiche (`supplierId`), ou un nom libre (`supplierId: null`). */
export interface FournisseurDepense {
  name: string;
  supplierId: string | null;
  /** Nom tapé à l'instant, jamais saisi auparavant (option « fournisseur de passage »). */
  nouveau?: boolean;
}

/** Clé de comparaison : minuscules, sans accents ni espaces superflus. */
export function cleFournisseur(nom: string): string {
  return nom
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Options : celles de l'API (fiches d'abord, puis noms libres déjà saisis), plus le
 * texte tapé comme « fournisseur de passage » s'il ne correspond à aucune d'elles.
 * Un nom identique à une fiche n'est pas proposé en texte libre : c'est la fiche qui
 * est proposée (rattachement SUGGÉRÉ, jamais imposé ni réécrit en base).
 */
export function optionsFournisseur(
  entries: readonly TreasurySupplierEntry[],
  saisie: string,
): FournisseurDepense[] {
  const options: FournisseurDepense[] = entries.map((e) => ({
    name: e.name,
    supplierId: e.supplierId,
  }));
  const nom = saisie.trim().slice(0, 120);
  if (nom !== '' && !options.some((o) => cleFournisseur(o.name) === cleFournisseur(nom))) {
    options.push({ name: nom, supplierId: null, nouveau: true });
  }
  return options;
}

export function cleOption(f: FournisseurDepense): string {
  return f.supplierId ? `fiche:${f.supplierId}` : `texte:${cleFournisseur(f.name)}`;
}

export function descriptionFournisseur(f: FournisseurDepense): string {
  if (f.supplierId) return 'Fiche fournisseur';
  return f.nouveau ? 'Fournisseur de passage (nom libre)' : 'Déjà saisi, sans fiche';
}

/**
 * Champs envoyés : fiche → `supplierId` (l'API reprend le nom de la fiche) ; nom
 * libre → `supplierName` seul, sans `supplierId`, pour garder la règle de l'API
 * (rattachement par clé exacte d'une fiche fusionnée, ADR-0044) ; aucun choix →
 * ni nom ni fiche.
 */
export function champsFournisseur(f: FournisseurDepense | null): {
  supplierName: string | null;
  supplierId?: string | null;
} {
  if (f === null) return { supplierName: null, supplierId: null };
  if (f.supplierId) return { supplierName: f.name, supplierId: f.supplierId };
  return { supplierName: f.name };
}
