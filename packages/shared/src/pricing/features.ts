// ─────────────────────────────────────────────────────────────────────────────
// FONCTIONNALITÉS PAR OFFRE — CATALOGUE (ADR-0053 § 6.3, lot P4)
//
// Une clé par fonctionnalité de la table « Répartition des fonctionnalités par
// offre » de docs/13, avec son libellé, son module, les préfixes de routes API
// qu'elle couvre et sa valeur par offre.
//
// ── Grille ENTIÈREMENT OUVERTE ───────────────────────────────────────────────
//
// La répartition est « À ARBITRER » (docs/13, décision de la dirigeante du
// 27 oct. 2026 : finir les fonctionnalités, les laisser ouvertes, répartir
// ensuite). Chaque valeur ci-dessous vaut donc `true` pour chaque offre : ce
// catalogue POSE le mécanisme, il ne ferme RIEN. Fermer une case est un
// arbitrage commercial (docs/13), revu, testé et versionné — jamais un clic de
// console (ADR-0053 O5-b, décision ouverte n° 10).
//
// Les six `Entitlements` (projets, PDF, IA, sièges, réalisé) restent tels quels
// et gardent leurs propres gardes (`project-limit.ts`, quotas) : une
// fonctionnalité dit ce qu'une offre PERMET de faire, un droit dit COMBIEN.
//
// ── Ce que ce module ne fait pas ─────────────────────────────────────────────
//
// Il ne décide rien côté navigateur : l'API impose (`FeatureGuard`), l'interface
// explique (« Disponible avec l'offre … »). La règle de docs/13 tient : une
// limite porte sur les GESTES FUTURS, jamais sur le patrimoine — lire et
// exporter l'existant restent permis (`isFeatureGatedMethod`).
//
// NOTE : `./index.js` réexporte ce fichier. N'en importer que des TYPES : une
// valeur importée d'`index.js` serait lue avant son initialisation (import
// circulaire), d'où l'ordre des offres recopié dans `FEATURE_PLAN_ORDER` et
// vérifié égal à `PLANS` par le test.
// ─────────────────────────────────────────────────────────────────────────────

import type { Plan } from './index.js';

/** Clés des fonctionnalités, dans l'ordre d'affichage (BUILD → RUN → GROW). */
export const FEATURE_KEYS = [
  'idea_lab',
  'business_plan',
  'run_work',
  'crm',
  'quotes',
  'normalized_invoicing',
  'invoice_templates',
  'sales_contracts',
  'treasury',
  'purchases',
  'hr',
  'stock',
  'assets',
  'documents',
  'accounting',
  'morning_brief',
  'grow',
  'lala_vocal',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === 'string' && (FEATURE_KEYS as readonly string[]).includes(value);
}

/** Module de la trajectoire (ADR-0038) auquel la fonctionnalité appartient. */
export type FeatureModule = 'build' | 'run' | 'grow';

/** Ordre des offres, du moins au plus riche — copie de `PLANS` (voir la note d'en-tête). */
export const FEATURE_PLAN_ORDER: readonly Plan[] = ['free', 'pro', 'cabinet', 'business', 'expert'];

/** Valeur d'une fonctionnalité pour chaque offre : `true` = permise. */
export type FeaturePlanValues = Readonly<Record<Plan, boolean>>;

export interface FeatureDefinition {
  readonly key: FeatureKey;
  readonly label: string;
  readonly module: FeatureModule;
  /** Préfixes des routes API couvertes (`@RequireFeature` sur leurs contrôleurs). */
  readonly apiPrefixes: readonly string[];
  /** Valeur par offre. Aujourd'hui : ouverte partout (docs/13 « À ARBITRER »). */
  readonly plans: FeaturePlanValues;
}

/** Grille actuelle de chaque fonctionnalité : ouverte à toutes les offres. */
const OPEN: FeaturePlanValues = Object.freeze({
  free: true,
  pro: true,
  cabinet: true,
  business: true,
  expert: true,
});

function feature(
  key: FeatureKey,
  label: string,
  module: FeatureModule,
  apiPrefixes: readonly string[],
): FeatureDefinition {
  return Object.freeze({
    key,
    label,
    module,
    apiPrefixes: Object.freeze([...apiPrefixes]),
    plans: OPEN,
  });
}

