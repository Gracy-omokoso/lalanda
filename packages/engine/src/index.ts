// API publique du moteur Lalanda.
// Voir docs/adr/ADR-0005 (HyperFormula), brief §3 et §7.

// S18a (FIN-001) : horizon 5 exercices, bilan prévisionnel, BFR, CAF, seuil de
// rentabilité. Toute évolution de calcul incrémente cette version — les plans
// re-validés après ce merge reçoivent un nouveau numéro (ADR-0011 § Contrat 1).
export const ENGINE_VERSION = '0.2.0';

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
  type Immobilisation,
  type CategorieImmobilisation,
  type StructureFinanciere,
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
  HORIZON_PROJECTION_DEFAUT,
  type DriverValues,
  type EvaluationResult,
  type LineResult,
} from './evaluator/index.js';

// États financiers prévisionnels (S18a, FIN-001) — BFR, CAF, bilan, seuil.
export {
  calculerEtatsFinanciers,
  calculerEcheancierDette,
  JOURS_ANNEE_COMMERCIALE,
  type BilanOuverture,
  type EntreesEtatsFinanciers,
  type EtatsFinanciers,
  type ExerciceBfr,
  type ExerciceBilan,
  type ExerciceCaf,
  type ExerciceDette,
  type ExerciceSeuil,
} from './etats-financiers/index.js';

// Amortissements (S14c) — feuille SYSCOHADA révisé.
export {
  calculerAmortissements,
  DUREES_SYSCOHADA,
  LABELS_CATEGORIE,
  type FeuilleAmortissements,
  type LigneAmortissement,
} from './amortissements/index.js';

// ParameterPacks (multi-pays / multi-fiscalité)
export {
  ParameterPackSchema,
  packToDriverValues,
  parseParameterPack,
  toSummary as parameterPackToSummary,
  type ParameterPack,
  type ParameterPackSummary,
  type Param,
} from './parameter-packs/index.js';

/** Placeholder — sera retiré quand toutes les APIs seront stables. */
export function engineHealth(): { ok: true; version: string } {
  return { ok: true, version: ENGINE_VERSION };
}
