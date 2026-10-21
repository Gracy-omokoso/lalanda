// Adaptateurs purs : documents Mongo (lus, jamais écrits) → entrées du moteur GROW
// (ADR-0032 § 2). Aucun calcul ici : on recopie des champs, le moteur calcule.

import type {
  GrowActualPeriod,
  GrowActualsSource,
  GrowIndicatorsResult,
  GrowSalesAmounts,
  GrowSalesDocument,
} from '@lalanda/engine';

/** Projection lue dans `sales_invoices` (voir `GrowReaderService`). */
export interface InvoiceForGrow {
  _id: unknown;
  type: GrowSalesDocument['type'];
  status: string;
  series: string | null;
  issuedAt: Date | null;
  currency: string;
  customer?: { customerId?: string | null; name?: string | null } | null;
  lines?: { catalogItemId?: string | null }[] | null;
  documentAmounts?: {
    calculation?: { totals?: { groups?: { group: string; ht: string }[] } | null } | null;
  } | null;
  normalizedAmounts?: {
    currency?: string;
    calculation?: { groups?: { group: string; ht: string }[] } | null;
  } | null;
}

/**
 * Document de vente pour le moteur, ou `null` si ses montants manquent — ce qui
 * n'arrive pas pour un document final (le gel exige un calcul réussi, ADR-0023).
 */
export function toGrowSalesDocument(inv: InvoiceForGrow): GrowSalesDocument | null {
  const groups = inv.documentAmounts?.calculation?.totals?.groups;
  if (!groups) return null;
  const amounts: GrowSalesAmounts[] = [
    { currency: inv.currency, groups: groups.map((g) => ({ group: g.group, ht: g.ht })) },
  ];
  const normalized = inv.normalizedAmounts?.calculation?.groups;
  const normalizedCurrency = inv.normalizedAmounts?.currency ?? 'CDF';
  if (normalized && normalizedCurrency !== inv.currency) {
    amounts.push({
      currency: normalizedCurrency,
      groups: normalized.map((g) => ({ group: g.group, ht: g.ht })),
    });
  }
  return {
    id: String(inv._id),
    type: inv.type,
    status: inv.status,
    series: inv.series,
    issuedAt: inv.issuedAt ? inv.issuedAt.toISOString() : null,
    customerKey: inv.customer?.customerId ?? null,
    customerName: inv.customer?.name ?? null,
    amounts,
    lineCatalogItemIds: (inv.lines ?? []).map((l) => l.catalogItemId ?? null),
  };
}

export interface ProjectForGrow {
  _id: unknown;
  name: string;
  deviseAffichage: string;
}

export interface ActualPeriodForGrow {
  year: number;
  month: number;
  status: 'open' | 'closed';
  closedAt?: Date | null;
  values?: Record<string, unknown> | null;
}

/**
 * Projet de référence (ADR-0032 O2) : celui que l'utilisateur a choisi s'il existe
 * encore dans l'organisation ; à défaut le seul projet ; sinon aucun, et la raison.
 */
export function pickReferenceProject(
  projects: readonly ProjectForGrow[],
  declaredId: string | null,
):
  | { project: ProjectForGrow; selection: 'declared' | 'only_project' }
  | { project: null; reason: 'AUCUN_PROJET' | 'PROJET_DE_REFERENCE_A_CHOISIR' } {
  const declared =
    declaredId === null ? undefined : projects.find((p) => String(p._id) === declaredId);
  if (declared) return { project: declared, selection: 'declared' };
  if (projects.length === 1) return { project: projects[0]!, selection: 'only_project' };
  return {
    project: null,
    reason: projects.length === 0 ? 'AUCUN_PROJET' : 'PROJET_DE_REFERENCE_A_CHOISIR',
  };
}

export function toGrowActuals(
  ref: ReturnType<typeof pickReferenceProject>,
  periods: readonly ActualPeriodForGrow[],
): GrowActualsSource {
  if (ref.project === null) return { kind: 'none', reason: ref.reason };
  return {
    kind: 'project',
    projectId: String(ref.project._id),
    projectName: ref.project.name,
    currency: ref.project.deviseAffichage,
    selection: ref.selection,
    periods: periods.map((p): GrowActualPeriod => ({
      year: p.year,
      month: p.month,
      status: p.status,
      closedAt: p.closedAt ? p.closedAt.toISOString() : null,
      // Seules les valeurs numériques sont des observations (docs/08).
      values: Object.fromEntries(
        Object.entries(p.values ?? {}).filter(
          (e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]),
        ),
      ),
    })),
  };
}

/**
 * Retire les NOMS des clients des indicateurs pour un appelant sans `sales.read`
 * (ADR-0032 § 6 : le Conseiller, externe, lit les parts sans les noms — le fichier
 * clients contient des données personnelles, ADR-0022 § S25c.1).
 */
export function withoutCustomerNames(result: GrowIndicatorsResult): GrowIndicatorsResult {
  const c = result.indicateurs.concentration_clients;
  if (!c.disponible || !c.premiersClients) return result;
  return {
    ...result,
    indicateurs: {
      ...result.indicateurs,
      concentration_clients: {
        ...c,
        premiersClients: c.premiersClients.map((x) => ({
          ...x,
          cle: `client-${x.rang}`,
          nom: null,
        })),
      },
    },
  };
}