/** LE CATALOGUE. Ajouter une fonctionnalité = une ligne ici ET son décorateur côté API. */
export const FEATURES: Readonly<Record<FeatureKey, FeatureDefinition>> = Object.freeze({
  idea_lab: feature('idea_lab', 'Idea Lab', 'build', ['/idea-lab']),
  business_plan: feature('business_plan', 'Business plan rédigé', 'build', [
    '/business-plan',
    '/projects/:projectId/business-plan',
  ]),
  run_work: feature('run_work', 'Projets et tâches, temps passé, marge', 'run', ['/work']),
  crm: feature('crm', 'CRM', 'run', ['/crm']),
  quotes: feature('quotes', 'Devis', 'run', ['/sales/quotes']),
  normalized_invoicing: feature(
    'normalized_invoicing',
    'Facturation normalisée, avoirs, encaissements',
    'run',
    ['/sales/invoices', '/sales/receipts', '/sales/journal', '/sales/normalization'],
  ),
  invoice_templates: feature('invoice_templates', 'Modèles de facture', 'run', [
    '/sales/invoice-templates',
    '/sales/invoice-template-packages',
  ]),
  sales_contracts: feature('sales_contracts', 'Commandes et contrats', 'run', [
    '/sales/orders',
    '/sales/contracts',
    '/sales/contract-settings',
    '/sales/quotes/:quoteId/to-order',
    '/sales/quotes/:quoteId/to-contract',
  ]),
  treasury: feature('treasury', 'Trésorerie', 'run', ['/treasury']),
  purchases: feature('purchases', 'Achats et fournisseurs', 'run', ['/purchases']),
  hr: feature('hr', 'Ressources humaines', 'run', ['/hr']),
  stock: feature('stock', 'Stocks', 'run', ['/stock']),
  assets: feature('assets', 'Équipements', 'run', ['/assets']),
  documents: feature('documents', 'Bibliothèque de documents', 'run', ['/documents']),
  accounting: feature('accounting', 'Comptabilité', 'run', ['/accounting']),
  morning_brief: feature('morning_brief', 'Brief du matin', 'grow', ['/morning-brief']),
  grow: feature('grow', 'GROW : santé, indicateurs, parcours', 'grow', ['/grow']),
  lala_vocal: feature('lala_vocal', 'Lala vocal', 'grow', ['/ai/lala/vocal']),
});

/** Grille fonctionnalité × offre. Remplaçable (tests, future grille arbitrée). */
export type FeatureGrid = Readonly<Record<FeatureKey, FeaturePlanValues>>;

/** La grille du catalogue — entièrement ouverte. */
export const DEFAULT_FEATURE_GRID: FeatureGrid = Object.freeze(
  Object.fromEntries(FEATURE_KEYS.map((k) => [k, FEATURES[k].plans])) as Record<
    FeatureKey,
    FeaturePlanValues
  >,
);

/** La fonctionnalité est-elle ouverte à TOUTES les offres ? (chemin rapide de la garde) */
export function isFeatureOpenEverywhere(grid: FeatureGrid, key: FeatureKey): boolean {
  return FEATURE_PLAN_ORDER.every((p) => grid[key][p]);
}

/** Offre la moins riche qui permet la fonctionnalité, ou `null` si aucune. */
export function minimalPlanFor(grid: FeatureGrid, key: FeatureKey): Plan | null {
  return FEATURE_PLAN_ORDER.find((p) => grid[key][p]) ?? null;
}

/**
 * Méthodes HTTP soumises à la garde. Lecture et export de l'existant restent
 * permis (docs/13 : une limite porte sur les gestes futurs, jamais sur le
 * patrimoine).
 */
export function isFeatureGatedMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';
}

export type FeatureAccessSource = 'plan' | 'override';

export type FeatureAccessDecision =
  | { readonly allowed: true; readonly source: FeatureAccessSource }
  | {
      readonly allowed: false;
      readonly code: 'FEATURE_NOT_IN_PLAN';
      readonly minimalPlan: Plan | null;
    };

export interface FeatureAccessInput {
  readonly grid: FeatureGrid;
  readonly feature: FeatureKey;
  readonly plan: Plan;
  /** Échéance d'une dérogation ACTIVE (non révoquée) qui ouvre la fonctionnalité, ou `null`. */
  readonly overrideEndsAt: Date | null;
  readonly now: Date;
}

/** Décision pure : l'offre permet, sinon une dérogation non échue rouvre, sinon refus. */
export function featureAccessDecision(input: FeatureAccessInput): FeatureAccessDecision {
  if (input.grid[input.feature][input.plan]) return { allowed: true, source: 'plan' };
  if (input.overrideEndsAt !== null && input.overrideEndsAt.getTime() > input.now.getTime()) {
    return { allowed: true, source: 'override' };
  }
  return {
    allowed: false,
    code: 'FEATURE_NOT_IN_PLAN',
    minimalPlan: minimalPlanFor(input.grid, input.feature),
  };
}

// ── Contrat de `GET /me/features` ────────────────────────────────────────────

/** `included` : l'offre la permet ; `override` : dérogation active ; `not_in_plan` : absente. */
export type MyFeatureStatus = 'included' | 'override' | 'not_in_plan';

export interface MyFeatureView {
  readonly key: FeatureKey;
  readonly label: string;
  readonly module: FeatureModule;
  readonly status: MyFeatureStatus;
  /** Offre la moins riche qui la permet (`null` : aucune). */
  readonly minimalPlan: Plan | null;
  /** Dérogation : échéance ISO, et raison GÉNÉRIQUE (catégorie), jamais l'opérateur. */
  readonly overrideEndsAt: string | null;
  readonly overrideReason: string | null;
}

export interface MyFeaturesView {
  readonly plan: Plan;
  readonly features: readonly MyFeatureView[];
}

/**
 * Explication d'une fonctionnalité absente, à AFFICHER (jamais à cacher) :
 * « Disponible avec l'offre Pro ». `planName` : nom commercial de l'offre.
 */
export function featureUnavailableLabel(minimalPlanName: string | null): string {
  return minimalPlanName === null
    ? 'Non comprise dans votre offre'
    : `Disponible avec l’offre ${minimalPlanName}`;
}
