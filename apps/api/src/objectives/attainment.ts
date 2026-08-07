// Taux d'atteinte des objectifs financiers (S18d — docs/01 + ADR-0011 contrat 4).
//
//   atteinte = valeur_observee / valeur_cible
//
// La « valeur observée » est lue dans le snapshot du DERNIER PLAN VALIDÉ
// (module plans/, lecture seule) — jamais recalculée, jamais ré-évaluée par le
// moteur. Le mapping objectif → ligne se fait par ID DE LIGNE du snapshot.
//
// Règle ADR-0011 (risque n°4) : si la ligne n'existe pas dans le snapshot
// (ex. `ca_annuel_5` sur un plan validé avant l'horizon 5 exercices de FIN-001),
// la réponse porte `atteinte: null` + `raison: 'LIGNE_INDISPONIBLE'`.
// JAMAIS 0, jamais une valeur inventée, jamais une 500.
//
// Le calcul vit ici, côté API (docs/26 : aucune règle financière dans un
// composant UI) ; le web se contente d'afficher `atteinte` et `statut`.

import type { EvaluationView } from '../evaluate/evaluation-view.js';
import type { ObjectiveKey } from './objectives.dto.js';

/** `indisponible` n'est pas un jugement de performance : la mesure n'existe pas. */
export type AttainmentStatut = 'atteint' | 'partiel' | 'non_atteint' | 'indisponible';

export type AttainmentRaison = 'LIGNE_INDISPONIBLE';

export interface ObjectiveAttainment {
  objectif: ObjectiveKey;
  label: string;
  /** Cible saisie par l'utilisateur. */
  cible: number;
  /** Id de la ligne du snapshot retenue comme valeur observée, `null` si absente. */
  lineId: string | null;
  /** Valeur observée dans le snapshot du plan validé, `null` si la ligne est absente. */
  valeur: number | null;
  /** Taux d'atteinte en %, arrondi à 0,1. `null` = non mesurable (jamais 0 par défaut). */
  atteinte: number | null;
  statut: AttainmentStatut;
  /** Renseignée uniquement quand `atteinte` est `null`. */
  raison: AttainmentRaison | null;
}

/**
 * Mapping objectif → id de ligne attendu dans le snapshot d'un plan validé.
 *
 * Ids conformes aux conventions moteur (ADR-0011 contrat 2) : séries annuelles
 * suffixées `_annuel_N`. Les templates S6–S14 projettent 3 exercices — les
 * objectifs à 5 ans restent donc `LIGNE_INDISPONIBLE` tant que FIN-001 (K)
 * n'est pas mergé, puis s'activent seuls sans changement de code ici.
 */
export const OBJECTIVE_LINES: Record<ObjectiveKey, { label: string; lineId: string }> = {
  ca_cible_an1: { label: "Chiffre d'affaires à 1 an", lineId: 'ca_annuel_1' },
  ca_cible_an5: { label: "Chiffre d'affaires à 5 ans", lineId: 'ca_annuel_5' },
  resultat_net_cible_an1: { label: 'Résultat net à 1 an', lineId: 'resultat_annuel_1' },
  resultat_net_cible_an5: { label: 'Résultat net à 5 ans', lineId: 'resultat_annuel_5' },
  tresorerie_cible: { label: 'Trésorerie (fin de 1re année)', lineId: 'tresorerie_fin_m12' },
};

/**
 * Seuil produit séparant « partiel » de « non atteint ».
 * Provisoire : docs/01 renvoie les seuils exacts à la spécification des
 * diagnostics (docs/10). Il est exposé dans la réponse pour rester lisible.
 */
export const PARTIAL_THRESHOLD_PCT = 80;

/**
 * Taux d'atteinte en % (arrondi à 0,1).
 *
 * Cible nulle : le ratio n'a pas de sens mathématique, mais l'objectif « ne pas
 * descendre sous 0 » est vérifiable — atteint si la valeur observée est ≥ 0.
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
 *
 * Les objectifs non renseignés sont ignorés (aucune entrée) ; ceux dont la
 * ligne source manque au snapshot sont renvoyés avec `atteinte: null`.
 */
export function computeAttainment(
  objectives: Partial<Record<ObjectiveKey, number | undefined>>,
  result: EvaluationView,
): ObjectiveAttainment[] {
  const byLineId = new Map(result.lines.map((l) => [l.lineId, l]));
  const attainments: ObjectiveAttainment[] = [];

  for (const [key, meta] of Object.entries(OBJECTIVE_LINES) as [
    ObjectiveKey,
    { label: string; lineId: string },
  ][]) {
    const cible = objectives[key];
    if (cible === undefined || cible === null) continue;

    const line = byLineId.get(meta.lineId);
    if (!line) {
      attainments.push({
        objectif: key,
        label: meta.label,
        cible,
        lineId: null,
        valeur: null,
        atteinte: null,
        statut: 'indisponible',
        raison: 'LIGNE_INDISPONIBLE',
      });
      continue;
    }

    const atteinte = computeTauxPct(cible, line.value);
    attainments.push({
      objectif: key,
      label: meta.label,
      cible,
      lineId: line.lineId,
      valeur: line.value,
      atteinte,
      statut: statutFromTaux(atteinte),
      raison: null,
    });
  }

  return attainments;
}
