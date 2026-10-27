'use client';

// Chrome de l'espace Croissance : onglets et droits affichés (ADR-0032 § 8).
// Les permissions sont lues une fois (`GET /me/permissions`) et partagées par
// contexte. Rien ici n'autorise : l'API refuse de toute façon.

import { TabsNav } from '@lalanda/ui';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';

import { renderNextLink } from '@/components/next-link';
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
      <TabsNav
        label="Sections de la croissance"
        renderLink={renderNextLink}
        items={GROW_TABS.map((tab) => ({
          href: `${CROISSANCE_BASE}/${tab.segment}`,
          label: tab.label,
          current: courant === tab.segment,
        }))}
      />
      {children}
    </Contexte.Provider>
  );
}
