import { forwardRef } from 'react';

import { cn } from '../utils.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-md)] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress';

const VARIANTES: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--accent)] text-[var(--accent-foreground)] hover:bg-[color-mix(in_srgb,var(--accent)_88%,var(--foreground))]',
  secondary:
    'border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--foreground)] hover:border-[var(--accent)] hover:bg-[var(--surface-muted)]',
  ghost:
    'text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]',
  danger:
    'border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] text-[var(--danger)] hover:bg-[var(--danger-bg)]',
};

const TAILLES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  // Cible tactile confortable (≥ 44 px) : boutons d'action principale sur téléphone.
  lg: 'h-12 px-5 text-base',
};

/** Classes d'un bouton, pour styler un lien (`<Link>`) comme un bouton. */
export function buttonClasses(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return cn(BASE, VARIANTES[variant], TAILLES[size], className);
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Action en cours : le bouton est désactivé et l'annonce `aria-busy`. */
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', busy = false, className, disabled, type, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={Boolean(disabled) || busy}
      aria-busy={busy || undefined}
      className={buttonClasses(variant, size, className)}
      {...props}
    />
  );
});
