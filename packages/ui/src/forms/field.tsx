// Champ et grille de formulaire (ADR-0074 § 2).
//
// `Field` porte le libellé, l'aide, l'erreur et l'indicateur obligatoire ou
// facultatif ; il fournit à son contrôle (`TextInput`, `Select`, `DatePicker`…)
// l'identifiant, `aria-describedby` et `aria-invalid` par un contexte : un
// écran n'a plus à relier ces attributs à la main.
//
// `FormGrid` : 12 colonnes à partir de 32 rem de LARGEUR DU FORMULAIRE
// (requête de conteneur), une seule en dessous — sur téléphone comme dans une
// fenêtre étroite. Chaque champ prend la largeur de la donnée (`size`).

import { Eye, EyeOff } from 'lucide-react';
import { createContext, forwardRef, useContext, useId, useState } from 'react';

import { cn } from '../utils.js';

import { describedBy, FIELD_SPANS, idSur, type FieldSize } from './logic.js';

export interface FieldContextValue {
  id: string;
  labelId: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** Contexte du champ englobant (`null` hors `Field`). */
export function useField(): FieldContextValue | null {
  return useContext(FieldContext);
}

/** Attributs d'accessibilité d'un contrôle, fusionnés avec ceux passés à la main. */
export function controlA11y(
  ctx: FieldContextValue | null,
  props: {
    id?: string | undefined;
    'aria-describedby'?: string | undefined;
    'aria-invalid'?: React.AriaAttributes['aria-invalid'];
    required?: boolean | undefined;
    disabled?: boolean | undefined;
  },
  extra?: string,
): {
  id: string | undefined;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  'aria-required': true | undefined;
  disabled: boolean | undefined;
} {
  const ids = [props['aria-describedby'], ctx?.describedBy, extra].filter(Boolean).join(' ');
  const invalide = props['aria-invalid'] === true || props['aria-invalid'] === 'true';
  return {
    id: props.id ?? ctx?.id,
    'aria-describedby': ids === '' ? undefined : ids,
    'aria-invalid': invalide || ctx?.invalid ? true : undefined,
    'aria-required': props.required || ctx?.required ? true : undefined,
    disabled: props.disabled ?? (ctx?.disabled || undefined),
  };
}

/**
 * Classes d'un contrôle de saisie : 36 px (44 px et 16 px de texte sur
 * téléphone, ce qui évite aussi le zoom d'iOS), bordure ≥ 3:1, erreur en
 * rouge, désactivé lisible. Le focus visible vient de `globals.css`.
 */
export const CONTROL_CLASSES =
  'h-[var(--control-h)] w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--foreground)] placeholder:text-[color-mix(in_srgb,var(--foreground-muted)_75%,transparent)] transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:border-[color-mix(in_srgb,var(--accent)_55%,var(--border-strong))] focus:border-[var(--accent)] aria-[invalid=true]:border-[var(--danger)] disabled:cursor-not-allowed disabled:bg-[var(--surface-muted)] disabled:opacity-70 max-sm:h-11 max-sm:text-base';

export interface FormGridProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/** Grille sémantique de 12 colonnes, repliée en une seule sous 32 rem de large. */
export function FormGrid({ className, children, ...props }: FormGridProps): React.ReactElement {
  return (
    <div className={cn('@container', className)} {...props}>
      <div className="grid grid-cols-1 gap-x-4 gap-y-4 @lg:grid-cols-12">{children}</div>
    </div>
  );
}

export interface FormSectionProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** Groupe titré de champs (`fieldset` + `legend`), avec sa grille. */
export function FormSection({
  title,
  description,
  children,
  className,
}: FormSectionProps): React.ReactElement {
  const id = useId();
  return (
    <fieldset
      className={cn('flex min-w-0 flex-col gap-3', className)}
      aria-describedby={description ? `${id}-desc` : undefined}
    >
      <legend className="mb-1 text-sm font-semibold text-[var(--foreground)]">{title}</legend>
      {description ? (
        <p id={`${id}-desc`} className="-mt-1 text-xs text-[var(--foreground-muted)]">
          {description}
        </p>
      ) : null}
      <FormGrid>{children}</FormGrid>
    </fieldset>
  );
}

export interface FieldProps {
  label: React.ReactNode;
  /** Aide sous le contrôle, reliée par `aria-describedby`. */
  hint?: React.ReactNode;
  /** Erreur : annoncée, reliée, et `aria-invalid` sur le contrôle. */
  error?: React.ReactNode;
  required?: boolean;
  /** Écrit « Facultatif » à droite du libellé (formulaire où presque tout est obligatoire). */
  optional?: boolean;
  disabled?: boolean;
  /** Largeur de la donnée (défaut `md`). */
  size?: FieldSize;
  /** Commence une nouvelle ligne de la grille. */
  newRow?: boolean;
  /** Identifiant du contrôle ; généré sinon. */
  id?: string;
  /**
   * Contrôle composite (`SegmentedControl`, `ChoiceCards`, `OtpInput`) : le
   * libellé n'est pas un `<label for>` mais le nom du groupe (`aria-labelledby`).
   */
  group?: boolean;
  /** Lien ou bouton à droite du libellé (« Mot de passe oublié ? »). */
  labelAction?: React.ReactNode;
  className?: string;
  children: React.ReactNode | ((ctx: FieldContextValue) => React.ReactNode);
}

export function Field({
  label,
  hint,
  error,
  required = false,
  optional = false,
  disabled = false,
  size = 'md',
  newRow = false,
  id: idDonne,
  group = false,
  labelAction,
  className,
  children,
}: FieldProps): React.ReactElement {
  const auto = useId();
  const id = idDonne ?? idSur(auto, 'champ');
  const ctx: FieldContextValue = {
    id,
    labelId: `${id}-libelle`,
    describedBy: describedBy(id, { hint, error }),
    invalid: Boolean(error),
    required,
    disabled,
  };
  const Libelle = group ? 'span' : 'label';
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1.5',
        FIELD_SPANS[size],
        // Les deux paliers : le `col-span` de @3xl réécrit aussi le début de colonne.
        newRow && '@lg:col-start-1 @3xl:col-start-1',
        className,
      )}
    >
      <div className="flex min-h-5 items-baseline justify-between gap-2">
        <Libelle
          id={ctx.labelId}
          {...(group ? {} : { htmlFor: id })}
          className="text-sm font-medium text-[var(--foreground)]"
        >
          {label}
          {required ? (
            <>
              <span className="text-[var(--danger)]" aria-hidden="true">
                {' '}
                *
              </span>
              <span className="sr-only"> (obligatoire)</span>
            </>
          ) : null}
        </Libelle>
        {labelAction ??
          (optional && !required ? (
            <span className="text-xs text-[var(--foreground-muted)]">Facultatif</span>
          ) : null)}
      </div>
      <FieldContext.Provider value={ctx}>
        {typeof children === 'function' ? children(ctx) : children}
      </FieldContext.Provider>
      {hint ? (
        <p id={`${id}-aide`} className="text-xs leading-snug text-[var(--foreground-muted)]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={`${id}-erreur`}
          aria-live="polite"
          className="flex items-start gap-1 text-xs font-medium leading-snug text-[var(--danger)]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

export type TextInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  /** Élément à gauche (icône, préfixe). */
  leading?: React.ReactNode;
  /** Élément à droite (unité, devise, bouton). */
  trailing?: React.ReactNode;
};

/** Champ texte relié à son `Field`. */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { className, leading, trailing, ...props },
  ref,
) {
  const a11y = controlA11y(useField(), props);
  const champ = (
    <input
      ref={ref}
      {...props}
      {...a11y}
      className={cn(
        CONTROL_CLASSES,
        leading ? 'pl-9' : null,
        trailing ? 'pr-12' : null,
        'read-only:bg-[var(--surface-muted)]',
        leading || trailing ? null : className,
      )}
    />
  );
  if (!leading && !trailing) return champ;
  return (
    <div className={cn('relative flex items-center', className)}>
      {leading ? (
        <span className="pointer-events-none absolute left-3 flex items-center text-[var(--foreground-muted)]">
          {leading}
        </span>
      ) : null}
      {champ}
      {trailing ? (
        <span className="absolute right-1 flex items-center text-xs text-[var(--foreground-muted)]">
          {trailing}
        </span>
      ) : null}
    </div>
  );
});

