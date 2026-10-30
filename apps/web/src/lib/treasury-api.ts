// Client HTTP de la trésorerie RUN — ADR-0034.
//
// Fichier séparé de `api.ts` : le module est livré en parallèle d'autres lots
// qui modifient ce fichier, et ses types miroirs (vues de l'API) sont nombreux.
// Mêmes conventions : `credentials: 'include'`, erreur portant `status` et
// `detail` (corps JSON `{ code, message, details? }`).
//
// Les montants restent des CHAÎNES décimales de bout en bout : l'interface les
// met en forme, elle ne les additionne jamais (le moteur est l'unique source).

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

export type TreasuryCurrency = 'CDF' | 'USD';
export type TreasuryAccountKind = 'cash' | 'bank' | 'mobile_money';
export type RecurrenceFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type ScenarioId = 'optimistic' | 'probable' | 'pessimistic';

export interface ExpenseCategoryView {
  code: string;
  label: string;
  nature: 'exploitation' | 'investissement' | 'financement';
}

export interface TreasuryAccountView {
  id: string;
  name: string;
  kind: TreasuryAccountKind;
  institution: string | null;
  currency: TreasuryCurrency;
  openingBalance: string;
  openingDate: string;
  active: boolean;
  revision: number;
  balance: string;
  inflows: string;
  outflows: string;
  movementCount: number;
}

export interface AccountsPage {
  asOf: string;
  items: TreasuryAccountView[];
  totalsByCurrency: Partial<Record<TreasuryCurrency, string>>;
  receiptsIntegrated: boolean;
}

