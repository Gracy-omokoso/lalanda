'use client';

// Indicateur de progression du wizard (S18c).
//
// Accessibilité (docs/04-UX-UI.md) :
// - liste ordonnée sémantique dans un <nav aria-label>;
// - `aria-current="step"` sur l'étape courante;
// - le statut n'est jamais porté par la seule couleur : pastille + libellé textuel
//   repris dans `aria-label` du bouton;
// - une étape non encore visitée reste inaccessible au clic (`disabled`) mais son
//   état est annoncé.

import type { StepStatus, WizardStep } from './wizard-model';

export interface StepIndicator {
  step: WizardStep;
  status: StepStatus;
  /** Ids des drivers de l'étape en erreur bloquante. */
  errors: string[];
  visited: boolean;
}

interface WizardProgressProps {
  indicators: StepIndicator[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

const STATUS_TEXT: Record<StepStatus, string> = {
  error: 'à corriger',
  warning: 'à vérifier',
  ok: 'complète',
};

const STATUS_DOT: Record<StepStatus, string> = {
  error: 'dot dot-ko',
  warning: 'dot dot-warn',
  ok: 'dot dot-ok',
};

export function WizardProgress({
  indicators,
  activeIndex,
  onSelect,
}: WizardProgressProps): React.ReactElement {
  const total = indicators.length;
  const active = indicators[activeIndex];
  const completes = indicators.filter((i) => i.visited && i.status !== 'error').length;

  return (
    <nav aria-label="Étapes de saisie" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--foreground-muted)]">
          Étape <span className="fig text-[var(--foreground)]">{activeIndex + 1}</span> sur{' '}
          <span className="fig text-[var(--foreground)]">{total}</span>
          {active ? (
            <span className="normal-case tracking-normal"> — {active.step.label}</span>
          ) : null}
        </p>
        <p className="fig text-xs text-[var(--foreground-muted)]">
          {completes}/{total} renseignées
        </p>
      </div>

      {/* Barre de progression — doublée par le compteur textuel ci-dessus. */}
      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={activeIndex + 1}
        aria-valuetext={`Étape ${activeIndex + 1} sur ${total}${active ? ` : ${active.step.label}` : ''}`}
        className="h-1 w-full overflow-hidden rounded-full bg-[var(--border)]"
      >
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
          style={{ width: `${((activeIndex + 1) / total) * 100}%` }}
        />
      </div>

      <ol className="flex flex-wrap gap-1.5">
        {indicators.map((indicator, index) => {
          const isActive = index === activeIndex;
          // Accès direct aux étapes déjà visitées et à la suivante immédiate.
          const reachable = indicator.visited || index <= activeIndex;
          const statusLabel = indicator.visited ? STATUS_TEXT[indicator.status] : 'non commencée';
          return (
            <li key={indicator.step.id}>
              <button
                type="button"
                disabled={!reachable}
                onClick={() => onSelect(index)}
                {...(isActive ? { 'aria-current': 'step' as const } : {})}
                aria-label={`Étape ${index + 1} sur ${total} : ${indicator.step.label} — ${statusLabel}`}
                className={[
                  'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition',
                  isActive
                    ? 'border-[var(--accent)] bg-[var(--accent)] font-semibold text-[var(--accent-foreground)]'
                    : 'border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-muted)]',
                  reachable && !isActive
                    ? 'hover:border-[var(--border-strong)] hover:text-[var(--foreground)]'
                    : '',
                  reachable ? '' : 'cursor-not-allowed opacity-45',
                ].join(' ')}
              >
                <span className="fig text-[0.7rem] opacity-70">{index + 1}</span>
                <span>{indicator.step.label}</span>
                {indicator.visited ? (
                  <span aria-hidden="true" className={STATUS_DOT[indicator.status]} />
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
