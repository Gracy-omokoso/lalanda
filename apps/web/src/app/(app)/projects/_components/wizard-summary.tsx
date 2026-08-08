'use client';

// Étape finale « Synthèse » du wizard (S18c).
//
// Reprend les éléments exigés par docs/06-WIZARD.md § « Validation finale » :
// hypothèses principales, champs à corriger, avertissements, Country Pack et version,
// devise — puis la confirmation explicite de l'utilisateur (« Valider ce plan »).
//
// Le doute d'audit du pack (`a_confirmer`) est affiché ici, comme il l'est déjà dans
// le PDF : un paramètre fiscal non confirmé ne doit jamais passer inaperçu.

import type { ParameterPackDetail, ProjectView, TemplateMeta } from '@/lib/api';

import type { StepIndicator } from './wizard-progress';
import { validateDriver, type WizardStep } from './wizard-model';

interface WizardSummaryProps {
  project: ProjectView;
  template: TemplateMeta;
  pack: ParameterPackDetail | null;
  indicators: StepIndicator[];
  raw: Record<string, string>;
  currency: string;
  onGoToStep: (index: number) => void;
  onRecalculer: () => void;
  onValider: () => void;
  recalculating: boolean;
  approving: boolean;
  /** Ids des drivers en erreur bloquante — la validation reste interdite tant qu'il en reste. */
  blocking: string[];
}

function unitLabel(
  driver: { type: string; devise?: string; unite?: string },
  currency: string,
): string {
  if (driver.type === 'percent') return '%';
  if (driver.type === 'money') return driver.devise ?? currency;
  return driver.unite ?? '';
}

