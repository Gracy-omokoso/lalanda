// Évaluateur : compile + exécute un template avec des valeurs de drivers données.
// S1 : évaluation ponctuelle (1 mois), pas de dimension temporelle.

import { CellError, ErrorType, HyperFormula, type Sheet } from 'hyperformula';

import { CycleError, EngineError, MissingDriverValueError } from '../dsl/errors.js';
import type { Template } from '../dsl/schema.js';
import { packToDriverValues, type ParameterPack } from '../parameter-packs/index.js';
import {
  DRIVERS_SHEET,
  compileTemplate,
  type CompiledLine,
  type CompiledTemplate,
} from '../compiler/index.js';
import { calculerAmortissements, type FeuilleAmortissements } from '../amortissements/index.js';
import { calculerEtatsFinanciers, type EtatsFinanciers } from '../etats-financiers/index.js';

/**
 * (S18a) Horizon par défaut des états financiers et de la feuille amortissements.
 * docs/07 « horizon standard : 5 exercices ». L'ancien défaut de 3 contredisait
 * docs/07 — arbitrage tranché par ADR-0011 § Contradictions 2 en faveur de docs/07.
 */
export const HORIZON_PROJECTION_DEFAUT = 5;

/** Valeurs de drivers fournies par le scénario. Clé = driver.id. */
export type DriverValues = ReadonlyMap<string, number> | Record<string, number>;

/**
 * Options d'évaluation.
 * `parameterPack` : les valeurs du pack sont pré-remplies comme drivers par défaut,
 * mais l'utilisateur peut toujours surcharger via `values`. Précédence (fort→faible) :
 * user values > pack > template.defaut.
 */
export interface EvaluateOptions {
  parameterPack?: ParameterPack;
}

/** Résultat pour une ligne évaluée. */
export interface LineResult {
  readonly sheetId: string;
  readonly lineId: string;
  readonly label: string;
  readonly formulaSource: string;
  readonly formulaExcel: string;
  readonly value: number;
  readonly format: CompiledLine['format'];
  /**
   * (S10) Statut du feu tricolore : présent uniquement si la ligne déclare `seuil_pack`
   * ET que le pack fournit la valeur du seuil. Comparaison :
   * - `min` → `value >= seuil` = vert, à ±10 % = orange, sinon rouge
   * - `max` → `value <= seuil` = vert, à ±10 % = orange, sinon rouge
   */
  readonly seuil?: {
    readonly valeur: number;
    readonly direction: 'min' | 'max';
    readonly statut: 'vert' | 'orange' | 'rouge';
  };
}

export interface EvaluationResult {
  readonly compiled: CompiledTemplate;
  readonly drivers: ReadonlyMap<string, number>;
  readonly lines: readonly LineResult[];
  /**
   * (S14c) Feuille amortissements SYSCOHADA calculée si le template déclare une
   * liste d'immobilisations. `undefined` sinon — comportement rétrocompatible :
   * un template sans `immobilisations` ne produit ni lignes ni feuille supplémentaires.
   */
  readonly amortissements?: FeuilleAmortissements;
  /**
   * (S18a, FIN-001) États financiers prévisionnels — BFR, CAF, bilan équilibré et
   * seuil de rentabilité sur l'horizon du template. `undefined` si le template ne
   * déclare pas `structure_financiere` (compatibilité S6→S14).
   */
  readonly etatsFinanciers?: EtatsFinanciers;
}

/** Compile un template et l'évalue avec les valeurs de drivers données. */
export function evaluateTemplate(
  template: Template,
  values: DriverValues,
  options: EvaluateOptions = {},
): EvaluationResult {
  const compiled = compileTemplate(template);
  return evaluateCompiled(compiled, values, options);
}

