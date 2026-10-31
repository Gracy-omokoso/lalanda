// Constantes des stocks (ADR-0046 § 1, § 2 et § 5). ADR-0046 — S0.
//
// Libellé d'interface ↔ code (ADR-0046 § 1) : « Article stocké » = `StockItem`,
// « Emplacement » = `StockLocation`, « Mouvement » = `StockMovement`, « Bon de sortie,
// de transfert, d'ajustement » = `StockVoucher`, « Stock par emplacement » =
// `StockLevel`, « Entrée ou sortie à traiter » = `StockPendingLine`, « Inventaire » =
// `StockCount`, « Réglages des stocks » = `StockSettings`.
//
// Ce fichier ne contient que des unions fermées, des bornes, des valeurs par défaut et
// des codes : AUCUNE règle comptable ni fiscale (ADR-0046 § 9). La valorisation au coût
// moyen pondéré est une MESURE DE GESTION calculée par le moteur `@lalanda/engine`
// (`stock`, lot S1) ; aucun taux de change n'est jamais appliqué.

/** Devises de valorisation (`costCurrency`) : celles de la trésorerie, jamais converties. */
export const STOCK_CURRENCIES = ['CDF', 'USD'] as const;
export type StockCurrency = (typeof STOCK_CURRENCIES)[number];

// ── Articles (§ 2.1) ────────────────────────────────────────────────────────

/** Nature d'un article : informative (filtres, rapports), aucun effet de calcul. */
export const STOCK_ITEM_KINDS = ['goods', 'consumable', 'material'] as const;
export type StockItemKind = (typeof STOCK_ITEM_KINDS)[number];

/**
 * Préfixe de la référence d'un article de stock portée par une ligne de commande R3
 * (`itemRef = stk:<id>`, § 6.1). Sinon, `itemRef` est comparé au `codeKey` de l'article.
 */
export const STOCK_ITEM_REF_PREFIX = 'stk:';

/** Seul type d'article de vente qui peut être lié à un article stocké (O1). */
export const STOCKABLE_CATALOG_ITEM_TYPE = 'BIE';

// ── Emplacements (§ 2.2) ────────────────────────────────────────────────────

export const STOCK_LOCATION_KINDS = ['warehouse', 'shop', 'vehicle', 'site', 'other'] as const;
export type StockLocationKind = (typeof STOCK_LOCATION_KINDS)[number];

/** Nom de l'emplacement créé à l'activation (`isDefault`). */
export const STOCK_DEFAULT_LOCATION_NAME = 'Magasin principal';

// ── Mouvements (§ 2.3) ──────────────────────────────────────────────────────

/** Nature d'un mouvement du grand livre (ajout seul). */
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

/**
 * Mouvements CONSTATÉS ailleurs (vente émise, annulation d'une réception) : toujours
 * enregistrés, même au-delà du disponible (alerte `NEGATIVE_STOCK`, O4). Les autres
 * sorties sont DÉCIDÉES dans le module : refusées au-delà du disponible
 * (`409 STOCK_INSUFFICIENT`) sauf `allowNegativeManualMoves`.
 */
export const STOCK_OBSERVED_MOVEMENT_KINDS: readonly StockMovementKind[] = Object.freeze([
  'sale_issue',
  'purchase_receipt_reversal',
]);

/** Statut du coût d'un mouvement (§ 2.3.1). */
export const STOCK_COST_STATUSES = ['valued', 'pending_cost', 'not_applicable'] as const;
export type StockCostStatus = (typeof STOCK_COST_STATUSES)[number];

/** Origine d'un mouvement (`source.kind`). */
export const STOCK_MOVEMENT_SOURCE_KINDS = [
  'reception',
  'invoice',
  'voucher',
  'count',
  'pending',
] as const;
export type StockMovementSourceKind = (typeof STOCK_MOVEMENT_SOURCE_KINDS)[number];

/** Sens d'un mouvement de bon dans sa clé d'idempotence (`voucher:<id>:<ligne>:<sens>`). */
export const STOCK_VOUCHER_DIRECTIONS = ['in', 'out', 'reversal'] as const;
export type StockVoucherDirection = (typeof STOCK_VOUCHER_DIRECTIONS)[number];

/**
 * Clés d'idempotence (`sourceKey`, unique partiel par organisation, § 2.3) : rejouer un
 * rattrapage n'écrit rien deux fois. Forme seulement ; l'unicité est l'index.
 */
