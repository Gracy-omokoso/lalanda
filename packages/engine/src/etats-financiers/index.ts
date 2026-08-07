// États financiers prévisionnels S18a (FIN-001) — BFR, CAF, bilan, seuil de rentabilité.
//
// Ce module est calculé HORS HyperFormula, comme la feuille `amortissements` (S14c) :
// il s'agit d'un déroulé pluriannuel (report de stocks d'un exercice sur l'autre) qui
// ne se prête pas au modèle « une ligne = une formule ponctuelle » du DSL.
//
// ── Invariant central (docs/07 § Invariants, docs/21 § Contrôles) ─────────────
// Actif = Passif à chaque exercice, SANS poste d'ajustement. L'égalité est
// obtenue par construction : la trésorerie de clôture est le déroulé du tableau
// de flux (méthode indirecte), pas un solde de bouclage.
//
//   Actif_N  = VNC_N + Stocks_N + Créances_N + Trésorerie_N
//   Passif_N = Capitaux propres_N + Dettes financières_N + Fournisseurs_N + DFS_N
//
//   VNC_N   = VNC_{N-1} − DAP_N
//   BFR_N   = Stocks_N + Créances_N − Fournisseurs_N − DFS_N
//   Tréso_N = Tréso_{N-1} + CAF_N − ΔBFR_N − Remboursement capital_N
//   CP_N    = CP_{N-1} + Résultat net_N
//   Dette_N = Dette_{N-1} − Remboursement capital_N
//   CAF_N   = Résultat net_N + DAP_N              (définition SYSCOHADA simplifiée)
//
// Démonstration (récurrence) : Actif_N − Passif_N
//   = (Actif_{N-1} − Passif_{N-1}) − DAP_N + CAF_N − Résultat net_N
//   = 0 − DAP_N + (RN_N + DAP_N) − RN_N = 0. ∎
//
// L'écart résiduel exposé par `bilan_ecart_equilibre_*` n'est donc que du bruit
// d'arrondi flottant (≪ 0,01). S'il devient significatif, c'est un bug de saisie
// des entrées, pas un défaut de modèle.
//
// ── Conventions retenues (à revalider par un expert-comptable) ────────────────
// 1. Année commerciale de 360 jours pour convertir les délais en montants
//    (usage constant de l'analyse financière francophone / SYSCOHADA).
// 2. Le résultat net du bilan = résultat du compte d'exploitation (déjà net d'IBP)
//    − dotations aux amortissements − intérêts d'emprunt. L'ÉCONOMIE D'IMPÔT
//    procurée par les dotations et les intérêts n'est PAS modélisée : l'IBP reste
//    celui assis sur l'EBE. Hypothèse volontairement PRUDENTE (résultat net minoré,
//    donc capitaux propres et trésorerie minorés) — à revalider par expert-comptable.
// 3. Dettes fiscales et sociales non modélisées à ce stade (l'IBP est supposé
//    réglé sur l'exercice). La ligne existe, à zéro, pour que le bilan reste
//    lisible et que l'ajout soit additif le jour où le décalage sera modélisé.
// 4. Les dettes fournisseurs sont assises sur les seuls achats variables ; les
//    charges fixes sont supposées réglées comptant. Hypothèse PRUDENTE (BFR majoré).
// 5. Immobilisations brutes = driver `investissements_initiaux` (pilotable par
//    l'utilisateur). La liste `immobilisations` du template ne sert qu'à calculer
//    les dotations. Un écart entre les deux est exposé par
//    `bilan_immobilisations_ecart_base_amortissable` — il ne rompt pas l'équilibre.
// 6. Le BFR d'ouverture vaut le driver `bfr_initial`, présenté en bloc (non ventilé
//    stocks/créances/fournisseurs) : c'est le fonds de roulement déployé au
//    lancement, cohérent avec la ligne existante `tresorerie_initiale`.
// 7. STRUCTURE DE COÛTS PROPORTIONNELLE. Les charges d'EXPLOITATION dites fixes
//    du seuil de rentabilité sont indexées sur le taux de croissance du CA, pas
//    sur l'inflation. Une charge indexée sur le CA n'est pas fixe au sens de
//    l'analyse de gestion : elle n'apporte AUCUN effet de levier opérationnel.
//    Neutraliser les dotations et les intérêts rend d'ailleurs `marge_securite`
//    exactement constante sur tout l'horizon (test dédié).
//    Le levier que le prévisionnel montre malgré tout provient uniquement des
//    dotations et des intérêts d'emprunt, seuls postes réellement fixes du
//    modèle : le seuil progresse un peu moins vite que le CA et le point mort se
//    raccourcit. L'effet réel est donc SOUS-ESTIMÉ, pas absent — lecture
//    prudente, mais qui ne doit pas être présentée comme une tendance.
//    Ce n'est pas un choix de confort : la feuille `projection` (S12-lite) pose
//    `resultat_annuel_N = resultat_annuel_1 × (1+g)^(N−1)`, donc une structure de
//    coûts entièrement proportionnelle. Indexer les charges fixes sur l'inflation
//    ici — et seulement ici — ferait diverger `CA_N − achats_N − charges fixes_N`
//    de l'EBE impliqué par `resultat_annuel_N` : le seuil de rentabilité et le
//    compte de résultat afficheraient deux structures de coûts incompatibles dans
//    le même dossier bancaire. Le vrai correctif est de distinguer croissance des
//    charges fixes et des charges variables DANS la projection elle-même, ce qui
//    revalorise `resultat_annuel_2..3` (lignes figées, non-régression) — ticket
//    séparé, cf. docs/07 § Limites connues.

