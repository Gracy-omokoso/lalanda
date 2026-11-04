'use client';

// Atomes de l'accueil des projets et de « Mes tâches » (ADR-0058) : cercle à
// cocher animé, avatar et pile d'avatars, pastille de couleur d'un projet,
// onglets Liste · Calendrier · Temps. Aucune logique métier.
//
// Mouvement : 120 à 180 ms, CSS seulement, coupé sous `prefers-reduced-motion`
// (`motion-reduce:`). La couleur n'est jamais seule : chaque état a un texte.

import type { WorkLabelColor, WorkMemberRef } from '@lalanda/shared/work';
import { TabsNav } from '@lalanda/ui';
import Link from 'next/link';
import { useState } from 'react';

import { MES_TACHES_HREF } from './projets-model';

/** Initiales d'un nom (deux au plus). */
export function initiales(nom: string): string {
  const mots = nom.split(/\s+/).filter(Boolean);
  return (
    mots
      .slice(0, 2)
      .map((m) => m[0]!.toUpperCase())
      .join('') || '?'
  );
}

const TEINTES: readonly WorkLabelColor[] = ['teal', 'blue', 'purple', 'orange', 'green', 'pink'];

/** Teinte stable d'un avatar, tirée de l'identifiant (palette fermée des étiquettes). */
export function teinteAvatar(userId: string): WorkLabelColor {
  let h = 0;
  for (let i = 0; i < userId.length; i += 1) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return TEINTES[h % TEINTES.length]!;
}

export function Avatar({
  membre,
  taille = 24,
  className = '',
}: {
  membre: WorkMemberRef;
  taille?: 24 | 28 | 32;
  className?: string;
}): React.ReactElement {
  const t = teinteAvatar(membre.userId);
  return (
    <span
      title={membre.name}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ring-2 ring-[var(--surface)] ${className}`}
      style={{
        width: taille,
        height: taille,
        fontSize: taille <= 24 ? '0.625rem' : '0.7rem',
        background: `var(--label-${t}-bg)`,
        color: `var(--label-${t}-fg)`,
      }}
    >
      <span aria-hidden="true">{initiales(membre.name)}</span>
      <span className="sr-only">{membre.name}</span>
    </span>
  );
}

/** Pile d'avatars qui se chevauchent ; « +N » au-delà de ceux rendus. */
export function PileAvatars({
  membres,
  total,
}: {
  membres: readonly WorkMemberRef[];
  total: number;
}): React.ReactElement {
  if (membres.length === 0) {
    return <span className="text-xs text-[var(--foreground-muted)]">Aucun membre</span>;
  }
  const reste = total - membres.length;
  return (
    <span className="flex items-center" aria-label={`${total} membre${total > 1 ? 's' : ''}`}>
      {membres.map((m, i) => (
        <Avatar key={m.userId} membre={m} className={i > 0 ? '-ml-1.5' : ''} />
      ))}
      {reste > 0 ? (
        <span className="-ml-1.5 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[var(--surface-muted)] px-1 text-[0.625rem] font-semibold text-[var(--foreground-muted)] ring-2 ring-[var(--surface)]">
          +{reste}
        </span>
      ) : null}
    </span>
  );
}

/** Pastille de couleur d'un projet (décorative : le nom l'accompagne toujours). */
export function PastilleProjet({
  couleur,
  taille = 'md',
}: {
  couleur: WorkLabelColor;
  taille?: 'sm' | 'md';
}): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-[3px] ${taille === 'sm' ? 'h-2 w-2' : 'h-3 w-3'}`}
      style={{ background: `var(--label-${couleur}-dot)` }}
    />
  );
}

/**
 * Cercle à cocher façon Asana : un clic termine. La coche se trace en 180 ms
 * (`--motion-base`), puis l'appelant retire la ligne. Désactivé sans droit.
 */
export function CercleCocher({
  libelle,
  desactive,
  onCocher,
}: {
  libelle: string;
  desactive: boolean;
  onCocher: () => Promise<void> | void;
}): React.ReactElement {
  const [coche, setCoche] = useState(false);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={coche}
      aria-label={libelle}
      disabled={desactive || coche}
      onClick={() => {
        setCoche(true);
        void Promise.resolve(onCocher()).catch(() => setCoche(false));
      }}
      className="group relative -m-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed"
    >
      <span
        aria-hidden="true"
        className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border-[1.5px] transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none ${
          coche
            ? 'border-[var(--ok)] bg-[var(--ok)] text-[var(--surface)]'
            : 'border-[var(--border-strong)] text-transparent group-enabled:group-hover:border-[var(--ok)] group-enabled:group-hover:text-[var(--ok)] group-disabled:opacity-50'
        }`}
      >
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none">
          <path
            d="M2.5 6.2 5 8.5l4.5-5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray={1}
            className={`transition-[stroke-dashoffset] duration-[var(--motion-base)] ease-[var(--ease-standard)] motion-reduce:transition-none ${
              coche
                ? '[stroke-dashoffset:0]'
                : '[stroke-dashoffset:1] group-enabled:group-hover:[stroke-dashoffset:0]'
            }`}
          />
        </svg>
      </span>
    </button>
  );
}

export type OngletMesTaches = 'liste' | 'calendrier' | 'temps';

/** Onglets communs aux trois vues de « Mes tâches ». */
export function OngletsMesTaches({ actif }: { actif: OngletMesTaches }): React.ReactElement {
  return (
    <TabsNav
      label="Vues de Mes tâches"
      renderLink={({ children, ...props }) => (
        <Link {...props} prefetch={false}>
          {children}
        </Link>
      )}
      items={[
        { href: MES_TACHES_HREF, label: 'Liste', current: actif === 'liste' },
        {
          href: `${MES_TACHES_HREF}/calendrier`,
          label: 'Calendrier',
          current: actif === 'calendrier',
        },
        { href: `${MES_TACHES_HREF}/temps`, label: 'Temps', current: actif === 'temps' },
      ]}
    />
  );
}
