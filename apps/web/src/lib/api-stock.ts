// Client de l'API des stocks — ADR-0046 § 5.1 (lot S8).
//
// Fichier voisin de `api.ts` (même `jsonRequest`, mêmes erreurs). AUCUNE quantité,
// aucun coût ni aucune valeur n'est calculé ici : tout vient de l'API (moteur
// `@lalanda/engine`, module `stock`), en chaînes décimales.
//
// Contrats : les constantes et unions viennent de `@lalanda/shared/stock` (lot S0).
// Les vues de réponse ne sont pas encore publiées par le lot S3 : celles d'ici
// recopient l'ADR (§ 2, § 5.1, § 7.1) au plus près et seront remplacées par les
// contrats de S3 à leur fusion. Tant qu'une route n'existe pas, l'API répond 404 :
// les écrans le disent par une phrase, rien n'est inventé.
//
// VALEURS (§ 5) : coûts, valeurs et écarts valorisés ne sont servis qu'avec
// `purchase.read` ou `treasury.read` ; sinon ils valent `null` et la réponse
// porte `valuesHidden: true`. Le Magasinier ne voit aucune valeur.

import type {
  StockCountScope,
  StockCountStatus,
  StockCostStatus,
  StockCurrency,
  StockItemKind,
  StockLocationKind,
  StockMovementKind,
  StockMovementSourceKind,
  StockPendingReason,
  StockPendingStatus,
  StockSalesIssueMode,
  StockVoucherKind,
  StockVoucherStatus,
} from '@lalanda/shared/stock';

import { jsonRequest, salesQuery } from './api';

export type {
  StockCountScope,
  StockCountStatus,
  StockCostStatus,
  StockCurrency,
  StockItemKind,
  StockLocationKind,
  StockMovementKind,
  StockPendingReason,
  StockPendingStatus,
  StockSalesIssueMode,
  StockVoucherKind,
  StockVoucherStatus,
} from '@lalanda/shared/stock';

type DecimalString = string;

/** Page paginée par curseur ; `valuesHidden` quand la réponse porte des valeurs. */
export interface StockPage<T> {
  items: T[];
  nextCursor: string | null;
  valuesHidden?: boolean;
}

// ─── Articles (§ 2.1) ───────────────────────────────────────────────────────

export interface StockUnitConversionView {
  unit: string;
  factor: DecimalString;
}

export interface StockReorderView {
  minQuantity: DecimalString;
  targetQuantity: DecimalString | null;
  locationId: string | null;
}

/** Quantité d'un article à un emplacement (cache `stock_levels`). */
export interface StockItemLevelView {
  locationId: string;
  locationName: string | null;
  quantity: DecimalString;
}

/** Constat du moteur (`stockFindings`) : code et détails, jamais recalculés ici. */
export interface StockFindingView {
  code: string;
  itemId?: string;
  locationId: string | null;
  movementId?: string | null;
  details?: Record<string, string>;
}

export interface StockItemView {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  kind: StockItemKind;
  catalogItemId: string | null;
  unit: string;
  unitConversions: StockUnitConversionView[];
  costCurrency: StockCurrency;
  tracked: boolean;
  defaultLocationId: string | null;
  reorder: StockReorderView | null;
  preferredSupplierId: string | null;
  preferredSupplierName?: string | null;
  active: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** Quantité totale tous emplacements (moteur). */
  quantity: DecimalString;
  levels?: StockItemLevelView[];
  /** Coût moyen pondéré (CMUP) : `null` si les valeurs sont masquées. */
  averageUnitCost: DecimalString | null;
  /** Valeur de gestion, dans `costCurrency` : `null` si masquée. */
  value: DecimalString | null;
  /** Valorisation complète (`false` : entrées sans coût). */
  valuationComplete?: boolean | null;
  findings?: StockFindingView[];
  valuesHidden?: boolean;
}

export interface ListStockItemsParams {
  q?: string;
  kind?: StockItemKind;
  active?: 'true' | 'false';
  cursor?: string;
  limit?: number;
}

export interface StockItemInput {
  code?: string | null;
  name: string;
  description?: string | null;
  kind: StockItemKind;
  catalogItemId?: string | null;
  unit: string;
  unitConversions?: StockUnitConversionView[];
  costCurrency: StockCurrency;
  tracked: boolean;
  defaultLocationId?: string | null;
  reorder?: StockReorderView | null;
  preferredSupplierId?: string | null;
}

// ─── Emplacements (§ 2.2) ───────────────────────────────────────────────────

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
}

