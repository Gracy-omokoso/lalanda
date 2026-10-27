// Briques d'affichage de l'espace Croissance — mêmes classes et jetons que le
// tableau de bord de l'organisation (`doc-card`, `fig`, `--ok/--warn/--ko`).
// Accessibilité (docs/04) : chaque statut est ÉCRIT, la couleur n'est qu'un renfort.

import Link from 'next/link';

import type { GrowSourceRef } from '@/lib/grow-api';

import { libelleSource } from './grow-model';

export function Bloc({
  titre,
  children,
  aside,
}: {
  titre: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}): React.ReactElement {
  const id = `bloc-${titre.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="font-display text-lg font-semibold tracking-tight">
          {titre}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Pastille({
  ton,
  children,
}: {
  ton: 'ok' | 'warn' | 'ko' | 'neutre' | 'accent';
  children: React.ReactNode;
}): React.ReactElement {
  const styles: Record<typeof ton, string> = {
    ok: 'border-[var(--ok)] text-[var(--ok)]',
    warn: 'border-[var(--warn)] text-[var(--warn)]',
    ko: 'border-[var(--ko)] text-[var(--ko)]',
    accent: 'border-[var(--accent)] text-[var(--accent)]',
    neutre: 'border-[var(--border-strong)] text-[var(--foreground-muted)]',
  };
  return (
    <span
      className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.62rem] font-medium uppercase tracking-[0.06em] ${styles[ton]}`}
    >
      {children}
    </span>
  );
}

/** Sources d'une valeur : le lecteur sait toujours d'où vient un chiffre. */
export function Sources({
  sources,
}: {
  sources: readonly GrowSourceRef[];
}): React.ReactElement | null {
  if (sources.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 text-xs text-[var(--foreground-muted)]">
      {sources.map((s) => (
        <li key={`${s.source}-${s.libelle}`}>
          <span className="font-medium">{libelleSource(s.source)}</span> — {s.libelle}
        </li>
      ))}
    </ul>
  );
}

export function Hypotheses({ items }: { items: readonly string[] }): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <details className="text-xs text-[var(--foreground-muted)]">
      <summary className="cursor-pointer select-none font-medium">
        Hypothèses et limites ({items.length})
      </summary>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {items.map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ul>
    </details>
  );
}

export function EtatVide({
  titre,
  children,
}: {
  titre: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center sm:p-8">
      <p className="text-sm font-medium">{titre}</p>
      <div className="mx-auto mt-1 max-w-xl text-sm text-[var(--foreground-muted)]">{children}</div>
    </div>
  );
}

/** Refus de forfait : la phrase du serveur et le chemin vers les offres. */
export function RefusForfait({ message }: { message: string }): React.ReactElement {
  return (
    <EtatVide titre="Non inclus dans votre offre">
      <p>{message}</p>
      <p className="mt-2">
        <Link href="/pricing" className="underline hover:text-[var(--accent)]">
          Voir les offres
        </Link>{' '}
        ·{' '}
        <Link href="/croissance/parcours" className="underline hover:text-[var(--accent)]">
          Ouvrir le parcours
        </Link>
      </p>
    </EtatVide>
  );
}

export function Erreur({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col items-start gap-3">
      <div
        role="alert"
        className="w-full rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
      >
        {message}
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-[var(--border-strong)] px-4 py-2 text-sm font-medium transition hover:border-[var(--accent)]"
      >
        Réessayer
      </button>
    </div>
  );
}

export function Chargement(): React.ReactElement {
  return <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>;
}