/** Évalue un template déjà compilé. Utile quand on veut lancer plusieurs scénarios. */
export function evaluateCompiled(
  compiled: CompiledTemplate,
  values: DriverValues,
  options: EvaluateOptions = {},
): EvaluationResult {
  const driverValues = resolveDriverValues(compiled, values, options.parameterPack);

  const sheets: Record<string, Sheet> = {};

  // Feuille des drivers : ligne i = [id, valeur].
  sheets[DRIVERS_SHEET] = compiled.template.drivers.map((d) => {
    const v = driverValues.get(d.id)!;
    return [d.id, v];
  });

  // Feuilles calculées : ligne i = [id, "=formule"].
  for (const feuille of compiled.template.feuilles) {
    sheets[feuille.id] = feuille.lignes.map((ligne) => {
      const compiledLine = compiled.lineIndex.get(ligne.id)!;
      return [ligne.id, compiledLine.formulaExcel];
    });
  }

  // HyperFormula GPL v3 : la clé publique est requise (produit MIT/GPL dual-licensed).
  const hf = HyperFormula.buildFromSheets(sheets, { licenseKey: 'gpl-v3' });

  try {
    const lines: LineResult[] = [];
    for (const feuille of compiled.template.feuilles) {
      feuille.lignes.forEach((ligne, i) => {
        const sheetIdxHf = hf.getSheetId(feuille.id);
        if (sheetIdxHf === undefined) {
          throw new EngineError(
            'INVALID_FORMULA',
            `Feuille HyperFormula introuvable : ${feuille.id}`,
          );
        }
        const raw = hf.getCellValue({ sheet: sheetIdxHf, row: i, col: 1 });
        const value = coerceCellValue(raw, ligne.id);
        const compiledLine = compiled.lineIndex.get(ligne.id)!;
        const seuil = computeSeuil(compiledLine, value, options.parameterPack);
        lines.push({
          sheetId: compiledLine.sheetId,
          lineId: compiledLine.lineId,
          label: compiledLine.label,
          formulaSource: compiledLine.formulaSource,
          formulaExcel: compiledLine.formulaExcel,
          value,
          format: compiledLine.format,
          ...(seuil ? { seuil } : {}),
        });
      });
    }

    // (S14c) Feuille amortissements — calculée hors HyperFormula car sa forme
    // (colonnes = années × immobilisations) ne se prête pas au modèle ligne/formule DSL.
    const amortissements = computeAmortissementsSheet(compiled.template);
    if (amortissements) {
      appendAmortissementsLines(lines, amortissements);
      applyDapToProjection(lines, amortissements);
    }

    // (S18a) États financiers prévisionnels — même parti pris que les amortissements :
    // un déroulé pluriannuel avec report de stocks d'un exercice sur l'autre ne se
    // modélise pas en lignes/formules ponctuelles du DSL.
    const etatsFinanciers = computeEtatsFinanciersSheet(
      compiled.template,
      driverValues,
      lines,
      amortissements,
    );
    if (etatsFinanciers) {
      appendEtatsFinanciersLines(lines, etatsFinanciers, options.parameterPack);
    }

    return {
      compiled,
      drivers: driverValues,
      lines,
      ...(amortissements ? { amortissements } : {}),
      ...(etatsFinanciers ? { etatsFinanciers } : {}),
    };
  } finally {
    hf.destroy();
  }
}

// ─── Feuille amortissements (S14c) ────────────────────────────

/**
 * Calcule la feuille amortissements si le template déclare `immobilisations`.
 * Retourne `undefined` sinon (non-régression : templates existants inchangés).
 */
function computeAmortissementsSheet(template: Template): FeuilleAmortissements | undefined {
  const immobilisations = template.immobilisations;
  if (!immobilisations || immobilisations.length === 0) return undefined;
  const horizon = template.horizon_projection_annees ?? HORIZON_PROJECTION_DEFAUT;
  return calculerAmortissements(immobilisations, horizon);
}

/**
 * Ajoute au tableau `lines` une ligne par (immobilisation × année) plus une ligne
 * total DAP par année et une ligne total VNC par année. Le `sheetId` est
 * `amortissements` — nouveau sheetId réservé côté API et web.
 */