import { EngineError } from '../dsl/errors.js';

/** Base de conversion des délais en montants : année commerciale de 360 jours. */
export const JOURS_ANNEE_COMMERCIALE = 360;

/** Entrées du calcul des états financiers — toutes déjà résolues et annualisées. */
export interface EntreesEtatsFinanciers {
  /** Nombre d'exercices projetés (5 pour FIN-001). */
  readonly horizonAnnees: number;
  /** Chiffre d'affaires par exercice (index 0 = exercice 1). */
  readonly caAnnuel: readonly number[];
  /**
   * Résultat net du compte d'exploitation par exercice — déjà net d'IBP,
   * mais AVANT dotations aux amortissements et AVANT intérêts d'emprunt.
   */
  readonly resultatAnnuel: readonly number[];
  /** Achats variables (matières / marchandises) par exercice. 0 si le modèle n'en a pas. */
  readonly achatsVariablesAnnuels: readonly number[];
  /** Charges fixes d'exploitation par exercice (hors dotations et hors intérêts). */
  readonly chargesFixesAnnuelles: readonly number[];
  /** Dotations aux amortissements par exercice (feuille `amortissements`). */
  readonly dapAnnuelle: readonly number[];
  /** Total des immobilisations brutes déclarées (Σ montant_ht) — contrôle seulement. */
  readonly immobilisationsBrutesDeclarees: number;

  readonly investissementsInitiaux: number;
  readonly bfrInitial: number;
  readonly apportCapital: number;
  readonly empruntCapital: number;
  readonly empruntTauxAnnuel: number;
  readonly empruntDureeMois: number;

  readonly delaiClientsJours: number;
  readonly delaiFournisseursJours: number;
  readonly rotationStockJours: number;
}

/** Échéancier de la dette pour un exercice. */
export interface ExerciceDette {
  readonly annee: number;
  /** Capital restant dû à l'ouverture de l'exercice. */
  readonly capital_restant_ouverture: number;
  /** Capital remboursé sur l'exercice. */
  readonly remboursement_capital: number;
  /** Intérêts payés sur l'exercice. */
  readonly interets: number;
  /** Capital restant dû à la clôture. */
  readonly capital_restant_cloture: number;
}

