'use client';

// Éléments d'affichage partagés par l'espace admin (S21b).
//
// Regroupés ici pour une raison précise : ces trois composants portent des
// conventions d'ACCESSIBILITÉ qu'il ne faut pas réinventer à chaque panneau
// (docs/04). En particulier, aucun statut n'est signalé par la seule couleur —
// le libellé porte toujours l'information, la pastille n'est qu'un renfort. Un
// daltonien lit « Dernier test en échec », pas une nuance de rouge.

import type { TonStatut } from './admin-model';

const TONS: Record<TonStatut, string> = {
  neutre: 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--foreground-muted)]',
  attention: 'border-[var(--warning)]/30 bg-[var(--warning-bg)] text-[var(--warning)]',
  succes: 'border-[var(--success)]/30 bg-[var(--success-bg)] text-[var(--success)]',
  echec: 'border-[var(--danger)]/30 bg-[var(--danger-bg)] text-[var(--danger)]',
};

/** Pastille de statut. Le texte porte l'information, la couleur la renforce. */
export function Pastille({
  ton,
  children,
}: {
  ton: TonStatut;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <span
      className={`font-mono inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.06em] ${TONS[ton]}`}
    >
      {children}
    </span>
  );
}

/**
 * Bandeau de message. `role="alert"` uniquement pour les erreurs : un lecteur
 * d'écran qui annonce chaque succès finit par être coupé.
 */
export function Bandeau({
  ton,
  children,
}: {
  ton: TonStatut;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      role={ton === 'echec' ? 'alert' : 'status'}
      className={`rounded-md border p-3 text-sm ${TONS[ton]}`}
    >
      {children}
    </div>
  );
}

/** Carte de compteur du tableau de bord. */
export function Compteur({
  libelle,
  valeur,
  precision,
}: {
  libelle: string;
  valeur: string | number;
  precision?: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <span className="font-mono text-[0.66rem] uppercase tracking-[0.1em] text-[var(--foreground-muted)]">
        {libelle}
      </span>
      <span className="font-display text-2xl font-bold tracking-tight">{valeur}</span>
      {precision ? (
        <span className="text-xs text-[var(--foreground-muted)]">{precision}</span>
      ) : null}
    </div>
  );
}

/** Bloc « rien à afficher » — un vide expliqué vaut mieux qu'un tableau vide. */
export function Vide({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--foreground-muted)]">
      {children}
    </div>
  );
}
