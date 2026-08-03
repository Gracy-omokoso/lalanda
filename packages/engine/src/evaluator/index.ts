// Évaluateur : compile + exécute un template avec des valeurs de drivers données.
// S1 : évaluation ponctuelle (1 mois), pas de dimension temporelle.

import { CellError, ErrorType, HyperFormula, type Sheet } from 'hyperformula';

import { CycleError, EngineError, MissingDriverValueError } from '../dsl/errors.js';
import type { Template } from '../dsl/schema.js';
import {
  DRIVERS_SHEET,
  compileTemplate,
  type CompiledLine,
  type CompiledTemplate,
} from '../compiler/index.js';

/** Valeurs de drivers fournies par le scénario. Clé = driver.id. */
export type DriverValues = ReadonlyMap<string, number> | Record<string, number>;

/** Résultat pour une ligne évaluée. */
export interface LineResult {
  readonly sheetId: string;
  readonly lineId: string;
  readonly label: string;
  readonly formulaSource: string;
  readonly formulaExcel: string;
  readonly value: number;
  readonly format: CompiledLine['format'];
}

export interface EvaluationResult {
  readonly compiled: CompiledTemplate;
  readonly drivers: ReadonlyMap<string, number>;
  readonly lines: readonly LineResult[];
}

/** Compile un template et l'évalue avec les valeurs de drivers données. */
export function evaluateTemplate(template: Template, values: DriverValues): EvaluationResult {
  const compiled = compileTemplate(template);
  return evaluateCompiled(compiled, values);
}

/** Évalue un template déjà compilé. Utile quand on veut lancer plusieurs scénarios. */
export function evaluateCompiled(
  compiled: CompiledTemplate,
  values: DriverValues,
): EvaluationResult {
  const driverValues = resolveDriverValues(compiled, values);

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
        lines.push({
          sheetId: compiledLine.sheetId,
          lineId: compiledLine.lineId,
          label: compiledLine.label,
          formulaSource: compiledLine.formulaSource,
          formulaExcel: compiledLine.formulaExcel,
          value,
          format: compiledLine.format,
        });
      });
    }

    return { compiled, drivers: driverValues, lines };
  } finally {
    hf.destroy();
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function resolveDriverValues(
  compiled: CompiledTemplate,
  values: DriverValues,
): Map<string, number> {
  const provided = values instanceof Map ? values : new Map(Object.entries(values));
  const resolved = new Map<string, number>();
  for (const d of compiled.template.drivers) {
    if (provided.has(d.id)) {
      resolved.set(d.id, provided.get(d.id)!);
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
