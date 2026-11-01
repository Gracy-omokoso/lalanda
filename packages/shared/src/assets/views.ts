// Vues HTTP des équipements (ADR-0046 § 3, § 5.2). ADR-0046 — S5.
//
// VALEURS (coûts d'acquisition, de maintenance, de couverture, prix de cession,
// estimation de gestion, coût de possession) : servies seulement si l'appelant détient
// aussi `purchase.read` ou `treasury.read` ; sinon elles valent `null` et la réponse
// porte `valuesHidden: true` (§ 5). Un collaborateur affecté n'apparaît que par son
// nom d'usage et son poste : aucune donnée RH sensible.

import type {
  AssetCoverageKind,
  AssetCurrency,
  AssetDisposalKind,
  AssetFindingCode,
  AssetMaintenanceKind,
  AssetMaintenanceStatus,
  AssetStatus,
  ExpiryStatus,
} from './constants.js';

/** Bénéficiaire d'une affectation, avec son seul libellé d'affichage. */
export type AssetAssigneeView =
  | {
      kind: 'employee';
      employeeId: string;
      /** Nom d'usage ; `null` pour une fiche anonymisée. */
      name: string | null;
      jobTitle: string | null;
      /** Le collaborateur a quitté l'organisation (constat `ASSET_HELD_BY_FORMER_EMPLOYEE`). */
      exited: boolean;
    }
  | { kind: 'project'; workProjectId: string; name: string | null }
  | { kind: 'location'; locationId: string; name: string | null }
  | { kind: 'member'; userId: string; name: string | null };

export interface AssetAssignmentView {
  id: string;
  assetId: string;
  assignee: AssetAssigneeView;
  from: string;
  to: string | null;
  handedOverBy: string;
  conditionOut: string | null;
  conditionIn: string | null;
  note: string | null;
  createdAt: string;
}

/** Estimation de gestion servie (§ 9) : toujours étiquetée. */
export interface AssetEstimateView {
  label: 'management_estimate';
  /** « Estimation de gestion — n'est pas un amortissement comptable ou fiscal ». */
  notice: string;
  estimable: boolean;
  /** Motif quand `estimable` est faux (`NO_DURATION`, `RESIDUAL_ABOVE_COST`, `UNKNOWN_COST`). */
  reason: string | null;
  onDate: string;
  currency: AssetCurrency | null;
  estimatedValue: string | null;
  consumed: string | null;
  consumedPercent: string | null;
  endOn: string | null;
  monthsTotal: number | null;
  monthsElapsed: number | null;
  stoppedByDisposalOn: string | null;
  version: string;
}

