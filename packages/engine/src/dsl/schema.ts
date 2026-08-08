// Schéma Zod du DSL de template Lalanda.
// Voir brief §7 pour la spécification complète.
// S1 : sous-ensemble minimal (drivers scalaires, formules ponctuelles, pas de temporalité, pas de custom functions).

import { z } from 'zod';
import {
  GROUPE_TOUS,
  findUnknownWizardGroupes,
  resolveWizardEtapes,
  type ResolvedEtape,
} from '@lalanda/shared/wizard';

// ─── Identifiants ─────────────────────────────────────────────
// Snake_case ASCII, [a-z0-9_], commence par une lettre, 1..64 chars.
const IdSchema = z
  .string()
  .min(1, 'identifiant vide')
  .max(64, 'identifiant trop long (>64)')
  .regex(/^[a-z][a-z0-9_]*$/, 'identifiant invalide (attendu : ^[a-z][a-z0-9_]*$)');

// ─── Types de drivers ─────────────────────────────────────────
const DriverTypeSchema = z.enum(['number', 'percent', 'money']);
export type DriverType = z.infer<typeof DriverTypeSchema>;

const CurrencySchema = z.enum(['USD', 'CDF']);

// Un driver scalaire — la temporalité (mensualisation) arrive en S2.
const DriverSchema = z
  .object({
    id: IdSchema,
    groupe: IdSchema.optional(),
    label: z.string().min(1).optional(),
    type: DriverTypeSchema.default('number'),
    devise: CurrencySchema.optional(),
    defaut: z.number().finite().optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    unite: z.string().optional(),
    aide: z.string().optional(),
  })
  .strict();

export type Driver = z.infer<typeof DriverSchema>;

// ─── Groupes d'hypothèses (organisation UI, pas de sémantique de calcul) ─────
const GroupeSchema = z
  .object({
    id: IdSchema,
    label: z.string().min(1),
  })
  .strict();

// ─── Étapes du wizard de saisie (S18c) ────────────────────────
// PRÉSENTATION UNIQUEMENT — aucune sémantique de calcul. Une étape regroupe un ou
// plusieurs `groupes_hypotheses` et donne au wizard web un ordre de saisie lisible
// (contexte → CA → coûts → personnel → investissement → financement → synthèse,
// voir docs/06-WIZARD.md). Le moteur ignore totalement ce champ lors de l'évaluation.
const EtapeSchema = z
  .object({
    id: IdSchema,
    /** Titre affiché dans l'indicateur de progression (ex. « Chiffre d'affaires »). */
    label: z.string().min(1),
    /** Phrase d'accroche affichée sous le titre de l'étape. */
    description: z.string().optional(),
    /** Ids des `groupes_hypotheses` dont les drivers sont saisis à cette étape. */
    groupes: z.array(IdSchema).min(1, 'une étape doit rattacher au moins un groupe'),
    /**
     * Rang d'affichage. Si absent, l'ordre de déclaration fait foi. Les étapes sans
     * `ordre` passent après celles qui en déclarent un.
     */
    ordre: z.number().int().positive().optional(),
  })
  .strict();

export type Etape = z.infer<typeof EtapeSchema>;

/**
 * Bloc de présentation du wizard — regroupe TOUTES les clés destinées à l'interface
 * de saisie, et rien d'autre. Le compilateur et l'évaluateur l'ignorent intégralement
 * (voir ADR-0011, Contrat 3 : frontière explicite entre structure financière et
 * présentation, pour que deux chantiers puissent éditer le même template).
 */
const WizardSchema = z
  .object({
    etapes: z.array(EtapeSchema).min(1, 'le bloc wizard doit déclarer au moins une étape'),
  })
  .strict();

export type WizardPresentation = z.infer<typeof WizardSchema>;

