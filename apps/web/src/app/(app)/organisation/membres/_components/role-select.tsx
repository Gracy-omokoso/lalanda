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
//
// ADR-0074 : `Select` de `@lalanda/ui` (options désactivées gardées).

import { Select, type SelectOption } from '@lalanda/ui';

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
  const choix: SelectOption<OrgRole>[] = options.map((o) => ({
    value: o.value,
    label: o.grantable ? o.label : `${o.label} — hors de votre portée`,
    disabled: !o.grantable,
  }));
  const nom = label === null ? ariaLabel : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      {label === null ? null : (
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
      )}
      <Select<OrgRole>
        id={id}
        value={value}
        onChange={onChange}
        options={choix}
        disabled={disabled}
        searchable={false}
        {...(nom ? { 'aria-label': nom } : {})}
        {...(selected ? { 'aria-describedby': `${id}-desc` } : {})}
      />
      {/* La description du rôle sélectionné, pas une liste : c'est au moment du
          choix qu'elle sert, et `aria-describedby` la lie au contrôle. */}
      <p id={`${id}-desc`} className="text-xs text-[var(--foreground-muted)]">
        {selected?.description ?? ''}
      </p>
    </div>
  );
}
