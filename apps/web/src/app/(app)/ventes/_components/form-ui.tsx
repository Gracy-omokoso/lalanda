// Briques de formulaire et d'état communes aux écrans Ventes.
//
// Mêmes classes et mêmes liens d'accessibilité que l'onglet Fiscalité
// (`organisation/_components/fiscal-profile-panel.tsx`) : chaque champ est relié
// à son aide et à son erreur par `aria-describedby`, `aria-invalid` sur un champ
// refusé, astérisque doublé d'un « (obligatoire) » lu par les lecteurs d'écran.

export const CHAMP =
  'w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)] aria-[invalid=true]:border-[var(--danger)] disabled:opacity-60';

export const BOUTON =
  'rounded-md border border-[var(--border-strong)] px-4 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-50';

export const BOUTON_PETIT =
  'rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium transition hover:border-[var(--accent)] disabled:opacity-50';

export const BOUTON_DANGER =
  'rounded-md border border-[var(--danger)]/40 px-3 py-1.5 text-xs font-medium text-[var(--danger)] transition hover:bg-[var(--danger-bg)] disabled:opacity-50';

/** `aria-invalid` et `aria-describedby` reliant l'aide et l'erreur du champ. */
export function aria(
  id: string,
  erreur: string | undefined,
  avecAide = false,
): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  const ids = [avecAide ? `${id}-aide` : null, erreur ? `${id}-erreur` : null].filter(Boolean);
  return {
    ...(erreur ? { 'aria-invalid': true as const } : {}),
    ...(ids.length > 0 ? { 'aria-describedby': ids.join(' ') } : {}),
  };
}

export function Champ({
  id,
  label,
  aide,
  requis = false,
  erreur,
  children,
}: {
  id: string;
  label: string;
  aide?: string | undefined;
  requis?: boolean;
  erreur?: string | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {requis ? (
          <span className="text-[var(--foreground-muted)]" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
        {requis ? <span className="sr-only"> (obligatoire)</span> : null}
      </label>
      {children}
      <AideEtErreur id={id} aide={aide} erreur={erreur} />
    </div>
  );
}

export function AideEtErreur({
  id,
  aide,
  erreur,
}: {
  id: string;
  aide?: string | undefined;
  erreur?: string | undefined;
}): React.ReactElement {
  return (
    <>
      {aide ? (
        <p id={`${id}-aide`} className="text-xs text-[var(--foreground-muted)]">
          {aide}
        </p>
      ) : null}
      {erreur ? (
        <p id={`${id}-erreur`} className="text-xs font-medium text-[var(--danger)]">
          {erreur}
        </p>
      ) : null}
    </>
  );
}

/** Bandeau d'échec, avec une action de reprise éventuelle. */
export function Alerte({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-4 text-sm text-[var(--danger)]"
    >
      <div className="flex flex-col gap-2">{children}</div>
      {action}
    </div>
  );
}

/** Pastille d'état. Le texte porte l'information ; la couleur n'est qu'un renfort. */
export function Pastille({
  ton,
  children,
}: {
  ton: 'neutre' | 'attention';
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <span
      className={
        ton === 'attention'
          ? 'inline-flex items-center rounded-full border border-[var(--warn)]/50 px-2 py-0.5 text-[0.7rem] font-medium text-[var(--foreground)]'
          : 'inline-flex items-center rounded-full border border-[var(--border)] px-2 py-0.5 text-[0.7rem] font-medium text-[var(--foreground-muted)]'
      }
    >
      {children}
    </span>
  );
}
