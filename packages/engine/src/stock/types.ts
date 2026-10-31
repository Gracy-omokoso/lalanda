// ─────────────────────────────────────────────────────────────────────────────
// Stocks — types (ADR-0046 § 7.1)
//
// Module PUR : aucune base, aucun réseau, aucune horloge (le jour de référence
// est un paramètre, jour civil de Kinshasa déjà calculé par l'appelant,
// ADR-0027). Entrées et sorties en chaînes décimales ; arithmétique en entiers
// `bigint` : quantités en MILLIÈMES, montants en CENTIMES, coûts unitaires et
// facteurs de conversion en MILLIONIÈMES. Jamais de flottant, JAMAIS de
// conversion entre devises : chaque article est valorisé dans sa seule devise
// de coût.
//
// Aucune règle comptable ni fiscale (ADR-0046 § 9) : le coût moyen pondéré est
// une MESURE DE GESTION ; aucune dépréciation, aucune provision.
// ─────────────────────────────────────────────────────────────────────────────

/** Toute évolution d'un calcul de ce module incrémente cette version. */
export const STOCK_VERSION = '1.0.0';

/** Devises de valorisation (ADR-0046 § 1). */
export const STOCK_CURRENCIES = ['CDF', 'USD'] as const;
export type StockCurrency = (typeof STOCK_CURRENCIES)[number];

/** Date civile `AAAA-MM-JJ` (jour de Kinshasa). */
export type StockDay = string;
/** Horodatage UTC ISO 8601 (`2026-10-31T08:15:00.000Z`). */
export type StockTimestamp = string;
/** Quantité décimale, trois décimales au plus, signée dans le grand livre (« -2.5 »). */
export type StockQuantity = string;
/** Montant décimal, deux décimales au plus, signé quand il s'agit d'un écart. */
export type StockAmount = string;
/** Coût unitaire décimal, six décimales au plus. */
export type StockUnitCost = string;

// ─── Articles ────────────────────────────────────────────────────────────────

export const STOCK_ITEM_KINDS = ['goods', 'consumable', 'material'] as const;
export type StockItemKind = (typeof STOCK_ITEM_KINDS)[number];

/** 1 `unit` = `factor` unités de stock (`factor` > 0, six décimales au plus). */
export interface UnitConversionInput {
  unit: string;
  factor: string;
}

/** Seuil d'alerte (§ 2.1) : global (`locationId: null`) ou pour un emplacement. */
export interface ReorderInput {
  /** ≥ 0, trois décimales au plus. */
  minQuantity: StockQuantity;
  /** > `minQuantity` attendu ; absent ou `null` : la suggestion vise le seuil. */
  targetQuantity?: StockQuantity | null;
  locationId: string | null;
}

export interface StockItemInput {
  id: string;
  /** Unité de stock. */
  unit: string;
  unitConversions?: readonly UnitConversionInput[];
  costCurrency: StockCurrency;
  /** `false` : article référencé sans suivi ; absent = `true`. */
  tracked?: boolean;
  /** Absent = `true`. */
  active?: boolean;
  kind?: StockItemKind;
  reorder?: ReorderInput | null;
  preferredSupplierId?: string | null;
  /**
   * Unité DISCRÈTE (pièce, carton) : la suggestion de réapprovisionnement est
   * arrondie à l'unité entière supérieure. Absent = `false` (unité divisible).
   */
  discreteUnit?: boolean;
}

// ─── Grand livre ─────────────────────────────────────────────────────────────

export const STOCK_MOVEMENT_KINDS = [
  'opening',
  'purchase_receipt',
  'purchase_receipt_reversal',
  'sale_issue',
  'sale_return',
  'issue',
  'issue_return',
  'transfer_out',
  'transfer_in',
  'adjustment',
  'count_adjustment',
  'supplier_return',
] as const;
export type StockMovementKind = (typeof STOCK_MOVEMENT_KINDS)[number];

export const STOCK_COST_STATUSES = ['valued', 'pending_cost', 'not_applicable'] as const;
export type StockCostStatus = (typeof STOCK_COST_STATUSES)[number];

