// Surfaces et messages : Card, Badge, Alert, EmptyState, Skeleton.
//
// Règle commune (docs/04 § Accessibilité) : le TEXTE porte l'information, la
// couleur ne fait que la renforcer. Aucun composant ici n'accepte une couleur
// sans libellé.

import { cn } from '../utils.js';

export function Card({
  className,
  as: Balise = 'div',
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'section' | 'article' | 'li';
}): React.ReactElement {
  return (
    <Balise
      className={cn(
        'rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-card)]',
        className,
      )}
      {...props}
    />
  );
}

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONS_BADGE: Record<Tone, string> = {
  neutral: 'border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground-muted)]',
  info: 'border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[var(--accent-soft)] text-[var(--accent)]',
  success:
    'border-[color-mix(in_srgb,var(--ok)_40%,transparent)] bg-[color-mix(in_srgb,var(--ok)_10%,var(--surface))] text-[var(--ok)]',
  warning:
    'border-[color-mix(in_srgb,var(--warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,var(--surface))] text-[var(--warn)]',
  danger:
    'border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[var(--danger-bg)] text-[var(--danger)]',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.7rem] font-medium leading-4',
        TONS_BADGE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Bandeau. `danger` est annoncé immédiatement (`role="alert"`) ; les autres tons
 * sont polis (`role="status"`) : une information n'interrompt pas la lecture.
 */
export function Alert({
  tone = 'info',
  title,
  action,
  className,
  children,
}: {
  tone?: Tone;
  title?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex flex-col gap-3 rounded-[var(--radius-md)] border p-4 text-sm sm:flex-row sm:items-start sm:justify-between',
        TONS_BADGE[tone],
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="leading-6">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** État vide : dit ce qui manque et propose l'action suivante — jamais une page muette. */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] px-6 py-10 text-center',
        className,
      )}
    >
      {icon ? (
        <div aria-hidden="true" className="text-[var(--foreground-muted)]">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-semibold">{title}</p>
      {description ? (
        <p className="max-w-md text-sm leading-6 text-[var(--foreground-muted)]">{description}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/**
 * Bloc de chargement à la taille du contenu attendu (pas de saut à l'arrivée des
 * données). Décoratif : l'état est annoncé par le conteneur (`aria-busy`).
 */
export function Skeleton({ className }: { className?: string }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'block rounded-[var(--radius-sm)] bg-[var(--surface-muted)] motion-safe:animate-pulse',
        className,
      )}
    />
  );
}