export interface AssetView {
  id: string;
  number: string;
  tag: string | null;
  name: string;
  categoryId: string;
  categoryName: string | null;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  status: AssetStatus;
  acquisition: {
    on: string;
    /**
     * `null` si les valeurs sont masquées (`valuesHidden`), ou si le coût est
     * INCONNU (non saisi) quand elles sont visibles — jamais « 0 ».
     */
    cost: string | null;
    currency: AssetCurrency;
    supplierId: string | null;
    supplierInvoiceId: string | null;
    expenseId: string | null;
    note: string | null;
  };
  stockItemId: string | null;
  locationId: string | null;
  currentAssignment: AssetAssignmentView | null;
  /** Paramètres saisis ; la valeur résiduelle est masquée avec les valeurs. */
  managementDepreciation: { years: number; residualValue: string | null; startOn: string } | null;
  disposal: {
    on: string;
    kind: AssetDisposalKind;
    proceeds: string | null;
    currency: AssetCurrency | null;
    buyer: string | null;
    reason: string;
    by: string;
  } | null;
  notes: string | null;
  findings: AssetFindingCode[];
  valuesHidden: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface AssetDetailView extends AssetView {
  /** `null` si les valeurs sont masquées ou l'affichage éteint dans les réglages. */
  managementEstimate: AssetEstimateView | null;
  /** Coût total de possession par devise (moteur) ; `null` si valeurs masquées. */
  totalCostOfOwnership: {
    /** `false` si le coût d'acquisition est inconnu : aucun total publié. */
    estimable: boolean;
    reason: 'UNKNOWN_COST' | null;
    byCurrency: {
      currency: AssetCurrency;
      acquisition: string;
      maintenance: string;
      coverages: string;
      total: string;
    }[];
    maintenanceCount: number;
    unpricedMaintenanceCount: number;
    coverageCount: number;
  } | null;
}

export interface AssetPageView {
  items: AssetView[];
  nextCursor: string | null;
  valuesHidden: boolean;
}

export interface AssetAssignmentsView {
  items: AssetAssignmentView[];
  /** Cohérence de l'historique jugée par le moteur (`assignmentHistory`). */
  valid: boolean;
}

export interface AssetMaintenanceView {
  id: string;
  assetId: string;
  kind: AssetMaintenanceKind;
  status: AssetMaintenanceStatus;
  plannedOn: string | null;
  doneOn: string | null;
  cost: string | null;
  currency: AssetCurrency | null;
  supplierId: string | null;
  supplierInvoiceId: string | null;
  performedBy: string | null;
  note: string | null;
  recurrence: { everyMonths: number } | null;
  /** Intervention créée automatiquement par celle-ci (récurrence), sinon `null`. */
  nextId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface AssetCoverageView {
  id: string;
  assetId: string;
  kind: AssetCoverageKind;
  provider: string;
  reference: string | null;
  startOn: string;
  endOn: string;
  cost: string | null;
  currency: AssetCurrency | null;
  documentId: string | null;
  reminderDays: number | null;
  /** Moteur `expiryStatus` au jour de Kinshasa. */
  expiry: ExpiryStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface AssetListOf<T> {
  items: T[];
  valuesHidden: boolean;
}

export interface AssetDeadlineView {
  kind:
    | 'maintenance_overdue'
    | 'maintenance_due_soon'
    | 'coverage_expired'
    | 'coverage_due_soon'
    | 'held_by_former_employee';
  assetId: string;
  assetNumber: string;
  assetName: string;
  refId: string | null;
  employeeId: string | null;
  employeeName: string | null;
  date: string;
  daysLeft: number;
}

export interface AssetDeadlinesView {
  today: string;
  items: AssetDeadlineView[];
  counts: Record<AssetDeadlineView['kind'], number>;
  version: string;
}

export interface AssetCurrencyTotalView {
  currency: AssetCurrency;
  count: number;
  total: string;
}

export interface AssetReportsView {
  version: string;
  total: number;
  byStatus: { status: AssetStatus; count: number }[];
  byCategory: {
    categoryId: string | null;
    categoryName: string | null;
    count: number;
    byStatus: { status: AssetStatus; count: number }[];
    acquisitionCosts: AssetCurrencyTotalView[] | null;
    /** Équipements au coût inconnu, exclus des sommes ; `null` si valeurs masquées. */
    unknownCostCount: number | null;
  }[];
  assigned: { employee: number; project: number; location: number; member: number; none: number };
  /** Coûts CONNUS seulement. */
  acquisitionCosts: AssetCurrencyTotalView[] | null;
  activeAcquisitionCosts: AssetCurrencyTotalView[] | null;
  /** Équipements au coût inconnu (cédés compris / non cédés) ; `null` si valeurs masquées. */
  unknownCostCount: number | null;
  activeUnknownCostCount: number | null;
  managementEstimate: {
    label: 'management_estimate';
    notice: string;
    onDate: string;
    estimatedValues: AssetCurrencyTotalView[];
    notEstimable: number;
  } | null;
  valuesHidden: boolean;
}

export interface AssetCategoryView {
  id: string;
  name: string;
  active: boolean;
  assetCount: number;
  revision: number;
}

export interface AssetSettingsView {
  reminderDays: number;
  maintenanceDueSoonDays: number;
  showDepreciationEstimate: boolean;
  isDefault: boolean;
  revision: number;
}
