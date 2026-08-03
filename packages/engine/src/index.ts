// API publique du moteur Lalanda.
// Voir docs/adr/ADR-0005 (HyperFormula), brief §3 et §7.

export const ENGINE_VERSION = '0.1.0';

// DSL
export {
  TemplateSchema,
  collectIds,
  type CollectedIds,
  type Driver,
  type DriverType,
  type Feuille,
  type Ligne,
  type Template,
} from './dsl/schema.js';
export { parseTemplate } from './dsl/parser.js';
export {
  CycleError,
  DuplicateIdError,
  EngineError,
  MissingDriverValueError,
  UnknownDriverError,
  UnknownLineError,
  type EngineErrorCode,
} from './dsl/errors.js';

// Compiler
export {
  DRIVERS_SHEET,
  compileTemplate,
  feuillesCompilees,
  type CellLocation,
  type CompiledLine,
  type CompiledTemplate,
} from './compiler/index.js';

// Evaluator
export {
  evaluateCompiled,
  evaluateTemplate,
  type DriverValues,
  type EvaluationResult,
  type LineResult,
} from './evaluator/index.js';

/** Placeholder — sera retiré quand toutes les APIs seront stables. */
export function engineHealth(): { ok: true; version: string } {
  return { ok: true, version: ENGINE_VERSION };
}