/** Besoin en fonds de roulement pour un exercice. */
export interface ExerciceBfr {
  readonly annee: number;
  readonly stocks: number;
  readonly creances_clients: number;
  readonly dettes_fournisseurs: number;
  readonly dettes_fiscales_sociales: number;
  readonly bfr: number;
  /** BFR_N − BFR_{N-1} (BFR_0 = `bfrInitial`). Positif = besoin de trésorerie. */
  readonly variation: number;
  /** BFR exprimé en jours de chiffre d'affaires. 0 si CA nul. */
  readonly bfr_jours_ca: number;
}

/** Capacité d'autofinancement pour un exercice. */
export interface ExerciceCaf {
  readonly annee: number;
  /** Résultat net après dotations et intérêts (celui qui alimente les capitaux propres). */
  readonly resultat_net: number;
  readonly dotations_amortissements: number;
  /** CAF = résultat net + dotations. */
  readonly caf: number;
}

/** Bilan prévisionnel d'un exercice. */
export interface ExerciceBilan {
  readonly annee: number;
  // ── Actif ──
  readonly immobilisations_brutes: number;
  readonly amortissements_cumules: number;
  /** Immobilisations nettes (VNC) = brutes − amortissements cumulés. */
  readonly actif_immobilise: number;
  readonly stocks: number;
  readonly creances_clients: number;
  /** Actif circulant = stocks + créances. */
  readonly actif_circulant: number;
  readonly tresorerie_actif: number;
  readonly total_actif: number;
  // ── Passif ──
  readonly capital_apporte: number;
  readonly resultats_cumules: number;
  readonly capitaux_propres: number;
  readonly dettes_financieres: number;
  readonly fournisseurs: number;
  readonly dettes_fiscales_sociales: number;
  readonly total_passif: number;
  // ── Contrôle ──
  /** Actif − Passif. Doit être nul à la tolérance d'arrondi (invariant docs/07). */
  readonly ecart_equilibre: number;
  /** Capitaux propres / total passif. 0 si total nul. */
  readonly autonomie_financiere: number;
}

/** Bilan d'ouverture (avant le premier exercice). */
export interface BilanOuverture {
  readonly actif_immobilise: number;
  /** BFR déployé au lancement, non ventilé (cf. convention 6). */
  readonly actif_circulant: number;
  readonly tresorerie_actif: number;
  readonly total_actif: number;
  readonly capitaux_propres: number;
  readonly dettes_financieres: number;
  readonly total_passif: number;
  readonly ecart_equilibre: number;
}

/** Seuil de rentabilité d'un exercice. */
export interface ExerciceSeuil {
  readonly annee: number;
  readonly ca: number;
  readonly charges_variables: number;
  readonly marge_sur_couts_variables: number;
  /** (CA − charges variables) / CA. 0 si CA nul. */
  readonly taux_marge_variable: number;
  /** Charges fixes retenues = charges fixes d'exploitation + dotations + intérêts. */
  readonly charges_fixes: number;
  /** CA au point mort = charges fixes / taux de marge variable. 0 si taux ≤ 0. */
  readonly ca_seuil: number;
  /** Point mort en mois d'activité (12 × CA seuil / CA). 0 si CA nul. */
  readonly point_mort_mois: number;
  /** Point mort en jours (360 × CA seuil / CA). 0 si CA nul. */
  readonly point_mort_jours: number;
  /** Marge de sécurité = (CA − CA seuil) / CA. 0 si CA nul. */
  readonly marge_securite: number;
}

