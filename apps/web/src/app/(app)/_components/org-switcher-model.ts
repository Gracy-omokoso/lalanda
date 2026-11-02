// Modèle pur du sélecteur d'organisation et de la fenêtre de création (ADR-0052 — O1).
//
// « Nouvelle organisation, c'est nouvelle entreprise » : la fenêtre demande le minimum
// (nom, pays, type, § 5), le dit en une phrase, puis mène à la mise en route. Le sélecteur
// affiche l'organisation que l'API SERT (F2) et, pour chacune, le rôle et l'avancement de
// sa mise en route. Aucune règle fiscale n'est posée ici : le seul avertissement repris
// est celui d'ADR-0021 R1 (facture normalisée : siège en RDC).

import type { OrganizationSetupProgressView, OrganizationType, OrganizationView } from '@/lib/api';

export const PHRASE_NOUVELLE_ORGANISATION =
  'Une organisation est une entreprise distincte : elle commence vide, avec ses propres fiche fiscale, clients, comptes et membres.';

export const AVERTISSEMENT_PAYS_HORS_RDC =
  'La facture normalisée DGI n’est disponible que pour un siège en RDC.';

/** Pays proposés (ISO-2), la RDC d'abord (§ 5 : `CD` proposé). */
export const PAYS_CREATION: ReadonlyArray<{ code: string; libelle: string }> = [
  { code: 'CD', libelle: 'République démocratique du Congo' },
  { code: 'CG', libelle: 'République du Congo' },
  { code: 'AO', libelle: 'Angola' },
  { code: 'BE', libelle: 'Belgique' },
  { code: 'BI', libelle: 'Burundi' },
  { code: 'CM', libelle: 'Cameroun' },
  { code: 'CI', libelle: 'Côte d’Ivoire' },
  { code: 'FR', libelle: 'France' },
  { code: 'GA', libelle: 'Gabon' },
  { code: 'KE', libelle: 'Kenya' },
  { code: 'UG', libelle: 'Ouganda' },
  { code: 'CF', libelle: 'République centrafricaine' },
  { code: 'RW', libelle: 'Rwanda' },
  { code: 'SN', libelle: 'Sénégal' },
  { code: 'TZ', libelle: 'Tanzanie' },
  { code: 'TD', libelle: 'Tchad' },
  { code: 'ZM', libelle: 'Zambie' },
];

export const TYPES_ORGANISATION: ReadonlyArray<{ code: OrganizationType; libelle: string }> = [
  { code: 'solo', libelle: 'Entreprise ou indépendant' },
  { code: 'agence', libelle: 'Agence ou cabinet' },
  { code: 'incubateur', libelle: 'Incubateur' },
  { code: 'banque', libelle: 'Banque ou institution financière' },
  { code: 'ecole', libelle: 'École ou centre de formation' },
];

/** Après la création : la mise en route, à l'étape « Société » (critère 10). */
export const DESTINATION_APRES_CREATION = '/organisation/mise-en-route?etape=societe';

export interface FormulaireCreation {
  nom: string;
  pays: string;
  type: OrganizationType;
}

export const FORMULAIRE_CREATION_VIDE: FormulaireCreation = { nom: '', pays: 'CD', type: 'solo' };

/** Avertissement d'ADR-0021 R1 quand le pays n'est pas la RDC ; `null` sinon. */
export function avertissementPays(pays: string): string | null {
  return pays.trim().toUpperCase() === 'CD' ? null : AVERTISSEMENT_PAYS_HORS_RDC;
}

export type ResultatCreation =
  | { ok: true; corps: { name: string; pays: string; type: OrganizationType } }
  | { ok: false; erreur: string };

/** Valide la fenêtre et prépare le corps de `POST /organizations`. */
export function validerCreation(f: FormulaireCreation): ResultatCreation {
  const name = f.nom.trim();
  if (!name) return { ok: false, erreur: 'Donnez un nom à l’organisation.' };
  if (name.length > 100)
    return { ok: false, erreur: 'Le nom ne doit pas dépasser 100 caractères.' };
  const pays = f.pays.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(pays)) return { ok: false, erreur: 'Choisissez un pays.' };
  if (!TYPES_ORGANISATION.some((t) => t.code === f.type)) {
    return { ok: false, erreur: 'Choisissez un type d’organisation.' };
  }
  return { ok: true, corps: { name, pays, type: f.type } };
}

/**
 * Organisation à afficher (F2) : celle que l'API sert (`activeOrganizationId`), jamais
 * la première appartenance par ancienneté. Repli sur la première seulement si l'API n'en
 * a pas indiqué (réponse d'une ancienne version).
 */
export function organisationAffichee(
  organisations: readonly OrganizationView[],
  activeOrganizationId: string | null | undefined,
): OrganizationView | undefined {
  return organisations.find((o) => o.id === activeOrganizationId) ?? organisations[0];
}

/**
 * Le cookie doit-il être reposé ? Oui s'il manque ou désigne une autre organisation que
 * celle servie (appartenance retirée, cookie d'un autre compte) : l'étiquette et les
 * données doivent toujours dire la même chose.
 */
export function cookieARectifier(
  cookie: string | undefined,
  activeOrganizationId: string | null | undefined,
): boolean {
  return Boolean(activeOrganizationId) && cookie !== activeOrganizationId;
}

/** Ligne d'avancement : « Mise en route : 3 étapes sur 9 » ou « Mise en route terminée ». */
export function libelleAvancement(p: OrganizationSetupProgressView | undefined): string | null {
  if (!p || p.total <= 0) return null;
  if (p.done + p.deferred >= p.total) return 'Mise en route terminée';
  return `Mise en route : ${p.done} étape${p.done > 1 ? 's' : ''} sur ${p.total}`;
}

/** Ligne de détail d'une organisation dans le menu : rôle, puis avancement. */
export function detailOrganisation(
  o: Pick<OrganizationView, 'roleLabel'>,
  p: OrganizationSetupProgressView | undefined,
): string {
  const avancement = libelleAvancement(p);
  return avancement ? `${o.roleLabel} · ${avancement}` : o.roleLabel;
}
