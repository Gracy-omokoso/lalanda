'use client';

// Vue projet — wizard de saisie par étapes (S18c), généré dynamiquement depuis le DSL.
// Drivers, labels, aide, min/max, unité, devise et découpage en étapes viennent tous du
// serveur. Aucune logique métier locale : le moteur reste la source de vérité (brief §3-1).
//
// Historique : S5a saisie monolithique par groupes → S13d onglets de résultats
// → S18c parcours guidé (progression, auto-save débouncé, validation 3 niveaux,
// étape finale de synthèse).
//
// L'onglet de résultats actif est persisté dans l'URL via `?tab=...`
// (useSearchParams sous Suspense, requis par le pré-rendu statique Next 15).

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  api,
  type AmortissementsView,
  type EtatsFinanciersView,
  type LineResult,
  type ParameterPackDetail,
  type PlanSummaryView,
  type ProjectView,
  type TemplateDriverMeta,
  type TemplateMeta,
} from '@/lib/api';

import { AmortissementsTable } from './amortissements-table';
import { BfrTable, BilanTable, CafTable, SeuilTable } from './etats-financiers-tables';
import { RatiosStickyBanner } from './ratios-sticky-banner';
import { SheetTabs, type SheetTab } from './sheet-tabs';
import { saveStatusLabel, useAutosave } from './use-autosave';
import { WizardField } from './wizard-field';
import {
  blockingDriverIds,
  buildWizardSteps,
  diagnoseStep,
  initialProvenance,
  initialRawValues,
  parseInput,
  type Provenance,
} from './wizard-model';
import { WizardProgress, type StepIndicator } from './wizard-progress';
import { WizardSummary } from './wizard-summary';

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
  // (S18a, FIN-001) États financiers prévisionnels.
  bfr: 'BFR',
  bilan: 'Bilan',
  caf: 'CAF',
  seuil_rentabilite: 'Seuil',
};

// Ordre canonique des onglets (gauche → droite) — S13d + S14c.
const TAB_ORDER: string[] = [
  'ratios',
  'activite',
  'tresorerie',
  'projection',
  'financement',
  'plan_financement',
  'bfr',
  'bilan',
  'caf',
  'seuil_rentabilite',
  'amortissements',
];

const DEFAULT_TAB = 'ratios';