function appendAmortissementsLines(lines: LineResult[], feuille: FeuilleAmortissements): void {
  const idSafe = (label: string): string =>
    'immo_' +
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || 'immo';

  // Une ligne par immobilisation : label = "Dotation <immo> — année N"
  feuille.lignes.forEach((ligne, immoIdx) => {
    ligne.dotations.forEach((dot, i) => {
      const anneeNum = i + 1;
      lines.push({
        sheetId: 'amortissements',
        lineId: `${idSafe(ligne.label)}_${immoIdx}_dotation_a${anneeNum}`,
        label: `${ligne.label} — dotation année ${anneeNum}`,
        formulaSource: `linéaire ${ligne.duree_annees} ans, prorata ${ligne.prorata_premiere_annee.toFixed(2)}`,
        formulaExcel: '',
        value: dot,
        format: 'money',
      });
    });
    ligne.vnc.forEach((v, i) => {
      const anneeNum = i + 1;
      lines.push({
        sheetId: 'amortissements',
        lineId: `${idSafe(ligne.label)}_${immoIdx}_vnc_a${anneeNum}`,
        label: `${ligne.label} — VNC fin année ${anneeNum}`,
        formulaSource: `montant_ht − Σ dotations`,
        formulaExcel: '',
        value: v,
        format: 'money',
      });
    });
  });

  // Totaux par année.
  feuille.dap_par_annee.forEach((total, i) => {
    const anneeNum = i + 1;
    lines.push({
      sheetId: 'amortissements',
      lineId: `dap_total_a${anneeNum}`,
      label: `TOTAL Dotations aux amortissements — année ${anneeNum}`,
      formulaSource: 'Σ dotations toutes immobilisations',
      formulaExcel: '',
      value: total,
      format: 'money',
    });
  });
  feuille.vnc_par_annee.forEach((total, i) => {
    const anneeNum = i + 1;
    lines.push({
      sheetId: 'amortissements',
      lineId: `vnc_total_a${anneeNum}`,
      label: `TOTAL VNC — fin année ${anneeNum}`,
      formulaSource: 'Σ VNC toutes immobilisations',
      formulaExcel: '',
      value: total,
      format: 'money',
    });
  });
}

/**
 * Injecte l'impact des amortissements sur la projection annuelle si celle-ci existe.
 * Convention MVP : si des lignes `resultat_annuel_1..N` existent dans la feuille
 * `projection`, on ajoute des lignes `resultat_annuel_N_apres_amortissements`
 * (résultat net − DAP). On ne mute PAS les lignes existantes pour préserver la
 * traçabilité (le CR "hors amortissements" reste lisible côté rapport bancaire).
 *
 * Si une ligne `dotations_amortissements` existe explicitement dans le template,
 * on la surcharge avec le total année 1 (la feuille amortissements devient la
 * source unique — cf. brief S14c "remplace toute DAP saisie manuelle").
 */
function applyDapToProjection(lines: LineResult[], feuille: FeuilleAmortissements): void {
  // 1) Surcharge éventuelle d'une ligne DAP manuelle (année 1 par défaut).
  const dapAnnee1 = feuille.dap_par_annee[0] ?? 0;
  const manualDap = lines.findIndex((l) => l.lineId === 'dotations_amortissements');
  if (manualDap >= 0) {
    lines[manualDap] = {
      ...lines[manualDap]!,
      value: dapAnnee1,
      formulaSource: '(surchargé) Σ dotations amortissements année 1',
    };
  }

  // 2) Ajout des lignes "résultat après amortissements" pour l'horizon disponible.
  for (let i = 0; i < feuille.horizon_annees; i++) {
    const anneeNum = i + 1;
    const resAnnuel = lines.find((l) => l.lineId === `resultat_annuel_${anneeNum}`);
    if (!resAnnuel) continue;
    const dap = feuille.dap_par_annee[i] ?? 0;
    lines.push({
      sheetId: resAnnuel.sheetId,
      lineId: `resultat_annuel_${anneeNum}_apres_amort`,
      label: `Résultat net année ${anneeNum} (après amortissements)`,
      formulaSource: `${resAnnuel.lineId} − DAP année ${anneeNum}`,
      formulaExcel: '',
      value: resAnnuel.value - dap,
      format: 'money',
    });
  }
}

// ─── États financiers prévisionnels (S18a, FIN-001) ───────────

/**
 * Rassemble les entrées des états financiers depuis les drivers résolus et les
 * lignes déjà évaluées, puis délègue le calcul à `calculerEtatsFinanciers`.
 * Retourne `undefined` si le template ne déclare pas `structure_financiere`.
 *
 * Les séries annuelles d'achats variables et de charges fixes sont extrapolées au
 * `taux_croissance_ca`, exactement comme la projection existante fait croître le
 * résultat net (« coûts variables + fixes croissent proportionnellement »,
 * feuille `projection` S12-lite). Cette cohérence est vérifiée par un test :
 * CA_N − achats_N − charges fixes_N = EBE_N.
 */