/** Résultat complet du bloc états financiers. */
export interface EtatsFinanciers {
  readonly horizon_annees: number;
  readonly ouverture: BilanOuverture;
  readonly echeancier_dette: readonly ExerciceDette[];
  readonly bfr: readonly ExerciceBfr[];
  readonly caf: readonly ExerciceCaf[];
  readonly bilan: readonly ExerciceBilan[];
  readonly seuil_rentabilite: readonly ExerciceSeuil[];
  /**
   * Écart entre les immobilisations brutes retenues au bilan (driver
   * `investissements_initiaux`) et la base amortissable déclarée (Σ montant_ht).
   * N'affecte pas l'équilibre du bilan (cf. convention 5), mais un écart non nul
   * signale une incohérence de saisie — voir `coherence_immobilisations`.
   */
  readonly ecart_base_amortissable: number;
  /** Contrôle de cohérence entre le driver d'investissement et la base amortissable. */
  readonly coherence_immobilisations: CoherenceImmobilisations;
}

/**
 * Contrôle de cohérence des immobilisations.
 *
 * Le bilan retient comme immobilisations brutes le driver
 * `investissements_initiaux` (pilotable par l'utilisateur), tandis que les
 * dotations viennent de la liste `immobilisations` du template. Si la base
 * déclarée dépasse le driver, l'amortissement cumulé finirait par excéder la
 * valeur brute et l'actif immobilisé passerait SOUS ZÉRO — une absurdité sur un
 * bilan bancaire, que l'équilibre comptable ne détecte pas (la trésorerie
 * absorbe l'écart via la CAF).
 *
 * Le cumul des dotations est donc plafonné à la valeur brute (`dotations_plafonnees`)
 * et l'incohérence est signalée explicitement pour affichage en rouge.
 */
export interface CoherenceImmobilisations {
  /** Immobilisations brutes retenues au bilan (driver). */
  readonly base_bilan: number;
  /** Base amortissable déclarée par le template (Σ montant_ht). */
  readonly base_declaree: number;
  /** `base_bilan − base_declaree`. */
  readonly ecart: number;
  readonly statut: 'coherent' | 'incoherent';
  /**
   * `true` si le plafonnement a effectivement joué sur au moins un exercice,
   * c'est-à-dire si les dotations auraient amorti au-delà de la valeur brute.
   */
  readonly dotations_plafonnees: boolean;
}

/** En deçà de ce montant, un écart de base amortissable est du bruit d'arrondi. */
const TOLERANCE_BASE_AMORTISSABLE = 0.005;

/** Bruit d'arrondi flottant admis sur les intérêts d'un échéancier. */
const TOLERANCE_ECHEANCIER = 1e-6;

/**
 * Calcule le bloc complet des états financiers prévisionnels sur `horizonAnnees`
 * exercices. Aucun poste d'ajustement : l'équilibre du bilan est démontré en tête
 * de fichier et vérifié par les tests d'invariant.
 */
