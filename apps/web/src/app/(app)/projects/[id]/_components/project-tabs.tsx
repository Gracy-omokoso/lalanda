'use client';

// Onglets de niveau projet (S18d) : Plan · Canvas · Objectifs.
//
// À ne pas confondre avec `SheetTabs` (feuilles de RÉSULTATS à l'intérieur de
// l'onglet Plan). Ici chaque onglet est une route à part entière — l'URL reste
// partageable et le retour navigateur fonctionne.
//
// ── Point d'extension (arbitrage CTO S18d) ──────────────────────
// C'est la navigation canonique du projet : les chantiers Wizard et Réalisé s'y
// branchent au lieu de gérer leur propre système d'onglets. Pour ajouter une
// section, il suffit d'AJOUTER UNE ENTRÉE à `PROJECT_TABS` ci-dessous et de
// créer `app/(app)/projects/[id]/<segment>/page.tsx` — aucun autre fichier à
// toucher, aucun cas particulier à écrire dans le rendu.
//
//   { segment: 'realise', label: 'Réalisé' }
//   { segment: 'wizard',  label: 'Saisie'  }
//
// L'ordre du tableau est l'ordre d'affichage. Les sous-routes sont gérées :
// `/projects/:id/realise/2026-01` garde bien l'onglet « Réalisé » actif.
//
// ── S23a : « Plan » devient « Saisie » + « Résultats » ──────────
// L'ancien onglet « Plan » portait les deux à la fois. Il est scindé pour que
// la barre dise la vérité sur ce qu'on va trouver derrière : on saisit dans
// « Saisie », on lit dans « Résultats ». La saisie est placée en premier —
// c'est l'ordre du parcours (docs/03 « Construction du plan ») — mais c'est
// « Résultats » qui occupe la racine du projet, parce que consulter est plus
// fréquent que modifier et que les liens `?tab=` déjà partagés y pointent.

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface ProjectTab {
  /** Segment d'URL sous `/projects/:id/`. La chaîne vide = page racine du projet. */
  segment: string;
  label: string;
}

export const PROJECT_TABS: ProjectTab[] = [
  { segment: 'saisie', label: 'Saisie' },
  { segment: '', label: 'Résultats' },
  { segment: 'realise', label: 'Réalisé' },
  { segment: 'canvas', label: 'Canvas' },
  { segment: 'objectifs', label: 'Objectifs' },
];

/** Premier segment sous `/projects/:id/` — '' sur la page racine du projet. */
function activeSegment(pathname: string, base: string): string {
  if (!pathname.startsWith(base)) return '';
  return pathname.slice(base.length).split('/').filter(Boolean)[0] ?? '';
}

export function ProjectTabs({
  projectId,
  tabs = PROJECT_TABS,
}: {
  projectId: string;
  tabs?: ProjectTab[];
}): React.ReactElement {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;
  const current = activeSegment(pathname, base);

  return (
    <nav
      aria-label="Sections du projet"
      className="flex flex-wrap gap-1 border-b border-[var(--border)]"
    >
      {tabs.map((tab) => {
        const isActive = current === tab.segment;
        return (
          <Link
            key={tab.segment || 'plan'}
            href={tab.segment ? `${base}/${tab.segment}` : base}
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