export const stockSourceKey = {
  receptionIn: (receptionId: string, orderLineId: string): string =>
    `reception:${receptionId}:${orderLineId}:in`,
  receptionReversal: (receptionId: string, orderLineId: string): string =>
    `reception:${receptionId}:${orderLineId}:reversal`,
  invoice: (invoiceId: string, lineIndex: number): string => `invoice:${invoiceId}:${lineIndex}`,
  voucher: (voucherId: string, lineId: string, direction: StockVoucherDirection): string =>
    `voucher:${voucherId}:${lineId}:${direction}`,
  count: (countId: string, lineId: string): string => `count:${countId}:${lineId}`,
} as const;

// ── Bons (§ 2.4) ────────────────────────────────────────────────────────────

export const STOCK_VOUCHER_KINDS = [
  'issue',
  'issue_return',
  'transfer',
  'adjustment',
  'supplier_return',
] as const;
export type StockVoucherKind = (typeof STOCK_VOUCHER_KINDS)[number];

export const STOCK_VOUCHER_STATUSES = ['draft', 'posted', 'cancelled'] as const;
export type StockVoucherStatus = (typeof STOCK_VOUCHER_STATUSES)[number];

/**
 * Préfixe du numéro d'un bon (`BS{AA}{MM}-NNNNNN`) : pièces internes, HORS série
 * fiscale, compteurs annuels au jour de Kinshasa, trous admis. Le retour au magasin et
 * le retour fournisseur sont des sorties ou entrées hors transfert et ajustement : ils
 * portent le préfixe des bons de sortie.
 */
export const STOCK_VOUCHER_PREFIXES: Readonly<Record<StockVoucherKind, string>> = Object.freeze({
  issue: 'BS',
  issue_return: 'BS',
  transfer: 'BT',
  adjustment: 'BJ',
  supplier_return: 'BS',
});

/** Préfixe du numéro d'un inventaire (`IV{AA}{MM}-NNNNNN`, § 2.7). */
export const STOCK_COUNT_PREFIX = 'IV';

/** Numéro d'un bon ou d'un inventaire : préfixe, année et mois sur deux chiffres, six chiffres. */
export const STOCK_DOCUMENT_NUMBER_PATTERN = /^(BS|BT|BJ|IV)\d{4}-\d{6}$/;

// ── « À traiter » (§ 2.6) ───────────────────────────────────────────────────

export const STOCK_PENDING_REASONS = [
  'unknown_item',
  'unknown_unit',
  'pending_cost',
  'sale_return_proposed',
  'cost_differs',
  // ADR-0046 — S4 : `salesIssueMode = proposed` (§ 2.8, § 6.2) — la ligne d'une facture
  // finale devient « À traiter » au lieu d'une sortie ; confirmée, elle écrit `sale_issue`.
  'sale_issue_proposed',
] as const;
export type StockPendingReason = (typeof STOCK_PENDING_REASONS)[number];

/** Une ligne à traiter ne disparaît qu'en `resolved` ou `dismissed` (qui, quand, motif). */
export const STOCK_PENDING_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export type StockPendingStatus = (typeof STOCK_PENDING_STATUSES)[number];

/**
 * Résoudre une ligne exige `stock.move`, sauf celles qui portent un COÛT : `stock.manage`
 * (§ 2.6, § 5.1).
 */
export const STOCK_PENDING_REASONS_REQUIRING_MANAGE: readonly StockPendingReason[] = Object.freeze([
  'pending_cost',
  'cost_differs',
]);

// ── Inventaires (§ 2.7) ─────────────────────────────────────────────────────

export const STOCK_COUNT_SCOPES = ['all', 'items'] as const;
export type StockCountScope = (typeof STOCK_COUNT_SCOPES)[number];

export const STOCK_COUNT_STATUSES = [
  'draft',
  'counting',
  'submitted',
  'validated',
  'cancelled',
] as const;
export type StockCountStatus = (typeof STOCK_COUNT_STATUSES)[number];

// ── Réglages (§ 2.8) ────────────────────────────────────────────────────────

/** Sortie de stock à la vente (décision ouverte n° 4). */
export const STOCK_SALES_ISSUE_MODES = ['automatic', 'proposed', 'off'] as const;
export type StockSalesIssueMode = (typeof STOCK_SALES_ISSUE_MODES)[number];

/** Destinataires des alertes : détenteurs effectifs de `stock.manage` et responsables. */
export const STOCK_ALERT_RECIPIENTS = ['holders'] as const;
export type StockAlertRecipients = (typeof STOCK_ALERT_RECIPIENTS)[number];

