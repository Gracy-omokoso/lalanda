// Client de l'API des stocks — ADR-0046 § 5.1 (lot S8, contrats alignés par le lot S4).
//
// Fichier voisin de `api.ts` (même `jsonRequest`, mêmes erreurs). AUCUNE quantité,
// aucun coût ni aucune valeur n'est calculé ici : tout vient de l'API (moteur
// `@lalanda/engine`, module `stock`), en chaînes décimales.
//
// Contrats : les vues de réponse et les corps de requête sont ceux de
// `@lalanda/shared/stock` (lots S0, S3 et S4) — plus aucune vue recopiée de l'ADR. Les
// corps sont les ENTRÉES des schémas zod (`z.input`) : l'écran envoie ce que l'API
// valide, et rien d'autre.
//
// VALEURS (§ 5) : coûts, valeurs et écarts valorisés ne sont servis qu'avec
// `purchase.read` ou `treasury.read` ; sinon ils valent `null` et la réponse
// porte `valuesHidden: true`. Le Magasinier ne voit aucune valeur.

import type {
  CancelStockCountBody,
  CancelStockVoucherBody,
  CountStockLineBody,
  CreateStockCountBody,
  CreateStockItemBody,
  CreateStockLocationBody,
  CreateStockVoucherBody,
  DismissStockPendingBody,
  ListStockCountsQuery,
  ListStockItemsQuery,
  ListStockLedgerQuery,
  ListStockLevelsQuery,
  ListStockMovementsQuery,
  ListStockPendingQuery,
  ListStockVouchersQuery,
  ResolveStockPendingBody,
  StockCountPage,
  StockCountView,
  StockItemPage,
  StockItemView,
  StockLedgerPage,
  StockLevelsResponse,
  StockLevelView,
  StockLocationList,
  StockLocationView,
  StockMovementPage,
  StockPendingLineView,
  StockPendingPage,
  StockReorderAlertView,
  StockReplenishmentResponse,
  StockReportResponse,
  StockSettingsView,
  StockSyncResponse,
  StockValuationResponse,
  StockVoucherPage,
  StockVoucherView,
  UpdateStockItemBody,
  UpdateStockLocationBody,
  UpdateStockSettingsBody,
  UpdateStockVoucherBody,
  ValidateStockCountBody,
} from '@lalanda/shared/stock';
import type { z } from 'zod';

import { jsonRequest, salesQuery } from './api';

export type {
  StockAdjustmentDirection,
  StockCostStatus,
  StockCountLineView,
  StockCountPage,
  StockCountScope,
  StockCountStatus,
  StockCountView,
  StockCurrency,
  StockFindingView,
  StockItemKind,
  StockItemLevelView,
  StockItemPage,
  StockItemView,
  StockLedgerEntryView,
  StockLedgerPage,
  StockLevelsResponse,
  StockLevelView,
  StockLocationKind,
  StockLocationList,
  StockLocationView,
  StockMovementKind,
  StockMovementPage,
  StockMovementView,
  StockPendingLineView,
  StockPendingPage,
  StockPendingProposal,
  StockPendingReason,
  StockPendingStatus,
  StockReorderAlertView,
  StockReplenishmentResponse,
  StockReportResponse,
  StockSalesIssueMode,
  StockSettingsView,
  StockSyncResponse,
  StockValuationResponse,
  StockVoucherKind,
  StockVoucherLineView,
  StockVoucherPage,
  StockVoucherStatus,
  StockVoucherView,
} from '@lalanda/shared/stock';

/** Page paginée par curseur ; `valuesHidden` quand la réponse porte des valeurs. */
export interface StockPage<T> {
  items: T[];
  nextCursor: string | null;
  valuesHidden?: boolean;
}

// ── Noms des écrans (S8), alignés sur les contrats ──────────────────────────

/** Ligne de niveau (article × emplacement), cache `stock_levels`. */
export type StockLevelRowView = StockLevelView;
/** Suggestion du moteur (`replenishmentSuggestions`). */
export type StockReplenishmentSuggestionView = StockReorderAlertView;
export type StockReplenishmentView = StockReplenishmentResponse;
export type StockValuationView = StockValuationResponse;
/** Motif d'ajustement des réglages (`{ key, label }`). */
export type StockAdjustmentReasonView = StockSettingsView['adjustmentReasons'][number];

