// Feuille amortissements SYSCOHADA révisé (AUDCIF 2017) — méthode linéaire.
//
// Source des durées standard :
// - AUDCIF 2017 (Acte Uniforme SYSCOHADA relatif au droit comptable et à l'information financière),
//   Titre I chapitre 3, articles relatifs aux immobilisations amortissables.
// - Guide d'application SYSCOHADA révisé, tables sectorielles indicatives.
//
// AVERTISSEMENT : ces durées sont des valeurs indicatives conformes aux usages
// du référentiel SYSCOHADA. Un dossier bancaire officiel doit faire valider les
// durées retenues par un expert-comptable local, en particulier lorsque la nature
// de l'actif permet une plage (matériel : 5-10 ans, transport : 4-5 ans).
//
// Portée S14c :
// - méthode linéaire uniquement ;
// - prorata temporis à la 1re année (base 12 mois) ;
// - VNC = brut − cumul dotations ; s'arrête à la valeur résiduelle ;
// - horizon = `horizon_projection_annees` (défaut 5 depuis S18a).

import type { Immobilisation, CategorieImmobilisation } from '../dsl/schema.js';
import { EngineError } from '../dsl/errors.js';

/** Durées d'amortissement standard SYSCOHADA (années). Valeur par défaut par catégorie. */
export const DUREES_SYSCOHADA: Record<CategorieImmobilisation, number> = {
  constructions: 20,
  materiel_outillage: 10,
  materiel_transport: 5,
  materiel_informatique: 3,
  mobilier_bureau: 10,
  amenagements: 10,
  logiciels: 3,
};

/** Étiquettes lisibles FR pour chaque catégorie. */
export const LABELS_CATEGORIE: Record<CategorieImmobilisation, string> = {
  constructions: 'Constructions',
  materiel_outillage: 'Matériel et outillage',
  materiel_transport: 'Matériel de transport',
  materiel_informatique: 'Matériel informatique',
  mobilier_bureau: 'Mobilier de bureau',
  amenagements: 'Aménagements, agencements, installations',
  logiciels: 'Logiciels',
};

/** Ligne d'amortissement calculée pour une immobilisation. */
export interface LigneAmortissement {
  readonly label: string;
  readonly categorie: CategorieImmobilisation;
  readonly montant_ht: number;
  readonly valeur_residuelle: number;
  readonly duree_annees: number;
  readonly date_acquisition: string;
  /** Prorata temporis 1re année (fraction de 12), calculé une fois. */
  readonly prorata_premiere_annee: number;
  /** Dotation par année (index 0 = année 1, ..., n-1 = année n). */
  readonly dotations: readonly number[];
  /** Valeur nette comptable à la fin de chaque année. */
  readonly vnc: readonly number[];
}

/** Résultat complet de la feuille amortissements. */
export interface FeuilleAmortissements {
  readonly horizon_annees: number;
  readonly lignes: readonly LigneAmortissement[];
  /** Total DAP par année (somme de toutes les immobilisations). */
  readonly dap_par_annee: readonly number[];
  /** VNC totale par année (somme). */
  readonly vnc_par_annee: readonly number[];
}

/**
 * Calcule la feuille amortissements à partir d'une liste d'immobilisations.
 * L'année 1 correspond à l'année de la première acquisition (mois de départ = mois d'acquisition).
 * Pour simplifier, on considère que l'année 1 = année civile de l'acquisition la plus ancienne.
 */