// ─── Feuilles et lignes ───────────────────────────────────────
// S1 : uniquement des feuilles calculées avec des lignes explicites.
// S10 : ligne peut porter un seuil (feu tricolore) référençant un paramètre du pack.
// Les feuilles typées (syscohada_resultat, cashflow_mensuel, syscohada_bilan) arrivent en S11.
const LigneSchema = z
  .object({
    id: IdSchema,
    label: z.string().min(1).optional(),
    /**
     * Expression source dans le DSL. Peut référencer un `driver.id`, une autre `ligne.id`,
     * et utiliser les opérateurs `+ - * / ^` avec parenthèses.
     * Depuis S10 : accepte aussi les fonctions Excel MAX, MIN, IF, ABS, ROUND, SUM, IFERROR,
     * AND, OR, NOT (évaluées nativement par HyperFormula).
     */
    formule: z.string().min(1),
    format: z.enum(['money', 'number', 'percent']).default('number'),
    /**
     * (S10, feuille ratios) — id d'un paramètre du ParameterPack qui sert de seuil de
     * référence pour le feu tricolore. Ex. `ratio_dscr_min`. Si absent, pas de feu.
     */
    seuil_pack: IdSchema.optional(),
    /**
     * (S10, feuille ratios) — direction du seuil :
     * - `min` : la valeur doit être ≥ seuil pour être verte (ex. DSCR, autonomie).
     * - `max` : la valeur doit être ≤ seuil pour être verte (ex. endettement).
     */
    seuil_direction: z.enum(['min', 'max']).optional(),
  })
  .strict();

export type Ligne = z.infer<typeof LigneSchema>;

const FeuilleSchema = z
  .object({
    id: IdSchema,
    label: z.string().min(1).optional(),
    lignes: z.array(LigneSchema).min(1, 'une feuille doit contenir au moins une ligne'),
  })
  .strict();

export type Feuille = z.infer<typeof FeuilleSchema>;

// ─── Immobilisations SYSCOHADA (S14c) ─────────────────────────
// Liste optionnelle d'immobilisations sur laquelle l'évaluateur produit la feuille
// synthétique `amortissements` (voir packages/engine/src/amortissements/index.ts).
// Les catégories sont normalisées SYSCOHADA révisé (AUDCIF 2017).
const CategorieImmobilisationSchema = z.enum([
  'constructions',
  'materiel_outillage',
  'materiel_transport',
  'materiel_informatique',
  'mobilier_bureau',
  'amenagements',
  'logiciels',
]);
export type CategorieImmobilisation = z.infer<typeof CategorieImmobilisationSchema>;

const ImmobilisationSchema = z
  .object({
    /** Libellé lisible affiché dans la feuille (ex. « Camion de livraison »). */
    label: z.string().min(1),
    /** Catégorie SYSCOHADA — détermine la durée par défaut. */
    categorie: CategorieImmobilisationSchema,
    /** Montant HT amortissable (base d'amortissement = montant_ht − valeur_residuelle). */
    montant_ht: z.number().finite().nonnegative(),
    /** Date d'acquisition au format YYYY-MM-DD (utilisée pour le prorata temporis). */
    date_acquisition: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date invalide (attendu YYYY-MM-DD)'),
    /** Valeur résiduelle en fin de vie (optionnel, défaut = 0). */
    valeur_residuelle: z.number().finite().nonnegative().optional(),
    /** Surcharge explicite de la durée standard SYSCOHADA (années). */
    duree_annees: z.number().int().positive().max(50).optional(),
  })
  .strict();

export type Immobilisation = z.infer<typeof ImmobilisationSchema>;