export function WizardSummary({
  project,
  template,
  pack,
  indicators,
  raw,
  currency,
  onGoToStep,
  onRecalculer,
  onValider,
  recalculating,
  approving,
  blocking,
}: WizardSummaryProps): React.ReactElement {
  const saisie = indicators.filter((i) => !i.step.synthese);
  const enErreur = saisie.filter((i) => i.status === 'error');
  const enAvertissement = saisie.filter((i) => i.status === 'warning');
  const aConfirmer = pack ? Object.entries(pack.params).filter(([, p]) => p.a_confirmer) : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-lg font-semibold tracking-tight">Synthèse du plan</h3>
        <p className="text-sm text-[var(--foreground-muted)]">
          Relisez vos hypothèses avant de figer une version validée.
        </p>
      </div>

      {/* ─── Blocages et avertissements ─────────────────────── */}
      {enErreur.length > 0 ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-[var(--danger)]/40 bg-[var(--danger-bg)] p-3 text-sm"
        >
          <p className="font-semibold text-[var(--danger)]">
            {enErreur.length} étape{enErreur.length > 1 ? 's' : ''} à corriger avant validation
          </p>
          <ul className="flex flex-wrap gap-2">
            {enErreur.map((i) => (
              <li key={i.step.id}>
                <button
                  type="button"
                  onClick={() => onGoToStep(indicators.indexOf(i))}
                  className="rounded border border-[var(--danger)]/50 px-2 py-1 text-xs font-medium text-[var(--danger)] transition hover:bg-[var(--danger)]/10"
                >
                  {i.step.label} ({i.errors.length})
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {enAvertissement.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-md border border-[var(--warn)]/40 p-3 text-sm">
          <p className="font-semibold text-[var(--warn)]">
            <span aria-hidden="true" className="dot dot-warn mr-1.5" />
            Valeurs atypiques à vérifier
          </p>
          <p className="text-xs text-[var(--foreground-muted)]">
            {enAvertissement.map((i) => i.step.label).join(', ')} — ces hypothèses n’empêchent pas
            la validation, mais un banquier les questionnera.
          </p>
        </div>
      ) : null}

      {/* ─── Récapitulatif par étape ────────────────────────── */}
      <div className="flex flex-col gap-4">
        {saisie.map((indicator) => (
          <SummaryStep
            key={indicator.step.id}
            step={indicator.step}
            raw={raw}
            currency={currency}
            onEdit={() => onGoToStep(indicators.indexOf(indicator))}
          />
        ))}
      </div>

      {/* ─── Cadre du plan : template, pack, devise ──────────── */}
      <section className="flex flex-col gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
        <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--foreground-muted)]">
          Cadre du plan
        </h4>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          <SummaryEntry label="Modèle sectoriel" value={`${template.slug} v${template.version}`} />
          <SummaryEntry label="Devise" value={currency} />
          <SummaryEntry
            label="Country Pack"
            value={pack ? `${pack.label} (${pack.slug}, ${pack.annee})` : project.parameterPackSlug}
          />
          <SummaryEntry
            label="Système comptable"
            value={pack?.systeme_comptable ?? project.systemeComptable}
          />
        </dl>

        {pack?.avertissement ? (
          <p className="mt-1 border-l-2 border-[var(--warn)] pl-2.5 text-xs text-[var(--foreground-muted)]">
            {pack.avertissement}
          </p>
        ) : null}

        {aConfirmer.length > 0 ? (
          <details className="mt-1 text-xs">
            <summary className="cursor-pointer font-medium text-[var(--warn)]">
              <span aria-hidden="true" className="dot dot-warn mr-1.5" />
              {aConfirmer.length} paramètre{aConfirmer.length > 1 ? 's' : ''} fiscal
              {aConfirmer.length > 1 ? 'aux' : ''} à confirmer auprès d’une source officielle
            </summary>
            <ul className="mt-2 flex flex-col gap-1.5 text-[var(--foreground-muted)]">
              {aConfirmer.map(([id, param]) => (
                <li key={id} className="ledger-row">
                  <span>{param.aide ?? id}</span>
                  <span className="leader" />
                  <span className="fig">
                    {param.valeur}
                    {param.unite ? ` ${param.unite}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 italic text-[var(--foreground-muted)]">
              Ces valeurs sont reprises telles quelles dans le PDF remis au banquier. Confirmez-les
              avant tout usage officiel.
            </p>
          </details>
        ) : null}
      </section>

      {/* ─── Actions finales ────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onRecalculer}
          disabled={recalculating}
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium transition hover:bg-[var(--surface-muted)] disabled:opacity-40"
        >
          {recalculating ? 'Calcul…' : 'Recalculer'}
        </button>
        <button
          type="button"
          onClick={onValider}
          disabled={approving || blocking.length > 0}
          title={
            blocking.length > 0
              ? 'Corrigez les erreurs bloquantes pour valider ce plan'
              : 'Fige les chiffres actuels en version validée immuable (vN+1)'
          }
          className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90 disabled:opacity-40"
        >
          {approving ? 'Validation…' : 'Valider ce plan'}
        </button>
        {blocking.length > 0 ? (
          <span className="text-xs text-[var(--danger)]">
            {blocking.length} champ{blocking.length > 1 ? 's' : ''} à corriger
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SummaryEntry({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-3 sm:justify-start sm:gap-2">
      <dt className="text-[var(--foreground-muted)]">{label}</dt>
      <dd className="fig text-right sm:text-left">{value}</dd>
    </div>
  );
}

function SummaryStep({
  step,
  raw,
  currency,
  onEdit,
}: {
  step: WizardStep;
  raw: Record<string, string>;
  currency: string;
  onEdit: () => void;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--foreground-muted)]">
          {step.label}
        </h4>
        <button
          type="button"
          onClick={onEdit}
          className="text-xs font-medium text-[var(--accent)] underline-offset-2 hover:underline"
        >
          Modifier<span className="sr-only"> l’étape {step.label}</span>
        </button>
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {step.drivers.map((d) => {
          const value = raw[d.id] ?? '';
          const issue = validateDriver(d, value);
          // Une valeur illisible est affichée « — » (convention docs/04-UX-UI.md).
          const display = value.trim() === '' ? '—' : value;
          return (
            <li key={d.id} className="ledger-row">
              <span>{d.label ?? d.id}</span>
              <span className="leader" />
              <span
                className={`fig ${
                  issue?.level === 'error'
                    ? 'text-[var(--danger)]'
                    : issue?.level === 'warning'
                      ? 'text-[var(--warn)]'
                      : ''
                }`}
              >
                {display} {unitLabel(d, currency)}
                {issue ? (
                  <span className="sr-only">
                    {issue.level === 'error' ? ' — erreur : ' : ' — à vérifier : '}
                    {issue.message}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
