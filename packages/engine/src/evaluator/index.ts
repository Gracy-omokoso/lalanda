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

    return { compiled, drivers: driverValues, lines };
  } finally {
    hf.destroy();
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
