'use client';

// Onglets de niveau projet (S18d) : Plan · Canvas · Objectifs.
//
// À ne pas confondre avec `SheetTabs` (feuilles de RÉSULTATS à l'intérieur de
// l'onglet Plan). Ici chaque onglet est une route à part entière — l'URL reste
// partageable et le retour navigateur fonctionne.

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface ProjectTab {
  segment: string;
  label: string;
}

const TABS: ProjectTab[] = [
  { segment: '', label: 'Plan' },
  { segment: 'canvas', label: 'Canvas' },
  { segment: 'objectifs', label: 'Objectifs' },
];

export function ProjectTabs({ projectId }: { projectId: string }): React.ReactElement {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;
  // Segment courant relatif au projet ('' pour l'onglet Plan).
  const current = pathname.startsWith(base) ? pathname.slice(base.length).replace(/^\//, '') : '';

  return (
    <nav
      aria-label="Sections du projet"
      className="flex flex-wrap gap-1 border-b border-[var(--border)]"
    >
      {TABS.map((tab) => {
        const href = tab.segment ? `${base}/${tab.segment}` : base;
        const isActive = current === tab.segment;
        return (
          <Link
            key={tab.segment || 'plan'}
            href={href}
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
