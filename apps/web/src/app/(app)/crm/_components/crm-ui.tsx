'use client';

// Briques visuelles du CRM — cohérentes avec l'Accueil refait (ADR-0038 § 5) :
// bandeaux teintés à la couleur du module RUN, tuiles de chiffres, panneaux.
// Icônes Lucide (ADR-0038 § 4, révision du 29 oct. 2026), décoratives :
// le sens est toujours porté par un texte.

import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { crmApi, type CrmAccountListItem } from '@/lib/api-crm';

import { CHAMP } from '../../ventes/_components/form-ui';

import type { MembreCrm } from './crm-access';
import { libelleNature } from './comptes-model';

/** Fond teinté du module RUN (même recette que les cartes de l'Accueil). */
export const TEINTE_RUN = 'bg-[color-mix(in_srgb,var(--module-run)_9%,transparent)]';

/** Bandeau d'en-tête d'un écran : pastille d'icône, titre, sous-titre, actions. */
export function Bandeau({
  icone: Icone,
  titre,
  sousTitre,
  actions,
  children,
}: {
  icone: LucideIcon;
  titre: React.ReactNode;
  sousTitre?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <header
      className={`flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] px-4 py-4 sm:px-6 sm:py-5 ${TEINTE_RUN}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <span
            aria-hidden="true"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--module-run)] text-[var(--surface)] shadow-sm sm:h-12 sm:w-12"
          >
            <Icone className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={1.75} />
          </span>
          <div className="flex min-w-0 flex-col">
            <h2 className="font-display text-xl font-bold leading-tight tracking-tight break-words sm:text-2xl">
              {titre}
            </h2>
            {sousTitre ? (
              <p className="text-sm text-[var(--foreground-muted)]">{sousTitre}</p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}

/** Tuile de chiffre (valeur rendue par l'API, jamais calculée ici). */
export function Tuile({
  libelle,
  valeur,
  detail,
  attention = false,
}: {
  libelle: string;
  valeur: React.ReactNode;
  detail?: React.ReactNode;
  attention?: boolean;
}): React.ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[var(--radius-md)] bg-[var(--surface)] px-3 py-2.5 shadow-sm">
      <span className="text-xs leading-snug text-[var(--foreground-muted)]">{libelle}</span>
      <span
        className={`font-display text-lg font-bold tabular-nums break-words sm:text-xl ${attention ? 'text-[var(--danger)]' : ''}`}
      >
        {valeur}
      </span>
      {detail ? <span className="text-xs text-[var(--foreground-muted)]">{detail}</span> : null}
    </div>
  );
}

/** Panneau de section : titre avec icône, action facultative, contenu. */
export function Panneau({
  titre,
  icone: Icone,
  action,
  children,
  className = '',
  id,
}: {
  titre: React.ReactNode;
  icone?: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}): React.ReactElement {
  return (
    <section
      aria-labelledby={id}
      className={`flex min-w-0 flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={id} className="flex items-center gap-2 text-sm font-semibold">
          {Icone ? <Icone aria-hidden="true" className="h-4 w-4 text-[var(--module-run)]" /> : null}
          {titre}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Phrase d'une section masquée ou vide (jamais un zéro). */
export function PhraseSection({ children }: { children: React.ReactNode }): React.ReactElement {
  return <p className="text-sm text-[var(--foreground-muted)]">{children}</p>;
}

/** Choix d'un membre (responsable, assigné) ; l'API refuse un membre non éligible. */
export function ChoixMembre({
  id,
  valeur,
  onChange,
  membres,
  vide = 'Moi (par défaut)',
}: {
  id: string;
  valeur: string;
  onChange: (v: string) => void;
  membres: readonly MembreCrm[];
  vide?: string;
}): React.ReactElement {
  return (
    <select id={id} className={CHAMP} value={valeur} onChange={(e) => onChange(e.target.value)}>
      <option value="">{vide}</option>
      {membres.map((m) => (
        <option key={m.userId} value={m.userId}>
          {m.name}
        </option>
      ))}
    </select>
  );
}

/**
 * Choix d'un compte (prospect ou client) par recherche (`GET /crm/accounts?q=`) :
 * lecture `crm.read`, sans passer par la liste des clients de Ventes.
 */
export function ChoixCompte({
  id,
  valeur,
  nomInitial,
  onChange,
  aria,
}: {
  id: string;
  valeur: string;
  nomInitial?: string | null;
  onChange: (id: string, nom: string | null) => void;
  aria?: Record<string, unknown>;
}): React.ReactElement {
  const [q, setQ] = useState('');
  const [comptes, setComptes] = useState<CrmAccountListItem[]>([]);

  useEffect(() => {
    let annule = false;
    const t = setTimeout(() => {
      crmApi
        .listAccounts({ active: 'true', limit: 50, ...(q.trim() ? { q: q.trim() } : {}) })
        .then((p) => {
          if (!annule) setComptes(p.items);
        })
        .catch(() => undefined);
    }, 200);
    return () => {
      annule = true;
      clearTimeout(t);
    };
  }, [q]);

  const connu = comptes.some((c) => c.id === valeur);
  return (
    <div className="flex flex-col gap-1.5">
      <input
        type="search"
        aria-label="Rechercher un compte"
        placeholder="Rechercher un compte…"
        className={CHAMP}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <select
        id={id}
        className={CHAMP}
        value={valeur}
        onChange={(e) => {
          const c = comptes.find((x) => x.id === e.target.value);
          onChange(e.target.value, c?.name ?? null);
        }}
        {...aria}
      >
        <option value="">Choisir un compte…</option>
        {valeur !== '' && !connu ? (
          <option value={valeur}>{nomInitial ?? 'Compte actuel'}</option>
        ) : null}
        {comptes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} — {libelleNature(c.kind)}
          </option>
        ))}
      </select>
    </div>
  );
}
