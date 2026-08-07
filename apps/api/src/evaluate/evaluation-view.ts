// Vue API d'un résultat moteur (`EvaluationResult` → JSON camelCase).
//
// Factorisée (S16c) pour être partagée entre :
//   - POST /projects/:id/evaluate (réponse live) ;
//   - le snapshot figé d'un plan validé (plans/plan.schema.ts) — les deux doivent
//     avoir exactement la même forme pour que « live » et « figé » soient comparables.

import type { EvaluationResult } from '@lalanda/engine';

export interface EvaluatedLineView {
  sheetId: string;
  lineId: string;
  label: string;
  formulaSource: string;
  value: number;
  format: 'money' | 'number' | 'percent';
  seuil?: {
    valeur: number;
    direction: 'min' | 'max';
    statut: 'vert' | 'orange' | 'rouge';
  };
}

export interface AmortissementsView {
  horizonAnnees: number;
  lignes: {
    label: string;
    categorie: string;
    montantHt: number;
    valeurResiduelle: number;
    dureeAnnees: number;
    dateAcquisition: string;
    prorataPremiereAnnee: number;
    dotations: number[];
    vnc: number[];
  }[];
  dapParAnnee: number[];
  vncParAnnee: number[];
}

/** Résultat d'évaluation sérialisable — la partie « chiffres » d'un EvaluateResponse. */
export interface EvaluationView {
  lines: EvaluatedLineView[];
  /** Absent si le template ne déclare pas d'immobilisations (S14c). */
  amortissements?: AmortissementsView;
}

export function toEvaluationView(result: EvaluationResult): EvaluationView {
  return {
    lines: result.lines.map((l) => ({
      sheetId: l.sheetId,
      lineId: l.lineId,
      label: l.label,
      formulaSource: l.formulaSource,
      value: l.value,
      format: l.format,
      seuil: l.seuil
        ? { valeur: l.seuil.valeur, direction: l.seuil.direction, statut: l.seuil.statut }
        : undefined,
    })),
    amortissements: result.amortissements
      ? {
          horizonAnnees: result.amortissements.horizon_annees,
          lignes: result.amortissements.lignes.map((li) => ({
            label: li.label,
            categorie: li.categorie,
            montantHt: li.montant_ht,
            valeurResiduelle: li.valeur_residuelle,
            dureeAnnees: li.duree_annees,
            dateAcquisition: li.date_acquisition,
            prorataPremiereAnnee: li.prorata_premiere_annee,
            dotations: [...li.dotations],
            vnc: [...li.vnc],
          })),
          dapParAnnee: [...result.amortissements.dap_par_annee],
          vncParAnnee: [...result.amortissements.vnc_par_annee],
        }
      : undefined,
  };
}