export interface ExpenseView {
  id: string;
  spentOn: string;
  amount: string;
  currency: TreasuryCurrency;
  category: string;
  categoryLabel: string;
  label: string;
  supplierName: string | null;
  accountId: string | null;
  deductibleVat: string | null;
  reference: string | null;
  attachment: { contentType: string; size: number; uploadedAt: string } | null;
  recurringExpenseId: string | null;
  occurrenceDate: string | null;
  /** Projet du RUN rattaché (ADR-0039 § 2.10), ou `null`. */
  workProjectId: string | null;
  // ADR-0044 — P8 : fiche fournisseur (P2) et dépense possédée par les achats (P5).
  // Facultatifs tant que l'API ne les sert pas.
  supplierId?: string | null;
  origin?: ExpenseOrigin | null;
  status: 'recorded' | 'cancelled';
  cancelReason: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Dépense créée ou rattachée par un paiement fournisseur (ADR-0044 § 2.8) : elle
 * appartient aux achats et ne se modifie pas depuis la trésorerie.
 */
export interface ExpenseOrigin {
  kind: 'supplier_payment';
  paymentId: string;
  invoiceId: string;
  allocationIndex: number;
  /** Copie d'affichage du numéro `PF…`, si l'API la rend. */
  paymentNumber?: string | null;
}

export interface ExpensePage {
  items: ExpenseView[];
  nextCursor: string | null;
}

export interface ExpenseBody {
  spentOn: string;
  amount: string;
  currency: TreasuryCurrency;
  category: string;
  label: string;
  supplierName?: string | null;
  accountId?: string | null;
  deductibleVat?: string | null;
  reference?: string | null;
  /** Projet du RUN (ADR-0039 § 2.10) ; absent à la modification : inchangé. */
  workProjectId?: string | null;
}

export interface ExpenseSummary {
  version: string;
  byMonth: {
    month: string;
    currency: TreasuryCurrency;
    category: string;
    total: string;
    count: number;
  }[];
  totalsByCurrency: Partial<Record<TreasuryCurrency, string>>;
}

export interface RecurringExpenseView {
  id: string;
  label: string;
  amount: string;
  currency: TreasuryCurrency;
  category: string;
  categoryLabel: string;
  supplierName: string | null;
  accountId: string | null;
  frequency: RecurrenceFrequency;
  startDate: string;
  endDate: string | null;
  active: boolean;
  revision: number;
  nextOccurrence: string | null;
}

export interface RecurringExpenseBody {
  label: string;
  amount: string;
  currency: TreasuryCurrency;
  category: string;
  supplierName?: string | null;
  accountId?: string | null;
  frequency: RecurrenceFrequency;
  startDate: string;
  endDate?: string | null;
  active?: boolean;
}

export interface DueOccurrence {
  recurringExpenseId: string;
  label: string;
  occurrenceDate: string;
  amount: string;
  currency: TreasuryCurrency;
  category: string;
}

export interface LedgerEntry {
  id: string;
  source: 'expense' | 'transfer' | 'other_in' | 'other_out' | 'receipt';
  accountId: string;
  date: string;
  direction: 'in' | 'out';
  amount: string;
  currency: TreasuryCurrency;
  label: string;
}

export interface ScenarioHypotheses {
  receivableCollectionRate: number;
  receivableDelayDays: number;
  noDueDateDays: number;
  recurringFactor: number;
  planRevenueRate: number;
  planChargesRate: number;
}

// ADR-0044 — P8 : `payable` = échéances des factures fournisseurs validées (moteur 1.1.0).
export type ForecastFlowSource = 'receivable' | 'recurring' | 'plan_in' | 'plan_out' | 'payable';

export interface ForecastAlert {
  severity: 'critique' | 'tension';
  date: string;
  dayIndex: number;
  horizon: 7 | 30 | 90 | 180;
  balance: string;
  threshold: string;
  probableCause: { label: string; amount: string; date: string } | null;
}

export interface ForecastScenario {
  id: ScenarioId;
  hypotheses: ScenarioHypotheses;
  series: { date: string; balance: string }[];
  horizons: {
    days: 7 | 30 | 90 | 180;
    date: string;
    closing: string;
    min: string;
    minDate: string;
    inflows: string;
    outflows: string;
    bySource: Record<ForecastFlowSource, string>;
  }[];
  alerts: ForecastAlert[];
  flows: {
    date: string;
    source: ForecastFlowSource;
    direction: 'in' | 'out';
    amount: string;
    label: string;
  }[];
}

export interface ForecastFinding {
  code: string;
  count: number;
  detail: string | null;
}

export interface TreasuryForecast {
  version: string;
  currency: TreasuryCurrency;
  asOf: string;
  openingBalance: string;
  accountsIncluded: string[];
  minimumBalance: string;
  planUsed: boolean;
  scenarios: ForecastScenario[];
  uncertainty: {
    horizons: { days: 7 | 30 | 90 | 180; low: string; high: string; spread: string }[];
    findings: ForecastFinding[];
  };
}

export interface TreasurySettingsView {
  revision: number;
  minimumBalances: { CDF: string | null; USD: string | null };
  scenarios: Record<ScenarioId, ScenarioHypotheses>;
  defaultScenarios: boolean;
}

export interface BridgeView {
  status: 'not_configured' | 'disabled' | 'enabled';
  enabled: boolean;
  projectId: string | null;
  projectName: string | null;
  projectCurrency: string | null;
  firstMonth: string | null;
  mapping: Record<string, string>;
  planVersion: number | null;
  mappableLines: { lineId: string; label: string }[];
  categories: { code: string; label: string; nature: string; mappable: boolean }[];
}

export interface BridgeBody {
  enabled: boolean;
  projectId: string | null;
  firstMonth: string | null;
  mapping: Record<string, string>;
}

export type SyncStatus =
  | 'written'
  | 'unchanged'
  | 'removed'
  | 'PERIOD_CLOSED'
  | 'MANUAL_VALUE_PRESENT'
  | 'OTHER_SOURCE_PRESENT'
  | 'UNKNOWN_LINE';

export interface SyncReport {
  dryRun: boolean;
  projectId: string;
  planVersion: number;
  version: string;
  results: {
    year: number;
    month: number;
    calendarMonth: string | null;
    lineId: string;
    amount: string | null;
    stored: number | null;
    status: SyncStatus;
  }[];
  skipped: {
    calendarMonth: string;
    year: number | null;
    month: number | null;
    lineId: string;
    reason: 'OUTSIDE_PLAN_HORIZON' | 'CURRENCY_NOT_CONVERTIBLE';
    expenseIds: string[];
    totalsByCurrency: Partial<Record<TreasuryCurrency, string>>;
  }[];
  unmapped: {
    calendarMonth: string;
    category: string;
    currency: TreasuryCurrency;
    total: string;
    count: number;
  }[];
  counts: Record<SyncStatus, number>;
}

export type ReconciliationFinding =
  | 'NOT_SYNCED'
  | 'PERIOD_CLOSED'
  | 'MANUAL_VALUE_PRESENT'
  | 'CURRENCY_NOT_CONVERTIBLE'
  | 'NO_PLAN_BASE';

export interface ReconciliationView {
  version: string;
  year: number;
  convention: 'annuel/12';
  projectId: string;
  projectName: string;
  projectCurrency: string;
  planVersion: number;
  bridgeEnabled: boolean;
  firstMonth: string;
  calendarMonths: string[];
  lines: {
    lineId: string;
    label: string;
    comparable: boolean;
    months: {
      month: number;
      prevu: string | null;
      realise: string | null;
      stored: string | null;
      storedSource: 'run.expenses' | 'run.sales' | 'manual' | null;
      ecart: string | null;
      statut: 'favorable' | 'defavorable' | 'conforme' | null;
      findings: ReconciliationFinding[];
    }[];
    total: {
      monthsCounted: number[];
      prevuCumule: string | null;
      realiseCumule: string | null;
      ecart: string | null;
      ecartPct: number | null;
      statut: 'favorable' | 'defavorable' | 'conforme' | null;
    };
    categories: { category: string; amount: string }[];
    topExpenses: { id: string; label: string; spentOn: string; amount: string }[];
  }[];
  skipped: SyncReport['skipped'];
  unmapped: SyncReport['unmapped'];
}

export type TreasuryError = Error & { status: number; detail: unknown };

async function request<T>(
  path: string,
  init: { method: string; body?: unknown; raw?: Blob } = { method: 'GET' },
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method,
    credentials: 'include',
    headers: { 'content-type': init.raw ? init.raw.type : 'application/json' },
    body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
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
    ) as TreasuryError;
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return (await res.json()) as T;
}