export function calculerEtatsFinanciers(entrees: EntreesEtatsFinanciers): EtatsFinanciers {
  const n = entrees.horizonAnnees;
  if (!Number.isInteger(n) || n < 1 || n > 30) {
    throw new EngineError('INVALID_FORMULA', `Horizon états financiers invalide : ${n}`);
  }

  // Les séries d'exploitation DOIVENT couvrir tout l'horizon. Un repli silencieux
  // sur 0 produirait des exercices vides d'apparence plausible (bilan équilibré,
  // CA nul) sans que personne ne s'en aperçoive — on échoue explicitement.
  // `dapAnnuelle` fait exception : un template sans immobilisations n'a
  // légitimement aucune dotation, la série est alors complétée par des zéros.
  for (const [nom, serie] of [
    ['caAnnuel', entrees.caAnnuel],
    ['resultatAnnuel', entrees.resultatAnnuel],
    ['achatsVariablesAnnuels', entrees.achatsVariablesAnnuels],
    ['chargesFixesAnnuelles', entrees.chargesFixesAnnuelles],
  ] as const) {
    if (serie.length < n) {
      throw new EngineError(
        'INVALID_FORMULA',
        `États financiers : la série "${nom}" couvre ${serie.length} exercice(s) alors que l'horizon en demande ${n}.`,
      );
    }
  }

  const echeancier = calculerEcheancierDette(
    entrees.empruntCapital,
    entrees.empruntTauxAnnuel,
    entrees.empruntDureeMois,
    n,
  );

  // ── Bilan d'ouverture ──────────────────────────────────────
  // Trésorerie d'ouverture = ressources − emplois durables − BFR déployé.
  // Identique à la ligne DSL existante `tresorerie_initiale` (non-régression).
  const tresorerieOuverture =
    entrees.apportCapital +
    entrees.empruntCapital -
    entrees.investissementsInitiaux -
    entrees.bfrInitial;
  const totalActifOuverture =
    entrees.investissementsInitiaux + entrees.bfrInitial + tresorerieOuverture;
  const totalPassifOuverture = entrees.apportCapital + entrees.empruntCapital;
  const ouverture: BilanOuverture = {
    actif_immobilise: entrees.investissementsInitiaux,
    actif_circulant: entrees.bfrInitial,
    tresorerie_actif: tresorerieOuverture,
    total_actif: totalActifOuverture,
    capitaux_propres: entrees.apportCapital,
    dettes_financieres: entrees.empruntCapital,
    total_passif: totalPassifOuverture,
    ecart_equilibre: totalActifOuverture - totalPassifOuverture,
  };

  // ── Déroulé des exercices ──────────────────────────────────
  const bfr: ExerciceBfr[] = [];
  const caf: ExerciceCaf[] = [];
  const bilan: ExerciceBilan[] = [];
  const seuil: ExerciceSeuil[] = [];

  let bfrPrecedent = entrees.bfrInitial;
  let tresorerie = tresorerieOuverture;
  let amortissementsCumules = 0;
  let resultatsCumules = 0;
  let dotationsPlafonnees = false;

  // Plafond d'amortissement : on ne peut pas amortir au-delà de la valeur brute
  // inscrite au bilan. Négatif impossible (le driver est borné à 0 côté DSL).
  const baseAmortissableBilan = Math.max(0, entrees.investissementsInitiaux);

  for (let i = 0; i < n; i++) {
    const annee = i + 1;
    const ca = at(entrees.caAnnuel, i);
    const achats = at(entrees.achatsVariablesAnnuels, i);
    const chargesFixesExploitation = at(entrees.chargesFixesAnnuelles, i);
    const dette = echeancier[i]!;

    // — Dotation retenue (plafonnée, cf. CoherenceImmobilisations) —
    // La dotation effectivement passée est la variation du cumul plafonné : elle
    // reste donc cohérente avec la VNC, ce qui préserve l'invariant d'équilibre
    // (VNC_N = VNC_{N−1} − dotation retenue_N) même en cas de saisie incohérente.
    const dapDeclaree = at(entrees.dapAnnuelle, i);
    const cumulPlafonne = Math.min(amortissementsCumules + dapDeclaree, baseAmortissableBilan);
    const dap = Math.max(0, cumulPlafonne - amortissementsCumules);
    if (dap < dapDeclaree - TOLERANCE_BASE_AMORTISSABLE) dotationsPlafonnees = true;

    // — BFR —
    const stocks = (achats * entrees.rotationStockJours) / JOURS_ANNEE_COMMERCIALE;
    const creances = (ca * entrees.delaiClientsJours) / JOURS_ANNEE_COMMERCIALE;
    const fournisseurs = (achats * entrees.delaiFournisseursJours) / JOURS_ANNEE_COMMERCIALE;
    const dettesFiscalesSociales = 0; // cf. convention 3
    const bfrExercice = stocks + creances - fournisseurs - dettesFiscalesSociales;
    const variationBfr = bfrExercice - bfrPrecedent;
    bfr.push({
      annee,
      stocks,
      creances_clients: creances,
      dettes_fournisseurs: fournisseurs,
      dettes_fiscales_sociales: dettesFiscalesSociales,
      bfr: bfrExercice,
      variation: variationBfr,
      bfr_jours_ca: ca === 0 ? 0 : (bfrExercice / ca) * JOURS_ANNEE_COMMERCIALE,
    });

    // — Résultat net et CAF —
    // Résultat d'exploitation net d'IBP, diminué des dotations et des intérêts.
    const resultatNet = at(entrees.resultatAnnuel, i) - dap - dette.interets;
    const cafExercice = resultatNet + dap;
    caf.push({
      annee,
      resultat_net: resultatNet,
      dotations_amortissements: dap,
      caf: cafExercice,
    });

    // — Trésorerie (tableau de flux, méthode indirecte) —
    tresorerie = tresorerie + cafExercice - variationBfr - dette.remboursement_capital;

    // — Bilan —
    amortissementsCumules += dap;
    resultatsCumules += resultatNet;
    const actifImmobilise = entrees.investissementsInitiaux - amortissementsCumules;
    const actifCirculant = stocks + creances;
    const totalActif = actifImmobilise + actifCirculant + tresorerie;
    const capitauxPropres = entrees.apportCapital + resultatsCumules;
    const totalPassif =
      capitauxPropres + dette.capital_restant_cloture + fournisseurs + dettesFiscalesSociales;
    bilan.push({
      annee,
      immobilisations_brutes: entrees.investissementsInitiaux,
      amortissements_cumules: amortissementsCumules,
      actif_immobilise: actifImmobilise,
      stocks,
      creances_clients: creances,
      actif_circulant: actifCirculant,
      tresorerie_actif: tresorerie,
      total_actif: totalActif,
      capital_apporte: entrees.apportCapital,
      resultats_cumules: resultatsCumules,
      capitaux_propres: capitauxPropres,
      dettes_financieres: dette.capital_restant_cloture,
      fournisseurs,
      dettes_fiscales_sociales: dettesFiscalesSociales,
      total_passif: totalPassif,
      ecart_equilibre: totalActif - totalPassif,
      autonomie_financiere: totalPassif === 0 ? 0 : capitauxPropres / totalPassif,
    });

    // — Seuil de rentabilité —
    // Charges fixes retenues = exploitation + dotations + intérêts (charges de
    // structure, indépendantes du volume d'activité).
    const chargesFixes = chargesFixesExploitation + dap + dette.interets;
    const margeSurCoutsVariables = ca - achats;
    const tauxMargeVariable = ca === 0 ? 0 : margeSurCoutsVariables / ca;
    const caSeuil = tauxMargeVariable <= 0 ? 0 : chargesFixes / tauxMargeVariable;
    seuil.push({
      annee,
      ca,
      charges_variables: achats,
      marge_sur_couts_variables: margeSurCoutsVariables,
      taux_marge_variable: tauxMargeVariable,
      charges_fixes: chargesFixes,
      ca_seuil: caSeuil,
      point_mort_mois: ca === 0 ? 0 : (12 * caSeuil) / ca,
      point_mort_jours: ca === 0 ? 0 : (JOURS_ANNEE_COMMERCIALE * caSeuil) / ca,
      marge_securite: ca === 0 ? 0 : (ca - caSeuil) / ca,
    });

    bfrPrecedent = bfrExercice;
  }

  const ecartBase = entrees.investissementsInitiaux - entrees.immobilisationsBrutesDeclarees;

  return {
    horizon_annees: n,
    ouverture,
    echeancier_dette: echeancier,
    bfr,
    caf,
    bilan,
    seuil_rentabilite: seuil,
    ecart_base_amortissable: ecartBase,
    coherence_immobilisations: {
      base_bilan: entrees.investissementsInitiaux,
      base_declaree: entrees.immobilisationsBrutesDeclarees,
      ecart: ecartBase,
      statut:
        Math.abs(ecartBase) > TOLERANCE_BASE_AMORTISSABLE &&
        entrees.immobilisationsBrutesDeclarees > 0
          ? 'incoherent'
          : 'coherent',
      dotations_plafonnees: dotationsPlafonnees,
    },
  };
}

