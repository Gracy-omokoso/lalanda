'use client';

// Onglets de l'espace admin plateforme (S21b).
//
// La liste vit dans `admin-model.ts` (testée), le rendu ne connaît aucun cas
// particulier. Les drapeaux viennent du CONTEXTE d'accès — donc du serveur, une
// seule fois pour tout l'espace : voir `admin-access.tsx`.

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useAccesPlateforme } from './admin-access';
import { ADMIN_BASE, ongletsVisibles, segmentActif } from './admin-model';

export function AdminTabs(): React.ReactElement {
  const pathname = usePathname();
  const acces = useAccesPlateforme();

  const courant = segmentActif(pathname);
  const onglets = ongletsVisibles(acces);

  return (
    <nav
      aria-label="Sections de l’administration"
      className="flex flex-wrap gap-1 border-b border-[var(--border)]"
    >
      {onglets.map((tab) => {
        const isActive = courant === tab.segment;
        return (
          <Link
            key={tab.segment || 'tableau-de-bord'}
            href={tab.segment ? `${ADMIN_BASE}/${tab.segment}` : ADMIN_BASE}
            // `aria-current="page"` : l'onglet courant est annoncé au lecteur
            // d'écran, l'information ne repose pas sur la seule bordure colorée.
            aria-current={isActive ? 'page' : undefined}
            className={
              isActive
                ? 'font-mono -mb-px border-b-2 border-[var(--accent)] px-3.5 py-2.5 text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-[var(--foreground)] transition'
                : 'font-mono -mb-px border-b-2 border-transparent px-3.5 py-2.5 text-[0.72rem] font-medium uppercase tracking-[0.08em] text-[var(--foreground-muted)] transition hover:text-[var(--foreground)]'
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
