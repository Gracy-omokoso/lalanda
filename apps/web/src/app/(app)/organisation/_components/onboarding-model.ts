// Logique pure de la mise en route d'une organisation (ADR-0030 § 8).
//
// La progression n'a AUCUN état serveur propre : elle se DÉDUIT des données que
// les étapes enregistrent déjà (identité visuelle, fiche fiscale, points de
// vente). C'est ce qui rend le parcours reprenable sur n'importe quel appareil
// sans nouvelle API, et ce qui l'empêche de mentir : une étape « faite » l'est
// parce que la donnée existe, pas parce qu'on a cliqué « suivant ».
//
// Seule exception, l'étape 4 (choix des modules) : faute d'API, le choix vit
// dans le navigateur (décision D3 de l'ADR-0030).

import type { BrandView, FiscalProfileView, NormalizedInvoicingView, OrgAction } from '@/lib/api';

export type EtapeId = 'identite' | 'fiscal' | 'points-de-vente' | 'modules';

export interface Etape {
  id: EtapeId;
  label: string;
  /** Pourquoi cette étape, en une phrase, du côté de l'utilisateur. */
  pourquoi: string;
  /** Action exigée par l'API qui l'alimente, ou `null`. */
  action: OrgAction | null;
  /** Qui peut la faire, pour l'expliquer à un rôle qui ne le peut pas. */
  quiPeut: string;
}

export const ETAPES: readonly Etape[] = [
  {
    id: 'identite',
    label: 'Identité visuelle',
    pourquoi: 'Votre logo, vos couleurs et votre police habillent vos factures et vos documents.',
    action: 'organization.manage',
    quiPeut: 'un Propriétaire ou un Administrateur',
  },
  {
    id: 'fiscal',
    label: 'Profil fiscal',
    pourquoi: 'Raison sociale, NIF, RCCM et siège : les mentions obligatoires de chaque facture.',
    action: 'fiscal.manage',
    quiPeut: 'un Propriétaire ou un Directeur financier',
  },
  {
    id: 'points-de-vente',
    label: 'Points de vente',
    pourquoi:
      'Les points de vente e-MCF reçoivent vos factures normalisées par la DGI. Vous pouvez commencer en mode test.',
    action: 'fiscal.manage',
    quiPeut: 'un Propriétaire ou un Directeur financier',
  },
  {
    id: 'modules',
    label: 'Vos modules',
    pourquoi:
      'Choisissez par quoi vous commencez. Votre navigation s’adapte ; rien n’est verrouillé.',
    action: null,
    quiPeut: 'tout membre',
  },
];

/**
 * Ce que l'on sait d'une étape :
 * - `true` / `false` : faite ou non, lu sur le serveur ;
 * - `'refus'` : l'étape n'est pas ouverte au rôle (403/404 ou action absente) ;
 * - `null` : pas encore lu, ou lecture en échec — inconnu, jamais « faite ».
 */
export type FaitEtape = boolean | 'refus' | null;

export type FaitsMiseEnRoute = Record<EtapeId, FaitEtape>;

export const FAITS_INCONNUS: FaitsMiseEnRoute = {
  identite: null,
  fiscal: null,
  'points-de-vente': null,
  modules: null,
};

/** Identité faite : un logo principal OU une couleur principale enregistrés. */
export function identiteFaite(brand: BrandView): boolean {
  return brand.logos.primary !== null || brand.primaryColor !== null;
}

/** Profil fiscal fait : une fiche existe (le serveur a validé ses champs obligatoires). */
export function fiscalFait(vue: FiscalProfileView): boolean {
  return vue.profile !== null;
}

/** Points de vente faits : au moins un, en test ou en production. */
export function pointsDeVenteFaits(vue: NormalizedInvoicingView): boolean {
  return vue.pointsOfSale.length > 0;
}

/**
 * Faits qu'on peut établir SANS appel, depuis les actions du rôle : une étape
 * dont l'action manque est un refus. Évite trois appels voués au 403.
 */
export function refusDepuisActions(
  actions: readonly OrgAction[] | null,
): Partial<FaitsMiseEnRoute> {
  if (actions === null) return {};
  const refus: Partial<FaitsMiseEnRoute> = {};
  for (const e of ETAPES) {
    if (e.action !== null && !actions.includes(e.action)) refus[e.id] = 'refus';
  }
  return refus;
}

/** Étapes qui comptent dans la progression : celles ouvertes au rôle. */
export function etapesApplicables(faits: FaitsMiseEnRoute): Etape[] {
  return ETAPES.filter((e) => faits[e.id] !== 'refus');
}

export function progression(faits: FaitsMiseEnRoute): { faites: number; total: number } {
  const applicables = etapesApplicables(faits);
  return {
    faites: applicables.filter((e) => faits[e.id] === true).length,
    total: applicables.length,
  };
}

/** Le parcours est-il terminé ? Une étape inconnue n'est PAS terminée. */
export function termine(faits: FaitsMiseEnRoute): boolean {
  const { faites, total } = progression(faits);
  return faites === total;
}

/**
 * Où reprendre : la première étape ouverte au rôle et non faite. Si tout est
 * fait, la dernière — on rouvre le parcours sur son récapitulatif naturel.
 */
export function etapeDeReprise(faits: FaitsMiseEnRoute): EtapeId {
  const ouverte = ETAPES.find((e) => faits[e.id] !== 'refus' && faits[e.id] !== true);
  return ouverte?.id ?? 'modules';
}

/** Étape demandée par l'URL (`?etape=`), ou `null` si absente ou inconnue. */
export function etapeDepuisParam(param: string | null): EtapeId | null {
  return ETAPES.some((e) => e.id === param) ? (param as EtapeId) : null;
}

export function etapeSuivante(id: EtapeId): EtapeId | null {
  const i = ETAPES.findIndex((e) => e.id === id);
  return ETAPES[i + 1]?.id ?? null;
}

export function etapePrecedente(id: EtapeId): EtapeId | null {
  const i = ETAPES.findIndex((e) => e.id === id);
  return i > 0 ? ETAPES[i - 1]!.id : null;
}

export type EtatAffiche = 'done' | 'current' | 'todo' | 'locked';

/** État affiché de chaque étape dans l'indicateur, l'étape ouverte primant. */
export function etatsAffiches(
  faits: FaitsMiseEnRoute,
  courante: EtapeId,
): Array<{ etape: Etape; etat: EtatAffiche }> {
  return ETAPES.map((etape) => ({
    etape,
    etat:
      etape.id === courante
        ? 'current'
        : faits[etape.id] === 'refus'
          ? 'locked'
          : faits[etape.id] === true
            ? 'done'
            : 'todo',
  }));
}

export const MISE_EN_ROUTE_BASE = '/organisation/mise-en-route';

export function lienEtape(id: EtapeId): string {
  return `${MISE_EN_ROUTE_BASE}?etape=${id}`;
}
