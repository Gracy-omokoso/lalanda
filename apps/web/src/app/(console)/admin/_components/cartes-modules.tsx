'use client';

// Cartes cliquables des modules ouverts (tableau de bord de la console).
//
// Même source que la navigation (`modulesVisibles`), pour que les deux ne se
// contredisent jamais. Le tableau de bord lui-même n'a pas de carte : on y est.

import Link from 'next/link';

import { useAccesPlateforme } from './admin-access';
import { actionsDe, hrefModule, modulesVisibles } from './console-model';

export function CartesModules(): React.ReactElement {
  const acces = useAccesPlateforme();
  const modules = modulesVisibles(actionsDe(acces)).filter((m) => m.segment !== '');

  return (
    <section aria-labelledby="modules-console" className="flex flex-col gap-3">
      <h2 id="modules-console" className="font-display text-lg font-bold tracking-tight">
        Vos modules
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {modules.map((m) => (
          <li key={m.id}>
            <Link
              href={hrefModule(m)}
              className="flex h-full flex-col gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--accent)] hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold">{m.label}</span>
                {m.etat === 'bientot' ? (
                  <span className="font-mono rounded-full border border-[var(--border)] px-2 py-0.5 text-[0.62rem] uppercase tracking-[0.08em] text-[var(--foreground-muted)]">
                    Bientôt disponible
                  </span>
                ) : null}
              </span>
              <span className="text-sm text-[var(--foreground-muted)]">{m.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