/** Chaîne de requête : les champs absents ou vides ne partent pas. */
function query(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s === '' ? '' : `?${s}`;
}

const id = encodeURIComponent;

export const treasuryApi = {
  categories: () => request<ExpenseCategoryView[]>('/treasury/categories'),

  listExpenses: (q: {
    from?: string;
    to?: string;
    category?: string;
    currency?: string;
    /** Dépenses d'un projet du RUN (ADR-0039 § 6.4). */
    workProjectId?: string;
    status?: 'recorded' | 'cancelled' | 'all';
    q?: string;
    cursor?: string | null;
    limit?: number;
  }) => request<ExpensePage>(`/treasury/expenses${query(q)}`),
  expenseSummary: (q: { from?: string; to?: string }) =>
    request<ExpenseSummary>(`/treasury/expenses/summary${query(q)}`),
  suppliers: (q: string) => request<{ items: string[] }>(`/treasury/suppliers${query({ q })}`),
  createExpense: (body: ExpenseBody) =>
    request<ExpenseView>('/treasury/expenses', { method: 'POST', body }),
  updateExpense: (expenseId: string, expectedRevision: number, expense: ExpenseBody) =>
    request<ExpenseView>(`/treasury/expenses/${id(expenseId)}`, {
      method: 'PUT',
      body: { expectedRevision, expense },
    }),
  cancelExpense: (expenseId: string, reason: string) =>
    request<ExpenseView>(`/treasury/expenses/${id(expenseId)}/cancel`, {
      method: 'POST',
      body: { reason },
    }),
  uploadAttachment: (expenseId: string, file: File) =>
    request<ExpenseView>(`/treasury/expenses/${id(expenseId)}/attachment`, {
      method: 'POST',
      raw: file,
    }),
  removeAttachment: (expenseId: string) =>
    request<ExpenseView>(`/treasury/expenses/${id(expenseId)}/attachment`, { method: 'DELETE' }),
  /** Octets de la pièce : à afficher par une URL d'objet, jamais injectés en HTML. */
  attachmentBlob: async (expenseId: string): Promise<Blob> => {
    const res = await fetch(`${API_URL}/treasury/expenses/${id(expenseId)}/attachment`, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  },

  listRecurring: () => request<{ items: RecurringExpenseView[] }>('/treasury/recurring-expenses'),
  dueOccurrences: () => request<{ items: DueOccurrence[] }>('/treasury/recurring-expenses/due'),
  createRecurring: (body: RecurringExpenseBody) =>
    request<RecurringExpenseView>('/treasury/recurring-expenses', { method: 'POST', body }),
  updateRecurring: (
    ruleId: string,
    expectedRevision: number,
    recurringExpense: RecurringExpenseBody,
  ) =>
    request<RecurringExpenseView>(`/treasury/recurring-expenses/${id(ruleId)}`, {
      method: 'PUT',
      body: { expectedRevision, recurringExpense },
    }),
  confirmOccurrence: (ruleId: string, date: string, body: { amount?: string } = {}) =>
    request<{ expense: ExpenseView; alreadyConfirmed: boolean }>(
      `/treasury/recurring-expenses/${id(ruleId)}/occurrences/${id(date)}/confirm`,
      { method: 'POST', body },
    ),

  listAccounts: () => request<AccountsPage>('/treasury/accounts'),
  createAccount: (body: {
    name: string;
    kind: TreasuryAccountKind;
    institution?: string | null;
    currency: TreasuryCurrency;
    openingBalance: string;
    openingDate: string;
  }) => request<TreasuryAccountView>('/treasury/accounts', { method: 'POST', body }),
  updateAccount: (
    accountId: string,
    body: {
      expectedRevision: number;
      name: string;
      kind: TreasuryAccountKind;
      institution: string | null;
      openingBalance: string;
      active: boolean;
    },
  ) => request<TreasuryAccountView>(`/treasury/accounts/${id(accountId)}`, { method: 'PUT', body }),
  ledger: (q: { accountId?: string; from?: string; to?: string }) =>
    request<{ items: LedgerEntry[]; truncated: boolean }>(`/treasury/movements${query(q)}`),
  transfer: (body: {
    date: string;
    fromAccountId: string;
    toAccountId: string;
    amountOut: string;
    amountIn: string;
    label?: string | null;
  }) => request<unknown>('/treasury/transfers', { method: 'POST', body }),
  otherMovement: (body: {
    kind: 'other_in' | 'other_out';
    date: string;
    accountId: string;
    amount: string;
    label: string;
  }) => request<unknown>('/treasury/movements', { method: 'POST', body }),

  forecast: (currency: TreasuryCurrency) =>
    request<TreasuryForecast>(`/treasury/forecast${query({ currency })}`),
  settings: () => request<TreasurySettingsView>('/treasury/settings'),
  putSettings: (body: {
    expectedRevision: number;
    minimumBalances: { CDF: string | null; USD: string | null };
    scenarios: Record<ScenarioId, ScenarioHypotheses> | null;
  }) => request<TreasurySettingsView>('/treasury/settings', { method: 'PUT', body }),

  bridge: () => request<BridgeView>('/treasury/actuals-bridge'),
  putBridge: (body: BridgeBody) =>
    request<BridgeView>('/treasury/actuals-bridge', { method: 'PUT', body }),
  sync: (dryRun: boolean) =>
    request<SyncReport>('/treasury/actuals-bridge/sync', { method: 'POST', body: { dryRun } }),
  reconciliation: (year: number) =>
    request<ReconciliationView>(`/treasury/reconciliation${query({ year })}`),
};

/** Code métier d'une erreur de l'API (`{ code }`), ou `null`. */
export function codeOf(err: unknown): string | null {
  const detail = (err as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'object' && detail !== null && 'code' in detail) {
    return String((detail as { code: unknown }).code);
  }
  return null;
}

/** Message lisible d'une erreur de l'API, problèmes de champ compris. */
export function messageOf(err: unknown): string {
  const detail = (err as { detail?: unknown } | null)?.detail as
    { message?: string; details?: { issues?: { path: string; message: string }[] } } | undefined;
  const issues = detail?.details?.issues ?? [];
  if (issues.length > 0) return issues.map((i) => i.message).join(' ');
  return detail?.message ?? (err instanceof Error ? err.message : 'Erreur inattendue.');
}
