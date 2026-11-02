// ─────────────────────────────────────────────────────────────────────────────
// Statistiques agrégées de la plateforme (ADR-0053 § 6.7 — lot P7)
//
// Fonctions PURES (aucune base, aucune horloge) : le service leur passe des
// métadonnées de plateforme — organisations (pays, type), abonnements (offre, état),
// comptes, et la liste des organisations ayant au moins un document dans un module —
// et sert le résultat tel quel.
//
// ── Seuil de diffusion (décision ouverte n° 13, défaut appliqué) ──────────────
//
// Aucune case de moins de `PLATFORM_LIMITS.statsMinCell` (5) n'est servie en clair :
// elle part `{ value: null, masked: true }`, affichée « < 5 ». Zéro compris : le
// défaut dit « aucune case de moins de 5 », sans exception.
//
// Masquage SECONDAIRE dans une répartition qui partitionne un total publié (par offre,
// par pays, par état, par type) : si une seule case y est masquée, la plus petite des
// autres l'est aussi — sinon la case masquée se déduirait par soustraction. Une
// répartition qui ne partitionne pas (adoption des modules) n'en a pas besoin.
//
// ── Ce qui n'entre jamais ici ────────────────────────────────────────────────
//
// Aucun montant, aucun nom, aucun identifiant d'organisation ni de compte dans la
// SORTIE : seulement des comptes. Les identifiants d'organisations reçus en entrée
// servent à dédoublonner, puis disparaissent.
// ─────────────────────────────────────────────────────────────────────────────

export const PLATFORM_STATS_VERSION = '1.0.0';

/** Une case servie : la valeur, ou rien si elle tombe sous le seuil. */
export interface StatCell {
  value: number | null;
  masked: boolean;
}

export interface StatBreakdownRow {
  key: string;
  cell: StatCell;
}

/** Modules suivis : un module = des collections dont un document suffit à dire « utilisé ». */
export const STATS_MODULES = [
  'projets',
  'canvas',
  'idea_lab',
  'business_plan',
  'objectifs',
  'crm',
  'devis_factures',
  'contrats',
  'achats',
  'tresorerie',
  'travail',
  'rh',
  'stock',
  'immobilisations',
  'comptabilite',
] as const;
export type StatsModule = (typeof STATS_MODULES)[number];

/**
 * Collections lues pour l'adoption, par module. Lecture de la seule clé de locataire
 * (`distinct('organizationId')`) : jamais un champ de contenu, jamais un montant.
 */
export const STATS_MODULE_COLLECTIONS: Readonly<Record<StatsModule, readonly string[]>> = {
  projets: ['projects'],
  canvas: ['canvases'],
  idea_lab: ['idea_lab_ideas'],
  business_plan: ['business_plans'],
  objectifs: ['financial_objectives'],
  crm: ['crm_accounts', 'crm_contacts', 'crm_opportunities'],
  devis_factures: ['sales_quotes', 'sales_invoices'],
  contrats: ['sales_contracts'],
  achats: ['suppliers', 'purchase_orders', 'supplier_invoices'],
  tresorerie: ['treasury_accounts', 'treasury_expenses', 'treasury_movements'],
  travail: ['work_projects', 'work_tasks'],
  rh: ['hr_employees'],
  stock: ['stock_items'],
  immobilisations: ['assets'],
  comptabilite: ['accounting_entries'],
};

export interface StatsOrganization {
  id: string;
  pays: string;
  type: string;
  createdAt: Date | null;
}

export interface StatsSubscription {
  organizationId: string;
  /** Offre EFFECTIVE à l'instant (octroi compris), calculée par l'appelant. */
  effectivePlan: string;
  status: string;
  trialStartedAt: Date | null;
  lastPaymentAt: Date | null;
}

export interface PlatformStatsInput {
  now: Date;
  /** Fenêtre « actif » et « nouveau », en jours (30 par défaut, § 6.7). */
  windowDays: number;
  minCell: number;
  plans: readonly string[];
  organizations: readonly StatsOrganization[];
  subscriptions: readonly StatsSubscription[];
  users: { total: number; createdInWindow: number; activeInWindow: number };
  /** Organisations dont au moins un membre a ouvert une session dans la fenêtre. */
  activeOrganizationIds: readonly string[];
  moduleAdoption: Readonly<Partial<Record<StatsModule, readonly string[]>>>;
  usage: { aiCallsInWindow: number; pdfExportsInWindow: number };
}

export interface PlatformStats {
  version: string;
  generatedAt: string;
  windowDays: number;
  minCell: number;
  organizations: {
    total: StatCell;
    activeInWindow: StatCell;
    createdInWindow: StatCell;
    byPlan: StatBreakdownRow[];
    byCountry: StatBreakdownRow[];
    bySubscriptionStatus: StatBreakdownRow[];
    byType: StatBreakdownRow[];
  };
  users: { total: StatCell; activeInWindow: StatCell; createdInWindow: StatCell };
  trials: { started: StatCell; converted: StatCell; ongoing: StatCell };
  modules: StatBreakdownRow[];
  usage: { aiCallsInWindow: StatCell; pdfExportsInWindow: StatCell };
}

