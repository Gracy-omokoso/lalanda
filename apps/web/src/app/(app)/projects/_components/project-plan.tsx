'use client';

// Vue projet — wizard généré dynamiquement depuis le DSL (S5a) :
// - drivers, labels, aide, min/max, unité, devise viennent tous du serveur
// - regroupement par `groupes_hypotheses` si le template en définit
// Aucune logique métier locale — le moteur reste la source de vérité (brief §3-1).
//
// S13d : panneau résultats en onglets + bandeau ratios sticky.
// L'onglet actif est persisté dans l'URL via `?tab=...` (useSearchParams sous Suspense).

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';

import {
  api,
  type AmortissementsView,
  type LineResult,
  type PlanSummaryView,
  type ProjectView,
  type TemplateDriverMeta,
  type TemplateMeta,
} from '@/lib/api';

import { AmortissementsTable } from './amortissements-table';
import { RatiosStickyBanner } from './ratios-sticky-banner';
import { SheetTabs, type SheetTab } from './sheet-tabs';

interface DriverGroup {
  id: string;
  label: string;
  drivers: TemplateDriverMeta[];
}

function isPercent(d: TemplateDriverMeta): boolean {
  return d.type === 'percent';
}

function driverSuffix(d: TemplateDriverMeta): string {
  if (isPercent(d)) return '%';
  if (d.type === 'money') return d.devise ?? 'USD';
  return d.unite ?? '';
}

