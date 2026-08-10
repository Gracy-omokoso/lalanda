'use client';

// Vue SAISIE d'un projet (S18c, éclatée en écran propre S23a).
//
// ── Ce qui change en S23a ──────────────────────────────────────
// L'assistant ne partage plus l'écran avec les feuilles de résultats. Il occupe
// toute la largeur, une étape à la fois, et se termine par un passage explicite
// à la lecture. Les onze feuilles, le bandeau de ratios, les exports et les
// versions figées sont partis sur `/projects/:id`.
//
// ── Deux « valider » à ne pas confondre ────────────────────────
//  - **terminer la saisie** : on quitte l'assistant pour lire ses chiffres.
//    Réversible, gratuit, aussi souvent qu'on veut. C'est le bouton « Voir les
//    résultats », disponible à toutes les étapes;
//  - **valider un plan** : on fige une version immuable vN+1 (CLAUDE.md, S16c).
//    Acte fort, il reste où il était — dans la synthèse, en fin d'assistant, à
//    un seul endroit.
//
// ── Auto-save et changement de vue ─────────────────────────────
// L'auto-save est débouncé à 800 ms. Passer aux résultats vide la file
// (`flush`) AVANT de naviguer : sans cela, l'écran de résultats relirait le
// serveur pendant que la dernière frappe est encore en vol et calculerait sur
// des hypothèses périmées. Le démontage garde son propre filet (use-autosave,
// filet n°2) pour les navigations qui ne passent pas par ce bouton.

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  api,
  type ParameterPackDetail,
  type ProjectView,
  type TemplateDriverMeta,
  type TemplateMeta,
} from '@/lib/api';

import { saveStatusLabel, useAutosave } from './use-autosave';
import { effectiveDriverValues } from './use-project-context';
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

export function ProjectWizard({ projectId }: { projectId: string }): React.ReactElement {
  return (
    // useSearchParams (`?champ=`) doit vivre sous <Suspense> — pré-rendu Next 15.
    <Suspense fallback={<p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>}>
      <WizardInner projectId={projectId} />
    </Suspense>
  );
}

