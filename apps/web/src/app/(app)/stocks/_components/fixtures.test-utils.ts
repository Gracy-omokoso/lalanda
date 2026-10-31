// Fixtures des tests des modèles des stocks (ADR-0046, lot S8).

import type { OrgAction } from '@/lib/api';
import type {
  StockCountLineView,
  StockCountView,
  StockItemView,
  StockLevelRowView,
  StockLocationView,
  StockVoucherView,
} from '@/lib/api-stock';

/** Propriétaire : tout, valeurs comprises. */
export const PROPRIETAIRE: OrgAction[] = [
  'purchase.read',
  'purchase.request',
  'treasury.read',
  'stock.read',
  'stock.move',
  'stock.count',
  'stock.manage',
];
/** Magasinier (ADR-0046 § 8.2) : ni valeurs, ni gestion, ni achats. */
export const MAGASINIER: OrgAction[] = [
  'analytics.read',
  'stock.read',
  'stock.move',
  'stock.count',
  'assets.read',
  'docs.read',
  'work.read',
  'work.update',
  'leave.request',
];
/** Comptable : compte et gère, voit les valeurs (trésorerie), ne mouvemente pas. */
export const COMPTABLE: OrgAction[] = [
  'treasury.read',
  'purchase.read',
  'stock.read',
  'stock.count',
  'stock.manage',
];
/** Commercial : lit les quantités, sans valeurs. */
export const COMMERCIAL: OrgAction[] = ['sales.read', 'stock.read'];

export const ID1 = 'a'.repeat(24);
export const ID2 = 'b'.repeat(24);

export function article(p: Partial<StockItemView> = {}): StockItemView {
  return {
    id: ID1,
    code: 'CIM-50',
    name: 'Ciment 50 kg',
    description: null,
    kind: 'goods',
    catalogItemId: null,
    unit: 'sac',
    unitConversions: [],
    costCurrency: 'USD',
    tracked: true,
    discreteUnit: true,
    defaultLocationId: null,
    reorder: null,
    preferredSupplierId: null,
    active: true,
    hasMovements: true,
    levels: [],
    valuationComplete: true,
    findings: [],
    valuesHidden: false,
    revision: 3,
    createdBy: 'u-gestion',
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    quantity: '12.000',
    averageUnitCost: '8.500000',
    value: '102.00',
    ...p,
  };
}

export function emplacement(p: Partial<StockLocationView> = {}): StockLocationView {
  return {
    id: ID1,
    name: 'Magasin principal',
    kind: 'warehouse',
    workProjectId: null,
    address: null,
    responsibleUserId: null,
    isDefault: false,
    pointOfSaleIds: [],
    active: true,
    revision: 1,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    ...p,
  };
}

export function niveau(p: Partial<StockLevelRowView> = {}): StockLevelRowView {
  return {
    itemId: ID1,
    itemName: 'Ciment 50 kg',
    itemCode: null,
    unit: 'sac',
    locationId: ID2,
    locationName: 'Magasin',
    quantity: '4.000',
    lastMovementAt: null,
    ...p,
  };
}

export function ligneInventaire(p: Partial<StockCountLineView> = {}): StockCountLineView {
  return {
    id: 'l1',
    itemId: ID1,
    itemName: 'Ciment 50 kg',
    itemCode: 'CIM',
    unit: 'sac',
    countedQuantity: null,
    countedAt: null,
    countedBy: null,
    note: null,
    unitCost: null,
    recounts: [],
    theoretical: null,
    variance: null,
    valuedVariance: null,
    currency: 'USD',
    needsUnitCost: false,
    ...p,
  };
}

export function inventaire(p: Partial<StockCountView> = {}): StockCountView {
  return {
    id: 'c1',
    number: 'IV2610-000001',
    locationId: ID2,
    locationName: 'Magasin',
    scope: 'all',
    status: 'counting',
    blind: true,
    note: null,
    lines: [ligneInventaire()],
    variances: null,
    theoreticalHidden: false,
    valuesHidden: false,
    submission: null,
    validation: null,
    cancellation: null,
    canValidate: false,
    validationAsSoleApprover: false,
    validationBlockedBy: null,
    assignees: [],
    revision: 2,
    createdBy: 'u-gestion',
    createdAt: '2026-10-30T08:00:00.000Z',
    updatedAt: '2026-10-30T08:00:00.000Z',
    ...p,
  };
}

export function bon(p: Partial<StockVoucherView> = {}): StockVoucherView {
  return {
    id: 'v1',
    number: 'BS2610-000001',
    kind: 'issue',
    status: 'draft',
    fromLocationId: ID1,
    toLocationId: null,
    lines: [
      {
        id: 'x',
        itemId: ID1,
        itemName: 'Ciment 50 kg',
        unit: 'sac',
        quantity: '2.000',
        direction: null,
        unitCost: null,
        note: null,
      },
    ],
    workProjectId: null,
    recipient: null,
    employeeId: null,
    supplierId: null,
    receptionId: null,
    reason: null,
    note: null,
    posting: null,
    cancellation: null,
    wentNegative: false,
    valuesHidden: false,
    postedOn: '2026-10-30',
    revision: 1,
    createdBy: 'u1',
    createdAt: '2026-10-30T08:00:00.000Z',
    updatedAt: '2026-10-30T08:00:00.000Z',
    ...p,
  };
}
