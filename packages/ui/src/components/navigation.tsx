// En-tête d'espace, onglets d'espace et indicateur d'étapes.
//
// `packages/ui` ne dépend pas de Next : les liens sont rendus par une fonction
// fournie par l'application (`renderLink`), qui reçoit les classes et attributs
// à poser. L'application y passe `next/link` ; un test ou une autre application
// y passe un `<a>`.

import { cn } from '../utils.js';
import { ModuleMark, type ModuleId } from './modules.js';

export interface LinkRenderProps {
  href: string;
  className: string;
  'aria-current'?: 'page' | 'step';
  children: React.ReactNode;
}

export type RenderLink = (props: LinkRenderProps) => React.ReactElement;

export const defaultRenderLink: RenderLink = ({ children, ...props }) => (
  <a {...props}>{children}</a>
);

/**
 * En-tête d'un espace : surtitre de module, titre, description, actions.
 *
 * La description est masquée sous 640 px quand `descriptionMobile` vaut `false` :
 * elle reste dans le DOM (lue par les lecteurs d'écran), mais ne repousse pas
 * le contenu sous la ligne de flottaison d'un téléphone (audit A3).
 */
export function PageHeader({
  module,
  moduleLabel,
  title,
  description,
  descriptionMobile = false,
  actions,
  as: Titre = 'h1',
  className,
}: {
  module?: ModuleId;
  moduleLabel?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  descriptionMobile?: boolean;
  actions?: React.ReactNode;
  as?: 'h1' | 'h2';
  className?: string;
}): React.ReactElement {
  return (
    <header
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        {module ? <ModuleMark module={module} suffix={moduleLabel} /> : null}
        <Titre className="font-display text-2xl font-bold tracking-tight sm:text-[1.75rem] sm:leading-9">
          {title}
        </Titre>
        {description ? (
          <p
            className={cn(
              'max-w-2xl text-sm leading-6 text-[var(--foreground-muted)]',
              !descriptionMobile && 'max-sm:sr-only',
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export interface TabItem {
  href: string;
  label: string;
  current: boolean;
  /** Information complémentaire (cadenas d'offre, compteur). Doit être lisible en texte. */
  adornment?: React.ReactNode;
}

/**
 * Onglets d'un espace, en une seule ligne qui défile horizontalement sur
 * téléphone (au lieu de passer sur deux lignes — audit A3).
 */
export function TabsNav({
  label,
  items,
  renderLink = defaultRenderLink,
  className,
}: {
  label: string;
  items: readonly TabItem[];
  renderLink?: RenderLink;
  className?: string;
}): React.ReactElement {
  return (
    <nav
      aria-label={label}
      className={cn(
        '-mx-4 overflow-x-auto border-b border-[var(--border)] px-4 [scrollbar-width:none] sm:mx-0 sm:px-0',
        className,
      )}
    >
      <ul className="flex min-w-max gap-1">
        {items.map((item) => (
          <li key={item.href}>
            {renderLink({
              href: item.href,
              'aria-current': item.current ? 'page' : undefined,
              className: cn(
                '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors',
                item.current
                  ? 'border-[var(--accent)] font-semibold text-[var(--foreground)]'
                  : 'border-transparent font-medium text-[var(--foreground-muted)] hover:border-[var(--border-strong)] hover:text-[var(--foreground)]',
              ),
              children: (
                <>
                  {item.label}
                  {item.adornment}
                </>
              ),
            })}
          </li>
        ))}
      </ul>
    </nav>
  );
}

export type StepState = 'done' | 'current' | 'todo' | 'locked';

export interface StepItem {
  id: string;
  href: string;
  label: string;
  state: StepState;
  /** Phrase courte sous le libellé (« 2 points de vente », « réservé au Propriétaire »). */
  hint?: string;
}

const ETAT_TEXTE: Record<StepState, string> = {
  done: 'terminée',
  current: 'en cours',
  todo: 'à faire',
  locked: 'non ouverte à votre rôle',
};

/**
 * Indicateur d'étapes d'un parcours guidé. Chaque étape est un lien : le
 * parcours se reprend dans n'importe quel ordre. L'état est écrit (lecteur
 * d'écran) et dessiné (coche, numéro, cadenas) — jamais la couleur seule.
 */
export function Stepper({
  label,
  steps,
  renderLink = defaultRenderLink,
  className,
}: {
  label: string;
  steps: readonly StepItem[];
  renderLink?: RenderLink;
  className?: string;
}): React.ReactElement {
  return (
    <nav aria-label={label} className={className}>
      <ol className="flex flex-col gap-1">
        {steps.map((step, index) => (
          <li key={step.id}>
            {renderLink({
              href: step.href,
              'aria-current': step.state === 'current' ? 'step' : undefined,
              className: cn(
                'group flex items-start gap-3 rounded-[var(--radius-md)] px-3 py-2.5 transition-colors',
                step.state === 'current'
                  ? 'bg-[var(--accent-soft)]'
                  : 'hover:bg-[var(--surface-muted)]',
              ),
              children: (
                <>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                      step.state === 'done' &&
                        'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]',
                      step.state === 'current' &&
                        'border-[var(--accent)] bg-[var(--surface)] text-[var(--accent)]',
                      (step.state === 'todo' || step.state === 'locked') &&
                        'border-[var(--border-strong)] text-[var(--foreground-muted)]',
                    )}
                  >
                    {step.state === 'done' ? '✓' : step.state === 'locked' ? '–' : index + 1}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span
                      className={cn(
                        'text-sm',
                        step.state === 'current' ? 'font-semibold' : 'font-medium',
                      )}
                    >
                      {step.label}
                      <span className="sr-only"> — étape {ETAT_TEXTE[step.state]}</span>
                    </span>
                    {step.hint ? (
                      <span className="text-xs text-[var(--foreground-muted)]">{step.hint}</span>
                    ) : null}
                  </span>
                </>
              ),
            })}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Barre de progression textuelle : « 2 étapes sur 4 ». */
export function Progress({
  value,
  max,
  label,
  className,
}: {
  value: number;
  max: number;
  label: string;
  className?: string;
}): React.ReactElement {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value} sur ${max}`}
        className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]"
      >
        <div
          className="h-full rounded-full bg-[var(--accent)] motion-safe:transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