function WizardInner({ projectId }: { projectId: string }): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [project, setProject] = useState<ProjectView | null>(null);
  const [template, setTemplate] = useState<TemplateMeta | null>(null);
  const [pack, setPack] = useState<ParameterPackDetail | null>(null);
  /** Valeurs stockées (fractions pour les pourcentages) — charge utile envoyée au moteur. */
  const [values, setValues] = useState<Record<string, number>>({});
  /** Texte exact saisi par l'utilisateur — source de la validation, jamais écrêté. */
  const [raw, setRaw] = useState<Record<string, string>>({});
  /** Saisi par l'utilisateur ou simple suggestion du modèle (docs/06). */
  const [provenance, setProvenance] = useState<Record<string, Provenance>>({});
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [planNotice, setPlanNotice] = useState<string | null>(null);
  // `ready` n'est levé qu'une fois les valeurs initiales posées : sans lui, l'auto-save
  // prendrait l'état vide comme référence et réécrirait les drivers au simple chargement.
  const [ready, setReady] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [visited, setVisited] = useState<Set<string>>(new Set());

  const headingRef = useRef<HTMLHeadingElement>(null);
  const navigatedRef = useRef(false);
  /** Le saut vers `?champ=` ne doit se produire qu'une fois, au chargement. */
  const jumpedRef = useRef(false);

  const currency = template?.devise_base ?? 'USD';
  const steps = useMemo(() => (template ? buildWizardSteps(template) : []), [template]);
  const resultatsHref = `/projects/${projectId}`;

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

  // Entrée profonde : `?champ=<driver>` ouvre l'étape qui porte ce driver.
  // C'est ce qui rend le renvoi « Corriger les investissements » de l'écran de
  // résultats utile — sinon il déposerait l'utilisateur à l'étape 1 en le
  // laissant chercher lui-même le champ à corriger.
  useEffect(() => {
    if (jumpedRef.current || steps.length === 0) return;
    const champ = searchParams.get('champ');
    if (!champ) return;
    jumpedRef.current = true;
    const index = steps.findIndex((s) => s.drivers.some((d) => d.id === champ));
    if (index >= 0) setActiveIndex(index);
  }, [steps, searchParams]);

  async function load(): Promise<void> {
    setError(null);
    try {
      const p = await api.getProject(projectId);
      setProject(p);
      const { template: tmpl } = await api.getTemplate(p.templateSlug);
      setTemplate(tmpl);

      const initial = effectiveDriverValues(tmpl, p);
      // Ces `set` sont dans le même tick : l'auto-save s'active avec `initial`
      // déjà en place et le prend comme référence, sans écriture réseau.
      setValues(initial);
      setRaw(initialRawValues(tmpl.drivers, initial));
      setProvenance(initialProvenance(tmpl.drivers, p.driverValues));
      setReady(true);

      // Pack fiscal — alimente l'avertissement `a_confirmer` de la synthèse.
      try {
        const { pack: detail } = await api.getParameterPack(p.parameterPackSlug);
        setPack(detail);
      } catch {
        /* la synthèse retombe sur le slug du projet si le pack n'est pas lisible */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
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

  /**
   * Fin de saisie → lecture. On enregistre d'abord, on navigue ensuite : une
   * hypothèse encore en attente de debounce ne doit jamais manquer au calcul.
   */
  async function handleVoirResultats(): Promise<void> {
    setCalculating(true);
    setError(null);
    try {
      await autosave.flush();
      router.push(resultatsHref);
    } catch (err) {
      // On ne navigue pas sur un enregistrement en échec : partir maintenant
      // afficherait des résultats calculés sans la dernière saisie.
      setError(
        err instanceof Error
          ? `Vos dernières modifications n'ont pas pu être enregistrées : ${err.message}`
          : "Vos dernières modifications n'ont pas pu être enregistrées.",
      );
      setCalculating(false);
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

  if (!project || !template || !activeStep) {
    return <p className="text-sm text-[var(--foreground-muted)]">{error ?? 'Chargement…'}</p>;
  }

  const isLast = activeIndex === steps.length - 1;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-display text-2xl font-semibold tracking-tight">{project.name}</h2>
          <span className="text-xs text-[var(--foreground-muted)]">
            Saisie des hypothèses — modèle <code className="font-mono">{template.slug}</code> v
            {template.version}
          </span>
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
        >
          <strong>Erreur :</strong> {error}
        </div>
      ) : null}

      {/* L'assistant occupe désormais toute la largeur ; sur grand écran le
          contenu est borné pour que les champs ne s'étirent pas sur 1 400 px. */}
      <section aria-label="Saisie des hypothèses" className="flex w-full max-w-3xl flex-col gap-5">
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
              onRecalculer={() => void handleVoirResultats()}
              onValider={() => void handleApprovePlan()}
              recalculating={calculating}
              approving={approving}
              blocking={blocking}
              recalculerLabel="Voir les résultats →"
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

        {planNotice ? <p className="text-xs text-[var(--accent)]">{planNotice}</p> : null}

        {/* ─── Navigation précédent / suivant / sortie vers la lecture ─── */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
          <button
            type="button"
            onClick={() => goToStep(activeIndex - 1)}
            disabled={activeIndex === 0}
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium transition hover:bg-[var(--surface-muted)] disabled:opacity-40"
          >
            ← Précédent
          </button>
          <div className="flex flex-wrap items-center gap-3">
            {/* Sortie vers les résultats : disponible à TOUTES les étapes. On ne
                force personne à dérouler l'assistant jusqu'au bout pour relire
                un ratio — la saisie est reprenable, pas linéaire. */}
            <button
              type="button"
              onClick={() => void handleVoirResultats()}
              disabled={calculating}
              className={
                isLast
                  ? 'rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-40'
                  : 'rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium transition hover:bg-[var(--surface-muted)] disabled:opacity-40'
              }
            >
              {calculating ? 'Enregistrement…' : 'Voir les résultats →'}
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
        </div>
      </section>
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
