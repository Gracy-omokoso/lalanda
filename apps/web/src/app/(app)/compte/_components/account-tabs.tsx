'use client';

// Onglets de l'espace compte (S20b) : Profil · Sécurité · Préférences.
//
// Même pattern déclaratif que `PROJECT_TABS` (projects/[id]/_components/project-tabs.tsx) :
// pour ajouter une section, on AJOUTE UNE ENTRÉE à `ACCOUNT_TABS` et on crée
// `app/(app)/compte/<segment>/page.tsx`. Aucun cas particulier dans le rendu.
//
// L'ordre du tableau est l'ordre d'affichage. Les sous-routes sont gérées :
// `/compte/securite/sessions` garderait bien l'onglet « Sécurité » actif.

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface AccountTab {
  /** Segment d'URL sous `/compte/`. La chaîne vide = page racine (Profil). */
  segment: string;
  label: string;
}

export const ACCOUNT_TABS: AccountTab[] = [
  { segment: '', label: 'Profil' },
  { segment: 'securite', label: 'Sécurité' },
  { segment: 'preferences', label: 'Préférences' },
];

const BASE = '/compte';

/** Premier segment sous `/compte/` — '' sur la page racine. */
export function activeSegment(pathname: string): string {
  if (!pathname.startsWith(BASE)) return '';
  return pathname.slice(BASE.length).split('/').filter(Boolean)[0] ?? '';
}

export function AccountTabs({ tabs = ACCOUNT_TABS }: { tabs?: AccountTab[] }): React.ReactElement {
  const pathname = usePathname();
  const current = activeSegment(pathname);

  return (
    <nav
      aria-label="Sections du compte"
      className="flex flex-wrap gap-1 border-b border-[var(--border)]"
    >
      {tabs.map((tab) => {
        const isActive = current === tab.segment;
        return (
          <Link
            key={tab.segment || 'profil'}
            href={tab.segment ? `${BASE}/${tab.segment}` : BASE}
            // `aria-current="page"` : le lecteur d'écran annonce l'onglet courant,
            // information qui ne doit pas reposer sur la seule bordure colorée.
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