// ── Corps et paramètres : entrées des schémas partagés ──────────────────────

type In<S extends z.ZodType> = z.input<S>;

export type StockItemInput = In<typeof CreateStockItemBody>;
export type StockItemUpdateInput = In<typeof UpdateStockItemBody>;
export type StockLocationInput = In<typeof CreateStockLocationBody>;
export type StockLocationUpdateInput = In<typeof UpdateStockLocationBody>;
export type StockVoucherInput = In<typeof CreateStockVoucherBody>;
export type StockVoucherUpdateInput = In<typeof UpdateStockVoucherBody>;
export type StockVoucherLineInput = StockVoucherInput['lines'][number];
export type StockVoucherCancelInput = In<typeof CancelStockVoucherBody>;
export type StockPendingResolveInput = In<typeof ResolveStockPendingBody>;
export type StockPendingDismissInput = In<typeof DismissStockPendingBody>;
export type StockCountInput = In<typeof CreateStockCountBody>;
export type StockCountLineInput = In<typeof CountStockLineBody>;
export type StockCountValidateInput = In<typeof ValidateStockCountBody>;
export type StockCountCancelInput = In<typeof CancelStockCountBody>;
export type StockSettingsInput = In<typeof UpdateStockSettingsBody>;

export type ListStockItemsParams = In<typeof ListStockItemsQuery>;
export type ListStockLevelsParams = In<typeof ListStockLevelsQuery>;
export type ListStockMovementsParams = In<typeof ListStockMovementsQuery>;
export type ListStockLedgerParams = In<typeof ListStockLedgerQuery>;
export type ListStockVouchersParams = In<typeof ListStockVouchersQuery>;
export type ListStockPendingParams = In<typeof ListStockPendingQuery>;
export type ListStockCountsParams = In<typeof ListStockCountsQuery>;

/**
 * Réponse de `GET /stock/levels`, plus une forme de PAGE des articles sous le seuil
 * (`items` = `belowReorder`, sans suite) : la tuile « Articles sous le seuil » de
 * l'Accueil (§ 6.8) en compte les éléments. Simple recopie, aucun calcul.
 */
export type StockLevelsWithAlerts = StockLevelsResponse & StockPage<StockReorderAlertView>;

// ─── Client ─────────────────────────────────────────────────────────────────

const id = (v: string): string => encodeURIComponent(v);
const GET = { method: 'GET' } as const;