/** État d'une organisation sans document d'abonnement (offre gratuite, docs/13). */
export const STATUS_NONE = 'none';

/** Case unique, seuil appliqué. */
export function cell(value: number, minCell: number): StatCell {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`Compte invalide : ${value}`);
  }
  return value < minCell ? { value: null, masked: true } : { value, masked: false };
}

/**
 * Répartition qui PARTITIONNE un total publié : seuil, puis masquage secondaire quand
 * une seule case est masquée (sinon elle se déduirait du total).
 */
export function partition(
  counts: ReadonlyMap<string, number>,
  minCell: number,
): StatBreakdownRow[] {
  const rows = [...counts.entries()].map(([key, n]) => ({ key, n, cell: cell(n, minCell) }));
  const masked = rows.filter((r) => r.cell.masked);
  if (masked.length === 1 && rows.length > 1) {
    const plusPetite = rows
      .filter((r) => !r.cell.masked)
      .sort((a, b) => a.n - b.n || a.key.localeCompare(b.key))[0];
    if (plusPetite) plusPetite.cell = { value: null, masked: true };
  }
  return rows.map(({ key, cell: c }) => ({ key, cell: c }));
}

function countBy<T>(items: readonly T[], keyOf: (item: T) => string, keys?: readonly string[]) {
  const map = new Map<string, number>((keys ?? []).map((k) => [k, 0]));
  for (const item of items) {
    const k = keyOf(item);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return map;
}

function sortedByKey(map: Map<string, number>): Map<string, number> {
  return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function computePlatformStats(input: PlatformStatsInput): PlatformStats {
  const { minCell } = input;
  const since = input.now.getTime() - input.windowDays * 86_400_000;
  const orgIds = new Set(input.organizations.map((o) => o.id));
  // Un abonnement orphelin (organisation supprimée) ne compte nulle part.
  const subs = new Map(
    input.subscriptions
      .filter((s) => orgIds.has(s.organizationId))
      .map((s) => [s.organizationId, s]),
  );

  const planOf = (o: StatsOrganization) => subs.get(o.id)?.effectivePlan ?? 'free';
  const statusOf = (o: StatsOrganization) => subs.get(o.id)?.status ?? STATUS_NONE;

  const active = new Set(input.activeOrganizationIds.filter((id) => orgIds.has(id)));
  const created = input.organizations.filter(
    (o) => o.createdAt !== null && o.createdAt.getTime() >= since,
  ).length;

  const trialSubs = [...subs.values()].filter((s) => s.trialStartedAt !== null);
  const converted = trialSubs.filter(
    (s) => s.lastPaymentAt !== null && s.lastPaymentAt.getTime() >= s.trialStartedAt!.getTime(),
  ).length;
  const ongoing = [...subs.values()].filter((s) => s.status === 'trialing').length;

  const modules = new Map<string, number>();
  for (const m of STATS_MODULES) {
    const ids = new Set((input.moduleAdoption[m] ?? []).filter((id) => orgIds.has(id)));
    modules.set(m, ids.size);
  }

  return {
    version: PLATFORM_STATS_VERSION,
    generatedAt: input.now.toISOString(),
    windowDays: input.windowDays,
    minCell,
    organizations: {
      total: cell(input.organizations.length, minCell),
      activeInWindow: cell(active.size, minCell),
      createdInWindow: cell(created, minCell),
      byPlan: partition(countBy(input.organizations, planOf, input.plans), minCell),
      byCountry: partition(sortedByKey(countBy(input.organizations, (o) => o.pays)), minCell),
      bySubscriptionStatus: partition(sortedByKey(countBy(input.organizations, statusOf)), minCell),
      byType: partition(sortedByKey(countBy(input.organizations, (o) => o.type)), minCell),
    },
    users: {
      total: cell(input.users.total, minCell),
      activeInWindow: cell(input.users.activeInWindow, minCell),
      createdInWindow: cell(input.users.createdInWindow, minCell),
    },
    trials: {
      started: cell(trialSubs.length, minCell),
      converted: cell(converted, minCell),
      ongoing: cell(ongoing, minCell),
    },
    // Pas une partition (une organisation utilise plusieurs modules) : seuil simple.
    modules: [...modules.entries()].map(([key, n]) => ({ key, cell: cell(n, minCell) })),
    usage: {
      aiCallsInWindow: cell(input.usage.aiCallsInWindow, minCell),
      pdfExportsInWindow: cell(input.usage.pdfExportsInWindow, minCell),
    },
  };
}

/** Toutes les cases d'un résultat, pour les tests de seuil. */
export function allCells(stats: PlatformStats): StatCell[] {
  const o = stats.organizations;
  return [
    o.total,
    o.activeInWindow,
    o.createdInWindow,
    ...[o.byPlan, o.byCountry, o.bySubscriptionStatus, o.byType, stats.modules].flatMap((rows) =>
      rows.map((r) => r.cell),
    ),
    stats.users.total,
    stats.users.activeInWindow,
    stats.users.createdInWindow,
    stats.trials.started,
    stats.trials.converted,
    stats.trials.ongoing,
    stats.usage.aiCallsInWindow,
    stats.usage.pdfExportsInWindow,
  ];
}
