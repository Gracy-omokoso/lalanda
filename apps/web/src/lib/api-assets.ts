// Client de l'API des équipements — ADR-0046 § 3 et § 5.2 (lot S9).
//
// Fichier voisin de `api.ts` (même `jsonRequest`, mêmes erreurs). Contrats : ceux de
// `@lalanda/shared/assets` (lots S0 et S5), recopiés nulle part. AUCUN calcul ici :
// estimation de gestion, coût de possession, échéances et totaux viennent du moteur,
// par l'API, en chaînes décimales.
//
// VALEURS (§ 5) : coûts, estimation et coût de possession ne sont servis qu'avec
// `purchase.read` ou `treasury.read` ; sinon ils valent `null` et la réponse porte
// `valuesHidden: true`.

import type {
  AssetAssignmentsView,
  AssetCategoryView,
  AssetCoverageView,
  AssetDeadlinesView,
  AssetDetailView,
  AssetListOf,
  AssetMaintenanceView,
  AssetPageView,
  AssetReportsView,
  AssetSettingsView,
  AssetStatus,
  AssignAssetBody,
  CompleteMaintenanceBody,
  CreateAssetBody,
  CreateCoverageBody,
  CreateMaintenanceBody,
  DisposeAssetBody,
  ReinstateAssetBody,
  ReturnAssetBody,
  UpdateAssetBody,
  UpdateAssetCategoryBody,
  UpdateAssetSettingsBody,
  UpdateCoverageBody,
  UpdateMaintenanceBody,
} from '@lalanda/shared/assets';

import { API_URL, EVENEMENT_REFUS_API, jsonRequest, salesQuery } from './api';

export type {
  AssetAssigneeKind,
  AssetAssigneeView,
  AssetAssignmentView,
  AssetAssignmentsView,
  AssetCategoryView,
  AssetCoverageKind,
  AssetCoverageView,
  AssetCurrency,
  AssetDeadlineView,
  AssetDeadlinesView,
  AssetDetailView,
  AssetDisposalKind,
  AssetEstimateView,
  AssetFindingCode,
  AssetMaintenanceKind,
  AssetMaintenanceStatus,
  AssetMaintenanceView,
  AssetPageView,
  AssetReportsView,
  AssetSettingsView,
  AssetStatus,
  AssetView,
  AssignAssetBody,
  CompleteMaintenanceBody,
  CreateAssetBody,
  CreateCoverageBody,
  CreateMaintenanceBody,
  DisposeAssetBody,
  ExpiryStatus,
  ReinstateAssetBody,
  ReturnAssetBody,
  UpdateAssetBody,
  UpdateCoverageBody,
  UpdateMaintenanceBody,
} from '@lalanda/shared/assets';

/** Paramètres de `GET /assets` : identifiants seulement. */
export interface ListAssetsParams {
  status?: AssetStatus | 'active' | 'all';
  categoryId?: string;
  employeeId?: string;
  workProjectId?: string;
  supplierId?: string;
  cursor?: string;
  limit?: number;
}

const id = (v: string): string => encodeURIComponent(v);
const GET = { method: 'GET' } as const;

/** Fichier reçu de l'API (registre CSV) : octets et nom. */
export interface FichierEquipements {
  blob: Blob;
  nom: string;
}

async function telechargerCsv(path: string, nomParDefaut: string): Promise<FichierEquipements> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    let detail: unknown = text;
    try {
      detail = JSON.parse(text);
    } catch {
      /* garde le texte brut */
    }
    const err = new Error(
      typeof detail === 'object' && detail !== null && 'message' in detail
        ? String((detail as { message: unknown }).message)
        : `HTTP ${res.status}`,
    ) as Error & { status: number; detail: unknown };
    err.status = res.status;
    err.detail = detail;
    if (res.status === 403 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(EVENEMENT_REFUS_API, { detail }));
    }
    throw err;
  }
  const cd = res.headers.get('content-disposition') ?? '';
  const m = /filename="([^"]+)"/i.exec(cd);
  return { blob: await res.blob(), nom: m?.[1] ?? nomParDefaut };
}