export const stockApi = {
  // Articles
  listItems: (query: ListStockItemsParams = {}) =>
    jsonRequest<StockItemPage>(`/stock/items${salesQuery(query)}`, GET),
  getItem: (itemId: string) => jsonRequest<StockItemView>(`/stock/items/${id(itemId)}`, GET),
  createItem: (body: StockItemInput) =>
    jsonRequest<StockItemView>('/stock/items', { method: 'POST', body }),
  updateItem: (itemId: string, body: StockItemUpdateInput) =>
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
    jsonRequest<StockMovementPage>(`/stock/items/${id(itemId)}/movements${salesQuery(query)}`, GET),

  /** Grand livre de TOUS les articles (S4), filtrable et paginé. */
  listMovements: (query: ListStockLedgerParams = {}) =>
    jsonRequest<StockLedgerPage>(`/stock/movements${salesQuery(query)}`, GET),

  // Emplacements
  listLocations: (query: { active?: 'true' | 'false' } = {}) =>
    jsonRequest<StockLocationList>(`/stock/locations${salesQuery(query)}`, GET),
  createLocation: (body: StockLocationInput) =>
    jsonRequest<StockLocationView>('/stock/locations', { method: 'POST', body }),
  updateLocation: (locationId: string, body: StockLocationUpdateInput) =>
    jsonRequest<StockLocationView>(`/stock/locations/${id(locationId)}`, { method: 'PUT', body }),
  archiveLocation: (locationId: string, expectedRevision: number) =>
    jsonRequest<StockLocationView>(`/stock/locations/${id(locationId)}/archive`, {
      method: 'POST',
      body: { expectedRevision },
    }),

  // Niveaux. `limit` et `cursor` (appel de l'Accueil) ne sont pas des paramètres de
  // l'API (corps strict) : ils ne sont pas transmis.
  listLevels: async (
    query: ListStockLevelsParams & { limit?: number; cursor?: string } = {},
  ): Promise<StockLevelsWithAlerts> => {
    const params: ListStockLevelsParams = {
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.below ? { below: query.below } : {}),
    };
    const res = await jsonRequest<StockLevelsResponse>(`/stock/levels${salesQuery(params)}`, GET);
    return { ...res, items: res.belowReorder, nextCursor: null };
  },

  // Bons
  listVouchers: (query: ListStockVouchersParams = {}) =>
    jsonRequest<StockVoucherPage>(`/stock/vouchers${salesQuery(query)}`, GET),
  getVoucher: (voucherId: string) =>
    jsonRequest<StockVoucherView>(`/stock/vouchers/${id(voucherId)}`, GET),
  createVoucher: (body: StockVoucherInput) =>
    jsonRequest<StockVoucherView>('/stock/vouchers', { method: 'POST', body }),
  updateVoucher: (voucherId: string, body: StockVoucherUpdateInput) =>
    jsonRequest<StockVoucherView>(`/stock/vouchers/${id(voucherId)}`, { method: 'PUT', body }),
  postVoucher: (voucherId: string, expectedRevision: number) =>
    jsonRequest<StockVoucherView>(`/stock/vouchers/${id(voucherId)}/post`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  cancelVoucher: (voucherId: string, body: StockVoucherCancelInput) =>
    jsonRequest<StockVoucherView>(`/stock/vouchers/${id(voucherId)}/cancel`, {
      method: 'POST',
      body,
    }),

  // « À traiter »
  listPending: (query: ListStockPendingParams = {}) =>
    jsonRequest<StockPendingPage>(`/stock/pending${salesQuery(query)}`, GET),
  resolvePending: (lineId: string, body: StockPendingResolveInput) =>
    jsonRequest<StockPendingLineView>(`/stock/pending/${id(lineId)}/resolve`, {
      method: 'POST',
      body,
    }),
  dismissPending: (lineId: string, body: StockPendingDismissInput) =>
    jsonRequest<StockPendingLineView>(`/stock/pending/${id(lineId)}/dismiss`, {
      method: 'POST',
      body,
    }),

  // Inventaires
  listCounts: (query: ListStockCountsParams = {}) =>
    jsonRequest<StockCountPage>(`/stock/counts${salesQuery(query)}`, GET),
  getCount: (countId: string) => jsonRequest<StockCountView>(`/stock/counts/${id(countId)}`, GET),
  createCount: (body: StockCountInput) =>
    jsonRequest<StockCountView>('/stock/counts', { method: 'POST', body }),
  startCount: (countId: string, expectedRevision: number) =>
    jsonRequest<StockCountView>(`/stock/counts/${id(countId)}/start`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  saveCountLine: (countId: string, lineId: string, body: StockCountLineInput) =>
    jsonRequest<StockCountView>(`/stock/counts/${id(countId)}/lines/${id(lineId)}`, {
      method: 'PUT',
      body,
    }),
  submitCount: (countId: string, expectedRevision: number) =>
    jsonRequest<StockCountView>(`/stock/counts/${id(countId)}/submit`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  cancelCount: (countId: string, body: StockCountCancelInput) =>
    jsonRequest<StockCountView>(`/stock/counts/${id(countId)}/cancel`, { method: 'POST', body }),
  validateCount: (countId: string, body: StockCountValidateInput) =>
    jsonRequest<StockCountView>(`/stock/counts/${id(countId)}/validate`, {
      method: 'POST',
      body,
    }),

  // Valorisation, suggestions, rapports, réglages, rattrapages
  getValuation: (query: { on?: string; locationId?: string } = {}) =>
    jsonRequest<StockValuationResponse>(`/stock/valuation${salesQuery(query)}`, GET),
  getReplenishment: () => jsonRequest<StockReplenishmentResponse>('/stock/replenishment', GET),
  getReport: (query: { from: string; to: string }) =>
    jsonRequest<StockReportResponse>(`/stock/reports${salesQuery(query)}`, GET),
  getSettings: () => jsonRequest<StockSettingsView>('/stock/settings', GET),
  updateSettings: (body: StockSettingsInput) =>
    jsonRequest<StockSettingsView>('/stock/settings', { method: 'PUT', body }),
  /** Rattrapages achats et ventes à la demande (`stock.manage`, 6 par heure). */
  sync: () => jsonRequest<StockSyncResponse>('/stock/sync', { method: 'POST', body: {} }),
};
