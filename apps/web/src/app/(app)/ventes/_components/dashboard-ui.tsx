'use client';

// Briques communes des tableaux de bord de l'espace Ventes (ADR-0067), reprises
// À L'IDENTIQUE de l'écran Factures (ADR-0056) : carte de chiffre avec mini-courbe,
// bloc de graphique, squelette de chargement, bandeau d'erreur et état vide.
// Aucun calcul : les valeurs arrivent déjà écrites.

import { buttonClasses, Sparkline, type ChartColor } from '@lalanda/ui';
import Link from 'next/link';

export const CARTE = 'rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]';

export const CHAMP_COMPACT =
  'h-8 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 text-[13px] outline-none transition-colors duration-[var(--motion-fast)] focus:border-[var(--accent)]';

export const BOUTON_LIGNE =
  'relative z-10 inline-flex h-7 items-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs font-medium transition-colors duration-[var(--motion-fast)] hover:border-[var(--accent)] hover:bg-[var(--surface-muted)]';

export type EtatTableau = 'chargement' | 'pret' | 'erreur';

export interface CarteTableau {
  id: string;
  label: string;
  valeur: string;
  note: string;
  /** `alerte` : rouge (retard) ; `attention` : orangé (à relancer). */
  ton: 'normal' | 'alerte' | 'attention';
  /** Mini-courbe ; absente : la carte n'en porte pas. */
  serie: number[] | null;
  couleur: ChartColor;
  /** Nom accessible de la mini-courbe. */
  tendance: string;
}

const TON_VALEUR: Record<CarteTableau['ton'], string> = {
  normal: '',
  alerte: 'text-[var(--danger)]',
  attention: 'text-[var(--warn)]',
};

/** Rangée de quatre cartes (deux par ligne sur téléphone). */
export function CartesChiffres({
  cartes,
}: {
  cartes: readonly CarteTableau[];
}): React.ReactElement {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
      {cartes.map((c) => (
        <li
          key={c.id}
          className={`${CARTE} flex min-w-0 items-end justify-between gap-2 px-3 py-2.5 sm:px-3.5 sm:py-3`}
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-xs text-[var(--foreground-muted)]">{c.label}</span>
            <span
              className={`truncate font-mono text-[15px] font-medium tabular-nums sm:text-lg ${TON_VALEUR[c.ton]}`}
            >
              {c.valeur}
            </span>
            <span className="truncate text-xs text-[var(--foreground-muted)]" title={c.note}>
              {c.note}
            </span>
          </span>
          {c.serie ? (
            <Sparkline
              values={c.serie}
              color={c.couleur}
              label={c.tendance}
              width={72}
              className="max-sm:hidden"
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Bandeau d'échec des chiffres : la liste, elle, reste utilisable. */
export function ErreurTableau({
  texte,
  onReessayer,
}: {
  texte: string;
  onReessayer: () => void;
}): React.ReactElement {
  return (
    <div className={`${CARTE} flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm`}>
      <p className="text-[var(--foreground-muted)]">{texte}</p>
      <button
        type="button"
        onClick={onReessayer}
        className="h-8 rounded-[var(--radius-md)] border border-[var(--border-strong)] px-3 text-[13px] font-medium transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-muted)]"
      >
        Réessayer
      </button>
    </div>
  );
}

/** Chargement : les blocs gardent la place des cartes (aucun saut de mise en page). */
export function SqueletteTableau({
  label,
  graphiques,
}: {
  label: string;
  /** Gabarit de la grille des graphiques sur grand écran. */
  graphiques: string;
}): React.ReactElement {
  const bloc = 'rounded-[var(--radius-sm)] bg-[var(--surface-muted)]';
  const n = graphiques.split('_').length;
  return (
    <section aria-busy="true" aria-label={label} className="flex flex-col gap-3">
      <ul className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className={`${CARTE} flex h-[78px] flex-col justify-center gap-2 px-3.5`}>
            <span className={`${bloc} h-3 w-24`} />
            <span className={`${bloc} h-4 w-36 max-w-full`} />
          </li>
        ))}
      </ul>
      <div className={`grid gap-3 ${graphiques}`}>
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className={`${CARTE} h-[238px] px-4 py-3.5`}>
            <span className={`${bloc} block h-3 w-40`} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Pas encore de données : une invitation claire, l'action principale si elle est permise. */
export function EtatVide({
  titre,
  texte,
  action,
}: {
  titre: string;
  texte: string;
  action?: { href: string; label: string } | null;
}): React.ReactElement {
  return (
    <div className={`${CARTE} flex flex-col items-center gap-1 px-4 py-8 text-center text-sm`}>
      <IconeVide />
      <p className="mt-2 font-medium">{titre}</p>
      <p className="max-w-md text-[var(--foreground-muted)]">{texte}</p>
      {action ? (
        <Link
          href={action.href}
          className={buttonClasses(
            'primary',
            'md',
            'mt-3 gap-1.5 px-3.5 text-[13px] font-semibold',
          )}
        >
          <IconePlus />
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

function IconeVide(): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="h-8 w-8 text-[var(--foreground-muted)]"
    >
      <path d="M4 19V5M4 19h16M8 15l3-4 3 2 5-6" />
    </svg>
  );
}

export function IconePlus(): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      className="h-[15px] w-[15px]"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Onglets de statut à bascule avec compteurs (même dessin que Factures). */
export function OngletsStatut<T extends string>({
  options,
  valeur,
  compteurs,
  onChange,
}: {
  options: readonly { valeur: T; label: string }[];
  valeur: T;
  compteurs: Partial<Record<T, number>> | null;
  onChange: (v: T) => void;
}): React.ReactElement {
  return (
    <div
      role="group"
      aria-label="Afficher"
      className="-mx-2 overflow-x-auto px-2 [scrollbar-width:none] sm:mx-0 sm:px-0"
    >
      <div className="inline-flex rounded-[var(--radius-md)] bg-[var(--surface-muted)] p-0.5">
        {options.map((f) => {
          const actif = valeur === f.valeur;
          const n = compteurs ? compteurs[f.valeur] : undefined;
          return (
            <button
              key={f.valeur}
              type="button"
              aria-pressed={actif}
              onClick={() => onChange(f.valeur)}
              className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] px-2.5 text-[13px] transition-colors duration-[var(--motion-fast)] ${
                actif
                  ? 'bg-[var(--surface)] font-semibold text-[var(--foreground)] shadow-[0_1px_2px_rgba(0,0,0,0.14)]'
                  : 'text-[var(--foreground-muted)] hover:text-[var(--foreground)]'
              }`}
            >
              {f.label}
              {n !== undefined ? (
                <span className="font-mono text-[11px] font-normal text-[var(--foreground-muted)]">
                  {n.toLocaleString('fr-FR')}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