// ─── Structure financière (S18a, FIN-001) ─────────────────────
// Bloc OPTIONNEL qui active les états financiers prévisionnels : BFR, CAF,
// bilan et seuil de rentabilité (voir packages/engine/src/etats-financiers/).
//
// Le bloc ne fait que DÉSIGNER des lignes et des drivers déjà déclarés par le
// template — il n'introduit aucune règle de calcul. Toutes les clés ont un défaut
// correspondant aux identifiants conventionnels des templates S6→S14, si bien
// qu'un template conforme n'a besoin que de `structure_financiere: {}`.
//
// Un template SANS ce bloc n'est pas modifié du tout (compatibilité S6→S14).
const StructureFinanciereSchema = z
  .object({
    /**
     * Ligne mensuelle des achats variables (matières premières, marchandises).
     * Absente = modèle sans achats variables (prestation de services) : les charges
     * variables valent 0, le taux de marge sur coûts variables vaut 100 %.
     */
    achats_variables_mensuels: IdSchema.optional(),
    /** Ligne mensuelle des charges fixes d'exploitation (hors dotations et intérêts). */
    charges_fixes_mensuelles: IdSchema.default('charges_operationnelles'),
    /** Préfixe des lignes de CA annuel de la projection (`<prefixe>_1` … `<prefixe>_5`). */
    prefixe_ca_annuel: IdSchema.default('ca_annuel'),
    /** Préfixe des lignes de résultat annuel de la projection. */
    prefixe_resultat_annuel: IdSchema.default('resultat_annuel'),

    // ── Drivers de financement ──
    driver_taux_croissance: IdSchema.default('taux_croissance_ca'),
    driver_apport: IdSchema.default('apport_capital'),
    driver_emprunt_capital: IdSchema.default('emprunt_capital'),
    driver_emprunt_taux_annuel: IdSchema.default('emprunt_taux_annuel'),
    driver_emprunt_duree_mois: IdSchema.default('emprunt_duree_mois'),
    driver_investissements: IdSchema.default('investissements_initiaux'),
    driver_bfr_initial: IdSchema.default('bfr_initial'),

    // ── Drivers de BFR ──
    driver_delai_clients_jours: IdSchema.default('delai_clients_jours'),
    driver_delai_fournisseurs_jours: IdSchema.default('delai_fournisseurs_jours'),
    driver_rotation_stock_jours: IdSchema.default('rotation_stock_jours'),
  })
  .strict();

export type StructureFinanciere = z.infer<typeof StructureFinanciereSchema>;

// ─── Template racine ──────────────────────────────────────────
// Conforme au brief §7 pour les champs présents ; les champs futurs (parameter_pack,
// horizon_mois, sorties…) sont acceptés en optionnel — ils seront exploités à partir de S2/S7.
export const TemplateSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z][a-z0-9-]*$/, 'slug invalide (attendu : ^[a-z][a-z0-9-]*$)'),
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, 'version invalide (attendu : semver majeur.mineur.patch)'),
    secteur: z.string().optional(),
    pays: z.array(z.string().length(2)).optional(),
    devise_base: CurrencySchema.optional(),
    horizon_mois: z.number().int().positive().max(120).optional(),
    parameter_pack: z.string().optional(),
    groupes_hypotheses: z.array(GroupeSchema).optional(),
    /**
     * (S18c) Bloc de présentation du wizard de saisie — aucune sémantique de calcul.
     * Absent → fallback « une étape par groupe d'hypothèses » (voir {@link resolveEtapes}).
     */
    wizard: WizardSchema.optional(),
    drivers: z.array(DriverSchema).min(1, 'au moins un driver requis'),
    feuilles: z.array(FeuilleSchema).min(1, 'au moins une feuille requise'),
    sorties: z.array(IdSchema).optional(),
    /**
     * (S14c) Liste d'immobilisations amortissables. Si présente, l'évaluateur produit
     * une feuille synthétique `amortissements` (méthode linéaire SYSCOHADA révisé)
     * et injecte la DAP annuelle dans le compte de résultat / la projection.
     */
    immobilisations: z.array(ImmobilisationSchema).optional(),
    /**
     * (S14c, révisé S18a) Horizon en années de la feuille amortissements et des
     * états financiers prévisionnels. Défaut = 5 exercices (docs/07 « horizon
     * standard : 5 exercices » — l'ancien défaut de 3 contredisait docs/07, cf.
     * ADR-0011 § Contradictions 2).
     */
    horizon_projection_annees: z.number().int().positive().max(30).optional(),
    /**
     * (S18a, FIN-001) Active les états financiers prévisionnels : BFR, CAF, bilan
     * équilibré et seuil de rentabilité sur `horizon_projection_annees` exercices.
     * Absent = aucune feuille supplémentaire (compatibilité S6→S14).
     */
    structure_financiere: StructureFinanciereSchema.optional(),
  })
  .strict();

