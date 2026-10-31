'use client';

// Frontière d'accès générique d'une application RUN (ADR-0046 — S8) : coquilles
// des Équipements et des Documents. Les droits viennent de la coquille
// (`useShell().actions`), jamais du nom du rôle ; masquer est un confort,
// `PermissionsGuard` refuse côté API de toute façon.

import type { OrgAction } from '@/lib/api';

import { useShell } from './shell-context';

export function AccesApplication({
  action,
  titreRefus,
  texteRefus,
  children,
}: {
  action: OrgAction;
  titreRefus: string;
  texteRefus: string;
  children: React.ReactNode;
}): React.ReactElement {
  const { actions, chargees } = useShell();
  if (!chargees) {
    return (
      <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
        Chargement…
      </p>
    );
  }
  if (actions === null || !actions.includes(action)) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center sm:p-8">
        <p className="text-sm font-medium">{titreRefus}</p>
        <p className="mx-auto mt-1 max-w-xl text-sm text-[var(--foreground-muted)]">
          {texteRefus}
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

/** Phrase d'un écran pas encore livré : jamais de fausses données. */
export function EcranAVenir({ texte }: { texte: string }): React.ReactElement {
  return (
    <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6 text-center text-sm text-[var(--foreground-muted)]">
      {texte}
    </p>
  );
}
