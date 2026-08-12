'use client';

// Vue RÉSULTATS d'un projet (S23a) — écran de LECTURE, sans aucune saisie.
//
// ── Pourquoi cet écran existe ──────────────────────────────────
// Jusqu'ici le wizard de saisie et les feuilles de résultats cohabitaient en
// deux colonnes sur `/projects/:id` (S18c). L'intention — voir l'impact d'une
// hypothèse pendant qu'on la tape — était bonne, mais avec onze feuilles, le
// bandeau de ratios, les exports et la liste des plans validés, l'écran ne
// tenait plus : on saisissait dans un couloir et on lisait des chiffres dans un
// autre. Décision produit : **on saisit, puis on lit**. La modification passe
// par un retour explicite dans l'assistant.
//
// Ce que cet écran NE fait pas :
//  - il n'écrit aucune hypothèse (aucun champ, aucun auto-save);
//  - il ne valide pas de plan. Valider un plan est un acte fort, figé et
//    versionné (CLAUDE.md) ; il reste au bout de l'assistant, à un seul
//    endroit. Ici on lit le calcul courant et on télécharge les versions déjà
//    figées.

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';

import {
  api,
  type AmortissementsView,
  type EtatsFinanciersView,
  type LineResult,
  type PlanSummaryView,
} from '@/lib/api';

import { PlanVersionsList } from './plan-versions-list';
import { ResultsTabs } from './results-tabs';
import { isUntouched, useProjectContext } from './use-project-context';

export function ProjectResults({ projectId }: { projectId: string }): React.ReactElement {
  const { project, template, values, ready, error: loadError } = useProjectContext(projectId);

  const [lines, setLines] = useState<LineResult[] | null>(null);
  const [amortissements, setAmortissements] = useState<AmortissementsView | undefined>(undefined);
  const [etatsFinanciers, setEtatsFinanciers] = useState<EtatsFinanciersView | undefined>(
    undefined,
  );
  const [plans, setPlans] = useState<PlanSummaryView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingXlsx, setDownloadingXlsx] = useState(false);

  const saisieHref = `/projects/${projectId}/saisie`;

  const evaluate = useCallback(
    async (payload: Record<string, number>) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.evaluateProject(projectId, payload, false);
        setLines(res.lines);
        setAmortissements(res.amortissements);
        setEtatsFinanciers(res.etatsFinanciers);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur d'évaluation");
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  // Le calcul est relancé au montage de l'écran, à partir des hypothèses
  // PERSISTÉES. C'est ce qui garantit qu'un aller-retour depuis l'assistant
  // affiche les chiffres de la dernière saisie : l'assistant vide sa file
  // d'auto-save avant de céder la main, l'écran de résultats relit le serveur.
  // Il n'y a donc plus de bandeau « résultats obsolètes » ici — un écran de
  // lecture n'a aucun moyen de rendre les chiffres obsolètes.
  useEffect(() => {
    if (!ready) return;
    void evaluate(values);
  }, [ready, values, evaluate]);

  useEffect(() => {
    let annule = false;
    void (async () => {
      try {
        const { plans: list } = await api.listPlans(projectId);
        if (!annule) setPlans(list);
      } catch {
        /* la liste des versions figées n'est pas critique pour la lecture */
      }
    })();
    return () => {
      annule = true;
    };
  }, [projectId]);

  async function handleDownload(kind: 'pdf' | 'xlsx'): Promise<void> {
    const setBusy = kind === 'pdf' ? setDownloadingPdf : setDownloadingXlsx;
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } =
        kind === 'pdf'
          ? await api.downloadProjectPdf(projectId)
          : await api.downloadProjectXlsx(projectId);
      triggerDownload(blob, filename);
    } catch (err) {
      // Le serveur reste l'autorité sur les bornes (400 DRIVERS_OUT_OF_RANGE) :
      // l'écran de lecture ne rejoue pas la validation du wizard, il renvoie
      // l'utilisateur là où la correction se fait.
      setError(err instanceof Error ? err.message : "Impossible de générer l'export");
    } finally {
      setBusy(false);
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

  if (!project || !template) {
    return <p className="text-sm text-[var(--foreground-muted)]">{loadError ?? 'Chargement…'}</p>;
  }

  const currency = template.devise_base ?? 'USD';

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-display text-2xl font-semibold tracking-tight">{project.name}</h2>
          <span className="text-xs text-[var(--foreground-muted)]">
            Résultats calculés — modèle <code className="font-mono">{template.slug}</code> v
            {template.version}
          </span>
        </div>
        {/* Le seul chemin vers la modification. Il est nommé, visible et
            constant : « pour modifier il faut rentrer vers les données ». */}
        <Link
          href={saisieHref}
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium transition hover:bg-[var(--surface-muted)]"
        >
          ← Modifier les hypothèses
        </Link>
      </header>

      {isUntouched(project) ? (
        <p className="rounded-md border border-[var(--warn)]/40 bg-[var(--surface-muted)] p-3 text-sm">
          Ces chiffres reposent encore entièrement sur les valeurs suggérées par le modèle sectoriel
          — ce ne sont pas les vôtres.{' '}
          <Link href={saisieHref} className="font-medium text-[var(--accent)] hover:underline">
            Saisissez vos hypothèses
          </Link>{' '}
          avant d’en tirer une conclusion ou de déposer un dossier.
        </p>
      ) : null}

      {(error ?? loadError) ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
        >
          <strong>Erreur :</strong> {error ?? loadError}
        </div>
      ) : null}

      {/* (S18a, FIN-001) Le détail chiffré de l'incohérence reste dans l'onglet
          Bilan ; l'alerte, elle, ne doit pas dépendre de l'onglet ouvert, et
          elle renvoie vers la saisie qui la corrige. */}
      {etatsFinanciers?.coherenceImmobilisations.statut === 'incoherent' ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--ko)]/40 bg-[var(--danger-bg)] p-3 text-sm"
        >
          <p className="flex items-center gap-2 text-[var(--ko)]">
            <span aria-hidden="true" className="dot dot-ko" />
            <span>
              Immobilisations incohérentes — les investissements portés au bilan diffèrent de la
              base amortissable déclarée.
            </span>
          </p>
          <Link
            href={`${saisieHref}?champ=investissements_initiaux`}
            className="rounded-md border border-[var(--ko)]/50 px-3 py-1.5 text-xs font-medium text-[var(--ko)] transition hover:bg-[var(--ko)]/10"
          >
            Corriger les investissements
          </Link>
        </div>
      ) : null}

      {lines ? (
        // useSearchParams doit vivre sous <Suspense> pour le pré-rendu statique Next 15.
        <Suspense fallback={<p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>}>
          <ResultsTabs
            lines={lines}
            currency={currency}
            templateSlug={template.slug}
            amortissements={amortissements}
            etatsFinanciers={etatsFinanciers}
          />
        </Suspense>
      ) : (
        <p className="text-sm text-[var(--foreground-muted)]">
          {loading ? 'Calcul en cours…' : 'Aucun résultat à afficher.'}
        </p>
      )}

      <section
        aria-label="Documents du plan"
        className="flex flex-col gap-4 border-t border-[var(--border)] pt-5"
      >
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleDownload('pdf')}
            disabled={downloadingPdf}
            title="Télécharger le rapport PDF des chiffres affichés"
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
      </section>
    </div>
  );
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