export const assetsApi = {
  // Registre (§ 3.1)
  list: (query: ListAssetsParams = {}) =>
    jsonRequest<AssetPageView>(`/assets${salesQuery(query)}`, GET),
  get: (assetId: string) => jsonRequest<AssetDetailView>(`/assets/${id(assetId)}`, GET),
  create: (body: CreateAssetBody) =>
    jsonRequest<AssetDetailView>('/assets', { method: 'POST', body }),
  update: (assetId: string, body: UpdateAssetBody) =>
    jsonRequest<AssetDetailView>(`/assets/${id(assetId)}`, { method: 'PUT', body }),
  dispose: (assetId: string, body: DisposeAssetBody) =>
    jsonRequest<AssetDetailView>(`/assets/${id(assetId)}/dispose`, { method: 'POST', body }),
  reinstate: (assetId: string, body: ReinstateAssetBody) =>
    jsonRequest<AssetDetailView>(`/assets/${id(assetId)}/reinstate`, { method: 'POST', body }),

  // Affectations (§ 3.2)
  assign: (assetId: string, body: AssignAssetBody) =>
    jsonRequest<AssetDetailView>(`/assets/${id(assetId)}/assign`, { method: 'POST', body }),
  giveBack: (assetId: string, body: ReturnAssetBody) =>
    jsonRequest<AssetDetailView>(`/assets/${id(assetId)}/return`, { method: 'POST', body }),
  assignments: (assetId: string) =>
    jsonRequest<AssetAssignmentsView>(`/assets/${id(assetId)}/assignments`, GET),

  // Maintenance (§ 3.3)
  listMaintenance: (assetId: string) =>
    jsonRequest<AssetListOf<AssetMaintenanceView>>(`/assets/${id(assetId)}/maintenance`, GET),
  createMaintenance: (assetId: string, body: CreateMaintenanceBody) =>
    jsonRequest<AssetMaintenanceView>(`/assets/${id(assetId)}/maintenance`, {
      method: 'POST',
      body,
    }),
  updateMaintenance: (assetId: string, maintenanceId: string, body: UpdateMaintenanceBody) =>
    jsonRequest<AssetMaintenanceView>(`/assets/${id(assetId)}/maintenance/${id(maintenanceId)}`, {
      method: 'PUT',
      body,
    }),
  completeMaintenance: (assetId: string, maintenanceId: string, body: CompleteMaintenanceBody) =>
    jsonRequest<AssetMaintenanceView>(
      `/assets/${id(assetId)}/maintenance/${id(maintenanceId)}/done`,
      { method: 'POST', body },
    ),

  // Garanties, assurances, contrats (§ 3.4)
  listCoverages: (assetId: string) =>
    jsonRequest<AssetListOf<AssetCoverageView>>(`/assets/${id(assetId)}/coverages`, GET),
  createCoverage: (assetId: string, body: CreateCoverageBody) =>
    jsonRequest<AssetCoverageView>(`/assets/${id(assetId)}/coverages`, { method: 'POST', body }),
  updateCoverage: (assetId: string, coverageId: string, body: UpdateCoverageBody) =>
    jsonRequest<AssetCoverageView>(`/assets/${id(assetId)}/coverages/${id(coverageId)}`, {
      method: 'PUT',
      body,
    }),
  deleteCoverage: (assetId: string, coverageId: string) =>
    jsonRequest<{ deleted: true }>(`/assets/${id(assetId)}/coverages/${id(coverageId)}`, {
      method: 'DELETE',
    }),

  // Échéances, rapports, export
  deadlines: (within?: number) =>
    jsonRequest<AssetDeadlinesView>(`/assets/deadlines${salesQuery({ within })}`, GET),
  reports: () => jsonRequest<AssetReportsView>('/assets/reports', GET),
  /** `report.export` en plus de `assets.read` ; l'API journalise l'export. */
  exportCsv: () => telechargerCsv('/assets/export.csv', 'registre-equipements.csv'),

  // Catégories et réglages (§ 3.5)
  listCategories: () => jsonRequest<{ items: AssetCategoryView[] }>('/assets/categories', GET),
  createCategory: (name: string) =>
    jsonRequest<AssetCategoryView>('/assets/categories', { method: 'POST', body: { name } }),
  updateCategory: (categoryId: string, body: UpdateAssetCategoryBody) =>
    jsonRequest<AssetCategoryView>(`/assets/categories/${id(categoryId)}`, {
      method: 'PUT',
      body,
    }),
  getSettings: () => jsonRequest<AssetSettingsView>('/assets/settings', GET),
  putSettings: (body: UpdateAssetSettingsBody) =>
    jsonRequest<AssetSettingsView>('/assets/settings', { method: 'PUT', body }),
};