export function calculerAmortissements(
  immobilisations: readonly Immobilisation[],
  horizonAnnees: number,
): FeuilleAmortissements {
  if (!Number.isInteger(horizonAnnees) || horizonAnnees < 1 || horizonAnnees > 30) {
    throw new EngineError('INVALID_FORMULA', `Horizon amortissement invalide : ${horizonAnnees}`);
  }

  const lignes: LigneAmortissement[] = [];
  const dapParAnnee = new Array<number>(horizonAnnees).fill(0);
  const vncParAnnee = new Array<number>(horizonAnnees).fill(0);

  // Année de référence = plus petite année d'acquisition (ou année courante par défaut).
  const anneesAcquisitions = immobilisations.map((i) => extractAnnee(i.date_acquisition));
  const anneeRef = anneesAcquisitions.length > 0 ? Math.min(...anneesAcquisitions) : 0;

  for (const immo of immobilisations) {
    const duree = immo.duree_annees ?? DUREES_SYSCOHADA[immo.categorie];
    const residuelle = immo.valeur_residuelle ?? 0;
    if (residuelle < 0 || residuelle >= immo.montant_ht) {
      throw new EngineError(
        'INVALID_FORMULA',
        `Valeur résiduelle invalide pour "${immo.label}" : doit être ≥ 0 et < montant_ht.`,
      );
    }
    const base = immo.montant_ht - residuelle;
    const dotationAnneePleine = base / duree;

    // Prorata temporis 1re année : (12 - mois_debut + 1) / 12
    // Ex. acquisition 1er juillet (mois 7) → 6 mois amortis → 6/12.
    // Convention : mois d'acquisition compte pour un mois entier (dotation dès mois M).
    const { annee: anneeAcq, mois: moisAcq } = extractDate(immo.date_acquisition);
    const decalageAnnees = anneeAcq - anneeRef;
    const prorata = (12 - moisAcq + 1) / 12; // acquisition mois 7 → (12-7+1)/12 = 6/12
    const dotationPremiereAnnee = dotationAnneePleine * prorata;

    const dotations: number[] = new Array(horizonAnnees).fill(0);
    const vnc: number[] = new Array(horizonAnnees).fill(0);

    // On génère les dotations à partir du décalage de l'immobilisation dans l'horizon.
    // idxAnnee = 0 correspond à l'année de référence (anneeRef).
    let cumul = 0;
    for (let i = 0; i < horizonAnnees; i++) {
      const anneeAmortissement = i - decalageAnnees; // 0 = 1re année d'amortissement
      let dotation = 0;
      if (anneeAmortissement === 0) {
        dotation = dotationPremiereAnnee;
      } else if (anneeAmortissement > 0 && anneeAmortissement < duree) {
        dotation = dotationAnneePleine;
      } else if (anneeAmortissement === duree) {
        // Dernière année : complète le reliquat lié au prorata (12 - prorata*12) mois restants.
        // Reste à amortir = base − cumul actuel.
        const resteAAmortir = base - cumul;
        dotation = Math.max(0, resteAAmortir);
      } else {
        dotation = 0;
      }
      // Sécurité : ne pas dépasser la base.
      if (cumul + dotation > base) dotation = Math.max(0, base - cumul);
      cumul += dotation;
      dotations[i] = dotation;
      // VNC = brut − cumul amortissements (avec résiduelle en plancher).
      vnc[i] = immo.montant_ht - cumul;
    }

    lignes.push({
      label: immo.label,
      categorie: immo.categorie,
      montant_ht: immo.montant_ht,
      valeur_residuelle: residuelle,
      duree_annees: duree,
      date_acquisition: immo.date_acquisition,
      prorata_premiere_annee: prorata,
      dotations,
      vnc,
    });

    for (let i = 0; i < horizonAnnees; i++) {
      dapParAnnee[i] = (dapParAnnee[i] ?? 0) + (dotations[i] ?? 0);
      vncParAnnee[i] = (vncParAnnee[i] ?? 0) + (vnc[i] ?? 0);
    }
  }

  return {
    horizon_annees: horizonAnnees,
    lignes,
    dap_par_annee: dapParAnnee,
    vnc_par_annee: vncParAnnee,
  };
}

/** Extrait l'année d'une date YYYY-MM-DD. */
function extractAnnee(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m)
    throw new EngineError(
      'INVALID_FORMULA',
      `Date d'acquisition invalide : "${date}" (attendu YYYY-MM-DD)`,
    );
  return Number.parseInt(m[1]!, 10);
}

/** Extrait année + mois (1-12) d'une date YYYY-MM-DD. */
function extractDate(date: string): { annee: number; mois: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m)
    throw new EngineError(
      'INVALID_FORMULA',
      `Date d'acquisition invalide : "${date}" (attendu YYYY-MM-DD)`,
    );
  return { annee: Number.parseInt(m[1]!, 10), mois: Number.parseInt(m[2]!, 10) };
}