function computeEtatsFinanciersSheet(
  template: Template,
  driverValues: ReadonlyMap<string, number>,
  lines: readonly LineResult[],
  amortissements: FeuilleAmortissements | undefined,
): EtatsFinanciers | undefined {
  const structure = template.structure_financiere;
  if (!structure) return undefined;

  const horizon = template.horizon_projection_annees ?? HORIZON_PROJECTION_DEFAUT;
  const lineValues = new Map(lines.map((l) => [l.lineId, l.value]));

  const driver = (id: string): number => {
    const v = driverValues.get(id);
    if (v === undefined) {
      throw new EngineError(
        'INVALID_FORMULA',
        `structure_financiere : driver "${id}" introuvable dans le template ${template.slug}.`,
      );
    }
    return v;
  };
  const ligne = (id: string): number => {
    const v = lineValues.get(id);
    if (v === undefined) {
      throw new EngineError(
        'INVALID_FORMULA',
        `structure_financiere : ligne "${id}" introuvable dans le template ${template.slug}.`,
      );
    }
    return v;
  };

  const croissance = driver(structure.driver_taux_croissance);

  // Séries lues dans la feuille `projection`. On exige que les lignes existent sur
  // tout l'horizon : un template qui active `structure_financiere` doit décliner sa
  // projection sur `horizon_projection_annees` exercices (erreur explicite sinon).
  const caAnnuel: number[] = [];
  const resultatAnnuel: number[] = [];
  for (let i = 1; i <= horizon; i++) {
    caAnnuel.push(ligne(`${structure.prefixe_ca_annuel}_${i}`));
    resultatAnnuel.push(ligne(`${structure.prefixe_resultat_annuel}_${i}`));
  }

  const achatsMensuels = structure.achats_variables_mensuels
    ? ligne(structure.achats_variables_mensuels)
    : 0;
  const chargesFixesMensuelles = ligne(structure.charges_fixes_mensuelles);

  const achatsVariablesAnnuels: number[] = [];
  const chargesFixesAnnuelles: number[] = [];
  for (let i = 0; i < horizon; i++) {
    const facteur = Math.pow(1 + croissance, i);
    achatsVariablesAnnuels.push(achatsMensuels * 12 * facteur);
    chargesFixesAnnuelles.push(chargesFixesMensuelles * 12 * facteur);
  }

  const dapAnnuelle: number[] = [];
  for (let i = 0; i < horizon; i++) {
    dapAnnuelle.push(amortissements?.dap_par_annee[i] ?? 0);
  }

  return calculerEtatsFinanciers({
    horizonAnnees: horizon,
    caAnnuel,
    resultatAnnuel,
    achatsVariablesAnnuels,
    chargesFixesAnnuelles,
    dapAnnuelle,
    immobilisationsBrutesDeclarees: (template.immobilisations ?? []).reduce(
      (s, im) => s + im.montant_ht,
      0,
    ),
    investissementsInitiaux: driver(structure.driver_investissements),
    bfrInitial: driver(structure.driver_bfr_initial),
    apportCapital: driver(structure.driver_apport),
    empruntCapital: driver(structure.driver_emprunt_capital),
    empruntTauxAnnuel: driver(structure.driver_emprunt_taux_annuel),
    empruntDureeMois: driver(structure.driver_emprunt_duree_mois),
    delaiClientsJours: driver(structure.driver_delai_clients_jours),
    delaiFournisseursJours: driver(structure.driver_delai_fournisseurs_jours),
    rotationStockJours: driver(structure.driver_rotation_stock_jours),
  });
}

/**
 * Projette les états financiers dans le tableau `lines`, en respectant le nommage
 * ADR-0011 § Contrat 2 :
 * - feuille `bilan`, lignes `bilan_*` ;
 * - feuille `caf`, lignes `caf_*` ;
 * - feuille `seuil_rentabilite`, lignes `sr_*` ;
 * - BFR détaillé dans la feuille existante `plan_financement`, lignes `pf_bfr_*` ;
 * - séries annuelles suffixées `_annuel_1` … `_annuel_5`.
 */