function formatValue(
  value: number,
  format: LineResult['format'],
  currency: string = 'USD',
): string {
  if (format === 'percent') {
    return new Intl.NumberFormat('fr-FR', {
      style: 'percent',
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (format === 'money') {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  }
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value);
}

/**
 * Regroupe les drivers selon `groupes_hypotheses` du template.
 * Fallback : un seul groupe "default" avec tous les drivers.
 */
function groupDrivers(template: TemplateMeta): DriverGroup[] {
  const groups = template.groupes_hypotheses ?? [];
  if (groups.length === 0) {
    return [{ id: '_all', label: 'Hypothèses', drivers: template.drivers }];
  }
  const byId = new Map(groups.map((g) => [g.id, { ...g, drivers: [] as TemplateDriverMeta[] }]));
  const orphans: TemplateDriverMeta[] = [];
  for (const d of template.drivers) {
    if (d.groupe && byId.has(d.groupe)) {
      byId.get(d.groupe)!.drivers.push(d);
    } else {
      orphans.push(d);
    }
  }
  const result: DriverGroup[] = [...byId.values()].filter((g) => g.drivers.length > 0);
  if (orphans.length > 0) result.push({ id: '_other', label: 'Autres', drivers: orphans });
  return result;
}

// ─── Configuration onglets (S13d) ─────────────────────────────
// Labels FR de fallback si l'API ne les fournit pas.
const SHEET_LABELS: Record<string, string> = {
  ratios: 'Ratios bancaires',
  activite: "Compte d'exploitation",
  tresorerie: 'Trésorerie mensuelle',
  projection: 'Projection 3 ans',
  financement: 'Financement',
  plan_financement: 'Plan de financement',
  amortissements: 'Amortissements',
};

// Ordre canonique des onglets (gauche → droite) — S13d + S14c.
const TAB_ORDER: string[] = [
  'ratios',
  'activite',
  'tresorerie',
  'projection',
  'financement',
  'plan_financement',
  'amortissements',
];

const DEFAULT_TAB = 'ratios';

export function ProjectPlan({ projectId }: { projectId: string }): React.ReactElement {
  const [project, setProject] = useState<ProjectView | null>(null);
  const [template, setTemplate] = useState<TemplateMeta | null>(null);
  const [values, setValues] = useState<Record<string, number>>({});
  const [lines, setLines] = useState<LineResult[] | null>(null);
  const [amortissements, setAmortissements] = useState<AmortissementsView | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingXlsx, setDownloadingXlsx] = useState(false);
  // (S16c) Plans validés figés.
  const [plans, setPlans] = useState<PlanSummaryView[]>([]);
  const [approving, setApproving] = useState(false);
  const [planNotice, setPlanNotice] = useState<string | null>(null);

  const groups = useMemo(() => (template ? groupDrivers(template) : []), [template]);
  const currency = template?.devise_base ?? 'USD';

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function load(): Promise<void> {
    setError(null);
    try {
      const p = await api.getProject(projectId);
      setProject(p);
      const { template: tmpl } = await api.getTemplate(p.templateSlug);
      setTemplate(tmpl);

      // Défauts DSL + overrides du projet.
      const defaults = Object.fromEntries(tmpl.drivers.map((d) => [d.id, d.defaut ?? 0]));
      const initial = { ...defaults, ...p.driverValues };
      setValues(initial);
      setDirty(false);
      // (S16c) Versions validées — best-effort, ne bloque pas la vue plan.
      try {
        const { plans: planList } = await api.listPlans(projectId);
        setPlans(planList);
      } catch {
        /* la liste des versions n'est pas critique pour l'édition */
      }
      await evaluate(initial);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    }
  }

  async function evaluate(payload: Record<string, number>): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await api.evaluateProject(projectId, payload, false);
      setLines(res.lines);
      setAmortissements(res.amortissements);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur d'évaluation");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateDrivers(projectId, values);
      setProject(updated);
      setDirty(false);
      setSavedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de sauvegarder');
    } finally {
      setSaving(false);
    }
  }

  async function handleDownloadPdf(): Promise<void> {
    setDownloadingPdf(true);
    setError(null);
    try {
      // Le PDF utilise les driverValues persistés — s'assurer qu'ils sont à jour côté serveur.
      if (dirty) await handleSave();
      const { blob, filename } = await api.downloadProjectPdf(projectId);
      triggerDownload(blob, filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de générer le PDF');
    } finally {
      setDownloadingPdf(false);
    }
  }

  async function handleDownloadXlsx(): Promise<void> {
    setDownloadingXlsx(true);
    setError(null);
    try {
      // Comme le PDF, l'Excel utilise les driverValues persistés — synchroniser si dirty.
      if (dirty) await handleSave();
      const { blob, filename } = await api.downloadProjectXlsx(projectId);
      triggerDownload(blob, filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de générer l'Excel");
    } finally {
      setDownloadingXlsx(false);
    }
  }

  // (S16c) Fige la version courante en plan validé vN+1.
  async function handleApprovePlan(): Promise<void> {
    setApproving(true);
    setError(null);
    setPlanNotice(null);
    try {
      // Le plan fige les drivers PERSISTÉS — synchroniser d'abord si modifiés.
      if (dirty) await handleSave();
      const plan = await api.approvePlan(projectId);
      setPlanNotice(`Plan validé v${plan.version} créé — chiffres figés.`);
      const { plans: planList } = await api.listPlans(projectId);
      setPlans(planList);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 409) {
        setPlanNotice('Aucun changement depuis le dernier plan validé — pas de nouvelle version.');
      } else {
        setError(err instanceof Error ? err.message : 'Impossible de valider le plan');
      }
    } finally {
      setApproving(false);
    }
  }

  async function handleDownloadPlanExport(version: number, kind: 'pdf' | 'xlsx'): Promise<void> {
    setError(null);
    try {
      const { blob, filename } =
        kind === 'pdf'
          ? await api.downloadProjectPdf(projectId, version)
          : await api.downloadProjectXlsx(projectId, version);
      triggerDownload(blob, filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de générer l'export");
    }
  }

  function triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function updateDriver(driver: TemplateDriverMeta, raw: string): void {
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return;
    // percent : l'UI reçoit en pourcentage (ex 40), on stocke en fraction (0.4).
    let final = isPercent(driver) ? parsed / 100 : parsed;
    // Contraintes min/max si définies dans le DSL.
    if (driver.min !== undefined && final < driver.min) final = driver.min;
    if (driver.max !== undefined && final > driver.max) final = driver.max;
    setValues((v) => ({ ...v, [driver.id]: final }));
    setDirty(true);
  }

  if (!project || !template) {
    return <p className="text-sm text-[var(--foreground-muted)]">{error ?? 'Chargement…'}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">{project.name}</h2>
        <span className="text-xs text-[var(--foreground-muted)]">
          Template <code>{template.slug}</code> v{template.version}
        </span>
      </header>

      <div className="grid gap-8 md:grid-cols-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void evaluate(values);
          }}
          className="flex flex-col gap-6"
        >
          {groups.map((group) => (
            <fieldset key={group.id} className="flex flex-col gap-4">
              <legend className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
                {group.label}
              </legend>
              {group.drivers.map((d) => {
                const raw = values[d.id] ?? d.defaut ?? 0;
                const display = isPercent(d) ? raw * 100 : raw;
                return (
                  <label key={d.id} className="flex flex-col gap-1 text-sm">
                    <span className="flex items-baseline justify-between gap-2 font-medium">
                      <span>{d.label ?? d.id}</span>
                      {d.min !== undefined || d.max !== undefined ? (
                        <span className="text-xs font-normal text-[var(--foreground-muted)]/60">
                          {d.min !== undefined ? `min ${isPercent(d) ? d.min * 100 : d.min}` : ''}
                          {d.min !== undefined && d.max !== undefined ? ' · ' : ''}
                          {d.max !== undefined ? `max ${isPercent(d) ? d.max * 100 : d.max}` : ''}
                        </span>
                      ) : null}
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="any"
                        value={display}
                        min={d.min !== undefined ? (isPercent(d) ? d.min * 100 : d.min) : undefined}
                        max={d.max !== undefined ? (isPercent(d) ? d.max * 100 : d.max) : undefined}
                        onChange={(e) => updateDriver(d, e.target.value)}
                        className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
                      />
                      <span className="w-16 text-xs text-[var(--foreground-muted)]">
                        {driverSuffix(d)}
                      </span>
                    </div>
                    {d.aide ? (
                      <span className="text-xs italic text-[var(--foreground-muted)]">
                        {d.aide}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </fieldset>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-50"
            >
              {loading ? 'Calcul…' : 'Recalculer'}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || !dirty}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium transition hover:bg-[var(--surface-muted)] disabled:opacity-40"
            >
              {saving ? 'Sauvegarde…' : dirty ? 'Enregistrer' : 'Enregistré'}
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadPdf()}
              disabled={downloadingPdf}
              title="Télécharger le rapport PDF"
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium transition hover:bg-[var(--surface-muted)] disabled:opacity-40"
            >
              {downloadingPdf ? 'Génération…' : 'Télécharger PDF'}
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadXlsx()}
              disabled={downloadingXlsx}
              title="Exporter le plan financier en Excel (formules préservées)"
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium transition hover:bg-[var(--surface-muted)] disabled:opacity-40"
            >
              {downloadingXlsx ? 'Génération…' : 'Exporter Excel'}
            </button>
            <button
              type="button"
              onClick={() => void handleApprovePlan()}
              disabled={approving}
              title="Fige les chiffres actuels en version validée immuable (vN+1)"
              className="rounded-md border border-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent)] transition hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)] disabled:opacity-40"
            >
              {approving ? 'Validation…' : 'Valider ce plan'}
            </button>
            {savedAt ? (
              <span className="text-xs text-[var(--foreground-muted)]">
                Sauvegardé à {new Date(savedAt).toLocaleTimeString('fr-FR')}
              </span>
            ) : null}
          </div>
          {planNotice ? (
            <p className="text-xs text-[var(--accent)]">{planNotice}</p>
          ) : null}
          <PlanVersionsList plans={plans} onDownload={handleDownloadPlanExport} />
        </form>

        <div className="flex flex-col gap-4">
          {error ? (
            <div className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]">
              <strong>Erreur :</strong> {error}
            </div>
          ) : null}
          {lines ? (
            // useSearchParams doit vivre sous <Suspense> pour le pré-rendu statique Next 15.
            <Suspense
              fallback={<p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>}
            >
              <ResultsTabs lines={lines} currency={currency} amortissements={amortissements} />
            </Suspense>
          ) : (
            <p className="text-sm text-[var(--foreground-muted)]">…</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Plans validés figés (S16c) ──────────────────────────────

function PlanVersionsList({
  plans,
  onDownload,
}: {
  plans: PlanSummaryView[];
  onDownload: (version: number, kind: 'pdf' | 'xlsx') => Promise<void>;
}): React.ReactElement | null {
  if (plans.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
        Plans validés
      </h3>
      <ul className="flex flex-col gap-1.5">
        {plans.map((p) => (
          <li
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          >
            <div className="flex items-center gap-2">
              <span className="font-semibold tabular-nums">v{p.version}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  p.status === 'approved'
                    ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                    : 'bg-[var(--border)] text-[var(--foreground-muted)]'
                }`}
              >
                {p.status === 'approved' ? 'Validé' : 'Remplacé'}
              </span>
              <span className="text-xs text-[var(--foreground-muted)]">
                {new Date(p.approvedAt).toLocaleDateString('fr-FR', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void onDownload(p.version, 'pdf')}
                title={`Télécharger le PDF figé du plan v${p.version} (aucun recalcul)`}
                className="rounded border border-[var(--border)] px-2 py-1 text-xs transition hover:bg-[var(--surface-muted)]"
              >
                PDF
              </button>
              <button
                type="button"
                onClick={() => void onDownload(p.version, 'xlsx')}
                title={`Télécharger l'Excel figé du plan v${p.version} (aucun recalcul)`}
                className="rounded border border-[var(--border)] px-2 py-1 text-xs transition hover:bg-[var(--surface-muted)]"
              >
                Excel
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Panneau résultats en onglets (S13d) ─────────────────────

interface ResultsTabsProps {
  lines: LineResult[];
  currency: string;
  amortissements?: AmortissementsView;
}

function ResultsTabs({ lines, currency, amortissements }: ResultsTabsProps): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Regroupement par feuille.
  const bySheet = useMemo(() => {
    const map = new Map<string, LineResult[]>();
    for (const l of lines) {
      const arr = map.get(l.sheetId) ?? [];
      arr.push(l);
      map.set(l.sheetId, arr);
    }
    return map;
  }, [lines]);

  // Onglets à afficher : ordre canonique + toute feuille inconnue à la suite.
  // (S14c) 'amortissements' est ajouté même si aucune ligne (rendu piloté par la
  // struct dédiée `amortissements`).
  const tabs: SheetTab[] = useMemo(() => {
    const seen = new Set<string>();
    const ordered: SheetTab[] = [];
    for (const id of TAB_ORDER) {
      if (bySheet.has(id) || (id === 'amortissements' && amortissements)) {
        ordered.push({ id, label: SHEET_LABELS[id] ?? id });
        seen.add(id);
      }
    }
    for (const id of bySheet.keys()) {
      if (!seen.has(id)) ordered.push({ id, label: SHEET_LABELS[id] ?? id });
    }
    return ordered;
  }, [bySheet, amortissements]);

  // Onglet actif : ?tab=... si valide, sinon défaut (ratios) sinon 1er dispo.
  // (S14c) 'amortissements' est un onglet valide même sans lignes (rendu par AmortissementsTable).
  const requestedTab = searchParams.get('tab');
  const isValidTab = (id: string): boolean =>
    bySheet.has(id) || (id === 'amortissements' && amortissements !== undefined);
  const fallbackTab = bySheet.has(DEFAULT_TAB) ? DEFAULT_TAB : (tabs[0]?.id ?? DEFAULT_TAB);
  const activeTab = requestedTab && isValidTab(requestedTab) ? requestedTab : fallbackTab;

  const setActiveTab = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set('tab', id);
      // replace : n'empile pas dans l'historique navigateur pour un simple switch UI.
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const ratiosLines = bySheet.get('ratios') ?? [];
  const activeLines = bySheet.get(activeTab) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <RatiosStickyBanner
        lines={ratiosLines}
        currency={currency}
        onSelect={() => setActiveTab('ratios')}
      />
      <SheetTabs tabs={tabs} activeId={activeTab} onChange={setActiveTab} />
      <div
        role="tabpanel"
        id={`sheet-panel-${activeTab}`}
        aria-labelledby={`sheet-tab-${activeTab}`}
      >
        {activeTab === 'ratios' ? (
          <RatiosCard lines={activeLines} />
        ) : activeTab === 'amortissements' && amortissements ? (
          <AmortissementsTable amortissements={amortissements} currency={currency} />
        ) : (
          <ResultsTable sheetId={activeTab} lines={activeLines} currency={currency} />
        )}
      </div>
    </div>
  );
}

// ─── Sous-composants d'affichage (S10) ───────────────────────

function ResultsTable({
  sheetId,
  lines,
  currency,
}: {
  sheetId: string;
  lines: LineResult[];
  currency: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
        {SHEET_LABELS[sheetId] ?? sheetId}
      </h3>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left">
            <th className="py-2 pr-2 font-medium text-[var(--foreground-muted)]">Ligne</th>
            <th className="py-2 pl-2 text-right font-medium text-[var(--foreground-muted)]">
              Valeur
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr
              key={line.lineId}
              className={`border-b border-[var(--border)] ${
                line.lineId === 'resultat_net' ? 'font-semibold text-[var(--accent)]' : ''
              }`}
            >
              <td className="py-2.5 pr-2">{line.label}</td>
              <td className="py-2.5 pl-2 text-right tabular-nums">
                {formatValue(line.value, line.format, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Couleurs des feux tricolores — cohérentes avec la palette produit. */
const STATUT_COLORS: Record<
  'vert' | 'orange' | 'rouge',
  { dot: string; text: string; label: string }
> = {
  vert: { dot: '#16a34a', text: 'text-[#15803d]', label: 'OK' },
  orange: { dot: '#ea580c', text: 'text-[#c2410c]', label: 'Vigilance' },
  rouge: { dot: '#dc2626', text: 'text-[#b91c1c]', label: 'Critique' },
};

function RatiosCard({ lines }: { lines: LineResult[] }): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
        Ratios financiers
      </h3>
      <ul className="flex flex-col gap-2">
        {lines.map((line) => {
          const seuilInfo = line.seuil ? STATUT_COLORS[line.seuil.statut] : null;
          return (
            <li
              key={line.lineId}
              className="flex flex-col gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {seuilInfo ? (
                    <span
                      aria-hidden="true"
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: seuilInfo.dot }}
                    />
                  ) : null}
                  <span className="text-sm font-medium">{line.label}</span>
                </div>
                <span className="text-sm font-semibold tabular-nums">
                  {formatValue(line.value, line.format, 'USD')}
                </span>
              </div>
              {line.seuil && seuilInfo ? (
                <div className={`text-[11px] ${seuilInfo.text}`}>
                  {seuilInfo.label} — seuil {line.seuil.direction === 'min' ? '≥' : '≤'}{' '}
                  {formatValue(line.seuil.valeur, line.format, 'USD')}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