export type Template = z.infer<typeof TemplateSchema>;

// ─── Validation croisée (unicité des id) ──────────────────────
// Ces vérifications ne sont pas exprimables en Zod pur → helper séparé.

import { DuplicateIdError, type EngineError } from './errors.js';

export interface CollectedIds {
  readonly drivers: ReadonlySet<string>;
  readonly lignes: ReadonlySet<string>;
  readonly feuilles: ReadonlySet<string>;
  readonly groupes: ReadonlySet<string>;
  /** (S18c) Ids des étapes du wizard — vide si le template n'en déclare pas. */
  readonly etapes: ReadonlySet<string>;
}

/**
 * Parcourt le template déjà validé par Zod et lève une {@link DuplicateIdError}
 * dès qu'un identifiant est réutilisé au sein de la même catégorie ou entre driver/ligne
 * (les deux vivent dans le même espace de noms de formules).
 */
export function collectIds(template: Template): CollectedIds {
  const drivers = new Set<string>();
  const lignes = new Set<string>();
  const feuilles = new Set<string>();
  const groupes = new Set<string>();
  const etapes = new Set<string>();

  for (const g of template.groupes_hypotheses ?? []) {
    if (groupes.has(g.id)) throw new DuplicateIdError('groupe', g.id);
    groupes.add(g.id);
  }
  // (S18c) Les étapes vivent dans leur propre espace de noms — elles ne sont jamais
  // référencées par une formule. Seule l'unicité des ids est vérifiée ici.
  //
  // Un groupe rattaché mais inexistant n'est PAS une erreur d'exécution : une clé de
  // présentation ne doit jamais empêcher un template de parser ni le moteur d'évaluer
  // (ADR-0011, Contrat 3). `resolveEtapes` l'ignore, et la cohérence des templates
  // livrés est vérifiée par `findUnknownWizardGroupes` dans leurs tests.
  for (const e of template.wizard?.etapes ?? []) {
    if (etapes.has(e.id)) throw new DuplicateIdError('etape', e.id);
    etapes.add(e.id);
  }
  for (const d of template.drivers) {
    if (drivers.has(d.id)) throw new DuplicateIdError('driver', d.id);
    drivers.add(d.id);
  }
  for (const f of template.feuilles) {
    if (feuilles.has(f.id)) throw new DuplicateIdError('feuille', f.id);
    feuilles.add(f.id);
    for (const l of f.lignes) {
      if (lignes.has(l.id) || drivers.has(l.id)) {
        // Un id de ligne ne peut pas doubler un id de driver — sinon les formules deviennent ambiguës.
        throw new DuplicateIdError('ligne', l.id);
      }
      lignes.add(l.id);
    }
  }

  return { drivers, lignes, feuilles, groupes, etapes };
}

// ─── Résolution des étapes du wizard (S18c) ───────────────────

/**
 * Calcule la liste ordonnée des étapes de saisie d'un template.
 *
 * L'algorithme vit dans @lalanda/shared : le web l'applique à l'identique, sans
 * réimplémentation (revue CTO S18c, point I5). Voir {@link resolveWizardEtapes}
 * pour les règles de tri, de filtrage et de fallback.
 */
export function resolveEtapes(template: Template): ResolvedEtape[] {
  return resolveWizardEtapes(template.groupes_hypotheses ?? [], template.wizard?.etapes ?? []);
}

export { DuplicateIdError, type EngineError };
export { GROUPE_TOUS, findUnknownWizardGroupes, type ResolvedEtape };