function appendEtatsFinanciersLines(
  lines: LineResult[],
  etats: EtatsFinanciers,
  pack: ParameterPack | undefined,
): void {
  const push = (
    sheetId: string,
    lineId: string,
    label: string,
    formulaSource: string,
    value: number,
    format: CompiledLine['format'],
    seuilPack?: { param: string; direction: 'min' | 'max' },
  ): void => {
    const seuil = seuilPack
      ? seuilDepuisPack(seuilPack.param, seuilPack.direction, value, pack)
      : undefined;
    lines.push({
      sheetId,
      lineId,
      label,
      formulaSource,
      formulaExcel: '',
      value,
      format,
      ...(seuil ? { seuil } : {}),
    });
  };

  // ── BFR détaillé (feuille plan_financement, ADR-0011 § Contrat 2) ──
  for (const e of etats.bfr) {
    const n = e.annee;
    push(
      'plan_financement',
      `pf_bfr_stocks_annuel_${n}`,
      `Stocks — exercice ${n}`,
      'achats variables × rotation stock / 360',
      e.stocks,
      'money',
    );
    push(
      'plan_financement',
      `pf_bfr_creances_clients_annuel_${n}`,
      `Créances clients — exercice ${n}`,
      'CA × délai clients / 360',
      e.creances_clients,
      'money',
    );
    push(
      'plan_financement',
      `pf_bfr_fournisseurs_annuel_${n}`,
      `Dettes fournisseurs — exercice ${n}`,
      'achats variables × délai fournisseurs / 360',
      e.dettes_fournisseurs,
      'money',
    );
    push(
      'plan_financement',
      `pf_bfr_dettes_fiscales_sociales_annuel_${n}`,
      `Dettes fiscales et sociales — exercice ${n}`,
      'non modélisé (IBP réglé sur l’exercice)',
      e.dettes_fiscales_sociales,
      'money',
    );
    push(
      'plan_financement',
      `pf_bfr_total_annuel_${n}`,
      `BFR — exercice ${n}`,
      'stocks + créances − fournisseurs − dettes fiscales et sociales',
      e.bfr,
      'money',
    );
    push(
      'plan_financement',
      `pf_bfr_variation_annuel_${n}`,
      `Variation du BFR — exercice ${n}`,
      `BFR exercice ${n} − BFR exercice ${n - 1}`,
      e.variation,
      'money',
    );
    push(
      'plan_financement',
      `pf_bfr_jours_ca_annuel_${n}`,
      `BFR en jours de CA — exercice ${n}`,
      'BFR / CA × 360',
      e.bfr_jours_ca,
      'number',
    );
  }

  // ── CAF ──
  for (const e of etats.caf) {
    const n = e.annee;
    push(
      'caf',
      `caf_resultat_net_annuel_${n}`,
      `Résultat net — exercice ${n}`,
      'résultat d’exploitation net d’IBP − dotations − intérêts',
      e.resultat_net,
      'money',
    );
    push(
      'caf',
      `caf_dotations_annuel_${n}`,
      `Dotations aux amortissements — exercice ${n}`,
      'feuille amortissements — total DAP',
      e.dotations_amortissements,
      'money',
    );
    push(
      'caf',
      `caf_totale_annuel_${n}`,
      `CAPACITÉ D’AUTOFINANCEMENT — exercice ${n}`,
      'résultat net + dotations aux amortissements',
      e.caf,
      'money',
    );
  }
  push(
    'caf',
    `caf_cumulee_${etats.horizon_annees}ans`,
    `CAF cumulée sur ${etats.horizon_annees} exercices`,
    'Σ CAF des exercices',
    etats.caf.reduce((s, e) => s + e.caf, 0),
    'money',
  );

  // ── Bilan d'ouverture ──
  const o = etats.ouverture;
  push(
    'bilan',
    'bilan_actif_immobilise_ouverture',
    'Actif immobilisé — ouverture',
    'investissements initiaux',
    o.actif_immobilise,
    'money',
  );
  push(
    'bilan',
    'bilan_actif_circulant_ouverture',
    'Actif circulant (BFR déployé) — ouverture',
    'BFR initial',
    o.actif_circulant,
    'money',
  );
  push(
    'bilan',
    'bilan_tresorerie_actif_ouverture',
    'Trésorerie — ouverture',
    'apport + emprunt − investissements − BFR initial',
    o.tresorerie_actif,
    'money',
  );
  push(
    'bilan',
    'bilan_total_actif_ouverture',
    'TOTAL ACTIF — ouverture',
    'actif immobilisé + actif circulant + trésorerie',
    o.total_actif,
    'money',
  );
  push(
    'bilan',
    'bilan_capitaux_propres_ouverture',
    'Capitaux propres — ouverture',
    'apport personnel',
    o.capitaux_propres,
    'money',
  );
  push(
    'bilan',
    'bilan_dettes_financieres_ouverture',
    'Dettes financières — ouverture',
    'capital emprunté',
    o.dettes_financieres,
    'money',
  );
  push(
    'bilan',
    'bilan_total_passif_ouverture',
    'TOTAL PASSIF — ouverture',
    'capitaux propres + dettes financières',
    o.total_passif,
    'money',
  );
  push(
    'bilan',
    'bilan_ecart_equilibre_ouverture',
    'Écart d’équilibre — ouverture',
    'total actif − total passif (doit être nul)',
    o.ecart_equilibre,
    'money',
  );

  // ── Bilan par exercice ──
  for (const e of etats.bilan) {
    const n = e.annee;
    push(
      'bilan',
      `bilan_immobilisations_brutes_annuel_${n}`,
      `Immobilisations brutes — exercice ${n}`,
      'investissements initiaux',
      e.immobilisations_brutes,
      'money',
    );
    push(
      'bilan',
      `bilan_amortissements_cumules_annuel_${n}`,
      `Amortissements cumulés — exercice ${n}`,
      'Σ dotations jusqu’à l’exercice N',
      e.amortissements_cumules,
      'money',
    );
    push(
      'bilan',
      `bilan_actif_immobilise_annuel_${n}`,
      `Actif immobilisé net (VNC) — exercice ${n}`,
      'immobilisations brutes − amortissements cumulés',
      e.actif_immobilise,
      'money',
    );
    push(
      'bilan',
      `bilan_stocks_annuel_${n}`,
      `Stocks — exercice ${n}`,
      'achats variables × rotation stock / 360',
      e.stocks,
      'money',
    );
    push(
      'bilan',
      `bilan_creances_clients_annuel_${n}`,
      `Créances clients — exercice ${n}`,
      'CA × délai clients / 360',
      e.creances_clients,
      'money',
    );
    push(
      'bilan',
      `bilan_actif_circulant_annuel_${n}`,
      `Actif circulant — exercice ${n}`,
      'stocks + créances clients',
      e.actif_circulant,
      'money',
    );
    push(
      'bilan',
      `bilan_tresorerie_actif_annuel_${n}`,
      `Trésorerie — exercice ${n}`,
      'trésorerie N−1 + CAF − variation BFR − remboursement capital',
      e.tresorerie_actif,
      'money',
    );
    push(
      'bilan',
      `bilan_total_actif_annuel_${n}`,
      `TOTAL ACTIF — exercice ${n}`,
      'actif immobilisé net + actif circulant + trésorerie',
      e.total_actif,
      'money',
    );

    push(
      'bilan',
      `bilan_capital_apporte_annuel_${n}`,
      `Capital apporté — exercice ${n}`,
      'apport personnel',
      e.capital_apporte,
      'money',
    );
    push(
      'bilan',
      `bilan_resultats_cumules_annuel_${n}`,
      `Résultats cumulés — exercice ${n}`,
      'Σ résultats nets jusqu’à l’exercice N',
      e.resultats_cumules,
      'money',
    );
    push(
      'bilan',
      `bilan_capitaux_propres_annuel_${n}`,
      `Capitaux propres — exercice ${n}`,
      'capital apporté + résultats cumulés',
      e.capitaux_propres,
      'money',
    );
    push(
      'bilan',
      `bilan_dettes_financieres_annuel_${n}`,
      `Dettes financières — exercice ${n}`,
      'capital restant dû (échéancier PMT)',
      e.dettes_financieres,
      'money',
    );
    push(
      'bilan',
      `bilan_fournisseurs_annuel_${n}`,
      `Dettes fournisseurs — exercice ${n}`,
      'achats variables × délai fournisseurs / 360',
      e.fournisseurs,
      'money',
    );
    push(
      'bilan',
      `bilan_dettes_fiscales_sociales_annuel_${n}`,
      `Dettes fiscales et sociales — exercice ${n}`,
      'non modélisé (IBP réglé sur l’exercice)',
      e.dettes_fiscales_sociales,
      'money',
    );
    push(
      'bilan',
      `bilan_total_passif_annuel_${n}`,
      `TOTAL PASSIF — exercice ${n}`,
      'capitaux propres + dettes financières + fournisseurs + dettes fiscales et sociales',
      e.total_passif,
      'money',
    );

    push(
      'bilan',
      `bilan_ecart_equilibre_annuel_${n}`,
      `Écart d’équilibre — exercice ${n}`,
      'total actif − total passif (doit être nul)',
      e.ecart_equilibre,
      'money',
    );
    push(
      'bilan',
      `bilan_autonomie_financiere_annuel_${n}`,
      `Autonomie financière — exercice ${n}`,
      'capitaux propres / total passif',
      e.autonomie_financiere,
      'percent',
      { param: 'ratio_autonomie_financiere_min', direction: 'min' },
    );
  }

  // ── Échéancier de la dette (détail du bilan) ──
  for (const e of etats.echeancier_dette) {
    const n = e.annee;
    push(
      'bilan',
      `bilan_dette_remboursement_annuel_${n}`,
      `Remboursement du capital — exercice ${n}`,
      'échéancier PMT : CRD ouverture − CRD clôture',
      e.remboursement_capital,
      'money',
    );
    push(
      'bilan',
      `bilan_dette_interets_annuel_${n}`,
      `Intérêts d’emprunt — exercice ${n}`,
      'échéancier PMT : mensualités payées − capital remboursé',
      e.interets,
      'money',
    );
  }

  push(
    'bilan',
    'bilan_immobilisations_ecart_base_amortissable',
    'Contrôle — écart investissements / base amortissable déclarée',
    'investissements initiaux − Σ montant_ht des immobilisations',
    etats.ecart_base_amortissable,
    'money',
  );

  // ── Seuil de rentabilité ──
  for (const e of etats.seuil_rentabilite) {
    const n = e.annee;
    push(
      'seuil_rentabilite',
      `sr_ca_annuel_${n}`,
      `Chiffre d’affaires — exercice ${n}`,
      'feuille projection',
      e.ca,
      'money',
    );
    push(
      'seuil_rentabilite',
      `sr_charges_variables_annuel_${n}`,
      `Charges variables — exercice ${n}`,
      'achats variables de l’exercice',
      e.charges_variables,
      'money',
    );
    push(
      'seuil_rentabilite',
      `sr_marge_sur_couts_variables_annuel_${n}`,
      `Marge sur coûts variables — exercice ${n}`,
      'CA − charges variables',
      e.marge_sur_couts_variables,
      'money',
    );
    push(
      'seuil_rentabilite',
      `sr_taux_marge_variable_annuel_${n}`,
      `Taux de marge sur coûts variables — exercice ${n}`,
      'marge sur coûts variables / CA',
      e.taux_marge_variable,
      'percent',
    );
    push(
      'seuil_rentabilite',
      `sr_charges_fixes_annuel_${n}`,
      `Charges fixes — exercice ${n}`,
      'charges d’exploitation fixes + dotations + intérêts',
      e.charges_fixes,
      'money',
    );
    push(
      'seuil_rentabilite',
      `sr_ca_seuil_annuel_${n}`,
      `SEUIL DE RENTABILITÉ (CA) — exercice ${n}`,
      'charges fixes / taux de marge sur coûts variables',
      e.ca_seuil,
      'money',
    );
    push(
      'seuil_rentabilite',
      `sr_point_mort_mois_annuel_${n}`,
      `Point mort — exercice ${n}`,
      '12 × CA seuil / CA',
      e.point_mort_mois,
      'number',
    );
    push(
      'seuil_rentabilite',
      `sr_point_mort_jours_annuel_${n}`,
      `Point mort en jours — exercice ${n}`,
      '360 × CA seuil / CA',
      e.point_mort_jours,
      'number',
    );
    push(
      'seuil_rentabilite',
      `sr_marge_securite_annuel_${n}`,
      `Marge de sécurité — exercice ${n}`,
      '(CA − CA seuil) / CA',
      e.marge_securite,
      'percent',
    );
  }
}