export function ProjectPlan({ projectId }: { projectId: string }): React.ReactElement {
  const [project, setProject] = useState<ProjectView | null>(null);
  const [template, setTemplate] = useState<TemplateMeta | null>(null);
  const [pack, setPack] = useState<ParameterPackDetail | null>(null);
  /** Valeurs stockées (fractions pour les pourcentages) — charge utile envoyée au moteur. */
  const [values, setValues] = useState<Record<string, number>>({});
  /** Texte exact saisi par l'utilisateur — source de la validation, jamais écrêté. */
  const [raw, setRaw] = useState<Record<string, string>>({});
  /** Saisi par l'utilisateur ou simple suggestion du modèle (docs/06). */
  const [provenance, setProvenance] = useState<Record<string, Provenance>>({});
  /** Instantané des valeurs de la dernière évaluation réussie — détecte l'obsolescence. */
  const [evaluatedSnapshot, setEvaluatedSnapshot] = useState<string | null>(null);
  const [lines, setLines] = useState<LineResult[] | null>(null);
  const [amortissements, setAmortissements] = useState<AmortissementsView | undefined>(undefined);
  const [etatsFinanciers, setEtatsFinanciers] = useState<EtatsFinanciersView | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingXlsx, setDownloadingXlsx] = useState(false);
  // (S16c) Plans validés figés.
  const [plans, setPlans] = useState<PlanSummaryView[]>([]);
  const [approving, setApproving] = useState(false);
  const [planNotice, setPlanNotice] = useState<string | null>(null);
  // (S18c) Navigation par étapes.
  // `ready` n'est levé qu'une fois les valeurs initiales posées : sans lui, l'auto-save
  // prendrait l'état vide comme référence et réécrirait les drivers au simple chargement.
  const [ready, setReady] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [visited, setVisited] = useState<Set<string>>(new Set());

  const headingRef = useRef<HTMLHeadingElement>(null);
  const navigatedRef = useRef(false);

  const currency = template?.devise_base ?? 'USD';
  const steps = useMemo(() => (template ? buildWizardSteps(template) : []), [template]);

  const indicators: StepIndicator[] = useMemo(
    () =>
      steps.map((step) => {
        const { status, errors } = diagnoseStep(step, raw);
        return { step, status, errors, visited: visited.has(step.id) };
      }),
    [steps, raw, visited],
  );

  const blocking = useMemo(() => blockingDriverIds(steps, raw), [steps, raw]);
  const activeStep = steps[activeIndex];
  // Les résultats affichés ne correspondent plus aux hypothèses courantes : le recalcul
  // est différé (conforme docs/06), mais l'écart doit être visible.
  const resultsStale = lines !== null && evaluatedSnapshot !== JSON.stringify(values);

  // ─── Auto-save débouncé (WIZ-002) ───────────────────────────
  const saveDrivers = useCallback(
    async (payload: Record<string, number>) => {
      const updated = await api.updateDrivers(projectId, payload);
      setProject(updated);
    },
    [projectId],
  );
  const autosave = useAutosave({ value: values, save: saveDrivers, enabled: ready });

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Déplace le focus sur le titre de l'étape après une navigation clavier ou souris,
  // pour que le lecteur d'écran annonce le nouveau contenu (jamais au premier rendu).
  useEffect(() => {
    if (!navigatedRef.current) return;
    headingRef.current?.focus();
  }, [activeIndex]);

  // Marque l'étape courante comme visitée dès qu'elle s'affiche.
  useEffect(() => {
    if (!activeStep) return;
    setVisited((v) => (v.has(activeStep.id) ? v : new Set(v).add(activeStep.id)));
  }, [activeStep]);

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
      // Ces trois `set` sont dans le même tick : l'auto-save s'active avec `initial`
      // déjà en place et le prend comme référence, sans écriture réseau.
      setValues(initial);
      setRaw(initialRawValues(tmpl.drivers, initial));
      setProvenance(initialProvenance(tmpl.drivers, p.driverValues));
      setReady(true);

      // (S16c) Versions validées — best-effort, ne bloque pas la vue plan.
      try {
        const { plans: planList } = await api.listPlans(projectId);
        setPlans(planList);
      } catch {
        /* la liste des versions n'est pas critique pour l'édition */
      }
      // (S18c) Pack fiscal — alimente l'avertissement `a_confirmer` de la synthèse.
      try {
        const { pack: detail } = await api.getParameterPack(p.parameterPackSlug);
        setPack(detail);
      } catch {
        /* la synthèse retombe sur le slug du projet si le pack n'est pas lisible */
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
      setEtatsFinanciers(res.etatsFinanciers);
      setEvaluatedSnapshot(JSON.stringify(payload));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur d'évaluation");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Applique une saisie. Le texte est conservé tel quel (support de la frappe
   * intermédiaire « -», « 12, »…), et la valeur numérique n'est mise à jour que
   * lorsqu'elle est lisible — sans aucun écrêtage sur min/max : une valeur hors
   * bornes reste visible et signalée comme erreur bloquante.
   */
  function handleFieldChange(driver: TemplateDriverMeta, text: string): void {
    setRaw((r) => ({ ...r, [driver.id]: text }));
    // Dès la première frappe, la valeur cesse d'être une suggestion du modèle.
    setProvenance((p) => (p[driver.id] === 'saisi' ? p : { ...p, [driver.id]: 'saisi' }));
    const parsed = parseInput(driver, text);
    if (parsed !== null) setValues((v) => ({ ...v, [driver.id]: parsed }));
  }

  function goToStep(index: number): void {
    if (index < 0 || index >= steps.length) return;
    navigatedRef.current = true;
    setActiveIndex(index);
  }

  async function handleDownload(kind: 'pdf' | 'xlsx'): Promise<void> {
    // Un dossier remis à une banque ne part jamais avec des hypothèses hors bornes.
    // Le serveur reste l'autorité (400 DRIVERS_OUT_OF_RANGE à la validation d'un
    // plan) ; ici on refuse tôt, avec un message explicite plutôt qu'un bouton inerte.
    if (blocking.length > 0) {
      setError(
        `Export impossible : ${blocking.length} hypothèse${blocking.length > 1 ? 's sont' : ' est'} hors des bornes autorisées. Corrigez-${blocking.length > 1 ? 'les' : 'la'} avant d'exporter.`,
      );
      return;
    }
    const setBusy = kind === 'pdf' ? setDownloadingPdf : setDownloadingXlsx;
    setBusy(true);
    setError(null);
    try {
      // Les exports utilisent les driverValues persistés — vider la file d'auto-save.
      await autosave.flush();
      const { blob, filename } =
        kind === 'pdf'
          ? await api.downloadProjectPdf(projectId)
          : await api.downloadProjectXlsx(projectId);
      triggerDownload(blob, filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de générer l'export");
    } finally {
      setBusy(false);
    }
  }

  // (S16c) Fige la version courante en plan validé vN+1.
  async function handleApprovePlan(): Promise<void> {
    if (blocking.length > 0) {
      setError(
        `Validation impossible : ${blocking.length} hypothèse${blocking.length > 1 ? 's sont' : ' est'} hors des bornes autorisées.`,
      );
      return;
    }
    setApproving(true);
    setError(null);
    setPlanNotice(null);
    try {
      // Le plan fige les drivers PERSISTÉS — synchroniser d'abord.
      await autosave.flush();
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

  if (!project || !template || !activeStep) {
    return <p className="text-sm text-[var(--foreground-muted)]">{error ?? 'Chargement…'}</p>;
  }

  const isLast = activeIndex === steps.length - 1;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl font-semibold tracking-tight">{project.name}</h2>
        <span className="text-xs text-[var(--foreground-muted)]">
          Template <code className="font-mono">{template.slug}</code> v{template.version}
        </span>
      </header>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* ─── Colonne saisie : wizard ────────────────────────── */}
        <section aria-label="Saisie des hypothèses" className="flex flex-col gap-5">
          <WizardProgress indicators={indicators} activeIndex={activeIndex} onSelect={goToStep} />

          <SaveIndicator state={autosave.state} onRetry={autosave.retry} />

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h3
                ref={headingRef}
                tabIndex={-1}
                className="font-display text-lg font-semibold tracking-tight outline-none"
              >
                {activeStep.label}
              </h3>
              {activeStep.description ? (
                <p className="text-sm text-[var(--foreground-muted)]">{activeStep.description}</p>
              ) : null}
            </div>

            {activeStep.synthese ? (
              <WizardSummary
                project={project}
                template={template}
                pack={pack}
                indicators={indicators}
                raw={raw}
                currency={currency}
                onGoToStep={goToStep}
                onRecalculer={() => void evaluate(values)}
                onValider={() => void handleApprovePlan()}
                recalculating={loading}
                approving={approving}
                blocking={blocking}
              />
            ) : (
              // `key` : remonte les champs à chaque étape pour repartir d'un état propre.
              <div key={activeStep.id} className="flex flex-col gap-5">
                {activeStep.drivers.map((d) => (
                  <WizardField
                    key={d.id}
                    driver={d}
                    raw={raw[d.id] ?? ''}
                    provenance={provenance[d.id] ?? 'defaut'}
                    onChange={(text) => handleFieldChange(d, text)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ─── Navigation précédent / suivant ─────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
            <button
              type="button"
              onClick={() => goToStep(activeIndex - 1)}
              disabled={activeIndex === 0}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium transition hover:bg-[var(--surface-muted)] disabled:opacity-40"
            >
              ← Précédent
            </button>
            {!isLast ? (
              <button
                type="button"
                onClick={() => goToStep(activeIndex + 1)}
                className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90"
              >
                Suivant →
              </button>
            ) : null}
          </div>

          {planNotice ? <p className="text-xs text-[var(--accent)]">{planNotice}</p> : null}

          {/* Exports et versions figées : accessibles depuis n'importe quelle étape
              — les cantonner à la synthèse était une régression de portée vs S16c. */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void handleDownload('pdf')}
                disabled={downloadingPdf}
                title="Télécharger le rapport PDF"
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium transition hover:bg-[var(--surface-muted)] disabled:opacity-40"
              >
                {downloadingPdf ? 'Génération…' : 'Télécharger PDF'}
              </button>
              <button
                type="button"
                onClick={() => void handleDownload('xlsx')}
                disabled={downloadingXlsx}
                title="Exporter le plan financier en Excel (formules préservées)"
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium transition hover:bg-[var(--surface-muted)] disabled:opacity-40"
              >
                {downloadingXlsx ? 'Génération…' : 'Exporter Excel'}
              </button>
            </div>
            <PlanVersionsList plans={plans} onDownload={handleDownloadPlanExport} />
          </div>
        </section>

        {/* ─── Colonne résultats : reste accessible à toute étape ─ */}
        <section aria-label="Résultats du plan" className="flex flex-col gap-4">
          {error ? (
            <div
              role="alert"
              className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
            >
              <strong>Erreur :</strong> {error}
            </div>
          ) : null}
          {/* Recalcul différé (docs/06) : les chiffres affichés restent ceux de la
              dernière évaluation, mais leur obsolescence est explicite et corrigeable
              sans quitter l'étape courante. */}
          {resultsStale ? (
            // `status` : annonce l'obsolescence sans bavarder à chaque changement
            // d'onglet, ce qu'aurait fait un aria-live sur tout le panneau.
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--warn)]/40 p-3 text-sm"
            >
              <p className="flex items-center gap-2 text-[var(--warn)]">
                <span aria-hidden="true" className="dot dot-warn" />
                <span>
                  Résultats obsolètes — vos hypothèses ont changé depuis le dernier calcul.
                </span>
              </p>
              <button
                type="button"
                onClick={() => void evaluate(values)}
                disabled={loading}
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium transition hover:bg-[var(--surface-muted)] disabled:opacity-40"
              >
                {loading ? 'Calcul…' : 'Recalculer'}
              </button>
            </div>
          ) : null}
          {lines ? (
            // useSearchParams doit vivre sous <Suspense> pour le pré-rendu statique Next 15.
            <Suspense
              fallback={<p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>}
            >
              <ResultsTabs
                lines={lines}
                currency={currency}
                amortissements={amortissements}
                etatsFinanciers={etatsFinanciers}
              />
            </Suspense>
          ) : (
            <p className="text-sm text-[var(--foreground-muted)]">…</p>
          )}
        </section>
      </div>
    </div>
  );
}

// ─── Indicateur d'auto-save (S18c — WIZ-002) ─────────────────

function SaveIndicator({
  state,
  onRetry,
}: {
  state: ReturnType<typeof useAutosave>['state'];
  onRetry: () => void;
}): React.ReactElement {
  const isError = state.status === 'error';
  return (
    <p
      // `polite` : l'état est annoncé sans interrompre la saisie en cours.
      aria-live="polite"
      className={`flex flex-wrap items-center gap-2 text-xs ${
        isError ? 'text-[var(--danger)]' : 'text-[var(--foreground-muted)]'
      }`}
    >
      <span
        aria-hidden="true"
        className={
          isError ? 'dot dot-ko' : state.status === 'saved' ? 'dot dot-ok' : 'dot dot-warn'
        }
      />
      {saveStatusLabel(state)}
      {isError ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded border border-[var(--danger)]/50 px-2 py-0.5 font-medium transition hover:bg-[var(--danger)]/10"
        >
          Réessayer
        </button>
      ) : null}
    </p>
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
              <span className="fig font-semibold">v{p.version}</span>
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
  etatsFinanciers?: EtatsFinanciersView;
}

function ResultsTabs({
  lines,
  currency,
  amortissements,
  etatsFinanciers,
}: ResultsTabsProps): React.ReactElement {
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
  // (S18a) 'bfr' est un onglet VIRTUEL : ses lignes vivent dans `plan_financement`
  // (`pf_bfr_*`, ADR-0011 § Contrat 2), son rendu vient de la struct `etatsFinanciers`.
  const hasVirtualTab = useCallback(
    (id: string): boolean =>
      (id === 'amortissements' && amortissements !== undefined) ||
      (id === 'bfr' && etatsFinanciers !== undefined),
    [amortissements, etatsFinanciers],
  );

  const tabs: SheetTab[] = useMemo(() => {
    const seen = new Set<string>();
    const ordered: SheetTab[] = [];
    for (const id of TAB_ORDER) {
      if (bySheet.has(id) || hasVirtualTab(id)) {
        ordered.push({ id, label: SHEET_LABELS[id] ?? id });
        seen.add(id);
      }
    }
    for (const id of bySheet.keys()) {
      if (!seen.has(id)) ordered.push({ id, label: SHEET_LABELS[id] ?? id });
    }
    return ordered;
  }, [bySheet, hasVirtualTab]);

  // Onglet actif : ?tab=... si valide, sinon défaut (ratios) sinon 1er dispo.
  // (S14c) 'amortissements' est un onglet valide même sans lignes (rendu par AmortissementsTable).
  const requestedTab = searchParams.get('tab');
  const isValidTab = (id: string): boolean => bySheet.has(id) || hasVirtualTab(id);
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
  // (S18a) Le détail annuel du BFR a son propre onglet : on l'ôte du tableau brut
  // du plan de financement, qui doit rester la lecture « besoins / ressources ».
  const activeLines = (bySheet.get(activeTab) ?? []).filter(
    (l) => activeTab !== 'plan_financement' || !l.lineId.startsWith('pf_bfr_'),
  );

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
        ) : activeTab === 'bilan' && etatsFinanciers ? (
          <BilanTable etats={etatsFinanciers} currency={currency} />
        ) : activeTab === 'bfr' && etatsFinanciers ? (
          <BfrTable etats={etatsFinanciers} currency={currency} />
        ) : activeTab === 'caf' && etatsFinanciers ? (
          <CafTable etats={etatsFinanciers} currency={currency} />
        ) : activeTab === 'seuil_rentabilite' && etatsFinanciers ? (
          <SeuilTable etats={etatsFinanciers} currency={currency} />
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
      {/* Les tables financières défilent horizontalement sur mobile (docs/04-UX-UI.md). */}
      <div className="overflow-x-auto">
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
                <td className="fig py-2.5 pl-2 text-right">
                  {formatValue(line.value, line.format, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
                <span className="fig text-sm font-semibold">
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