/**
 * Mouvement du grand livre (§ 2.3). Ordre de rejeu : `occurredOn`, puis `id`
 * (ordre d'écriture : identifiants croissants, ObjectId hexadécimaux).
 *
 * - entrée (quantité > 0) `valued` : `unitCost` requis ;
 * - entrée `pending_cost` : quantité comptée, valeur non (valorisation incomplète) ;
 * - entrée `not_applicable` sans `unitCost` (retour, écart positif, contre-passation
 *   d'une sortie) : valorisée au coût moyen COURANT au moment du rejeu ;
 * - sortie (quantité < 0) : `unitCost` nul, valorisée par le moteur ;
 * - transferts : quantités par emplacement, aucun effet sur la valeur ni le coût moyen.
 */
export interface StockMovementInput {
  id: string;
  itemId: string;
  locationId: string;
  kind: StockMovementKind;
  /** Signée, jamais nulle, trois décimales au plus. */
  quantity: StockQuantity;
  occurredOn: StockDay;
  unitCost?: StockUnitCost | null;
  costStatus: StockCostStatus;
  workProjectId?: string | null;
  /** Contre-passation : le signe est l'inverse du sens habituel du type. */
  reversalOf?: string | null;
  /** Horodatage d'écriture ; requis par `countVariances` seulement. */
  recordedAt?: StockTimestamp;
}

// ─── Conversions et coût d'entrée ────────────────────────────────────────────

export type StockQuantityConversion =
  | { version: string; ok: true; quantity: StockQuantity; factor: string }
  | { version: string; ok: false; code: 'UNKNOWN_UNIT' };

/** Ligne de commande (ou de facture) dont on tire un coût d'entrée. */
export interface EntryCostLineInput {
  /** HT, ≥ 0, deux décimales au plus, par `unit`. */
  unitPrice: StockAmount;
  /** 0 à 100, deux décimales au plus ; absent ou `null` = aucune remise. */
  discountPercent?: string | null;
  unit: string;
  /** Devise de la commande. */
  currency: StockCurrency;
}

export type EntryUnitCost =
  | { version: string; status: 'valued'; unitCost: StockUnitCost; factor: string }
  | { version: string; status: 'pending_cost'; code: 'CURRENCY_DIFFERS' }
  | { version: string; status: 'unknown_unit'; code: 'UNKNOWN_UNIT' };

// ─── Valorisation ────────────────────────────────────────────────────────────

export interface ValuationStep {
  movementId: string;
  kind: StockMovementKind;
  occurredOn: StockDay;
  quantity: StockQuantity;
  /** Coût unitaire appliqué à une entrée (saisi ou coût moyen courant) ; `null` sinon. */
  unitCost: StockUnitCost | null;
  /** Valeur d'une entrée valorisée (q × coût, au centime) ; `null` sinon. */
  entryValue: StockAmount | null;
  /** Coût d'une sortie ; `null` pour une entrée ou une sortie sans coût moyen connu. */
  exitCost: StockAmount | null;
  /** Le mouvement a reçu une valeur (entrée valorisée ou sortie au coût moyen). */
  valued: boolean;
  /** Sortie qui vide le stock : valeur restante − q × CMUP (signé, souvent 0). */
  roundingResidue: StockAmount;
  /** Entrée sur stock négatif : réévaluation des unités manquantes au nouveau coût. */
  negativeStockRevaluation: StockAmount;
  quantityAfter: StockQuantity;
  valueAfter: StockAmount;
  averageUnitCostAfter: StockUnitCost | null;
}

export type ValuationFindingCode = 'UNVALUED_ENTRIES' | 'NEGATIVE_STOCK';