/**
 * Feu tricolore pour une ligne générée hors DSL : même règle que `computeSeuil`
 * (±10 % de tolérance pour la zone orange), mais le seuil est désigné en TypeScript
 * plutôt que par la clé `seuil_pack` du template. Retourne `undefined` — donc ligne
 * purement informative — si le pack ne fournit pas le paramètre.
 */
function seuilDepuisPack(
  paramId: string,
  direction: 'min' | 'max',
  value: number,
  pack: ParameterPack | undefined,
): LineResult['seuil'] {
  if (!pack) return undefined;
  const param = pack.params[paramId];
  if (!param) return undefined;
  return {
    valeur: param.valeur,
    direction,
    statut: statutSeuil(value, param.valeur, direction),
  };
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Calcule le statut d'un feu tricolore pour une ligne :
 * - vert si la valeur respecte le seuil du pack ;
 * - orange si elle est dans une bande de tolérance ±10 % ;
 * - rouge sinon.
 * Retourne undefined si la ligne n'a pas de seuil OU si le pack n'a pas la valeur.
 */
function computeSeuil(
  compiledLine: CompiledLine,
  value: number,
  pack: ParameterPack | undefined,
): { valeur: number; direction: 'min' | 'max'; statut: 'vert' | 'orange' | 'rouge' } | undefined {
  if (!compiledLine.seuil_pack || !compiledLine.seuil_direction || !pack) return undefined;
  const param = pack.params[compiledLine.seuil_pack];
  if (!param) return undefined;
  const direction = compiledLine.seuil_direction;
  return { valeur: param.valeur, direction, statut: statutSeuil(value, param.valeur, direction) };
}

/**
 * Règle du feu tricolore, partagée par les lignes DSL (`seuil_pack`) et les lignes
 * générées hors DSL (états financiers S18a) :
 * - `min` : vert si `value >= seuil`, orange dans la bande −10 %, rouge sinon ;
 * - `max` : vert si `value <= seuil`, orange dans la bande +10 %, rouge sinon.
 */
function statutSeuil(
  value: number,
  seuil: number,
  direction: 'min' | 'max',
): 'vert' | 'orange' | 'rouge' {
  const tolerance = 0.1; // ±10 % pour la zone orange
  if (direction === 'min') {
    if (value >= seuil) return 'vert';
    return value >= seuil * (1 - tolerance) ? 'orange' : 'rouge';
  }
  if (value <= seuil) return 'vert';
  return value <= seuil * (1 + tolerance) ? 'orange' : 'rouge';
}

function resolveDriverValues(
  compiled: CompiledTemplate,
  values: DriverValues,
  pack: ParameterPack | undefined,
): Map<string, number> {
  const provided = values instanceof Map ? values : new Map(Object.entries(values));
  // Précédence : user > pack > template.defaut.
  const packValues = pack ? packToDriverValues(pack) : {};
  const resolved = new Map<string, number>();
  for (const d of compiled.template.drivers) {
    if (provided.has(d.id)) {
      resolved.set(d.id, provided.get(d.id)!);
    } else if (Object.prototype.hasOwnProperty.call(packValues, d.id)) {
      resolved.set(d.id, packValues[d.id]!);
    } else if (d.defaut !== undefined) {
      resolved.set(d.id, d.defaut);
    } else {
      throw new MissingDriverValueError(d.id);
    }
  }
  return resolved;
}

function coerceCellValue(raw: unknown, lineId: string): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (raw instanceof CellError) {
    // HyperFormula ne détectera un cycle qu'à l'évaluation si notre détection statique l'a raté.
    if (raw.type === ErrorType.CYCLE) {
      throw new CycleError([lineId]);
    }
    throw new EngineError('INVALID_FORMULA', `Cellule "${lineId}" en erreur : ${raw.type}`, {
      lineId,
      hfError: raw.type,
    });
  }
  // Chaîne, booléen, null → non attendu en S1 (formules purement numériques).
  throw new EngineError('INVALID_FORMULA', `Valeur inattendue pour "${lineId}" : ${String(raw)}`, {
    lineId,
    raw,
  });
}