/**
 * Échéancier d'un emprunt à mensualité constante (PMT), agrégé par exercice de
 * 12 mois. Même convention que la ligne DSL `mensualite_emprunt`
 * (`-PMT(taux/12, duree_mois, capital)`), pour que le service de la dette soit
 * cohérent entre la feuille `financement` et le bilan.
 *
 * Capital restant dû après k mensualités (taux mensuel i ≠ 0) :
 *   CRD_k = C·(1+i)^k − M·((1+i)^k − 1)/i
 * Les intérêts d'un exercice se déduisent par différence :
 *   intérêts = mensualités payées − capital remboursé.
 */
export function calculerEcheancierDette(
  capital: number,
  tauxAnnuel: number,
  dureeMois: number,
  horizonAnnees: number,
): ExerciceDette[] {
  const echeancier: ExerciceDette[] = [];
  const dureeValide = Number.isFinite(dureeMois) && dureeMois > 0 ? Math.floor(dureeMois) : 0;
  const capitalValide = Number.isFinite(capital) && capital > 0 ? capital : 0;

  if (capitalValide === 0 || dureeValide === 0) {
    for (let i = 0; i < horizonAnnees; i++) {
      echeancier.push({
        annee: i + 1,
        capital_restant_ouverture: 0,
        remboursement_capital: 0,
        interets: 0,
        capital_restant_cloture: 0,
      });
    }
    return echeancier;
  }

  const i = tauxAnnuel / 12;
  const mensualite =
    i === 0
      ? capitalValide / dureeValide
      : (capitalValide * i) / (1 - Math.pow(1 + i, -dureeValide));

  /** Capital restant dû après `k` mensualités. */
  const crd = (k: number): number => {
    const kClamp = Math.min(Math.max(k, 0), dureeValide);
    if (kClamp === dureeValide) return 0;
    const reste =
      i === 0
        ? capitalValide - mensualite * kClamp
        : capitalValide * Math.pow(1 + i, kClamp) -
          (mensualite * (Math.pow(1 + i, kClamp) - 1)) / i;
    return Math.max(0, reste);
  };

  for (let a = 0; a < horizonAnnees; a++) {
    const moisDebut = a * 12;
    const moisFin = Math.min((a + 1) * 12, dureeValide);
    const nbMensualites = Math.max(0, moisFin - moisDebut);
    const ouvertureCrd = crd(moisDebut);
    const clotureCrd = crd(moisFin);
    const remboursementCapital = ouvertureCrd - clotureCrd;
    const interets = mensualite * nbMensualites - remboursementCapital;
    // Des intérêts négatifs signifieraient que le capital remboursé dépasse les
    // mensualités payées : l'échéancier serait faux. On ne masque pas — on lève.
    // Seul le bruit d'arrondi flottant est ramené à zéro.
    if (interets < -TOLERANCE_ECHEANCIER) {
      throw new EngineError(
        'INVALID_FORMULA',
        `Échéancier incohérent sur l'exercice ${a + 1} : intérêts négatifs (${interets.toFixed(2)}). ` +
          `Capital ${capitalValide}, taux ${tauxAnnuel}, durée ${dureeValide} mois.`,
      );
    }
    echeancier.push({
      annee: a + 1,
      capital_restant_ouverture: ouvertureCrd,
      remboursement_capital: remboursementCapital,
      interets: Math.max(0, interets),
      capital_restant_cloture: clotureCrd,
    });
  }

  return echeancier;
}

/**
 * Lit un tableau annuel. Les séries d'exploitation sont validées en entrée de
 * `calculerEtatsFinanciers` (erreur explicite si elles ne couvrent pas l'horizon) ;
 * le repli sur 0 ne concerne donc que `dapAnnuelle`, légitimement vide pour un
 * template sans immobilisations.
 */
function at(serie: readonly number[], index: number): number {
  const v = serie[index];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
