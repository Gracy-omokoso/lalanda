// Page d'un module prévu par ADR-0053 dont le lot n'est pas livré.
//
// Un module annoncé dans la navigation doit répondre quelque chose de lisible :
// une 404 passerait pour une panne, une page vide pour un bug. Celle-ci dit ce
// que le module contiendra et qu'il n'existe pas encore — rien de plus. Elle
// n'appelle aucune route.

import Link from 'next/link';

import { CONSOLE_BASE } from './console-model';
import { EnTeteModule } from './en-tete-module';

export function BientotDisponible({ moduleId }: { moduleId: string }): React.ReactElement {
  return (
    <section className="flex flex-col gap-6">
      <EnTeteModule moduleId={moduleId} />
      <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center">
        <p className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-[var(--foreground-muted)]">
          Bientôt disponible
        </p>
        <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--foreground-muted)]">
          Ce module de la console est prévu et n’est pas encore livré. Rien ne s’y fait pour
          l’instant, et aucune donnée n’y est lue.
        </p>
        <p className="mt-4 text-sm">
          <Link href={CONSOLE_BASE} className="underline underline-offset-4 hover:no-underline">
            Retourner au tableau de bord de la console
          </Link>
        </p>
      </div>
    </section>
  );
}
