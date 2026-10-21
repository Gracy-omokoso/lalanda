'use client';

// Chrome de l'espace Croissance : onglets et droits affichés (ADR-0032 § 8).
// Les permissions sont lues une fois (`GET /me/permissions`) et partagées par
// contexte. Rien ici n'autorise : l'API refuse de toute façon.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';

import { api, type OrgAction } from '@/lib/api';

import { CROISSANCE_BASE, droitsCroissance, GROW_TABS, segmentCroissance } from './grow-model';

interface AccesCroissance {
  pret: boolean;
  declarer: boolean;
  declarerTresorerie: boolean;
}

const Contexte = createContext<AccesCroissance>({
  pret: false,
  declarer: false,
  declarerTresorerie: false,
});

export function useAccesCroissance(): AccesCroissance {
  return useContext(Contexte);
}

export function GrowChrome({ children }: { children: React.ReactNode }): React.ReactElement {
  const pathname = usePathname();
  const [actions, setActions] = useState<OrgAction[] | null>(null);
  const [pret, setPret] = useState(false);

  useEffect(() => {
    let annule = false;
    void api
      .getMyPermissions()
      .then((p) => {
        if (!annule) setActions(p.actions);
      })
      // Permissions illisibles : on n'affiche aucun bouton d'écriture, les pages
      // se chargent et expliquent elles-mêmes un éventuel refus.
      .catch(() => undefined)
      .finally(() => {
        if (!annule) setPret(true);
      });
    return () => {
      annule = true;
    };
  }, []);

  const courant = segmentCroissance(pathname);
  return (
    <Contexte.Provider value={{ pret, ...droitsCroissance(actions) }}>
      <nav
        aria-label="Sections de la croissance"
        className="flex flex-wrap gap-1 border-b border-[var(--border)]"
      >
        {GROW_TABS.map((tab) => {
          const actif = courant === tab.segment;
          return (
            <Link
              key={tab.segment}
              href={`${CROISSANCE_BASE}/${tab.segment}`}
              aria-current={actif ? 'page' : undefined}
              className={
                actif
                  ? 'font-mono -mb-px border-b-2 border-[var(--accent)] px-3.5 py-2.5 text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-[var(--foreground)] transition'
                  : 'font-mono -mb-px border-b-2 border-transparent px-3.5 py-2.5 text-[0.72rem] font-medium uppercase tracking-[0.08em] text-[var(--foreground-muted)] transition hover:text-[var(--foreground)]'
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </Contexte.Provider>
  );
}