export interface StockLocationInput {
  name: string;
  kind: StockLocationKind;
  workProjectId?: string | null;
  address?: string | null;
  responsibleUserId?: string | null;
}

// ─── Niveaux (§ 2.5, § 5.1) ─────────────────────────────────────────────────

export interface StockLevelRowView {
  itemId: string;
  itemName: string;
  itemCode: string | null;
  unit: string;
  locationId: string;
  locationName: string | null;
  quantity: DecimalString;
  /** Seuil applicable (article, emplacement ou global), `null` sans seuil. */
  minQuantity: DecimalString | null;
  /** Sous le seuil, d'après le moteur. */
  belowReorder?: boolean;
  lastMovementAt?: string | null;
}

export interface ListStockLevelsParams {
  locationId?: string;
  below?: 'reorder';
  cursor?: string;
  limit?: number;
}

// ─── Mouvements (§ 2.3) ─────────────────────────────────────────────────────

export interface StockMovementView {
  id: string;
  itemId: string;
  locationId: string;
  locationName?: string | null;
  kind: StockMovementKind;
  /** Signée : entrées > 0, sorties < 0. */
  quantity: DecimalString;
  occurredOn: string;
  unitCost: DecimalString | null;
  costStatus: StockCostStatus;
  source: { kind: StockMovementSourceKind; [cle: string]: unknown } | null;
  /** Numéro lisible de la pièce d'origine (bon, inventaire, réception, facture). */
  sourceLabel?: string | null;
  workProjectId: string | null;
  transferId: string | null;
  reason: string | null;
  reversalOf: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface ListStockMovementsParams {
  locationId?: string;
  kind?: StockMovementKind;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

// ─── Bons (§ 2.4) ───────────────────────────────────────────────────────────

export interface StockVoucherLineView {
  id: string;
  itemId: string;
  itemName?: string | null;
  unit?: string | null;
  quantity: DecimalString;
  note: string | null;
}

export interface StockVoucherView {
  id: string;
  number: string | null;
  kind: StockVoucherKind;
  status: StockVoucherStatus;
  fromLocationId: string | null;
  toLocationId: string | null;
  fromLocationName?: string | null;
  toLocationName?: string | null;
  lines: StockVoucherLineView[];
  workProjectId: string | null;
  recipient: string | null;
  supplierId: string | null;
  reason: string | null;
  reasonNote?: string | null;
  postedOn: string | null;
  cancellationReason?: string | null;
  revision: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StockVoucherLineInput {
  itemId: string;
  /** Positive en unité de stock ; signée pour un ajustement (entrée > 0, sortie < 0). */
  quantity: DecimalString;
  note?: string | null;
}

export interface StockVoucherInput {
  kind: StockVoucherKind;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  lines: StockVoucherLineInput[];
  workProjectId?: string | null;
  recipient?: string | null;
  supplierId?: string | null;
  /** Motif d'ajustement (clé des réglages), obligatoire pour un ajustement. */
  reason?: string | null;
  reasonNote?: string | null;
  postedOn: string;
}

export interface ListStockVouchersParams {
  kind?: StockVoucherKind;
  status?: StockVoucherStatus;
  cursor?: string;
  limit?: number;
}

// ─── « À traiter » (§ 2.6) ──────────────────────────────────────────────────

export interface StockPendingLineView {
  id: string;
  reason: StockPendingReason;
  status: StockPendingStatus;
  /** Libellé de la ligne d'origine (désignation d'achat ou de vente). */
  label: string | null;
  itemRef: string | null;
  itemId: string | null;
  itemName?: string | null;
  quantity: DecimalString | null;
  unit: string | null;
  currency?: StockCurrency | null;
  /** Pièce d'origine lisible (réception, facture, avoir). */
  sourceLabel?: string | null;
  createdAt: string;
  revision: number;
}

export interface StockPendingResolveInput {
  itemId?: string;
  factor?: DecimalString;
  quantity?: DecimalString;
  unitCost?: DecimalString;
  locationId?: string;
  expectedRevision: number;
}

// ─── Inventaires (§ 2.7) ────────────────────────────────────────────────────

export interface StockCountLineView {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string | null;
  unit: string;
  countedQuantity: DecimalString | null;
  countedAt: string | null;
  countedBy: string | null;
  note: string | null;
  /** Quantité théorique : `null` pour un compteur d'inventaire à l'aveugle. */
  theoreticalQuantity?: DecimalString | null;
}

export interface StockCountVarianceLineView {
  lineId: string;
  itemId: string;
  status: 'counted' | 'not_counted';
  theoretical: DecimalString | null;
  counted: DecimalString | null;
  variance: DecimalString | null;
  currency: StockCurrency;
  valuedVariance: DecimalString | null;
  needsUnitCost: boolean;
}

export interface StockCountVariancesView {
  lines: StockCountVarianceLineView[];
  byCurrency: {
    currency: StockCurrency;
    gains: DecimalString | null;
    losses: DecimalString | null;
    net: DecimalString | null;
    unvaluedLineCount: number;
  }[];
  countedLineCount: number;
  varianceLineCount: number;
}

export interface StockCountView {
  id: string;
  number: string | null;
  locationId: string;
  locationName?: string | null;
  scope: StockCountScope;
  status: StockCountStatus;
  blind: boolean;
  lines: StockCountLineView[];
  variances: StockCountVariancesView | null;
  validation: {
    by: string;
    at: string;
    comment: string | null;
    soleApprover: boolean;
  } | null;
  assignees: string[];
  /**
   * Jugement de l'API sur la validation par l'appelant, quand elle le sert
   * (séparation des tâches, approbateur unique) ; absent : l'écran applique
   * la règle « celui qui a compté ne valide pas ».
   */
  canValidate?: { allowed: boolean; soleApprover: boolean } | null;
  revision: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  valuesHidden?: boolean;
}

export interface StockCountInput {
  locationId: string;
  scope: StockCountScope;
  itemIds?: string[];
  blind: boolean;
  assignees?: string[];
}

export interface ListStockCountsParams {
  status?: StockCountStatus;
  locationId?: string;
  cursor?: string;
  limit?: number;
}

// ─── Valorisation, réapprovisionnement, réglages ────────────────────────────

export interface StockValuationView {
  until: string | null;
  locationId: string | null;
  byCurrency: {
    currency: StockCurrency;
    value: DecimalString;
    itemCount: number;
    complete: boolean;
  }[];
  valuesHidden?: boolean;
}

export interface StockReplenishmentSuggestionView {
  itemId: string;
  itemName: string;
  itemCode: string | null;
  unit: string;
  locationId: string | null;
  locationName: string | null;
  available: DecimalString;
  minQuantity: DecimalString;
  targetQuantity: DecimalString | null;
  onOrder: DecimalString;
  suggestedQuantity: DecimalString;
  preferredSupplierId: string | null;
  preferredSupplierName: string | null;
}

export interface StockReplenishmentView {
  suggestions: StockReplenishmentSuggestionView[];
}

export interface StockAdjustmentReasonView {
  key: string;
  label: string;
}

export interface StockSettingsView {
  salesIssueMode: StockSalesIssueMode;
  allowNegativeManualMoves: boolean;
  adjustmentReasons: StockAdjustmentReasonView[];
  countReminderDays: number;
  revision: number;
}

export interface StockSettingsInput {
  salesIssueMode: StockSalesIssueMode;
  allowNegativeManualMoves: boolean;
  adjustmentReasons: StockAdjustmentReasonView[];
  countReminderDays: number;
  expectedRevision: number;
}

// ─── Client ─────────────────────────────────────────────────────────────────

const id = (v: string): string => encodeURIComponent(v);
const GET = { method: 'GET' } as const;

export const stockApi = {
  // Articles
  listItems: (query: ListStockItemsParams = {}) =>
    jsonRequest<StockPage<StockItemView>>(`/stock/items${salesQuery(query)}`, GET),
  getItem: (itemId: string) => jsonRequest<StockItemView>(`/stock/items/${id(itemId)}`, GET),
  createItem: (body: StockItemInput) =>
    jsonRequest<StockItemView>('/stock/items', { method: 'POST', body }),
  updateItem: (itemId: string, body: StockItemInput & { expectedRevision: number }) =>
    jsonRequest<StockItemView>(`/stock/items/${id(itemId)}`, { method: 'PUT', body }),
  archiveItem: (itemId: string, expectedRevision: number) =>
    jsonRequest<StockItemView>(`/stock/items/${id(itemId)}/archive`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  restoreItem: (itemId: string, expectedRevision: number) =>
    jsonRequest<StockItemView>(`/stock/items/${id(itemId)}/restore`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  listItemMovements: (itemId: string, query: ListStockMovementsParams = {}) =>
    jsonRequest<StockPage<StockMovementView>>(
      `/stock/items/${id(itemId)}/movements${salesQuery(query)}`,
      GET,
    ),

  // Emplacements
  listLocations: (query: { active?: 'true' | 'false' } = {}) =>
    jsonRequest<StockPage<StockLocationView>>(`/stock/locations${salesQuery(query)}`, GET),
  createLocation: (body: StockLocationInput) =>
    jsonRequest<StockLocationView>('/stock/locations', { method: 'POST', body }),
  updateLocation: (locationId: string, body: StockLocationInput & { expectedRevision: number }) =>
    jsonRequest<StockLocationView>(`/stock/locations/${id(locationId)}`, { method: 'PUT', body }),
  archiveLocation: (locationId: string, expectedRevision: number) =>
    jsonRequest<StockLocationView>(`/stock/locations/${id(locationId)}/archive`, {
      method: 'POST',
      body: { expectedRevision },
    }),

  // Niveaux
  listLevels: (query: ListStockLevelsParams = {}) =>
    jsonRequest<StockPage<StockLevelRowView>>(`/stock/levels${salesQuery(query)}`, GET),

  // Bons
  listVouchers: (query: ListStockVouchersParams = {}) =>
    jsonRequest<StockPage<StockVoucherView>>(`/stock/vouchers${salesQuery(query)}`, GET),
  createVoucher: (body: StockVoucherInput) =>
    jsonRequest<StockVoucherView>('/stock/vouchers', { method: 'POST', body }),
  postVoucher: (voucherId: string, expectedRevision: number) =>
    jsonRequest<StockVoucherView>(`/stock/vouchers/${id(voucherId)}/post`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  cancelVoucher: (voucherId: string, body: { reason: string; expectedRevision: number }) =>
    jsonRequest<StockVoucherView>(`/stock/vouchers/${id(voucherId)}/cancel`, {
      method: 'POST',
      body,
    }),

  // « À traiter »
  listPending: (
    query: {
      status?: StockPendingStatus;
      reason?: StockPendingReason;
      cursor?: string;
      limit?: number;
    } = {},
  ) => jsonRequest<StockPage<StockPendingLineView>>(`/stock/pending${salesQuery(query)}`, GET),
  resolvePending: (lineId: string, body: StockPendingResolveInput) =>
    jsonRequest<StockPendingLineView>(`/stock/pending/${id(lineId)}/resolve`, {
      method: 'POST',
      body,
    }),
  dismissPending: (lineId: string, body: { reason: string; expectedRevision: number }) =>
    jsonRequest<StockPendingLineView>(`/stock/pending/${id(lineId)}/dismiss`, {
      method: 'POST',
      body,
    }),

  // Inventaires
  listCounts: (query: ListStockCountsParams = {}) =>
    jsonRequest<StockPage<StockCountView>>(`/stock/counts${salesQuery(query)}`, GET),
  getCount: (countId: string) => jsonRequest<StockCountView>(`/stock/counts/${id(countId)}`, GET),
  createCount: (body: StockCountInput) =>
    jsonRequest<StockCountView>('/stock/counts', { method: 'POST', body }),
  startCount: (countId: string, expectedRevision: number) =>
    jsonRequest<StockCountView>(`/stock/counts/${id(countId)}/start`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  saveCountLine: (
    countId: string,
    lineId: string,
    body: { countedQuantity: DecimalString; note?: string | null },
  ) =>
    jsonRequest<StockCountView>(`/stock/counts/${id(countId)}/lines/${id(lineId)}`, {
      method: 'PUT',
      body,
    }),
  submitCount: (countId: string, expectedRevision: number) =>
    jsonRequest<StockCountView>(`/stock/counts/${id(countId)}/submit`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  cancelCount: (countId: string, body: { reason: string; expectedRevision: number }) =>
    jsonRequest<StockCountView>(`/stock/counts/${id(countId)}/cancel`, { method: 'POST', body }),
  validateCount: (countId: string, body: { comment?: string | null; expectedRevision: number }) =>
    jsonRequest<StockCountView>(`/stock/counts/${id(countId)}/validate`, {
      method: 'POST',
      body,
    }),

  // Valorisation, suggestions, réglages
  getValuation: (query: { on?: string; locationId?: string } = {}) =>
    jsonRequest<StockValuationView>(`/stock/valuation${salesQuery(query)}`, GET),
  getReplenishment: () => jsonRequest<StockReplenishmentView>('/stock/replenishment', GET),
  getSettings: () => jsonRequest<StockSettingsView>('/stock/settings', GET),
  updateSettings: (body: StockSettingsInput) =>
    jsonRequest<StockSettingsView>('/stock/settings', { method: 'PUT', body }),
};
