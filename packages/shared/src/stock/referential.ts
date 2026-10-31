// Contrats du référentiel des stocks : articles et emplacements (ADR-0046 § 2.1, § 2.2,
// § 5.1). ADR-0046 — S3.
//
// Corps `.strict()`, identifiants ramenés en minuscules, quantités et coûts en chaînes.
// Les règles qui exigent la base (ressource d'une autre organisation → 404, unité ou
// devise verrouillée, catalogue `BIE` seulement, code unique) sont vérifiées par le
// service. Les VALEURS (coût moyen, valeur) valent `null` quand `valuesHidden`.

import { z } from 'zod';

import {
  StockCurrencySchema,
  StockExpectedRevision,
  StockId,
  StockItemKindSchema,
  StockLocationKindSchema,
  StockReorderSchema,
  StockUnitConversionsSchema,
  StockUnitSchema,
  stockBooleanParam,
  stockFr,
  stockOptionalText,
  stockRequiredText,
} from './common.js';
import {
  STOCK_LIMITS,
  STOCK_PAGE_LIMIT_DEFAULT,
  STOCK_PAGE_LIMIT_MAX,
  type StockCurrency,
  type StockFindingCode,
  type StockItemKind,
  type StockLocationKind,
} from './constants.js';

const L = STOCK_LIMITS;

/** Curseur opaque et taille de page, communs aux listes des stocks. */
export const StockCursor = z.string().min(1).max(512);
export const StockPageLimit = z.coerce
  .number()
  .int()
  .min(1)
  .max(STOCK_PAGE_LIMIT_MAX)
  .default(STOCK_PAGE_LIMIT_DEFAULT);

// ── Articles (§ 2.1) ────────────────────────────────────────────────────────

const itemFields = {
  code: stockOptionalText(L.itemCode).optional(),
  name: stockRequiredText(L.itemName, 'Nom'),
  description: stockOptionalText(L.itemDescription).optional(),
  kind: StockItemKindSchema,
  /** Article du catalogue de vente de type `BIE` (O1), unique par organisation. */
  catalogItemId: StockId.nullable().optional(),
  unit: StockUnitSchema,
  unitConversions: StockUnitConversionsSchema,
  /** Défaut : `defaultCostCurrency` des réglages des stocks. */
  costCurrency: StockCurrencySchema,
  tracked: z.boolean(stockFr('Booléen attendu.')),
  /**
   * Unité DISCRÈTE (pièce, carton) : la suggestion de réapprovisionnement est arrondie
   * à l'unité entière supérieure (moteur `replenishmentSuggestions`).
   */
  discreteUnit: z.boolean(stockFr('Booléen attendu.')),
  defaultLocationId: StockId.nullable().optional(),
  reorder: StockReorderSchema.nullable().optional(),
  preferredSupplierId: StockId.nullable().optional(),
};

export const CreateStockItemBody = z
  .object({
    ...itemFields,
    kind: itemFields.kind.default('goods'),
    unitConversions: itemFields.unitConversions.default([]),
    costCurrency: itemFields.costCurrency.optional(),
    tracked: itemFields.tracked.default(true),
    discreteUnit: itemFields.discreteUnit.default(false),
  })
  .strict();
export type CreateStockItemBody = z.output<typeof CreateStockItemBody>;

export const UpdateStockItemBody = z
  .object({
    code: itemFields.code,
    name: itemFields.name.optional(),
    description: itemFields.description,
    kind: itemFields.kind.optional(),
    catalogItemId: itemFields.catalogItemId,
    unit: itemFields.unit.optional(),
    unitConversions: itemFields.unitConversions.optional(),
    costCurrency: itemFields.costCurrency.optional(),
    tracked: itemFields.tracked.optional(),
    discreteUnit: itemFields.discreteUnit.optional(),
    defaultLocationId: itemFields.defaultLocationId,
    reorder: itemFields.reorder,
    preferredSupplierId: itemFields.preferredSupplierId,
    expectedRevision: StockExpectedRevision,
  })
  .strict();
export type UpdateStockItemBody = z.output<typeof UpdateStockItemBody>;