export interface WeightedAverageValuation {
  version: string;
  itemId: string;
  currency: StockCurrency;
  until: StockDay | null;
  /** Quantité totale tous emplacements (transferts exclus). */
  quantity: StockQuantity;
  /** Valeur des seules entrées valorisées, moins les sorties. */
  value: StockAmount;
  /** CMUP courant ; `null` tant qu'aucune entrée n'a été valorisée. */
  averageUnitCost: StockUnitCost | null;
  /** Faux si une entrée attend son coût ou n'a pu être valorisée. */
  complete: boolean;
  unvaluedEntryCount: number;
  unvaluedExitCount: number;
  /** Σ des entrées valorisées. */
  entriesValue: StockAmount;
  /** Σ des coûts de sortie. */
  exitsCost: StockAmount;
  /** Σ des restes d'arrondi rendus (déjà inclus dans `exitsCost`). */
  roundingResidue: StockAmount;
  /** Σ des réévaluations ; identité : entrées = sorties + valeur + réévaluations. */
  negativeStockRevaluation: StockAmount;
  /** Σ des quantités de transfert : 0 si chaque sortie a son entrée. */
  unpairedTransferQuantity: StockQuantity;
  findings: ValuationFindingCode[];
  steps: ValuationStep[];
}

export interface ItemValuation {
  itemId: string;
  currency: StockCurrency;
  quantity: StockQuantity;
  value: StockAmount;
  averageUnitCost: StockUnitCost | null;
  complete: boolean;
}

export interface StockValuation {
  version: string;
  until: StockDay | null;
  locationId: string | null;
  /**
   * Par article. Avec `locationId` : quantité de l'emplacement et valeur
   * = quantité × CMUP de l'article (au centime), sans changer le CMUP.
   */
  items: ItemValuation[];
  /** Σ par devise ; jamais de total toutes devises. */
  byCurrency: {
    currency: StockCurrency;
    value: StockAmount;
    itemCount: number;
    complete: boolean;
  }[];
}

// ─── Niveaux ─────────────────────────────────────────────────────────────────

export interface StockLevel {
  itemId: string;
  locationId: string;
  quantity: StockQuantity;
  lastOccurredOn: StockDay;
  movementCount: number;
}

export interface StockLevels {
  version: string;
  levels: StockLevel[];
}

export interface CachedLevelInput {
  itemId: string;
  locationId: string;
  quantity: StockQuantity;
}

export interface StockLevelDrift {
  code: 'STOCK_LEVEL_DRIFT';
  itemId: string;
  locationId: string;
  cached: StockQuantity;
  ledger: StockQuantity;
  /** grand livre − cache, signé. */
  difference: StockQuantity;
}

export interface StockLevelDriftReport {
  version: string;
  ok: boolean;
  drifts: StockLevelDrift[];
}

// ─── Contrôle du stock négatif (O4) ──────────────────────────────────────────

export interface AvailabilityRequestLine {
  itemId: string;
  locationId: string;
  /** Quantité à sortir, > 0. */
  quantity: StockQuantity;
}

export interface StockShortfall {
  itemId: string;
  locationId: string;
  available: StockQuantity;
  requested: StockQuantity;
  /** demandé − disponible, > 0. */
  shortfall: StockQuantity;
}

export interface StockAvailabilityCheck {
  version: string;
  /** Faux seulement si un manque existe et que le négatif manuel est refusé. */
  ok: boolean;
  code: 'STOCK_INSUFFICIENT' | null;
  /** Manques constatés (rendus même quand le négatif est permis : alerte). */
  shortfalls: StockShortfall[];
  /** Le négatif est permis et sera atteint : alerte `NEGATIVE_STOCK`. */
  goesNegative: boolean;
}

// ─── Inventaires ─────────────────────────────────────────────────────────────

export interface CountLineInput {
  id: string;
  itemId: string;
  /** `null` : ligne non encore comptée. */
  countedQuantity: StockQuantity | null;
  countedAt: StockTimestamp | null;
  /** Coût saisi (stock initial) : valorise un écart POSITIF. */
  unitCost?: StockUnitCost | null;
}

export interface CountVarianceLine {
  lineId: string;
  itemId: string;
  status: 'counted' | 'not_counted';
  /** Théorique à l'emplacement à `countedAt` (mouvements écrits jusque-là). */
  theoretical: StockQuantity | null;
  counted: StockQuantity | null;
  /** compté − théorique, signé. */
  variance: StockQuantity | null;
  currency: StockCurrency;
  /** Écart × coût (saisi pour un écart positif, sinon CMUP à `countedAt`), signé. */
  valuedVariance: StockAmount | null;
  /** Coût à porter par le `count_adjustment` : saisi, ou `null` (coût moyen courant). */
  adjustmentUnitCost: StockUnitCost | null;
  /** Écart positif d'un article jamais valorisé, sans coût saisi. */
  needsUnitCost: boolean;
}

