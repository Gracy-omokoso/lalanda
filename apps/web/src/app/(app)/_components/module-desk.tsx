'use client';

// Bureau d'un module — niveau 2 de la navigation (ADR-0038 § 2) : ses
// applications en grille de tuiles, façon bureau. Deux colonnes sur téléphone.
// La liste vient de `nav-model.ts` (`appsVisibles`), filtrée par les actions
// servies par le serveur ; ce composant ne fait qu'assembler.

import { PageHeader, Skeleton, type ModuleId } from '@lalanda/ui';
import Link from 'next/link';

import { IconeNav } from '@/components/icones-navigation';

import { appsVisibles, moduleParId } from './nav-model';
import { useShell } from './shell-context';

const COULEUR: Record<ModuleId, string> = {
  build: 'text-[var(--module-build)]',
  run: 'text-[var(--module-run)]',
  grow: 'text-[var(--module-grow)]',
};

export function ModuleDesk({ module }: { module: ModuleId }): React.ReactElement {
  const { actions, chargees } = useShell();
  const m = moduleParId(module);
  const apps = appsVisibles(actions, module);

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        module={module}
        moduleLabel={m.verb}
        title={m.label}
        description={m.description}
        descriptionMobile
      />
      {apps.length === 0 && chargees ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--foreground-muted)]">
          Aucune application de {m.label} n’est ouverte à votre rôle dans cette organisation. Un
          Propriétaire ou un Administrateur peut revoir votre rôle.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
          {apps.map((app) => (
            <li key={app.id}>
              <Link
                href={app.href}
                className="group flex h-full flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-card)] motion-reduce:hover:translate-y-0 sm:p-5"
              >
                <span
                  aria-hidden="true"
                  className={`flex h-12 w-12 items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-muted)] ${COULEUR[module]}`}
                >
                  <IconeNav id={app.icon} className="h-7 w-7" />
                </span>
                <span className="flex flex-col gap-1">
                  <span className="font-display text-[0.95rem] font-semibold leading-tight">
                    {app.label}
                  </span>
                  <span className="hidden text-xs leading-5 text-[var(--foreground-muted)] sm:block">
                    {app.description}
                  </span>
                </span>
              </Link>
            </li>
          ))}
          {/* Le reste des tuiles arrive avec les permissions : on réserve leur place
              plutôt que de faire sauter la grille. */}
          {!chargees
            ? [0, 1].map((i) => (
                <li key={`attente-${i}`} aria-hidden="true">
                  <Skeleton className="h-32 rounded-[var(--radius-lg)]" />
                </li>
              ))
            : null}
        </ul>
      )}
    </section>
  );
}
