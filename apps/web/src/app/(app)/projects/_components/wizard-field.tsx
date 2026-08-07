'use client';

// Champ de saisie d'un driver (S18c) — porte les trois niveaux de validation.
//
// Accessibilité :
// - `<label for>` explicite, jamais un simple wrapper;
// - `aria-invalid` + `aria-describedby` reliant le champ à son message d'erreur,
//   à son avertissement et à son aide;
// - `aria-errormessage` pour les lecteurs d'écran qui l'exploitent;
// - le niveau est doublé par un préfixe textuel (« Erreur : », « À vérifier : ») :
//   jamais d'information portée par la seule couleur (docs/04-UX-UI.md).

import type { TemplateDriverMeta } from '@/lib/api';

import { displayBound, isPercentDriver, validateDriver, type Provenance } from './wizard-model';

interface WizardFieldProps {
  driver: TemplateDriverMeta;
  raw: string;
  onChange: (raw: string) => void;
  /** `defaut` → la valeur affichée est une suggestion du modèle, pas une saisie. */
  provenance: Provenance;
  /** Focus automatique — utilisé pour le premier champ de l'étape affichée. */
  autoFocus?: boolean;
}

function driverSuffix(d: TemplateDriverMeta): string {
  if (isPercentDriver(d)) return '%';
  if (d.type === 'money') return d.devise ?? 'USD';
  return d.unite ?? '';
}

function boundsLabel(d: TemplateDriverMeta): string | null {
  const parts: string[] = [];
  if (d.min !== undefined) parts.push(`min ${displayBound(d, d.min)}`);
  if (d.max !== undefined) parts.push(`max ${displayBound(d, d.max)}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function WizardField({
  driver,
  raw,
  onChange,
  provenance,
  autoFocus = false,
}: WizardFieldProps): React.ReactElement {
  const issue = validateDriver(driver, raw);
  const hasError = issue?.level === 'error';
  const hasWarning = issue?.level === 'warning';

  const fieldId = `driver-${driver.id}`;
  const issueId = `${fieldId}-issue`;
  const helpId = `${fieldId}-help`;
  const originId = `${fieldId}-origin`;
  const isSuggested = provenance === 'defaut';
  const describedBy = [
    issue ? issueId : null,
    isSuggested ? originId : null,
    driver.aide ? helpId : null,
  ]
    .filter(Boolean)
    .join(' ');

  const bounds = boundsLabel(driver);
  const suffix = driverSuffix(driver);

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={fieldId}
        className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
      >
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="font-medium">{driver.label ?? driver.id}</span>
          {/* Provenance visible : une suggestion n'est jamais confondue avec une
              saisie (docs/06-WIZARD.md). Le badge disparaît dès la première frappe. */}
          {isSuggested ? (
            <span
              id={originId}
              className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[0.62rem] font-medium uppercase tracking-[0.06em] text-[var(--foreground-muted)]"
            >
              Valeur suggérée
            </span>
          ) : null}
        </span>
        {bounds ? (
          <span className="fig text-[0.68rem] text-[var(--foreground-muted)]">{bounds}</span>
        ) : null}
      </label>

      <div className="flex items-center gap-2">
        <input
          id={fieldId}
          name={driver.id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          value={raw}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={hasError}
          {...(describedBy ? { 'aria-describedby': describedBy } : {})}
          {...(hasError ? { 'aria-errormessage': issueId } : {})}
          className={[
            'fig w-full rounded-md border bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition',
            hasError
              ? 'border-[var(--danger)] bg-[var(--danger-bg)]'
              : hasWarning
                ? 'border-[var(--warn)]'
                : 'border-[var(--border)] focus:border-[var(--accent)]',
          ].join(' ')}
        />
        {suffix ? (
          <span aria-hidden="true" className="w-14 shrink-0 text-xs text-[var(--foreground-muted)]">
            {suffix}
          </span>
        ) : null}
      </div>

      {issue ? (
        <p
          id={issueId}
          role={hasError ? 'alert' : undefined}
          className={
            hasError
              ? 'text-xs font-medium text-[var(--danger)]'
              : 'text-xs font-medium text-[var(--warn)]'
          }
        >
          <span className="font-semibold">{hasError ? 'Erreur : ' : 'À vérifier : '}</span>
          {issue.message}
        </p>
      ) : null}

      {/* Niveau « information » : aide contextuelle, toujours visible. */}
      {driver.aide ? (
        <p id={helpId} className="text-xs italic text-[var(--foreground-muted)]">
          {driver.aide}
        </p>
      ) : null}
    </div>
  );
}