export interface CountVariances {
  version: string;
  locationId: string;
  lines: CountVarianceLine[];
  byCurrency: {
    currency: StockCurrency;
    gains: StockAmount;
    losses: StockAmount;
    net: StockAmount;
    unvaluedLineCount: number;
  }[];
  countedLineCount: number;
  varianceLineCount: number;
}

// ─── Réapprovisionnement ─────────────────────────────────────────────────────

/** Reste à recevoir d'une commande R3, déjà converti en unité de stock. */
export interface OpenOrderQuantityInput {
  itemId: string;
  quantity: StockQuantity;
}

export interface ReplenishmentSuggestion {
  itemId: string;
  /** `null` : seuil global (tous emplacements). */
  locationId: string | null;
  available: StockQuantity;
  minQuantity: StockQuantity;
  targetQuantity: StockQuantity | null;
  onOrder: StockQuantity;
  /** max(0, (cible ou seuil) − disponible − commandé), arrondi si l'unité est discrète. */
  suggestedQuantity: StockQuantity;
  preferredSupplierId: string | null;
}

export interface ReplenishmentSuggestions {
  version: string;
  suggestions: ReplenishmentSuggestion[];
}

// ─── Constats ────────────────────────────────────────────────────────────────

export type StockFindingCode =
  | 'NEGATIVE_STOCK'
  | 'BELOW_REORDER'
  | 'UNVALUED_ENTRIES'
  | 'ENTRY_COST_DIFFERS_FROM_INVOICE'
  | 'DORMANT_ITEM';

export interface StockFinding {
  code: StockFindingCode;
  itemId: string;
  locationId: string | null;
  movementId: string | null;
  details: Record<string, string>;
}

/** Entrée à comparer au prix de la facture fournisseur (§ 2.3.1). */
export interface EntryCostCheckInput {
  movementId: string;
  invoiceLine: EntryCostLineInput;
}

export interface StockFindingsInput {
  items: readonly StockItemInput[];
  movements: readonly StockMovementInput[];
  today: StockDay;
  /** Aucun mouvement depuis ce nombre de jours (≥ 1) ; absent : pas de constat. */
  dormantDays?: number | null;
  costChecks?: readonly EntryCostCheckInput[];
  openOrders?: readonly OpenOrderQuantityInput[];
}

export interface StockFindings {
  version: string;
  findings: StockFinding[];
}

// ─── Rapports ────────────────────────────────────────────────────────────────

export interface StockPeriod {
  from: StockDay;
  to: StockDay;
}

export interface KindQuantityValue {
  kind: StockMovementKind;
  quantity: StockQuantity;
  /** Valeur des entrées ou coût des sorties valorisés. */
  value: StockAmount;
  count: number;
  unvaluedCount: number;
}

export interface ItemReport {
  itemId: string;
  currency: StockCurrency;
  openingQuantity: StockQuantity;
  openingValue: StockAmount;
  entries: KindQuantityValue[];
  exits: KindQuantityValue[];
  transfersQuantity: StockQuantity;
  closingQuantity: StockQuantity;
  closingValue: StockAmount;
  complete: boolean;
}

export interface CurrencyReport {
  currency: StockCurrency;
  openingValue: StockAmount;
  entriesValue: StockAmount;
  exitsCost: StockAmount;
  /** Sorties de vente − retours de vente (indicateur de gestion, § 6.2). */
  costOfSales: StockAmount;
  /** Bons de sortie − retours au magasin. */
  consumption: StockAmount;
  closingValue: StockAmount;
  complete: boolean;
}

export interface ProjectMaterials {
  workProjectId: string;
  currency: StockCurrency;
  /** Sorties `issue` nettes des retours, au coût moyen. */
  consumedValue: StockAmount;
  issueCount: number;
  unvaluedCount: number;
}

export interface StockReport {
  version: string;
  period: StockPeriod;
  items: ItemReport[];
  byCurrency: CurrencyReport[];
  byProject: ProjectMaterials[];
}

export interface ProjectMaterialsResult {
  version: string;
  projects: ProjectMaterials[];
}
