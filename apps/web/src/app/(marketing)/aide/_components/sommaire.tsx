// Sommaire d'article (S22d).
//
// Rendu côté serveur, sans surlignage de la section courante : suivre le
// défilement imposerait un composant client et un observateur d'intersection
// pour un gain faible. Les ancres, elles, sont ce qui compte — elles sont
// citées depuis l'application et vérifiées par `liens.test.ts`.

import Link from 'next/link';

import type { SectionAide } from '@/lib/aide/types';

export function Sommaire({
  sections,
  slug,
}: {
  sections: readonly SectionAide[];
  slug: string;
}): React.ReactElement {
  return (
    <nav aria-labelledby={`sommaire-${slug}`} className="lg:sticky lg:top-8">
      <p
        id={`sommaire-${slug}`}
        className="font-mono text-[0.62rem] font-semibold tracking-[0.14em] text-[var(--foreground-muted)]"
      >
        SUR CETTE PAGE
      </p>
      <ol className="mt-3 flex flex-col gap-1 border-l border-[var(--border)]">
        {sections.map((section) => (
          <li key={section.id}>
            <Link
              href={`/aide/${slug}#${section.id}`}
              className="-ml-px block border-l border-transparent py-1.5 pl-3.5 text-[0.88rem] leading-snug text-[var(--foreground-muted)] transition hover:border-[var(--accent)] hover:text-[var(--foreground)]"
            >
              {section.titre}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
