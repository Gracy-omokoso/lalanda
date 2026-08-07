// Taux d'atteinte des objectifs financiers (S18d — docs/01 + docs/10 § Objectifs).
//
//   taux_atteinte = valeur_observee / valeur_cible   (docs/10)
//
// Ici la « valeur observée » est celle du DERNIER PLAN VALIDÉ (snapshot figé du
// module plans/ — jamais recalculée). Le mapping objectif → ligne se fait par id
// de ligne du snapshot : si la ligne n'existe pas dans le template du plan
// (ex. horizon 3 ans sans `ca_annuel_5`), l'objectif est déclaré non évaluable —
// on n'invente JAMAIS une valeur (docs/00 : pas de règle financière inventée).

import type { EvaluationView } from '../evaluate/evaluation-view.js';
import type { ObjectiveKey } from './objectives.dto.js';

export type AttainmentStatut = 'atteint' | 'partiel' | 'non_atteint';

export interface ObjectiveAttainment {
  objectif: ObjectiveKey;
  label: string;
  cible: number;
  /** Id de la ligne du snapshot utilisée comme valeur observée. */
  lineId: string;
  valeur_plan: number;
  taux_atteinte_pct: number;
  statut: AttainmentStatut;
}

export interface ObjectiveNotEvaluable {
  objectif: ObjectiveKey;
  label: string;
  cible: number;
  raison: 'LIGNE_INTROUVABLE';
  /** Ids de lignes cherchés dans le snapshot, par ordre de préférence. */
  lineIds: string[];
}

/**
 * Mapping objectif → ids de lignes candidats dans le snapshot d'un plan validé.
 * Ids observés dans les templates du moteur (feuilles `projection` et `tresorerie`) :
 * `ca_annuel_N`, `resultat_annuel_N`, `tresorerie_fin_m12`. Les templates actuels
 * projettent 3 ans — `ca_annuel_5` sera trouvé dès qu'un template l'exposera.
 */
export const OBJECTIVE_LINE_CANDIDATES: Record<
  ObjectiveKey,
  { label: string; lineIds: string[] }
> = {
  ca_cible_an1: { label: "Chiffre d'affaires à 1 an", lineIds: ['ca_annuel_1'] },
  ca_cible_an5: { label: "Chiffre d'affaires à 5 ans", lineIds: ['ca_annuel_5'] },
  resultat_net_cible_an1: { label: 'Résultat net à 1 an', lineIds: ['resultat_annuel_1'] },
  tresorerie_cible: { label: 'Trésorerie (fin année 1)', lineIds: ['tresorerie_fin_m12'] },
};

/** Seuil « partiel » (docs/10 : seuils configurés — ici défaut produit 80 %). */
export const PARTIAL_THRESHOLD_PCT = 80;

/**
 * Taux d'atteinte en % (arrondi à 0,1) — gère la cible nulle (docs/10 § Objectifs) :
 * une cible de 0 est atteinte dès que la valeur observée est ≥ 0.
 */
export function computeTauxPct(cible: number, valeur: number): number {
  if (cible === 0) return valeur >= 0 ? 100 : 0;
  return Math.round((valeur / cible) * 1000) / 10;
}

export function statutFromTaux(tauxPct: number): AttainmentStatut {
  if (tauxPct >= 100) return 'atteint';
  if (tauxPct >= PARTIAL_THRESHOLD_PCT) return 'partiel';
  return 'non_atteint';
}

/**
 * Compare les objectifs renseignés aux lignes du snapshot d'un plan validé.
 * Renvoie séparément les objectifs évaluables et ceux dont la ligne n'existe
 * pas dans ce template (jamais de valeur inventée).
 */
export function computeAttainment(
  objectives: Partial<Record<ObjectiveKey, number | undefined>>,
  result: EvaluationView,
): { objectifs: ObjectiveAttainment[]; non_evaluables: ObjectiveNotEvaluable[] } {
  const byLineId = new Map(result.lines.map((l) => [l.lineId, l]));
  const objectifs: ObjectiveAttainment[] = [];
  const non_evaluables: ObjectiveNotEvaluable[] = [];

  for (const [key, meta] of Object.entries(OBJECTIVE_LINE_CANDIDATES) as [
    ObjectiveKey,
    { label: string; lineIds: string[] },
  ][]) {
    const cible = objectives[key];
    if (cible === undefined || cible === null) continue;

    const line = meta.lineIds.map((id) => byLineId.get(id)).find((l) => l !== undefined);
    if (!line) {
      non_evaluables.push({
        objectif: key,
        label: meta.label,
        cible,
        raison: 'LIGNE_INTROUVABLE',
        lineIds: meta.lineIds,
      });
      continue;
    }

    const taux = computeTauxPct(cible, line.value);
    objectifs.push({
      objectif: key,
      label: meta.label,
      cible,
      lineId: line.lineId,
      valeur_plan: line.value,
      taux_atteinte_pct: taux,
      statut: statutFromTaux(taux),
    });
  }

  return { objectifs, non_evaluables };
}
