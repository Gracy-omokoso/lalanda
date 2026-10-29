// Bloc « Projets et tâches » du brief du matin (ADR-0039 § 6.5) : faits du
// moteur, chacun menant à l'écran où agir. Absent sans `work.read`.

import Link from 'next/link';

import type { MorningBriefData } from '@/lib/morning-brief-api';

import { blocTravail } from './brief-travail-model';

export function BriefTravail({ brief }: { brief: MorningBriefData }): React.ReactElement | null {
  const lignes = blocTravail(brief);
  if (!lignes) return null;
  return (
    <section aria-labelledby="brief-travail" className="flex flex-col gap-3">
      <h3 id="brief-travail" className="text-sm font-semibold uppercase tracking-wide">
        Projets et tâches
      </h3>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {lignes.map((l) => (
          <li key={l.id}>
            <Link
              href={l.lien}
              className="flex h-full flex-col gap-1 rounded-lg border border-[var(--border)] p-4 transition hover:bg-[var(--surface-muted)]"
            >
              <span className="text-xs text-[var(--foreground-muted)]">{l.libelle}</span>
              <span
                className={`fig text-lg font-semibold ${l.attention ? 'text-[var(--danger)]' : ''}`}
              >
                {l.valeur}
              </span>
              <span className="text-[11px] text-[var(--foreground-muted)]">{l.regle}</span>
            </Link>
          </li>
        ))}
      </ul>
      <span className="text-[11px] text-[var(--foreground-muted)]">Source : ADR-0039 § 6.5</span>
    </section>
  );
}