/** Archiver, restaurer : seule la révision attendue. */
export const StockRevisionBody = z.object({ expectedRevision: StockExpectedRevision }).strict();
export type StockRevisionBody = z.output<typeof StockRevisionBody>;

export const ListStockItemsQuery = z
  .object({
    /** Recherche sur le nom et le code (normalisés). Un nom d'article n'est pas sensible. */
    q: z.string().trim().max(L.itemName).optional(),
    kind: StockItemKindSchema.optional(),
    /** Défaut : actifs seulement. */
    active: stockBooleanParam.optional(),
    cursor: StockCursor.optional(),
    limit: StockPageLimit,
  })
  .strict();
export type ListStockItemsQuery = z.output<typeof ListStockItemsQuery>;

export interface StockItemLevelView {
  locationId: string;
  locationName: string | null;
  /** Quantité du cache `stock_levels`, trois décimales. */
  quantity: string;
}

export interface StockFindingView {
  code: StockFindingCode;
  locationId: string | null;
  movementId: string | null;
  details: Record<string, string>;
}

export interface StockItemView {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  kind: StockItemKind;
  catalogItemId: string | null;
  unit: string;
  unitConversions: { unit: string; factor: string }[];
  costCurrency: StockCurrency;
  tracked: boolean;
  discreteUnit: boolean;
  defaultLocationId: string | null;
  reorder: { minQuantity: string; targetQuantity: string | null; locationId: string | null } | null;
  preferredSupplierId: string | null;
  active: boolean;
  /** Au moins un mouvement : l'unité est verrouillée. */
  hasMovements: boolean;
  /** Quantité tous emplacements (cache). */
  quantity: string;
  levels: StockItemLevelView[];
  /** Valeurs (moteur `weightedAverageValuation`) : `null` si `valuesHidden`. */
  averageUnitCost: string | null;
  value: string | null;
  /** Faux si une entrée attend son coût ; `null` si `valuesHidden`. */
  valuationComplete: boolean | null;
  /** Constats du moteur (`stockFindings`), sur la fiche seulement (liste : `[]`). */
  findings: StockFindingView[];
  valuesHidden: boolean;
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface StockItemPage {
  items: StockItemView[];
  nextCursor: string | null;
  valuesHidden: boolean;
}

// ── Emplacements (§ 2.2) ────────────────────────────────────────────────────

const PointOfSaleIds = z
  .array(z.string().trim().min(1).max(64), stockFr('Liste de points de vente attendue.'))
  .max(L.pointOfSaleIds, { message: `${L.pointOfSaleIds} points de vente au plus.` });

export const CreateStockLocationBody = z
  .object({
    name: stockRequiredText(L.locationName, 'Nom'),
    kind: StockLocationKindSchema.default('warehouse'),
    /** Projet RUN (chantier) : une sortie vers cet emplacement est un transfert. */
    workProjectId: StockId.nullable().optional(),
    address: stockOptionalText(L.locationAddress).optional(),
    responsibleUserId: z.string().trim().min(1).max(64).nullable().optional(),
    pointOfSaleIds: PointOfSaleIds.default([]),
  })
  .strict();
export type CreateStockLocationBody = z.output<typeof CreateStockLocationBody>;

export const UpdateStockLocationBody = z
  .object({
    name: stockRequiredText(L.locationName, 'Nom').optional(),
    kind: StockLocationKindSchema.optional(),
    workProjectId: StockId.nullable().optional(),
    address: stockOptionalText(L.locationAddress).optional(),
    responsibleUserId: z.string().trim().min(1).max(64).nullable().optional(),
    pointOfSaleIds: PointOfSaleIds.optional(),
    expectedRevision: StockExpectedRevision,
  })
  .strict();
export type UpdateStockLocationBody = z.output<typeof UpdateStockLocationBody>;

export const ListStockLocationsQuery = z.object({ active: stockBooleanParam.optional() }).strict();
export type ListStockLocationsQuery = z.output<typeof ListStockLocationsQuery>;

export interface StockLocationView {
  id: string;
  name: string;
  kind: StockLocationKind;
  workProjectId: string | null;
  address: string | null;
  responsibleUserId: string | null;
  isDefault: boolean;
  pointOfSaleIds: string[];
  active: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface StockLocationList {
  items: StockLocationView[];
}