/** Motifs d'ajustement proposés à l'activation (§ 2.3), modifiables par l'organisation. */
export const STOCK_DEFAULT_ADJUSTMENT_REASONS = Object.freeze([
  { key: 'breakage', label: 'Casse' },
  { key: 'expiry', label: 'Péremption' },
  { key: 'theft', label: 'Vol' },
  { key: 'entry_error', label: 'Erreur de saisie' },
  { key: 'donation', label: 'Don' },
  { key: 'sample', label: 'Échantillon' },
  { key: 'other', label: 'Autre' },
] as const);

/** Valeurs par défaut des réglages (décisions ouvertes n° 4, 14 et 21). */
export const STOCK_SETTINGS_DEFAULTS = Object.freeze({
  salesIssueMode: 'automatic' as StockSalesIssueMode,
  allowNegativeManualMoves: false,
  countReminderDays: 0,
  alertRecipients: 'holders' as StockAlertRecipients,
});

// ── Bornes ──────────────────────────────────────────────────────────────────

export const STOCK_LIMITS = Object.freeze({
  itemCode: 40,
  itemName: 200,
  itemDescription: 2_000,
  unit: 20,
  unitConversions: 5,
  locationName: 120,
  locationAddress: 300,
  pointOfSaleIds: 10,
  voucherLines: 100,
  lineNote: 500,
  reason: 500,
  adjustmentReasons: 20,
  adjustmentReasonLabel: 60,
  countItems: 500,
  countReminderDaysMax: 365,
  /** Quantités : trois décimales au plus (le moteur compte en millièmes). */
  quantityDecimals: 3,
  /** Coût unitaire : six décimales au plus (le moteur compte en millionièmes). */
  unitCostDecimals: 6,
  /** Facteur de conversion d'unité : six décimales au plus. */
  conversionFactorDecimals: 6,
  amountDecimals: 2,
  /** Envois de `POST /stock/sync` par heure (§ 5.1). */
  syncPerHour: 6,
  /** Éléments de « Mes tâches » (§ 6.7). */
  agendaMax: 200,
});

export const STOCK_PAGE_LIMIT_DEFAULT = 50;
export const STOCK_PAGE_LIMIT_MAX = 100;

// ── Codes ───────────────────────────────────────────────────────────────────

/** Codes d'erreur métier des stocks (§ 2, § 5.1). */
export const STOCK_ERROR_CODES = [
  'STOCK_ITEM_CODE_EXISTS',
  'CATALOG_ITEM_ALREADY_STOCKED',
  'CATALOG_ITEM_NOT_STOCKABLE',
  'STOCK_ITEM_NOT_EMPTY',
  'STOCK_ITEM_UNIT_LOCKED',
  'STOCK_ITEM_CURRENCY_LOCKED',
  'STOCK_LOCATION_NAME_EXISTS',
  'STOCK_LOCATION_NOT_EMPTY',
  'STOCK_INSUFFICIENT',
  'STOCK_TRANSFER_SAME_LOCATION',
  'COUNT_SELF_VALIDATION',
  'STALE_REVISION',
] as const;
export type StockErrorCode = (typeof STOCK_ERROR_CODES)[number];

/** Constats du moteur des stocks (§ 7.1) et du contrôle du cache (§ 2.5). */
export const STOCK_FINDING_CODES = [
  'NEGATIVE_STOCK',
  'BELOW_REORDER',
  'UNVALUED_ENTRIES',
  'ENTRY_COST_DIFFERS_FROM_INVOICE',
  'DORMANT_ITEM',
  'STOCK_LEVEL_DRIFT',
] as const;
export type StockFindingCode = (typeof STOCK_FINDING_CODES)[number];

/** Événements d'audit des stocks. */
export const STOCK_AUDIT_EVENTS = [
  'stock.entry_cost_changed',
  'stock.count_validated',
  'stock.voucher_posted',
  'stock.voucher_cancelled',
  'stock.settings_changed',
] as const;
export type StockAuditEvent = (typeof STOCK_AUDIT_EVENTS)[number];

/**
 * Clé normalisée d'un code d'article (`codeKey`, unique partiel) : majuscules, sans
 * espaces. `null` pour un code vide.
 */
export function stockCodeKey(code: string | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  const key = code.replace(/\s+/g, '').toUpperCase();
  return key === '' ? null : key;
}
