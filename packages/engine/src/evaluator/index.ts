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

    return {
      compiled,
      drivers: driverValues,
      lines,
      ...(amortissements ? { amortissements } : {}),
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
  const horizon = template.horizon_projection_annees ?? 3;
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
  const seuil = param.valeur;
  const direction = compiledLine.seuil_direction;
  const tolerance = 0.1; // ±10 % pour la zone orange
  let statut: 'vert' | 'orange' | 'rouge';
  if (direction === 'min') {
    if (value >= seuil) statut = 'vert';
    else if (value >= seuil * (1 - tolerance)) statut = 'orange';
    else statut = 'rouge';
  } else {
    if (value <= seuil) statut = 'vert';
    else if (value <= seuil * (1 + tolerance)) statut = 'orange';
    else statut = 'rouge';
  }
  return { valeur: seuil, direction, statut };
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
