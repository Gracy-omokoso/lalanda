'use client';

// Sélecteur de rôle d'organisation (S20a — ADR-0012 §1).
//
// Les options viennent du SERVEUR (`roleOptions` de GET /members) : libellé,
// description et surtout `grantable`, qui dépend du rôle de l'appelant (R7). Le
// client ne peut pas les déduire, et ne doit pas essayer.
//
// Les rôles non attribuables restent VISIBLES et désactivés plutôt qu'absents :
// « Chef de projet » existe dans la documentation, un utilisateur qui l'y a lu
// doit comprendre pourquoi il ne peut pas le choisir, et non se demander s'il a
// mal lu.

import type { OrgRole, RoleOption } from '@/lib/api';

interface RoleSelectProps {
  id: string;
  options: readonly RoleOption[];
  value: OrgRole;
  onChange: (role: OrgRole) => void;
  disabled?: boolean;
  /** Libellé visible. Passer `null` place un `aria-label` à la place. */
  label: string | null;
  ariaLabel?: string;
}

export function RoleSelect({
  id,
  options,
  value,
  onChange,
  disabled = false,
  label,
  ariaLabel,
}: RoleSelectProps): React.ReactElement {
  const selected = options.find((o) => o.value === value) ?? null;

  return (
    <div className="flex flex-col gap-1.5">
      {label === null ? null : (
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
      )}
      <select
        id={id}
        value={value}
        aria-label={label === null ? ariaLabel : undefined}
        aria-describedby={selected ? `${id}-desc` : undefined}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as OrgRole)}
        className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent)] disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={!o.grantable}>
            {o.label}
            {o.grantable ? '' : ' — hors de votre portée'}
          </option>
        ))}
      </select>
      {/* La description du rôle sélectionné, pas une liste : c'est au moment du
          choix qu'elle sert, et `aria-describedby` la lie au contrôle. */}
      <p id={`${id}-desc`} className="text-xs text-[var(--foreground-muted)]">
        {selected?.description ?? ''}
      </p>
    </div>
  );
}
