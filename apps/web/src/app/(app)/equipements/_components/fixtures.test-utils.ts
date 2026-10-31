// Données de test des équipements (ADR-0046, lot S9) : vues du contrat partagé.

import type { OrgAction } from '@/lib/api';
import type { AssetDetailView } from '@/lib/api-assets';

export const GESTIONNAIRE: OrgAction[] = ['assets.read', 'assets.manage', 'purchase.read'];
export const LECTEUR_RH: OrgAction[] = ['assets.read', 'hr.read'];
export const EXPORTATEUR: OrgAction[] = ['assets.read', 'report.export', 'treasury.read'];

export function equipement(patch: Partial<AssetDetailView> = {}): AssetDetailView {
  return {
    id: 'a1',
    number: 'EQ-000001',
    tag: null,
    name: 'Ordinateur portable',
    categoryId: 'c1',
    categoryName: 'Informatique',
    brand: 'Dell',
    model: 'Latitude',
    serialNumber: 'SN-1',
    status: 'in_service',
    acquisition: {
      on: '2026-01-15',
      cost: '1200.00',
      currency: 'USD',
      supplierId: null,
      supplierInvoiceId: null,
      expenseId: null,
      note: null,
    },
    stockItemId: null,
    locationId: null,
    currentAssignment: null,
    managementDepreciation: null,
    disposal: null,
    notes: null,
    findings: [],
    valuesHidden: false,
    revision: 3,
    createdAt: '2026-01-15T10:00:00.000Z',
    updatedAt: '2026-01-15T10:00:00.000Z',
    managementEstimate: null,
    totalCostOfOwnership: null,
    ...patch,
  };
}
