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

/**
 * (S18a, FIN-001) États financiers prévisionnels — BFR, CAF, bilan et seuil de
 * rentabilité par exercice.
 *
 * Ces mêmes chiffres sont DÉJÀ présents dans `lines` (feuilles `bilan`, `caf`,
 * `seuil_rentabilite` et lignes `pf_bfr_*`), qui restent le contrat de lecture
 * officiel : L et N lisent par `lineId` (ADR-0011 § Contrat 1). Cette structure
 * n'est qu'une commodité de présentation pour les tableaux matriciels du
 * dashboard (postes en lignes × exercices en colonnes), au même titre que
 * `amortissements` en S14c. Ajout strictement additif.
 */
export interface EtatsFinanciersView {
  horizonAnnees: number;
  ouverture: {
    actifImmobilise: number;
    actifCirculant: number;
    tresorerieActif: number;
    totalActif: number;
    capitauxPropres: number;
    dettesFinancieres: number;
    totalPassif: number;
    ecartEquilibre: number;
  };
  bilan: {
    annee: number;
    immobilisationsBrutes: number;
    amortissementsCumules: number;
    actifImmobilise: number;
    stocks: number;
    creancesClients: number;
    actifCirculant: number;
    tresorerieActif: number;
    totalActif: number;
    capitalApporte: number;
    resultatsCumules: number;
    capitauxPropres: number;
    dettesFinancieres: number;
    fournisseurs: number;
    dettesFiscalesSociales: number;
    totalPassif: number;
    ecartEquilibre: number;
    autonomieFinanciere: number;
  }[];
  bfr: {
    annee: number;
    stocks: number;
    creancesClients: number;
    dettesFournisseurs: number;
    dettesFiscalesSociales: number;
    bfr: number;
    variation: number;
    bfrJoursCa: number;
  }[];
  caf: {
    annee: number;
    resultatNet: number;
    dotationsAmortissements: number;
    caf: number;
  }[];
  seuilRentabilite: {
    annee: number;
    ca: number;
    chargesVariables: number;
    margeSurCoutsVariables: number;
    tauxMargeVariable: number;
    chargesFixes: number;
    caSeuil: number;
    pointMortMois: number;
    pointMortJours: number;
    margeSecurite: number;
  }[];
  echeancierDette: {
    annee: number;
    capitalRestantOuverture: number;
    remboursementCapital: number;
    interets: number;
    capitalRestantCloture: number;
  }[];
  /**
   * (S18a) Contrôle de cohérence des immobilisations. `statut: 'incoherent'`
   * signale que la base amortissable déclarée diffère des investissements portés
   * au bilan : les dotations sont alors plafonnées pour que l'actif immobilisé ne
   * puisse pas devenir négatif, et l'interface doit l'afficher en rouge.
   */
  coherenceImmobilisations: {
    baseBilan: number;
    baseDeclaree: number;
    ecart: number;
    statut: 'coherent' | 'incoherent';
    dotationsPlafonnees: boolean;
  };
}

/** Résultat d'évaluation sérialisable — la partie « chiffres » d'un EvaluateResponse. */
export interface EvaluationView {
  lines: EvaluatedLineView[];
  /** Absent si le template ne déclare pas d'immobilisations (S14c). */
  amortissements?: AmortissementsView;
  /** Absent si le template ne déclare pas `structure_financiere` (S18a). */
  etatsFinanciers?: EtatsFinanciersView;
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
    etatsFinanciers: result.etatsFinanciers
      ? {
          horizonAnnees: result.etatsFinanciers.horizon_annees,
          ouverture: {
            actifImmobilise: result.etatsFinanciers.ouverture.actif_immobilise,
            actifCirculant: result.etatsFinanciers.ouverture.actif_circulant,
            tresorerieActif: result.etatsFinanciers.ouverture.tresorerie_actif,
            totalActif: result.etatsFinanciers.ouverture.total_actif,
            capitauxPropres: result.etatsFinanciers.ouverture.capitaux_propres,
            dettesFinancieres: result.etatsFinanciers.ouverture.dettes_financieres,
            totalPassif: result.etatsFinanciers.ouverture.total_passif,
            ecartEquilibre: result.etatsFinanciers.ouverture.ecart_equilibre,
          },
          bilan: result.etatsFinanciers.bilan.map((b) => ({
            annee: b.annee,
            immobilisationsBrutes: b.immobilisations_brutes,
            amortissementsCumules: b.amortissements_cumules,
            actifImmobilise: b.actif_immobilise,
            stocks: b.stocks,
            creancesClients: b.creances_clients,
            actifCirculant: b.actif_circulant,
            tresorerieActif: b.tresorerie_actif,
            totalActif: b.total_actif,
            capitalApporte: b.capital_apporte,
            resultatsCumules: b.resultats_cumules,
            capitauxPropres: b.capitaux_propres,
            dettesFinancieres: b.dettes_financieres,
            fournisseurs: b.fournisseurs,
            dettesFiscalesSociales: b.dettes_fiscales_sociales,
            totalPassif: b.total_passif,
            ecartEquilibre: b.ecart_equilibre,
            autonomieFinanciere: b.autonomie_financiere,
          })),
          bfr: result.etatsFinanciers.bfr.map((b) => ({
            annee: b.annee,
            stocks: b.stocks,
            creancesClients: b.creances_clients,
            dettesFournisseurs: b.dettes_fournisseurs,
            dettesFiscalesSociales: b.dettes_fiscales_sociales,
            bfr: b.bfr,
            variation: b.variation,
            bfrJoursCa: b.bfr_jours_ca,
          })),
          caf: result.etatsFinanciers.caf.map((c) => ({
            annee: c.annee,
            resultatNet: c.resultat_net,
            dotationsAmortissements: c.dotations_amortissements,
            caf: c.caf,
          })),
          seuilRentabilite: result.etatsFinanciers.seuil_rentabilite.map((s) => ({
            annee: s.annee,
            ca: s.ca,
            chargesVariables: s.charges_variables,
            margeSurCoutsVariables: s.marge_sur_couts_variables,
            tauxMargeVariable: s.taux_marge_variable,
            chargesFixes: s.charges_fixes,
            caSeuil: s.ca_seuil,
            pointMortMois: s.point_mort_mois,
            pointMortJours: s.point_mort_jours,
            margeSecurite: s.marge_securite,
          })),
          echeancierDette: result.etatsFinanciers.echeancier_dette.map((d) => ({
            annee: d.annee,
            capitalRestantOuverture: d.capital_restant_ouverture,
            remboursementCapital: d.remboursement_capital,
            interets: d.interets,
            capitalRestantCloture: d.capital_restant_cloture,
          })),
          coherenceImmobilisations: {
            baseBilan: result.etatsFinanciers.coherence_immobilisations.base_bilan,
            baseDeclaree: result.etatsFinanciers.coherence_immobilisations.base_declaree,
            ecart: result.etatsFinanciers.coherence_immobilisations.ecart,
            statut: result.etatsFinanciers.coherence_immobilisations.statut,
            dotationsPlafonnees:
              result.etatsFinanciers.coherence_immobilisations.dotations_plafonnees,
          },
        }
      : undefined,
  };
}