export type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className, rows = 3, ...props },
  ref,
) {
  const a11y = controlA11y(useField(), props);
  return (
    <textarea
      ref={ref}
      rows={rows}
      {...props}
      {...a11y}
      className={cn(
        CONTROL_CLASSES,
        'h-auto min-h-[4.5rem] py-2 leading-relaxed read-only:bg-[var(--surface-muted)]',
        className,
      )}
    />
  );
});

/** Mot de passe avec bouton « Afficher » (`aria-pressed`) ; jamais affiché par défaut. */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>
>(function PasswordInput({ className, ...props }, ref) {
  const [visible, setVisible] = useState(false);
  const a11y = controlA11y(useField(), props);
  return (
    <div className={cn('relative flex items-center', className)}>
      <input
        ref={ref}
        type={visible ? 'text' : 'password'}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        {...props}
        {...a11y}
        className={cn(CONTROL_CLASSES, 'pr-12')}
      />
      <button
        type="button"
        aria-pressed={visible}
        aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
        disabled={a11y.disabled}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-1 inline-flex h-8 w-10 items-center justify-center rounded-[var(--radius-sm)] text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] max-sm:h-10 max-sm:w-11"
      >
        {visible ? (
          <EyeOff aria-hidden="true" className="h-4 w-4" />
        ) : (
          <Eye aria-hidden="true" className="h-4 w-4" />
        )}
      </button>
    </div>
  );
});
