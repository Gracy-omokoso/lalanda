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
  resolveEtapes,
  findUnknownWizardGroupes,
  type CollectedIds,
  type Driver,
  type DriverType,
  type Etape,
  type Feuille,
  type Ligne,
  type ResolvedEtape,
  type WizardPresentation,
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

// Calcul conforme des factures (ADR-0022, S25d) — versionné à part
// (`INVOICE_TOTALS_VERSION`), il ne touche aucun calcul de plan.
export * from './invoice-totals/index.js';

// Encaissements, règlement des factures et réalisé issu des ventes (ADR-0031) —
// versionné à part (`RECEIVABLES_VERSION`).
export * from './receivables/index.js';
// Dépenses et trésorerie réelle (ADR-0034) — versionné à part (`TREASURY_VERSION`),
// il ne touche aucun calcul de plan.
export * from './treasury/index.js';
// Indicateurs du CRM minimal (ADR-0035) — sommes par devise et probabilité
// historique par étape, versionnés à part (`CRM_INDICATORS_VERSION`).
export * from './crm/index.js';

/** Placeholder — sera retiré quand toutes les APIs seront stables. */
export function engineHealth(): { ok: true; version: string } {
  return { ok: true, version: ENGINE_VERSION };
}
