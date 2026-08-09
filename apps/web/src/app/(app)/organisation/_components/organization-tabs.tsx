'use client';

// Onglets de l'espace organisation (S21a) : Tableau de bord · Paramètres ·
// Facturation · Journal.
//
// Même pattern déclaratif que `PROJECT_TABS` et `ACCOUNT_TABS` — la liste vit
// dans `organization-model.ts`, le rendu ne connaît aucun cas particulier.
//
// Différence avec l'espace compte : ici, tous les onglets ne s'adressent pas à
// tout le monde. La liste est filtrée par les permissions RÉELLES de l'appelant
// (`GET /me/permissions`), pas par une copie de la matrice côté client — ADR-0012
// §8. Masquer reste un confort : le serveur refuse de toute façon, et la page
// atteinte par URL directe l'explique.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api, type OrgAction } from '@/lib/api';

import { ORGANIZATION_BASE, ongletsVisibles, segmentActif } from './organization-model';

export function OrganizationTabs(): React.ReactElement {
  const pathname = usePathname();
  const [actions, setActions] = useState<OrgAction[] | null>(null);

  useEffect(() => {
    let annule = false;
    void api
      .getMyPermissions()
      .then((p) => {
        if (!annule) setActions(p.actions);
      })
      // Un échec laisse `actions` à `null` : seul le tableau de bord reste
      // proposé. Mieux vaut une navigation réduite qu'une navigation qui promet
      // des pages inaccessibles.
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, []);

  const courant = segmentActif(pathname);
  const onglets = ongletsVisibles(actions);

  return (
    <nav
      aria-label="Sections de l’organisation"
      className="flex flex-wrap gap-1 border-b border-[var(--border)]"
    >
      {onglets.map((tab) => {
        const isActive = courant === tab.segment;
        return (
          <Link
            key={tab.segment || 'tableau-de-bord'}
            href={tab.segment ? `${ORGANIZATION_BASE}/${tab.segment}` : ORGANIZATION_BASE}
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
